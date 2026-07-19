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

use rand::RngExt; // rand 0.10 moved `random_range` from `Rng` to `RngExt`
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

/// Which game the room is playing. `free` = the plain roller (default); `liars` =
/// Liar's Dice (hidden per-player dice, bidding + calling).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Free,
    Liars,
}

/// A Liar's Dice bid: "at least `quantity` dice showing `face`" across ALL cups.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bid {
    pub player_id: String,
    pub quantity: u32,
    pub face: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LiarsPhase {
    /// Someone must raise the bid or call "liar".
    Bidding,
    /// A call happened — all dice are revealed; tap to start the next round.
    Reveal,
    /// One player left standing.
    Over,
}

/// One player's full hand, only sent in a `reveal` (the payoff moment).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandReveal {
    pub player_id: String,
    pub dice: Vec<u8>,
}

/// The outcome of a "liar" call — every cup revealed + who lost a die.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reveal {
    pub hands: Vec<HandReveal>,
    pub bid: Bid,
    pub caller_id: String,
    pub actual: u32,
    pub loser_id: String,
    pub bid_was_true: bool,
}

/// A player as seen in a Liar's Dice view — only the public count, never values.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiarsPlayerView {
    pub player_id: String,
    pub dice_count: u8,
    pub out: bool,
}

/// A per-viewer Liar's Dice view: your own hand in full, everyone else only by
/// count (their values are NEVER serialized here — that's the whole game). Built
/// per-socket in the WS layer so a client can't read hidden dice off the wire.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiarsView {
    pub phase: LiarsPhase,
    pub current_player_id: Option<String>,
    pub bid: Option<Bid>,
    pub total_dice: u32,
    pub players: Vec<LiarsPlayerView>,
    pub your_dice: Vec<u8>,
    pub reveal: Option<Reveal>,
    pub winner: Option<String>,
    pub start_dice: u8,
}

/// Full room state — sent on connect and after any structural change.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub code: String,
    pub players: Vec<Player>,
    pub mode: Mode,
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
    /// Liar's Dice state changed — a per-socket rebuild signal (never carries
    /// hidden dice). The WS layer turns this into a personalized `Liars` message.
    LiarsChanged,
    /// A personalized Liar's Dice view — built + sent per-socket, never broadcast.
    Liars { view: LiarsView },
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
    /// Switch the room's game mode ("free" | "liars"); starts a fresh match.
    SetMode {
        mode: String,
    },
    /// Liar's Dice: raise the standing bid.
    Bid {
        quantity: u32,
        face: u8,
    },
    /// Liar's Dice: call the previous bidder a liar (reveal + resolve).
    CallLiar,
    /// Liar's Dice: from the reveal, deal the next round.
    NextRound,
    /// Remove yourself from the game.
    Leave,
}

/// Liar's Dice match state (present only while `mode == Liars`). Hidden dice live
/// here; they're only ever exposed through `liars_view` (your own) or a `Reveal`.
struct LiarsState {
    /// Turn order (player ids), captured at match start. Stable across the match;
    /// joiners after start spectate until the next `SetMode`.
    order: Vec<String>,
    /// Each participant's current hand (1..=6 faces). Empty vec = eliminated.
    dice: HashMap<String, Vec<u8>>,
    /// Index into `order` of the current bidder/caller (during Reveal, the player
    /// who will bid first next round).
    turn: usize,
    bid: Option<Bid>,
    phase: LiarsPhase,
    reveal: Option<Reveal>,
    winner: Option<String>,
    start_dice: u8,
}

impl LiarsState {
    /// Total dice still in play across all cups.
    fn total(&self) -> u32 {
        self.dice.values().map(|d| d.len() as u32).sum()
    }
    /// Is this player still holding dice?
    fn in_play(&self, id: &str) -> bool {
        self.dice.get(id).map(|d| !d.is_empty()).unwrap_or(false)
    }
    /// Indices (into `order`) of participants who still have dice.
    fn active(&self) -> Vec<usize> {
        self.order
            .iter()
            .enumerate()
            .filter(|(_, id)| self.in_play(id))
            .map(|(i, _)| i)
            .collect()
    }
    /// Next in-play index after `from` (wrapping); does NOT skip disconnected —
    /// like free mode, the table waits for a dropped player (they can `Leave`).
    fn next_active(&self, from: usize) -> Option<usize> {
        let n = self.order.len();
        if n == 0 {
            return None;
        }
        (1..=n)
            .map(|s| (from + s) % n)
            .find(|&i| self.in_play(&self.order[i]))
    }
    fn current_id(&self) -> Option<String> {
        if self.phase == LiarsPhase::Over {
            return None;
        }
        self.order.get(self.turn).cloned()
    }
}

