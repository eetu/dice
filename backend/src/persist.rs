//! Optional survive-a-*deploy* persistence. The app is ephemeral by default; when
//! `DICE_STATE_FILE` is set, the live rooms are flushed to a single JSON file on a
//! graceful shutdown (SIGTERM/SIGINT) and reloaded — then the file is consumed —
//! on the next boot. Reconnecting clients re-authenticate with their persisted
//! token and resume where they left off (the server re-sends the full state,
//! including the per-mode view, on WS connect).
//!
//! Scope + caveats:
//!  - Graceful only. A hard crash / OOM-kill / power loss loses everything (there
//!    is no periodic checkpoint) — matching the original ephemeral model for those
//!    cases. The flush happens the instant the signal arrives, BEFORE connections
//!    drain, so an orchestrator's SIGTERM→SIGKILL grace window can't truncate it.
//!  - The file holds secret player tokens (that's what makes resume work), so it
//!    is written `0600` and must live on a non-public path that persists across a
//!    deploy (a mounted volume — the container filesystem is replaced each deploy).
//!  - Version-tagged: a file whose schema version doesn't match the running binary
//!    is discarded (games from the old version are lost, cleanly) rather than
//!    mis-read. Bump [`PERSIST_VERSION`] on any incompatible shape change.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::room::{PersistedRoom, Room, Rooms, PERSIST_VERSION};

/// The on-disk envelope: a schema version plus the flattened rooms.
#[derive(Serialize, Deserialize)]
struct StateFile {
    version: u32,
    rooms: Vec<PersistedRoom>,
}

/// Flush every live room to `path`, written atomically (temp file + rename) so a
/// reader never sees a half-written file. Best-effort: any error is logged and
/// swallowed — a persistence failure must never keep the process from exiting.
pub fn save(rooms: &Rooms, path: &Path) {
    // Snapshot under the locks, then release them before doing IO. A poisoned
    // lock (a handler panicked mid-mutation) still yields the last-good state.
    let persisted: Vec<PersistedRoom> = {
        let map = rooms.lock().unwrap_or_else(|e| e.into_inner());
        map.values()
            .filter_map(|room| {
                room.lock()
                    .map(|r| r.to_persisted())
                    .or_else(|e| Ok::<_, ()>(e.into_inner().to_persisted()))
                    .ok()
            })
            .collect()
    };
    let count = persisted.len();
    let file = StateFile {
        version: PERSIST_VERSION,
        rooms: persisted,
    };
    let bytes = match serde_json::to_vec(&file) {
        Ok(b) => b,
        Err(e) => {
            tracing::error!(error = %e, "failed to serialize game state — games not saved");
            return;
        }
    };
    match write_atomic(path, &bytes) {
        Ok(()) => tracing::info!(rooms = count, path = %path.display(), "saved game state"),
        Err(e) => {
            tracing::error!(error = %e, path = %path.display(), "failed to write game state")
        }
    }
}

/// Load rooms from `path` into the (expected-empty) registry, then delete the
/// file. Returns how many rooms were restored. A missing file, unreadable JSON,
/// or a schema-version mismatch is a clean no-op (start empty — the original
/// behavior). The file is consumed even on a parse error so a corrupt or stale
/// file can't resurrect games on every future boot.
pub fn load(rooms: &Rooms, path: &Path) -> usize {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return 0,
        Err(e) => {
            tracing::warn!(error = %e, path = %path.display(), "could not read game state file");
            return 0;
        }
    };
    // Consume it up-front: whatever happens below, it must not restore again next
    // boot (a stale file would resurrect long-dead games).
    if let Err(e) = fs::remove_file(path) {
        tracing::warn!(error = %e, path = %path.display(), "could not remove game state file after read");
    }
    let file: StateFile = match serde_json::from_slice(&bytes) {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!(error = %e, "game state file unreadable — starting empty");
            return 0;
        }
    };
    if file.version != PERSIST_VERSION {
        tracing::warn!(
            found = file.version,
            expected = PERSIST_VERSION,
            "game state schema mismatch — discarding (games from the previous version are lost)"
        );
        return 0;
    }
    let mut map = rooms.lock().unwrap_or_else(|e| e.into_inner());
    let restored = file.rooms.len();
    for pr in file.rooms {
        map.insert(
            pr.code.clone(),
            Arc::new(Mutex::new(Room::from_persisted(pr))),
        );
    }
    tracing::info!(rooms = restored, "restored game state");
    restored
}

