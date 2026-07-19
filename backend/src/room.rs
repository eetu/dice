//! In-memory game rooms. Each room is an `Arc<Mutex<Room>>` in a registry keyed
//! by its short join code. A room holds the ordered player list (order == turn
//! order), the current turn, dice settings, roll history, and a per-room
//! `broadcast::Sender` for fanning state out to every connected client (the
//! `nib` pattern). Rooms are ephemeral — reaped by TTL (see `lib::reap_loop`).
//!
//! The wire protocol lives here too: [`ServerMsg`] (server→client) and
//! [`ClientMsg`] (client→server). Field names serialize as camelCase to match
//! the hand-written TS types in the SPA.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use rand::Rng;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use uuid::Uuid;

/// Registry of live rooms, keyed by join code.
pub type Rooms = Arc<Mutex<HashMap<String, Arc<Mutex<Room>>>>>;

pub fn new_rooms() -> Rooms {
    Arc::new(Mutex::new(HashMap::new()))
}

// Crockford-ish alphabet: no 0/O/1/I/L/U to keep codes unambiguous when read
// aloud or typed from a QR-less phone.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTVWXYZ23456789";
const CODE_LEN: usize = 5;
const MAX_HISTORY: usize = 500;
const MAX_NAME_LEN: usize = 24;

/// Mint a fresh join code not already present in `existing`.
pub fn gen_code(existing: &HashMap<String, Arc<Mutex<Room>>>) -> String {
    let mut rng = rand::rng();
    loop {
        let code: String = (0..CODE_LEN)
            .map(|_| CODE_ALPHABET[rng.random_range(0..CODE_ALPHABET.len())] as char)
            .collect();
        if !existing.contains_key(&code) {
            return code;
        }
    }
}

/// A participant. `token` is the secret used to authenticate WS + actions and is
/// never serialized; `id` is the public identifier used in every message.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: String,
    #[serde(skip)]
    pub token: String,
    pub name: String,
    pub connected: bool,
}

/// One completed roll, kept in the room's history for its lifetime.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollRecord {
    pub id: u64,
    pub player_id: String,
    pub player_name: String,
    /// Face values, each 1..=6.
    pub dice: Vec<u8>,
    pub total: u32,
    /// Unix milliseconds.
    pub ts: i64,
}

/// Full room state — sent on connect and after any structural change.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub code: String,
    pub players: Vec<Player>,
    pub turn_idx: usize,
    pub current_player_id: Option<String>,
    pub dice_count: u8,
    pub dice_theme: String,
    pub deck: String,
    pub history: Vec<RollRecord>,
}

/// Server → client messages.
#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ServerMsg {
    /// Full state replace (join/leave/reorder/dice-count/theme/name).
    Sync { state: Snapshot },
    /// A roll happened — triggers the dice animation + history append.
    Rolled {
        record: RollRecord,
        turn_idx: usize,
        current_player_id: Option<String>,
    },
    /// A player's connection flipped.
    Presence { player_id: String, connected: bool },
}

/// Client → server messages.
#[derive(Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ClientMsg {
    /// Throw the dice (only honored on the sender's turn).
    Roll,
    /// New turn order — a permutation of the current player ids.
    Reorder {
        order: Vec<String>,
    },
    SetDiceCount {
        count: u8,
    },
    SetName {
        name: String,
    },
    SetDiceTheme {
        theme: String,
    },
    /// Change the table (deck) material, room-wide.
    SetDeck {
        deck: String,
    },
    /// Force the turn forward (e.g. the current player is offline).
    SkipTurn,
    /// Remove yourself from the game.
    Leave,
}

pub struct Room {
    pub code: String,
    pub players: Vec<Player>,
    pub turn_idx: usize,
    pub dice_count: u8,
    pub dice_theme: String,
    pub deck: String,
    pub history: Vec<RollRecord>,
    pub tx: broadcast::Sender<ServerMsg>,
    pub last_activity: Instant,
    roll_seq: u64,
    max_dice: u8,
}