pub struct Room {
    pub code: String,
    pub players: Vec<Player>,
    pub mode: Mode,
    pub turn_idx: usize,
    pub dice_count: u8,
    pub dice_theme: String,
    pub deck: String,
    pub history: Vec<RollRecord>,
    pub tx: broadcast::Sender<ServerMsg>,
    pub last_activity: Instant,
    liars: Option<LiarsState>,
    roll_seq: u64,
    max_dice: u8,
}

impl Room {
    pub fn new(code: String, max_dice: u8) -> Self {
        let (tx, _rx) = broadcast::channel(256);
        Room {
            code,
            players: Vec::new(),
            mode: Mode::Free,
            turn_idx: 0,
            dice_count: 2,
            dice_theme: "ivory".into(),
            deck: "felt-green".into(),
            history: Vec::new(),
            tx,
            last_activity: Instant::now(),
            liars: None,
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
            mode: self.mode,
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
            ClientMsg::SetMode { mode } => self.set_mode(&mode),
            ClientMsg::Bid { quantity, face } => self.liars_bid(actor_id, quantity, face),
            ClientMsg::CallLiar => self.liars_call(actor_id),
            ClientMsg::NextRound => self.liars_next_round(actor_id),
            ClientMsg::Leave => self.remove_player(actor_id),
        }
    }

    fn roll(&mut self, actor_id: &str) {
        // Free-mode action only.
        if self.mode != Mode::Free {
            return;
        }
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
        // A leaver drops out of any Liar's Dice match in progress.
        if let Some(g) = self.liars.as_mut() {
            g.dice.remove(actor_id);
            if g.phase != LiarsPhase::Over {
                let active = g.active();
                if active.len() <= 1 {
                    g.winner = active.first().and_then(|&i| g.order.get(i).cloned());
                    g.phase = LiarsPhase::Over;
                    g.bid = None;
                } else if g.order.get(g.turn).map(|s| s.as_str()) == Some(actor_id) {
                    if let Some(next) = g.next_active(g.turn) {
                        g.turn = next;
                    }
                }
            }
        }
        self.broadcast_liars();
        self.broadcast_sync();
    }

    // ---------- Liar's Dice ----------

    /// Roll a fresh hand of `n` dice (1..=6 each).
    fn roll_hand(n: u8) -> Vec<u8> {
        let mut rng = rand::rng();
        (0..n).map(|_| rng.random_range(1..=6)).collect()
    }

    /// Switch game mode. Entering `liars` deals a fresh match to the current
    /// players; anything else falls back to free mode.
    fn set_mode(&mut self, mode: &str) {
        match mode {
            "liars" => {
                self.mode = Mode::Liars;
                self.start_liars();
            }
            _ => {
                self.mode = Mode::Free;
                self.liars = None;
            }
        }
        self.broadcast_sync(); // the `mode` field changed for everyone
        self.broadcast_liars(); // deal the (personalized) view
    }

    fn start_liars(&mut self) {
        let start_dice = 5u8;
        let order: Vec<String> = self.players.iter().map(|p| p.id.clone()).collect();
        let mut dice = HashMap::new();
        for id in &order {
            dice.insert(id.clone(), Self::roll_hand(start_dice));
        }
        self.liars = Some(LiarsState {
            order,
            dice,
            turn: 0,
            bid: None,
            phase: LiarsPhase::Bidding,
            reveal: None,
            winner: None,
            start_dice,
        });
    }

    /// Raise the standing bid (simple rules: strictly higher quantity, or same
    /// quantity at a higher face). Only the current player, only while bidding.
    fn liars_bid(&mut self, actor: &str, quantity: u32, face: u8) {
        {
            let Some(g) = self.liars.as_mut() else {
                return;
            };
            if g.phase != LiarsPhase::Bidding {
                return;
            }
            if !(1..=6).contains(&face) {
                return;
            }
            if g.order.get(g.turn).map(|s| s.as_str()) != Some(actor) {
                return;
            }
            if quantity < 1 || quantity > g.total() {
                return;
            }
            if let Some(prev) = &g.bid {
                let higher =
                    quantity > prev.quantity || (quantity == prev.quantity && face > prev.face);
                if !higher {
                    return;
                }
            }
            g.bid = Some(Bid {
                player_id: actor.to_string(),
                quantity,
                face,
            });
            if let Some(next) = g.next_active(g.turn) {
                g.turn = next;
            }
        }
        self.broadcast_liars();
    }