/// Write `bytes` to `path` atomically: create `<path>.tmp` (mode 0600), fsync,
/// then rename over `path` (rename is atomic on the same filesystem).
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        if !dir.as_os_str().is_empty() {
            fs::create_dir_all(dir)?;
        }
    }
    let tmp = tmp_path(path);
    {
        let mut f = fs::File::create(&tmp)?;
        restrict_perms(&f)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

/// Owner-only (0600) — the file holds secret player tokens. No-op off unix.
#[cfg(unix)]
fn restrict_perms(f: &fs::File) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    f.set_permissions(fs::Permissions::from_mode(0o600))
}
#[cfg(not(unix))]
fn restrict_perms(_f: &fs::File) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::room::{new_rooms, ClientMsg, DieKind, DieSpec, Room, YatzyCat};

    fn tmp_file(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "dice-persist-test-{name}-{}.json",
            std::process::id()
        ))
    }

    #[test]
    fn round_trips_rooms_and_tokens() {
        let path = tmp_file("roundtrip");
        let _ = fs::remove_file(&path);

        // A room with a player (whose token must survive) and a history entry.
        let rooms = new_rooms();
        let (id, token) = {
            let mut room = Room::new("ABC12".into(), 8);
            let (id, token) = room.add_player("Alice".into());
            // A mixed tray with per-die materials must survive the round trip.
            room.dice_set = vec![
                DieSpec {
                    kind: DieKind::D20,
                    material: "obsidian".into(),
                },
                DieSpec {
                    kind: DieKind::D6,
                    material: "ruby".into(),
                },
            ];
            rooms
                .lock()
                .unwrap()
                .insert("ABC12".into(), Arc::new(Mutex::new(room)));
            (id, token)
        };

        save(&rooms, &path);
        assert!(path.exists(), "state file should be written");

        // Fresh registry, load back.
        let restored = new_rooms();
        let n = load(&restored, &path);
        assert_eq!(n, 1);
        assert!(!path.exists(), "state file should be consumed on load");

        let map = restored.lock().unwrap();
        let room = map.get("ABC12").expect("room restored").lock().unwrap();
        assert_eq!(room.dice_set.len(), 2);
        assert_eq!(room.dice_set[0].kind, DieKind::D20);
        assert_eq!(room.dice_set[0].material, "obsidian");
        assert_eq!(room.dice_set[1].material, "ruby");
        // The secret token survived → a reconnecting client re-authenticates.
        assert_eq!(
            room.player_id_for_token(&token).as_deref(),
            Some(id.as_str())
        );
        // Restored players start disconnected (no live socket yet).
        assert!(room.players.iter().all(|p| !p.connected));
    }

    #[test]
    fn round_trips_an_in_progress_yatzy_match() {
        // Guards the one non-obvious serde path: YatzyState's scores are a
        // HashMap<YatzyCat, u16>, so persistence relies on the enum serializing
        // as a JSON string map key. A scored box must survive the round trip.
        let path = tmp_file("yatzy");
        let _ = fs::remove_file(&path);

        let rooms = new_rooms();
        let code = {
            let mut room = Room::new("YTZ01".into(), 8);
            let (p0, _) = room.add_player("A".into());
            room.add_player("B".into());
            for p in room.players.iter_mut() {
                p.connected = true;
            }
            // Deal Yatzy, roll, and score Chance (always non-zero) into p0's card.
            room.apply(
                &p0,
                ClientMsg::SetMode {
                    mode: "yatzy".into(),
                },
            );
            room.apply(&p0, ClientMsg::YatzyRoll);
            room.apply(
                &p0,
                ClientMsg::YatzyScore {
                    category: YatzyCat::Chance,
                },
            );
            let code = room.code.clone();
            rooms
                .lock()
                .unwrap()
                .insert(code.clone(), Arc::new(Mutex::new(room)));
            code
        };

        save(&rooms, &path);
        let restored = new_rooms();
        assert_eq!(load(&restored, &path), 1);

        let map = restored.lock().unwrap();
        let room = map.get(&code).expect("room restored").lock().unwrap();
        let view = room.yatzy_view().expect("yatzy match restored");
        // The scored Chance box survived (proves the enum-keyed map round-trips).
        let scored: usize = view.cards.iter().map(|c| c.cells.len()).sum();
        assert_eq!(scored, 1, "the one scored box should persist");
        assert!(view
            .cards
            .iter()
            .any(|c| c.cells.iter().any(|x| x.category == YatzyCat::Chance)));
    }

    #[test]
    fn missing_file_is_a_noop() {
        let path = tmp_file("missing");
        let _ = fs::remove_file(&path);
        let rooms = new_rooms();
        assert_eq!(load(&rooms, &path), 0);
    }

    #[test]
    fn version_mismatch_is_discarded() {
        let path = tmp_file("version");
        let bad = format!(r#"{{"version":{},"rooms":[]}}"#, PERSIST_VERSION + 1);
        fs::write(&path, bad).unwrap();
        let rooms = new_rooms();
        assert_eq!(load(&rooms, &path), 0);
        assert!(!path.exists(), "a mismatched file is still consumed");
    }
}