impl Room {
    pub fn new(code: String, max_dice: u8) -> Self {
        let (tx, _rx) = broadcast::channel(256);
        Room {
            code,
            players: Vec::new(),
            turn_idx: 0,
            dice_count: 2,
            dice_theme: "ivory".into(),
            deck: "felt-green".into(),
            history: Vec::new(),
            tx,
            last_activity: Instant::now(),
            roll_seq: 0,
            max_dice,
        }
    }

    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    /// Add a player, returning `(public_id, secret_token)`.
    pub fn add_player(&mut self, name: String) -> (String, String) {
        let id = Uuid::new_v4().to_string();
        let token = Uuid::new_v4().to_string();
        let name = sanitize_name(name, self.players.len());
        self.players.push(Player {
            id: id.clone(),
            token: token.clone(),
            name,
            connected: false,
        });
        self.touch();
        (id, token)
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn player_id_for_token(&self, token: &str) -> Option<String> {
        self.players
            .iter()
            .find(|p| p.token == token)
            .map(|p| p.id.clone())
    }

    pub fn current_player_id(&self) -> Option<String> {
        self.players.get(self.turn_idx).map(|p| p.id.clone())
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            code: self.code.clone(),
            players: self.players.clone(),
            turn_idx: self.turn_idx,
            current_player_id: self.current_player_id(),
            dice_count: self.dice_count,
            dice_theme: self.dice_theme.clone(),
            deck: self.deck.clone(),
            history: self.history.clone(),
        }
    }

    /// Broadcast the full state to every subscriber.
    pub fn broadcast_sync(&self) {
        let _ = self.tx.send(ServerMsg::Sync {
            state: self.snapshot(),
        });
    }