    /// Call "liar" on the standing bid: reveal all cups, count the bid face
    /// (no wilds), and dock a die from whoever was wrong.
    fn liars_call(&mut self, actor: &str) {
        {
            let Some(g) = self.liars.as_mut() else {
                return;
            };
            if g.phase != LiarsPhase::Bidding {
                return;
            }
            if g.order.get(g.turn).map(|s| s.as_str()) != Some(actor) {
                return;
            }
            let Some(bid) = g.bid.clone() else {
                return; // nothing to call
            };
            // 1s (aces) are wild — they count toward any bid face, except a bid
            // made ON aces (then only literal 1s count).
            let actual: u32 = g
                .dice
                .values()
                .flat_map(|d| d.iter())
                .filter(|&&f| f == bid.face || (bid.face != 1 && f == 1))
                .count() as u32;
            let bid_was_true = actual >= bid.quantity;
            let loser_id = if bid_was_true {
                actor.to_string()
            } else {
                bid.player_id.clone()
            };
            // Reveal captures every hand as it stood (before the die is docked).
            let hands: Vec<HandReveal> = g
                .order
                .iter()
                .filter_map(|id| {
                    g.dice.get(id).map(|d| HandReveal {
                        player_id: id.clone(),
                        dice: d.clone(),
                    })
                })
                .collect();
            if let Some(hand) = g.dice.get_mut(&loser_id) {
                hand.pop();
            }
            g.reveal = Some(Reveal {
                hands,
                bid,
                caller_id: actor.to_string(),
                actual,
                loser_id: loser_id.clone(),
                bid_was_true,
            });
            g.bid = None;
            let active = g.active();
            if active.len() <= 1 {
                g.winner = active.first().and_then(|&i| g.order.get(i).cloned());
                g.phase = LiarsPhase::Over;
            } else {
                g.phase = LiarsPhase::Reveal;
                // The loser opens the next round (or the next player if they're out).
                let loser_idx = g.order.iter().position(|id| id == &loser_id).unwrap_or(0);
                g.turn = if g.in_play(&loser_id) {
                    loser_idx
                } else {
                    g.next_active(loser_idx).unwrap_or(loser_idx)
                };
            }
        }
        self.broadcast_liars();
    }

    /// From the reveal, deal the next round (re-roll every surviving cup).
    fn liars_next_round(&mut self, actor: &str) {
        {
            let Some(g) = self.liars.as_mut() else {
                return;
            };
            if g.phase != LiarsPhase::Reveal {
                return;
            }
            if !g.in_play(actor) {
                return; // only a participant still in the match may deal
            }
            let ids: Vec<String> = g.dice.keys().cloned().collect();
            for id in ids {
                if let Some(hand) = g.dice.get_mut(&id) {
                    if !hand.is_empty() {
                        *hand = Self::roll_hand(hand.len() as u8);
                    }
                }
            }
            g.bid = None;
            g.reveal = None;
            g.phase = LiarsPhase::Bidding;
            // `turn` already points at the round starter (set in liars_call).
        }
        self.broadcast_liars();
    }

    /// Build a per-viewer Liar's Dice view: the viewer's own hand in full, and
    /// only counts for everyone else (their values are never serialized here).
    pub fn liars_view(&self, viewer_id: &str) -> Option<LiarsView> {
        let g = self.liars.as_ref()?;
        let players = g
            .order
            .iter()
            .map(|id| {
                let count = g.dice.get(id).map(|d| d.len()).unwrap_or(0) as u8;
                LiarsPlayerView {
                    player_id: id.clone(),
                    dice_count: count,
                    out: count == 0,
                }
            })
            .collect();
        Some(LiarsView {
            phase: g.phase,
            current_player_id: g.current_id(),
            bid: g.bid.clone(),
            total_dice: g.total(),
            players,
            your_dice: g.dice.get(viewer_id).cloned().unwrap_or_default(),
            reveal: g.reveal.clone(),
            winner: g.winner.clone(),
            start_dice: g.start_dice,
        })
    }