    /// Mark a player connected/disconnected and broadcast presence.
    pub fn set_connected(&mut self, player_id: &str, connected: bool) {
        if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
            p.connected = connected;
        }
        self.touch();
        let _ = self.tx.send(ServerMsg::Presence {
            player_id: player_id.to_string(),
            connected,
        });
    }

    fn advance_turn(&mut self) {
        let n = self.players.len();
        if n == 0 {
            self.turn_idx = 0;
            return;
        }
        // Advance to the next player in order — do NOT skip disconnected players.
        // A brief drop (phone standby, tab switch, flaky wifi) keeps that player's
        // turn and the game waits for them; others can force past a truly-gone
        // player with an explicit SkipTurn.
        self.turn_idx = (self.turn_idx + 1) % n;
    }

    /// Apply a client message from `actor_id`, mutating state and broadcasting.
    pub fn apply(&mut self, actor_id: &str, msg: ClientMsg) {
        self.touch();
        match msg {
            ClientMsg::Roll => self.roll(actor_id),
            ClientMsg::Reorder { order } => self.reorder(order),
            ClientMsg::SetDiceCount { count } => {
                self.dice_count = count.clamp(1, self.max_dice);
                self.broadcast_sync();
            }
            ClientMsg::SetName { name } => {
                let clean = sanitize_name(name, 0);
                if let Some(p) = self.players.iter_mut().find(|p| p.id == actor_id) {
                    p.name = clean.clone();
                }
                // History keys off the stable player id, so reflect the rename in
                // this player's past rolls too — the name stays consistent.
                for rec in self.history.iter_mut() {
                    if rec.player_id == actor_id {
                        rec.player_name = clean.clone();
                    }
                }
                self.broadcast_sync();
            }
            ClientMsg::SetDiceTheme { theme } => {
                self.dice_theme = sanitize_theme(theme);
                self.broadcast_sync();
            }
            ClientMsg::SetDeck { deck } => {
                self.deck = sanitize_slug(deck, "felt-green");
                self.broadcast_sync();
            }
            ClientMsg::SkipTurn => {
                self.advance_turn();
                self.broadcast_sync();
            }
            ClientMsg::Leave => self.remove_player(actor_id),
        }
    }

    fn roll(&mut self, actor_id: &str) {
        // Server is the authority: only the current player may roll, and the
        // faces are generated here so every client animates to the same result.
        if self.current_player_id().as_deref() != Some(actor_id) {
            return;
        }
        let mut rng = rand::rng();
        let dice: Vec<u8> = (0..self.dice_count)
            .map(|_| rng.random_range(1..=6))
            .collect();
        let total: u32 = dice.iter().map(|&d| d as u32).sum();
        self.roll_seq += 1;
        let player_name = self
            .players
            .iter()
            .find(|p| p.id == actor_id)
            .map(|p| p.name.clone())
            .unwrap_or_default();
        let record = RollRecord {
            id: self.roll_seq,
            player_id: actor_id.to_string(),
            player_name,
            dice,
            total,
            ts: chrono::Utc::now().timestamp_millis(),
        };
        self.history.push(record.clone());
        if self.history.len() > MAX_HISTORY {
            let excess = self.history.len() - MAX_HISTORY;
            self.history.drain(0..excess);
        }
        self.advance_turn();
        let _ = self.tx.send(ServerMsg::Rolled {
            record,
            turn_idx: self.turn_idx,
            current_player_id: self.current_player_id(),
        });
    }

    fn reorder(&mut self, order: Vec<String>) {
        // Validate `order` is a permutation of the current ids before touching
        // state, so malformed input can't corrupt the room.
        if order.len() != self.players.len() {
            return;
        }
        let mut seen = HashSet::new();
        for id in &order {
            if !self.players.iter().any(|p| &p.id == id) || !seen.insert(id.clone()) {
                return;
            }
        }
        let current_id = self.current_player_id();
        let mut remaining = std::mem::take(&mut self.players);
        let mut reordered = Vec::with_capacity(order.len());
        for id in &order {
            if let Some(pos) = remaining.iter().position(|p| &p.id == id) {
                reordered.push(remaining.remove(pos));
            }
        }
        self.players = reordered;
        // Keep the turn pointing at the same player after the shuffle.
        if let Some(cid) = current_id {
            if let Some(pos) = self.players.iter().position(|p| p.id == cid) {
                self.turn_idx = pos;
            }
        }
        self.broadcast_sync();
    }

    fn remove_player(&mut self, actor_id: &str) {
        if let Some(pos) = self.players.iter().position(|p| p.id == actor_id) {
            self.players.remove(pos);
            if self.players.is_empty() {
                self.turn_idx = 0;
            } else {
                if pos < self.turn_idx {
                    self.turn_idx -= 1;
                }
                self.turn_idx %= self.players.len();
            }
        }
        self.broadcast_sync();
    }
}

fn sanitize_name(name: String, index: usize) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_LEN)
        .collect();
    if cleaned.is_empty() {
        format!("Player {}", index + 1)
    } else {
        cleaned
    }
}

fn sanitize_theme(theme: String) -> String {
    sanitize_slug(theme, "ivory")
}

/// A safe short slug (alphanumeric + hyphen), falling back to `default` if empty.
fn sanitize_slug(s: String, default: &str) -> String {
    let t: String = s
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(MAX_NAME_LEN)
        .collect();
    if t.is_empty() {
        default.to_string()
    } else {
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn room_with(n: usize) -> Room {
        let mut room = Room::new("TEST1".into(), 8);
        for i in 0..n {
            room.add_player(format!("P{i}"));
        }
        for p in room.players.iter_mut() {
            p.connected = true;
        }
        room
    }

    fn ids(room: &Room) -> Vec<String> {
        room.players.iter().map(|p| p.id.clone()).collect()
    }

    #[test]
    fn roll_only_on_your_turn() {
        let mut room = room_with(2);
        let id = ids(&room);
        // Out of turn — ignored.
        room.apply(&id[1], ClientMsg::Roll);
        assert_eq!(room.history.len(), 0);
        // In turn — recorded, turn advances.
        room.apply(&id[0], ClientMsg::Roll);
        assert_eq!(room.history.len(), 1);
        assert_eq!(room.current_player_id().as_deref(), Some(id[1].as_str()));
    }

    #[test]
    fn roll_produces_valid_faces() {
        let mut room = room_with(1);
        let id = ids(&room);
        room.apply(&id[0], ClientMsg::SetDiceCount { count: 5 });
        room.apply(&id[0], ClientMsg::Roll);
        let rec = &room.history[0];
        assert_eq!(rec.dice.len(), 5);
        assert!(rec.dice.iter().all(|&d| (1..=6).contains(&d)));
        assert_eq!(rec.total, rec.dice.iter().map(|&d| d as u32).sum::<u32>());
    }

    #[test]
    fn dice_count_clamped() {
        let mut room = room_with(1);
        let id = ids(&room);
        room.apply(&id[0], ClientMsg::SetDiceCount { count: 99 });
        assert_eq!(room.dice_count, 8);
        room.apply(&id[0], ClientMsg::SetDiceCount { count: 0 });
        assert_eq!(room.dice_count, 1);
    }

    #[test]
    fn reorder_keeps_turn_on_same_player() {
        let mut room = room_with(3);
        let id = ids(&room);
        room.apply(&id[0], ClientMsg::Roll);
        assert_eq!(room.current_player_id().as_deref(), Some(id[1].as_str()));
        let new_order = vec![id[2].clone(), id[1].clone(), id[0].clone()];
        room.apply(&id[0], ClientMsg::Reorder { order: new_order });
        assert_eq!(room.current_player_id().as_deref(), Some(id[1].as_str()));
    }

    #[test]
    fn reorder_rejects_non_permutation() {
        let mut room = room_with(2);
        let id = ids(&room);
        let bad = vec![id[0].clone(), id[0].clone()];
        room.apply(&id[0], ClientMsg::Reorder { order: bad });
        // Unchanged.
        assert_eq!(ids(&room), id);
    }

    #[test]
    fn advance_waits_for_disconnected() {
        // A disconnected player keeps their turn (the game waits for them) — the
        // turn is NOT auto-skipped to the next connected player.
        let mut room = room_with(3);
        let id = ids(&room);
        room.players[1].connected = false;
        room.apply(&id[0], ClientMsg::Roll);
        assert_eq!(room.current_player_id().as_deref(), Some(id[1].as_str()));
    }

    #[test]
    fn skip_turn_advances_past_current() {
        // Others can still force past a player who is genuinely gone.
        let mut room = room_with(3);
        let id = ids(&room);
        room.players[1].connected = false;
        room.apply(&id[0], ClientMsg::Roll); // lands on the offline player 1
        room.apply(&id[0], ClientMsg::SkipTurn); // force past → player 2
        assert_eq!(room.current_player_id().as_deref(), Some(id[2].as_str()));
    }

    #[test]
    fn rename_updates_history() {
        let mut room = room_with(2);
        let id = ids(&room);
        room.apply(&id[0], ClientMsg::Roll);
        assert_eq!(room.history[0].player_name, "P0");
        room.apply(
            &id[0],
            ClientMsg::SetName {
                name: "Renamed".into(),
            },
        );
        assert_eq!(room.players[0].name, "Renamed");
        assert_eq!(room.history[0].player_name, "Renamed");
    }

    #[test]
    fn sets_deck_with_fallback() {
        let mut room = room_with(1);
        let id = ids(&room);
        room.apply(
            &id[0],
            ClientMsg::SetDeck {
                deck: "felt-red".into(),
            },
        );
        assert_eq!(room.deck, "felt-red");
        room.apply(
            &id[0],
            ClientMsg::SetDeck {
                deck: String::new(),
            },
        );
        assert_eq!(room.deck, "felt-green");
    }

    #[test]
    fn leave_fixes_turn_index() {
        let mut room = room_with(3);
        let id = ids(&room);
        room.apply(&id[0], ClientMsg::Roll); // turn -> id[1]
        room.apply(&id[0], ClientMsg::Leave); // remove index 0
                                              // turn_idx should still point at id[1], now at index 0
        assert_eq!(room.current_player_id().as_deref(), Some(id[1].as_str()));
        assert_eq!(room.players.len(), 2);
    }
}