    /// Signal every socket to rebuild its personalized Liar's Dice view.
    pub fn broadcast_liars(&self) {
        if self.mode == Mode::Liars {
            let _ = self.tx.send(ServerMsg::LiarsChanged);
        }
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

    // ---------- Liar's Dice ----------

    fn start_liars_room(n: usize) -> (Room, Vec<String>) {
        let mut room = room_with(n);
        let id = ids(&room);
        room.apply(&id[0], ClientMsg::SetMode { mode: "liars".into() });
        (room, id)
    }

    /// Overwrite a player's hidden hand for deterministic tests.
    fn set_hand(room: &mut Room, id: &str, hand: Vec<u8>) {
        room.liars.as_mut().unwrap().dice.insert(id.to_string(), hand);
    }

    #[test]
    fn liars_start_deals_five_each() {
        let (room, id) = start_liars_room(3);
        assert_eq!(room.mode, Mode::Liars);
        for pid in &id {
            let v = room.liars_view(pid).unwrap();
            assert_eq!(v.phase, LiarsPhase::Bidding);
            assert_eq!(v.your_dice.len(), 5);
            assert!(v.your_dice.iter().all(|&f| (1..=6).contains(&f)));
            assert_eq!(v.total_dice, 15);
        }
        // First player opens the bidding.
        assert_eq!(
            room.liars_view(&id[0]).unwrap().current_player_id.as_deref(),
            Some(id[0].as_str())
        );
    }

    #[test]
    fn liars_view_hides_other_hands() {
        let (mut room, id) = start_liars_room(2);
        set_hand(&mut room, &id[0], vec![1, 2, 3, 4, 5]);
        set_hand(&mut room, &id[1], vec![6, 6, 6, 6, 6]);
        // Each viewer sees only their own faces; others are just counts.
        assert_eq!(room.liars_view(&id[0]).unwrap().your_dice, vec![1, 2, 3, 4, 5]);
        assert_eq!(room.liars_view(&id[1]).unwrap().your_dice, vec![6, 6, 6, 6, 6]);
        // Counts are public and agree.
        let v = room.liars_view(&id[0]).unwrap();
        assert!(v.players.iter().all(|p| p.dice_count == 5));
    }

    #[test]
    fn liars_bid_must_raise() {
        let (mut room, id) = start_liars_room(2);
        room.apply(&id[0], ClientMsg::Bid { quantity: 2, face: 3 });
        // Not a raise (lower face) — ignored; bid + turn unchanged.
        room.apply(&id[1], ClientMsg::Bid { quantity: 2, face: 2 });
        let v = room.liars_view(&id[1]).unwrap();
        assert_eq!(v.bid.as_ref().unwrap().quantity, 2);
        assert_eq!(v.bid.as_ref().unwrap().face, 3);
        assert_eq!(v.current_player_id.as_deref(), Some(id[1].as_str()));
        // A real raise — accepted; turn returns to id[0].
        room.apply(&id[1], ClientMsg::Bid { quantity: 3, face: 1 });
        let v2 = room.liars_view(&id[0]).unwrap();
        assert_eq!(v2.bid.as_ref().unwrap().quantity, 3);
        assert_eq!(v2.current_player_id.as_deref(), Some(id[0].as_str()));
    }

    #[test]
    fn liars_call_false_bid_docks_bidder() {
        let (mut room, id) = start_liars_room(2);
        set_hand(&mut room, &id[0], vec![2, 2, 2, 2, 2]);
        set_hand(&mut room, &id[1], vec![3, 3, 3, 3, 3]);
        room.apply(&id[0], ClientMsg::Bid { quantity: 3, face: 6 }); // no 6s, no wild 1s → false
        room.apply(&id[1], ClientMsg::CallLiar);
        let v = room.liars_view(&id[1]).unwrap();
        assert_eq!(v.phase, LiarsPhase::Reveal);
        let rev = v.reveal.as_ref().unwrap();
        assert!(!rev.bid_was_true);
        assert_eq!(rev.actual, 0);
        assert_eq!(rev.loser_id, id[0]);
        let p0 = v.players.iter().find(|p| p.player_id == id[0]).unwrap();
        assert_eq!(p0.dice_count, 4); // bidder lost one
    }

    #[test]
    fn liars_call_true_bid_docks_caller() {
        let (mut room, id) = start_liars_room(2);
        set_hand(&mut room, &id[0], vec![6, 6, 6, 1, 1]);
        set_hand(&mut room, &id[1], vec![6, 2, 2, 2, 2]);
        room.apply(&id[0], ClientMsg::Bid { quantity: 3, face: 6 }); // four 6s + two wild 1s → true
        room.apply(&id[1], ClientMsg::CallLiar);
        let v = room.liars_view(&id[1]).unwrap();
        let rev = v.reveal.as_ref().unwrap();
        assert!(rev.bid_was_true);
        assert_eq!(rev.actual, 6); // four 6s + two wild 1s
        assert_eq!(rev.loser_id, id[1]);
        let p1 = v.players.iter().find(|p| p.player_id == id[1]).unwrap();
        assert_eq!(p1.dice_count, 4); // caller lost one
    }

    #[test]
    fn liars_last_player_standing_wins() {
        let (mut room, id) = start_liars_room(2);
        set_hand(&mut room, &id[0], vec![6, 6, 6, 6, 6]);
        set_hand(&mut room, &id[1], vec![3]); // one die left
        room.apply(&id[0], ClientMsg::Bid { quantity: 5, face: 6 }); // true
        room.apply(&id[1], ClientMsg::CallLiar); // caller loses last die → out
        let v = room.liars_view(&id[0]).unwrap();
        assert_eq!(v.phase, LiarsPhase::Over);
        assert_eq!(v.winner.as_deref(), Some(id[0].as_str()));
        assert_eq!(v.current_player_id, None);
    }

    #[test]
    fn liars_next_round_rerolls_and_loser_starts() {
        let (mut room, id) = start_liars_room(2);
        set_hand(&mut room, &id[0], vec![2, 2, 2, 2, 2]);
        set_hand(&mut room, &id[1], vec![3, 3, 3, 3, 3]);
        room.apply(&id[0], ClientMsg::Bid { quantity: 3, face: 6 }); // false → id[0] loses
        room.apply(&id[1], ClientMsg::CallLiar);
        // Loser (id[0]) opens the next round.
        assert_eq!(
            room.liars_view(&id[1]).unwrap().current_player_id.as_deref(),
            Some(id[0].as_str())
        );
        room.apply(&id[1], ClientMsg::NextRound);
        let v = room.liars_view(&id[0]).unwrap();
        assert_eq!(v.phase, LiarsPhase::Bidding);
        assert!(v.reveal.is_none());
        assert!(v.bid.is_none());
        assert_eq!(v.your_dice.len(), 4); // still down a die from last round
        assert_eq!(v.current_player_id.as_deref(), Some(id[0].as_str()));
    }

    #[test]
    fn liars_ones_are_wild() {
        let (mut room, id) = start_liars_room(2);
        set_hand(&mut room, &id[0], vec![1, 1, 4, 4, 5]); // two wild 1s + two 4s
        set_hand(&mut room, &id[1], vec![4, 3, 3, 3, 3]); // one 4
        // "four 4s": three real 4s + two wild 1s = 5 ≥ 4 → true.
        room.apply(&id[0], ClientMsg::Bid { quantity: 4, face: 4 });
        room.apply(&id[1], ClientMsg::CallLiar);
        let rev = room.liars_view(&id[1]).unwrap().reveal.unwrap();
        assert!(rev.bid_was_true);
        assert_eq!(rev.actual, 5); // 3 fours + 2 wild ones
        assert_eq!(rev.loser_id, id[1]); // caller was wrong
    }

    #[test]
    fn liars_ace_bid_has_no_wild() {
        let (mut room, id) = start_liars_room(2);
        set_hand(&mut room, &id[0], vec![1, 1, 2, 2, 2]); // two literal 1s
        set_hand(&mut room, &id[1], vec![3, 3, 3, 3, 3]);
        // Bidding ON aces counts only literal 1s (no wild bonus): 2 < 3 → false.
        room.apply(&id[0], ClientMsg::Bid { quantity: 3, face: 1 });
        room.apply(&id[1], ClientMsg::CallLiar);
        let rev = room.liars_view(&id[1]).unwrap().reveal.unwrap();
        assert!(!rev.bid_was_true);
        assert_eq!(rev.actual, 2);
        assert_eq!(rev.loser_id, id[0]);
    }
}
