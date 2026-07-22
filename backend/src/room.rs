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
#[derive(Clone, Serialize, Deserialize)]
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
/// Liar's Dice (hidden per-player dice, bidding + calling); `yatzy` = Nordic
/// Yatzy (public dice, up to 3 rolls/turn with holds, a 15-box scorecard);
/// `farkle` = Farkle (push-your-luck, set aside scoring dice or bust).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Free,
    Liars,
    Yatzy,
    Farkle,
}

/// A Liar's Dice bid: "at least `quantity` dice showing `face`" across ALL cups.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bid {
    pub player_id: String,
    pub quantity: u32,
    pub face: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandReveal {
    pub player_id: String,
    pub dice: Vec<u8>,
}

/// The outcome of a "liar" call — every cup revealed + who lost a die.
#[derive(Clone, Serialize, Deserialize)]
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

/// A Yatzy scorecard box (Nordic 15-category variant). Serialized camelCase; also
/// deserialized (the client names one in `YatzyScore`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum YatzyCat {
    Ones,
    Twos,
    Threes,
    Fours,
    Fives,
    Sixes,
    OnePair,
    TwoPairs,
    ThreeKind,
    FourKind,
    SmallStraight,
    LargeStraight,
    FullHouse,
    Chance,
    Yatzy,
}

/// The six upper-section boxes; their subtotal drives the +50 bonus at ≥63.
const YATZY_UPPER: [YatzyCat; 6] = [
    YatzyCat::Ones,
    YatzyCat::Twos,
    YatzyCat::Threes,
    YatzyCat::Fours,
    YatzyCat::Fives,
    YatzyCat::Sixes,
];

/// All 15 boxes, in card order.
const YATZY_ALL: [YatzyCat; 15] = [
    YatzyCat::Ones,
    YatzyCat::Twos,
    YatzyCat::Threes,
    YatzyCat::Fours,
    YatzyCat::Fives,
    YatzyCat::Sixes,
    YatzyCat::OnePair,
    YatzyCat::TwoPairs,
    YatzyCat::ThreeKind,
    YatzyCat::FourKind,
    YatzyCat::SmallStraight,
    YatzyCat::LargeStraight,
    YatzyCat::FullHouse,
    YatzyCat::Chance,
    YatzyCat::Yatzy,
];

/// One scored (or previewed) box.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YatzyCell {
    pub category: YatzyCat,
    pub value: u16,
}

/// A player's scorecard as seen by everyone (Yatzy dice are public).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YatzyCard {
    pub player_id: String,
    /// Only the boxes this player has already filled (value may be 0 = scratched).
    pub cells: Vec<YatzyCell>,
    pub upper: u16,
    pub bonus: u16,
    pub total: u16,
}

/// The public Yatzy view — same for every client (unlike Liar's Dice, nothing is
/// hidden). Broadcast on every change.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YatzyView {
    pub order: Vec<String>,
    pub current_player_id: Option<String>,
    /// The 5 dice; empty until the current player's first roll this turn.
    pub dice: Vec<u8>,
    pub held: Vec<bool>,
    pub rolls_left: u8,
    pub rolled: bool,
    pub cards: Vec<YatzyCard>,
    /// What each still-open box would score for the current dice (empty until a
    /// roll). Lets the client show a live preview without duplicating the rules.
    pub preview: Vec<YatzyCell>,
    pub winner: Option<String>,
    pub over: bool,
}

/// A player's banked Farkle total.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FarkleScore {
    pub player_id: String,
    pub score: u32,
}

/// The public Farkle view — same for every client (dice are public).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FarkleView {
    pub order: Vec<String>,
    pub current_player_id: Option<String>,
    pub scores: Vec<FarkleScore>,
    pub target: u32,
    /// The dice just rolled, waiting to be set aside ([] if none in play).
    pub dice: Vec<u8>,
    /// Points set aside this turn but not yet banked.
    pub turn_score: u32,
    /// Dice available to roll next (6 = a fresh hand / hot dice).
    pub remaining: u8,
    /// A roll landed and the player must set aside scoring dice before rolling
    /// again or banking.
    pub must_pick: bool,
    /// The last roll scored nothing — the turn is bust (tap to pass).
    pub busted: bool,
    pub winner: Option<String>,
    pub over: bool,
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
    /// The public Yatzy view — broadcast to everyone (nothing hidden).
    Yatzy { view: YatzyView },
    /// The public Farkle view — broadcast to everyone.
    Farkle { view: FarkleView },
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
    /// Switch the room's game mode ("free" | "liars" | "yatzy"); starts a fresh
    /// match.
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
    /// Yatzy: (re-)roll every die that isn't held (all dice on the first roll).
    YatzyRoll,
    /// Yatzy: toggle a die's hold between rolls (index 0..=4).
    YatzyHold {
        index: u8,
    },
    /// Yatzy: assign the current dice to a still-open box (ends the turn).
    YatzyScore {
        category: YatzyCat,
    },
    /// Farkle: roll the remaining dice (start of turn / after setting aside).
    FarkleRoll,
    /// Farkle: set aside a scoring selection (indices into the current dice),
    /// banking its points into the running turn score.
    FarkleSetAside {
        keep: Vec<usize>,
    },
    /// Farkle: bank the turn score and pass (also used to pass after a bust).
    FarkleBank,
    /// Remove yourself from the game.
    Leave,
}

/// Liar's Dice match state (present only while `mode == Liars`). Hidden dice live
/// here; they're only ever exposed through `liars_view` (your own) or a `Reveal`.
/// `Serialize`/`Deserialize` are for state persistence (see `crate::persist`), not
/// the wire protocol — this whole struct (hidden dice included) only ever hits the
/// on-disk state file, never a socket.
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct LiarsState {
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
    /// No one has acted yet (round 1, no bid) — safe to re-deal so a new joiner is
    /// included instead of left spectating.
    fn pristine(&self) -> bool {
        self.phase == LiarsPhase::Bidding
            && self.bid.is_none()
            && self.reveal.is_none()
            && self.dice.values().all(|d| d.len() as u8 == self.start_dice)
    }
}

/// Score a single Yatzy box for a set of dice (Nordic rules). Pure — the whole
/// ruleset lives here and is unit-tested + surfaced to the client as `preview`.
fn yatzy_score_cat(cat: YatzyCat, dice: &[u8]) -> u16 {
    // counts[f] = how many dice show face f (1..=6).
    let mut counts = [0u16; 7];
    for &d in dice {
        if (1..=6).contains(&d) {
            counts[d as usize] += 1;
        }
    }
    let sum: u16 = dice.iter().map(|&d| d as u16).sum();
    let n_of = |need: u16| (1..=6u16).rev().find(|&f| counts[f as usize] >= need);
    use YatzyCat::*;
    match cat {
        Ones => counts[1],
        Twos => counts[2] * 2,
        Threes => counts[3] * 3,
        Fours => counts[4] * 4,
        Fives => counts[5] * 5,
        Sixes => counts[6] * 6,
        // Sum of the dice forming the highest single pair.
        OnePair => n_of(2).map(|f| f * 2).unwrap_or(0),
        // Two DISTINCT pairs — sum of all four dice (0 if there aren't two).
        TwoPairs => {
            let pairs: Vec<u16> = (1..=6u16)
                .rev()
                .filter(|&f| counts[f as usize] >= 2)
                .collect();
            if pairs.len() >= 2 {
                (pairs[0] + pairs[1]) * 2
            } else {
                0
            }
        }
        ThreeKind => n_of(3).map(|f| f * 3).unwrap_or(0),
        FourKind => n_of(4).map(|f| f * 4).unwrap_or(0),
        SmallStraight => {
            if (1..=5).all(|f| counts[f] == 1) {
                15
            } else {
                0
            }
        }
        LargeStraight => {
            if (2..=6).all(|f| counts[f] == 1) {
                20
            } else {
                0
            }
        }
        // A triple + a pair of DIFFERENT faces (strict: five-of-a-kind is not one).
        FullHouse => {
            let trip = (1..=6).any(|f| counts[f] == 3);
            let pair = (1..=6).any(|f| counts[f] == 2);
            if trip && pair {
                sum
            } else {
                0
            }
        }
        Chance => sum,
        Yatzy => {
            if (1..=6).any(|f| counts[f] == 5) {
                50
            } else {
                0
            }
        }
    }
}

/// Nordic Yatzy match state (present only while `mode == Yatzy`). Dice are public,
/// so unlike Liar's Dice there's no per-viewer hiding. `Serialize`/`Deserialize`
/// are for state persistence (see `crate::persist`), not the wire protocol.
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct YatzyState {
    /// Turn order (player ids), captured at match start. Joiners after start
    /// spectate until the next `SetMode`.
    order: Vec<String>,
    /// Filled boxes per player. A category present here is used (value may be 0).
    scores: HashMap<String, HashMap<YatzyCat, u16>>,
    /// Index into `order` of the current roller.
    turn: usize,
    /// The 5 dice for the current turn (meaningful once `rolled`).
    dice: [u8; 5],
    held: [bool; 5],
    /// Rolls remaining this turn (starts at 3).
    rolls_left: u8,
    /// Has the current player rolled at least once this turn?
    rolled: bool,
    winner: Option<String>,
    over: bool,
}

impl YatzyState {
    fn current_id(&self) -> Option<String> {
        if self.over {
            return None;
        }
        self.order.get(self.turn).cloned()
    }
    fn card_full(&self, id: &str) -> bool {
        self.scores
            .get(id)
            .map(|m| m.len() >= YATZY_ALL.len())
            .unwrap_or(false)
    }
    fn all_full(&self) -> bool {
        !self.order.is_empty() && self.order.iter().all(|id| self.card_full(id))
    }
    /// (upper subtotal, bonus, grand total) for a player.
    fn totals(&self, id: &str) -> (u16, u16, u16) {
        let Some(m) = self.scores.get(id) else {
            return (0, 0, 0);
        };
        let upper: u16 = YATZY_UPPER.iter().filter_map(|c| m.get(c)).sum();
        let bonus = if upper >= 63 { 50 } else { 0 };
        let lower: u16 = m
            .iter()
            .filter(|(c, _)| !YATZY_UPPER.contains(c))
            .map(|(_, v)| *v)
            .sum();
        (upper, bonus, upper + bonus + lower)
    }
    fn winner_id(&self) -> Option<String> {
        self.order
            .iter()
            .max_by_key(|id| self.totals(id).2)
            .cloned()
    }
    /// Reset the per-turn dice state for a fresh turn.
    fn reset_turn(&mut self) {
        self.dice = [1; 5];
        self.held = [false; 5];
        self.rolls_left = 3;
        self.rolled = false;
    }
    /// No one has rolled or scored yet — safe to re-deal so a new joiner is
    /// included instead of left spectating.
    fn pristine(&self) -> bool {
        !self.rolled && self.scores.values().all(|m| m.is_empty())
    }
}

// ---------- Farkle scoring (pure) ----------

/// face → count (index 1..=6).
fn farkle_counts(dice: &[u8]) -> [u8; 7] {
    let mut c = [0u8; 7];
    for &d in dice {
        if (1..=6).contains(&d) {
            c[d as usize] += 1;
        }
    }
    c
}

/// Score a multiset where EVERY die must participate in scoring, or None. Singles
/// only score for 1s (100) and 5s (50); three+ of a kind uses the doubling ladder
/// (3=base, 4=2×, 5=4×, 6=8×; base = 1000 for 1s, else face×100). A lone 2/3/4/6
/// (count 1–2) is a dead die → None.
fn farkle_per_face(counts: &[u8; 7]) -> Option<u32> {
    let mut total = 0u32;
    for (f, &cnt) in counts.iter().enumerate().skip(1) {
        let c = cnt as u32;
        if c == 0 {
            continue;
        }
        if c >= 3 {
            let base = if f == 1 { 1000 } else { (f as u32) * 100 };
            total += base * (1 << (c - 3)); // ×2 per die beyond three
        } else if f == 1 {
            total += c * 100;
        } else if f == 5 {
            total += c * 50;
        } else {
            return None; // a 1–2 count of a non-1/5 face can't be used
        }
    }
    Some(total)
}

fn is_three_pairs(counts: &[u8; 7]) -> bool {
    let pairs: u8 = counts[1..=6].iter().map(|&c| c / 2).sum();
    pairs == 3 && counts[1..=6].iter().all(|&c| c.is_multiple_of(2))
}

fn is_two_triplets(counts: &[u8; 7]) -> bool {
    (1..=6).filter(|&f| counts[f] == 3).count() == 2
}

/// Best score for an EXACT selection (all dice must be used), or None if the
/// selection has a die that scores nothing. Six-dice specials (straight / three
/// pairs / two triplets) are considered when 6 dice are selected.
fn farkle_score_exact(dice: &[u8]) -> Option<u32> {
    let counts = farkle_counts(dice);
    let mut best = farkle_per_face(&counts);
    if dice.len() == 6 {
        let mut consider = |v: u32| best = Some(best.unwrap_or(0).max(v));
        if (1..=6).all(|f| counts[f] == 1) {
            consider(1500); // straight
        }
        if is_three_pairs(&counts) {
            consider(1500);
        }
        if is_two_triplets(&counts) {
            consider(2500);
        }
    }
    best.filter(|&s| s > 0)
}

/// Does a roll contain ANY scoring die? (false = a Farkle / bust.)
fn farkle_has_score(dice: &[u8]) -> bool {
    let c = farkle_counts(dice);
    if c[1] > 0 || c[5] > 0 {
        return true;
    }
    if (1..=6).any(|f| c[f] >= 3) {
        return true;
    }
    dice.len() == 6 && (is_three_pairs(&c) || is_two_triplets(&c))
}

/// Farkle match state (present only while `mode == Farkle`). Dice are public.
/// `Serialize`/`Deserialize` are for state persistence (see `crate::persist`),
/// not the wire protocol.
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct FarkleState {
    order: Vec<String>,
    scores: HashMap<String, u32>,
    turn: usize,
    target: u32,
    /// The dice just rolled, waiting to be set aside.
    dice: Vec<u8>,
    /// Points set aside this turn, not yet banked.
    turn_score: u32,
    /// Dice available to roll next (6 = fresh hand / hot dice).
    remaining: u8,
    /// A roll landed; the player must set aside before rolling again or banking.
    must_pick: bool,
    /// The last roll scored nothing.
    busted: bool,
    winner: Option<String>,
    over: bool,
}

impl FarkleState {
    fn current_id(&self) -> Option<String> {
        if self.over {
            return None;
        }
        self.order.get(self.turn).cloned()
    }
    fn score_of(&self, id: &str) -> u32 {
        self.scores.get(id).copied().unwrap_or(0)
    }
    /// Start a fresh turn for the current player.
    fn reset_turn(&mut self) {
        self.dice.clear();
        self.turn_score = 0;
        self.remaining = 6;
        self.must_pick = false;
        self.busted = false;
    }
    /// No one has scored and the turn hasn't started — safe to re-deal on join.
    fn pristine(&self) -> bool {
        self.turn == 0
            && !self.must_pick
            && self.turn_score == 0
            && self.dice.is_empty()
            && self.scores.values().all(|&s| s == 0)
    }
}

/// On-disk schema version for the persisted state file. Bump on ANY incompatible
/// change to `PersistedRoom` (or a type it embeds) so a stale file written by an
/// older build is discarded rather than mis-deserialized — see `crate::persist`.
pub(crate) const PERSIST_VERSION: u32 = 1;

/// A room flattened for persistence — the durable half of [`Room`]. Excludes the
/// live-only bits: the `broadcast::Sender` (recreated on load, fresh with no
/// subscribers), `last_activity` (reset to now on load, so a restart grants a
/// fresh TTL), and each player's `connected` flag (everyone is disconnected until
/// their socket reconnects). Unlike the [`Player`] wire type, the secret `token`
/// IS persisted here — it's what lets a reconnecting client re-authenticate after
/// the restart. The file therefore holds secrets (written `0600`, see `persist`).
#[derive(Serialize, Deserialize)]
pub(crate) struct PersistedRoom {
    pub(crate) code: String,
    players: Vec<PersistedPlayer>,
    mode: Mode,
    turn_idx: usize,
    dice_count: u8,
    dice_theme: String,
    deck: String,
    history: Vec<RollRecord>,
    roll_seq: u64,
    max_dice: u8,
    liars: Option<LiarsState>,
    yatzy: Option<YatzyState>,
    farkle: Option<FarkleState>,
}

/// A player as persisted — includes the secret `token` (see [`PersistedRoom`]).
#[derive(Serialize, Deserialize)]
struct PersistedPlayer {
    id: String,
    token: String,
    name: String,
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
    yatzy: Option<YatzyState>,
    farkle: Option<FarkleState>,
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
            yatzy: None,
            farkle: None,
            roll_seq: 0,
            max_dice,
        }
    }

    /// Flatten to the durable [`PersistedRoom`] for the shutdown state flush.
    pub(crate) fn to_persisted(&self) -> PersistedRoom {
        PersistedRoom {
            code: self.code.clone(),
            players: self
                .players
                .iter()
                .map(|p| PersistedPlayer {
                    id: p.id.clone(),
                    token: p.token.clone(),
                    name: p.name.clone(),
                })
                .collect(),
            mode: self.mode,
            turn_idx: self.turn_idx,
            dice_count: self.dice_count,
            dice_theme: self.dice_theme.clone(),
            deck: self.deck.clone(),
            history: self.history.clone(),
            roll_seq: self.roll_seq,
            max_dice: self.max_dice,
            liars: self.liars.clone(),
            yatzy: self.yatzy.clone(),
            farkle: self.farkle.clone(),
        }
    }

    /// Rebuild a live room from persisted state on boot: a fresh broadcast channel
    /// (no subscribers yet), a reset TTL clock, and every player marked
    /// disconnected until their socket reconnects with its (persisted) token.
    pub(crate) fn from_persisted(p: PersistedRoom) -> Self {
        let (tx, _rx) = broadcast::channel(256);
        Room {
            code: p.code,
            players: p
                .players
                .into_iter()
                .map(|pp| Player {
                    id: pp.id,
                    token: pp.token,
                    name: pp.name,
                    connected: false,
                })
                .collect(),
            mode: p.mode,
            turn_idx: p.turn_idx,
            dice_count: p.dice_count,
            dice_theme: p.dice_theme,
            deck: p.deck,
            history: p.history,
            tx,
            last_activity: Instant::now(),
            liars: p.liars,
            yatzy: p.yatzy,
            farkle: p.farkle,
            roll_seq: p.roll_seq,
            max_dice: p.max_dice,
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
            ClientMsg::YatzyRoll => self.yatzy_roll(actor_id),
            ClientMsg::YatzyHold { index } => self.yatzy_hold(actor_id, index),
            ClientMsg::YatzyScore { category } => self.yatzy_score(actor_id, category),
            ClientMsg::FarkleRoll => self.farkle_roll(actor_id),
            ClientMsg::FarkleSetAside { keep } => self.farkle_set_aside(actor_id, keep),
            ClientMsg::FarkleBank => self.farkle_bank(actor_id),
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
        // A leaver drops out of any Yatzy match in progress.
        if let Some(g) = self.yatzy.as_mut() {
            if let Some(pos) = g.order.iter().position(|id| id == actor_id) {
                let was_current = pos == g.turn;
                g.order.remove(pos);
                g.scores.remove(actor_id);
                if g.order.is_empty() {
                    g.over = true;
                    g.winner = None;
                } else {
                    if pos < g.turn {
                        g.turn -= 1;
                    }
                    g.turn %= g.order.len();
                    if was_current {
                        g.reset_turn(); // the next roller starts fresh
                    }
                    if g.all_full() {
                        g.over = true;
                        g.winner = g.winner_id();
                    }
                }
            }
        }
        // A leaver drops out of any Farkle match in progress.
        if let Some(g) = self.farkle.as_mut() {
            if let Some(pos) = g.order.iter().position(|id| id == actor_id) {
                let was_current = pos == g.turn;
                g.order.remove(pos);
                g.scores.remove(actor_id);
                if g.order.is_empty() {
                    g.over = true;
                    g.winner = None;
                } else {
                    if pos < g.turn {
                        g.turn -= 1;
                    }
                    g.turn %= g.order.len();
                    if was_current {
                        g.reset_turn(); // the next player starts fresh
                    }
                }
            }
        }
        self.broadcast_liars();
        self.broadcast_yatzy();
        self.broadcast_farkle();
        self.broadcast_sync();
    }

    // ---------- Liar's Dice ----------

    /// Roll a fresh hand of `n` dice (1..=6 each).
    fn roll_hand(n: u8) -> Vec<u8> {
        let mut rng = rand::rng();
        (0..n).map(|_| rng.random_range(1..=6)).collect()
    }

    /// Public entry to switch mode (used by the create endpoint so the host can
    /// pick the game in the lobby); the WS path goes through `apply(SetMode)`.
    pub fn set_game_mode(&mut self, mode: &str) {
        self.set_mode(mode);
    }

    /// Called after a NEW player is added (join). If a Liar's/Yatzy match is set
    /// but hasn't started (pristine), re-deal so the joiner is included rather
    /// than left spectating — this is what makes "create a game → friends join →
    /// play" work. A match already in progress is left alone (they spectate).
    pub fn on_player_joined(&mut self) {
        match self.mode {
            Mode::Liars if self.liars.as_ref().is_some_and(|g| g.pristine()) => {
                self.start_liars();
                self.broadcast_liars();
            }
            Mode::Yatzy if self.yatzy.as_ref().is_some_and(|g| g.pristine()) => {
                self.start_yatzy();
                self.broadcast_yatzy();
            }
            Mode::Farkle if self.farkle.as_ref().is_some_and(|g| g.pristine()) => {
                self.start_farkle();
                self.broadcast_farkle();
            }
            _ => {}
        }
    }

    /// Switch game mode. Entering `liars`/`yatzy` deals a fresh match to the
    /// current players; anything else falls back to free mode.
    fn set_mode(&mut self, mode: &str) {
        // Drop any prior match state; the chosen game deals its own below.
        self.liars = None;
        self.yatzy = None;
        self.farkle = None;
        match mode {
            "liars" => {
                self.mode = Mode::Liars;
                self.start_liars();
            }
            "yatzy" => {
                self.mode = Mode::Yatzy;
                self.start_yatzy();
            }
            "farkle" => {
                self.mode = Mode::Farkle;
                self.start_farkle();
            }
            _ => {
                self.mode = Mode::Free;
            }
        }
        self.broadcast_sync(); // the `mode` field changed for everyone
        self.broadcast_liars(); // deal the (personalized) Liar's view, if any
        self.broadcast_yatzy(); // deal the (public) Yatzy view, if any
        self.broadcast_farkle(); // deal the (public) Farkle view, if any
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

    // ---------- Yatzy (Nordic) ----------

    /// Deal a fresh Yatzy match to the current players (blank scorecards).
    fn start_yatzy(&mut self) {
        let order: Vec<String> = self.players.iter().map(|p| p.id.clone()).collect();
        let scores = order
            .iter()
            .map(|id| (id.clone(), HashMap::new()))
            .collect();
        self.yatzy = Some(YatzyState {
            order,
            scores,
            turn: 0,
            dice: [1; 5],
            held: [false; 5],
            rolls_left: 3,
            rolled: false,
            winner: None,
            over: false,
        });
    }

    /// Roll every non-held die (all dice on the first roll of a turn). Only the
    /// current player, only while rolls remain.
    fn yatzy_roll(&mut self, actor: &str) {
        let mut rng = rand::rng();
        {
            let Some(g) = self.yatzy.as_mut() else {
                return;
            };
            if g.over || g.rolls_left == 0 {
                return;
            }
            if g.order.get(g.turn).map(|s| s.as_str()) != Some(actor) {
                return;
            }
            for i in 0..5 {
                // On the first roll nothing is held yet, so all 5 are (re)rolled.
                if !g.rolled || !g.held[i] {
                    g.dice[i] = rng.random_range(1..=6);
                }
            }
            g.rolled = true;
            g.rolls_left -= 1;
        }
        self.broadcast_yatzy();
    }

    /// Toggle a die's hold between rolls (ignored after the last roll). Only the
    /// current player.
    fn yatzy_hold(&mut self, actor: &str, index: u8) {
        {
            let Some(g) = self.yatzy.as_mut() else {
                return;
            };
            if g.over || !g.rolled || g.rolls_left == 0 {
                return;
            }
            if g.order.get(g.turn).map(|s| s.as_str()) != Some(actor) {
                return;
            }
            if let Some(h) = g.held.get_mut(index as usize) {
                *h = !*h;
            }
        }
        self.broadcast_yatzy();
    }

    /// Assign the current dice to a still-open box (scoring its value, possibly 0),
    /// then advance to the next player. Ends the game when every card is full.
    fn yatzy_score(&mut self, actor: &str, cat: YatzyCat) {
        {
            let Some(g) = self.yatzy.as_mut() else {
                return;
            };
            if g.over || !g.rolled {
                return; // must roll at least once before scoring
            }
            if g.order.get(g.turn).map(|s| s.as_str()) != Some(actor) {
                return;
            }
            // Must be a participant with this box still open.
            if g.scores
                .get(actor)
                .map(|c| c.contains_key(&cat))
                .unwrap_or(true)
            {
                return;
            }
            let value = yatzy_score_cat(cat, &g.dice);
            g.scores.get_mut(actor).unwrap().insert(cat, value);

            if g.all_full() {
                g.over = true;
                g.winner = g.winner_id();
            } else {
                // Next player in order with an open card (normally just the next).
                let n = g.order.len();
                let mut t = g.turn;
                for _ in 0..n {
                    t = (t + 1) % n;
                    if !g.card_full(&g.order[t]) {
                        break;
                    }
                }
                g.turn = t;
                g.reset_turn();
            }
        }
        self.broadcast_yatzy();
    }

    /// Build the public Yatzy view (identical for every client).
    pub fn yatzy_view(&self) -> Option<YatzyView> {
        let g = self.yatzy.as_ref()?;
        let cards = g
            .order
            .iter()
            .map(|id| {
                let cells = g
                    .scores
                    .get(id)
                    .map(|m| {
                        m.iter()
                            .map(|(c, v)| YatzyCell {
                                category: *c,
                                value: *v,
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let (upper, bonus, total) = g.totals(id);
                YatzyCard {
                    player_id: id.clone(),
                    cells,
                    upper,
                    bonus,
                    total,
                }
            })
            .collect();
        let (dice, held, preview) = if g.rolled {
            let preview = YATZY_ALL
                .iter()
                .map(|&c| YatzyCell {
                    category: c,
                    value: yatzy_score_cat(c, &g.dice),
                })
                .collect();
            (g.dice.to_vec(), g.held.to_vec(), preview)
        } else {
            (Vec::new(), vec![false; 5], Vec::new())
        };
        Some(YatzyView {
            order: g.order.clone(),
            current_player_id: g.current_id(),
            dice,
            held,
            rolls_left: g.rolls_left,
            rolled: g.rolled,
            cards,
            preview,
            winner: g.winner.clone(),
            over: g.over,
        })
    }

    /// Broadcast the public Yatzy view to every subscriber.
    pub fn broadcast_yatzy(&self) {
        if self.mode == Mode::Yatzy {
            if let Some(view) = self.yatzy_view() {
                let _ = self.tx.send(ServerMsg::Yatzy { view });
            }
        }
    }

    // ---------- Farkle ----------

    /// Deal a fresh Farkle match to the current players (zeroed scores).
    fn start_farkle(&mut self) {
        let order: Vec<String> = self.players.iter().map(|p| p.id.clone()).collect();
        let scores = order.iter().map(|id| (id.clone(), 0)).collect();
        self.farkle = Some(FarkleState {
            order,
            scores,
            turn: 0,
            target: 10_000,
            dice: Vec::new(),
            turn_score: 0,
            remaining: 6,
            must_pick: false,
            busted: false,
            winner: None,
            over: false,
        });
    }

    /// Roll the remaining dice. Only the current player, only when not mid-pick.
    /// No scoring dice → the turn busts (running points lost, tap to pass).
    fn farkle_roll(&mut self, actor: &str) {
        let mut rng = rand::rng();
        {
            let Some(g) = self.farkle.as_mut() else {
                return;
            };
            if g.over || g.must_pick || g.busted {
                return;
            }
            if g.order.get(g.turn).map(|s| s.as_str()) != Some(actor) {
                return;
            }
            let n = g.remaining.clamp(1, 6);
            let dice: Vec<u8> = (0..n).map(|_| rng.random_range(1..=6)).collect();
            if farkle_has_score(&dice) {
                g.dice = dice;
                g.must_pick = true;
            } else {
                // Farkle — lose the turn's points; the player taps to pass.
                g.dice = dice;
                g.turn_score = 0;
                g.busted = true;
                g.must_pick = false;
            }
        }
        self.broadcast_farkle();
    }

    /// Set aside a scoring selection (indices into the current dice). Adds its
    /// score to the running turn total; empties all six = hot dice (roll again).
    fn farkle_set_aside(&mut self, actor: &str, keep: Vec<usize>) {
        {
            let Some(g) = self.farkle.as_mut() else {
                return;
            };
            if g.over || g.busted || !g.must_pick {
                return;
            }
            if g.order.get(g.turn).map(|s| s.as_str()) != Some(actor) {
                return;
            }
            // Validate indices: in range, unique, non-empty.
            let mut seen = HashSet::new();
            if keep.is_empty() || keep.iter().any(|&i| i >= g.dice.len() || !seen.insert(i)) {
                return;
            }
            let picked: Vec<u8> = keep.iter().map(|&i| g.dice[i]).collect();
            let Some(points) = farkle_score_exact(&picked) else {
                return; // selection isn't a valid all-scoring set
            };
            g.turn_score += points;
            let kept = keep.len() as u8;
            g.remaining = if kept >= g.remaining {
                6
            } else {
                g.remaining - kept
            }; // hot dice → 6
            g.dice.clear();
            g.must_pick = false;
        }
        self.broadcast_farkle();
    }

    /// Bank the running turn score (or just pass, after a bust) and advance.
    fn farkle_bank(&mut self, actor: &str) {
        {
            let Some(g) = self.farkle.as_mut() else {
                return;
            };
            if g.over {
                return;
            }
            if g.order.get(g.turn).map(|s| s.as_str()) != Some(actor) {
                return;
            }
            // Can't bank mid-pick (must set aside the roll first) unless busted.
            if g.must_pick && !g.busted {
                return;
            }
            if !g.busted {
                let total = g.score_of(actor) + g.turn_score;
                g.scores.insert(actor.to_string(), total);
                if total >= g.target {
                    g.over = true;
                    g.winner = Some(actor.to_string());
                }
            }
            if !g.over {
                let n = g.order.len();
                g.turn = if n == 0 { 0 } else { (g.turn + 1) % n };
                g.reset_turn();
            }
        }
        self.broadcast_farkle();
    }

    /// Build the public Farkle view.
    pub fn farkle_view(&self) -> Option<FarkleView> {
        let g = self.farkle.as_ref()?;
        let scores = g
            .order
            .iter()
            .map(|id| FarkleScore {
                player_id: id.clone(),
                score: g.score_of(id),
            })
            .collect();
        Some(FarkleView {
            order: g.order.clone(),
            current_player_id: g.current_id(),
            scores,
            target: g.target,
            dice: g.dice.clone(),
            turn_score: g.turn_score,
            remaining: g.remaining,
            must_pick: g.must_pick,
            busted: g.busted,
            winner: g.winner.clone(),
            over: g.over,
        })
    }

    /// Broadcast the public Farkle view to every subscriber.
    pub fn broadcast_farkle(&self) {
        if self.mode == Mode::Farkle {
            if let Some(view) = self.farkle_view() {
                let _ = self.tx.send(ServerMsg::Farkle { view });
            }
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
        room.apply(
            &id[0],
            ClientMsg::SetMode {
                mode: "liars".into(),
            },
        );
        (room, id)
    }

    /// Overwrite a player's hidden hand for deterministic tests.
    fn set_hand(room: &mut Room, id: &str, hand: Vec<u8>) {
        room.liars
            .as_mut()
            .unwrap()
            .dice
            .insert(id.to_string(), hand);
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
            room.liars_view(&id[0])
                .unwrap()
                .current_player_id
                .as_deref(),
            Some(id[0].as_str())
        );
    }

    #[test]
    fn liars_view_hides_other_hands() {
        let (mut room, id) = start_liars_room(2);
        set_hand(&mut room, &id[0], vec![1, 2, 3, 4, 5]);
        set_hand(&mut room, &id[1], vec![6, 6, 6, 6, 6]);
        // Each viewer sees only their own faces; others are just counts.
        assert_eq!(
            room.liars_view(&id[0]).unwrap().your_dice,
            vec![1, 2, 3, 4, 5]
        );
        assert_eq!(
            room.liars_view(&id[1]).unwrap().your_dice,
            vec![6, 6, 6, 6, 6]
        );
        // Counts are public and agree.
        let v = room.liars_view(&id[0]).unwrap();
        assert!(v.players.iter().all(|p| p.dice_count == 5));
    }

    #[test]
    fn liars_bid_must_raise() {
        let (mut room, id) = start_liars_room(2);
        room.apply(
            &id[0],
            ClientMsg::Bid {
                quantity: 2,
                face: 3,
            },
        );
        // Not a raise (lower face) — ignored; bid + turn unchanged.
        room.apply(
            &id[1],
            ClientMsg::Bid {
                quantity: 2,
                face: 2,
            },
        );
        let v = room.liars_view(&id[1]).unwrap();
        assert_eq!(v.bid.as_ref().unwrap().quantity, 2);
        assert_eq!(v.bid.as_ref().unwrap().face, 3);
        assert_eq!(v.current_player_id.as_deref(), Some(id[1].as_str()));
        // A real raise — accepted; turn returns to id[0].
        room.apply(
            &id[1],
            ClientMsg::Bid {
                quantity: 3,
                face: 1,
            },
        );
        let v2 = room.liars_view(&id[0]).unwrap();
        assert_eq!(v2.bid.as_ref().unwrap().quantity, 3);
        assert_eq!(v2.current_player_id.as_deref(), Some(id[0].as_str()));
    }

    #[test]
    fn liars_call_false_bid_docks_bidder() {
        let (mut room, id) = start_liars_room(2);
        set_hand(&mut room, &id[0], vec![2, 2, 2, 2, 2]);
        set_hand(&mut room, &id[1], vec![3, 3, 3, 3, 3]);
        room.apply(
            &id[0],
            ClientMsg::Bid {
                quantity: 3,
                face: 6,
            },
        ); // no 6s, no wild 1s → false
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
        room.apply(
            &id[0],
            ClientMsg::Bid {
                quantity: 3,
                face: 6,
            },
        ); // four 6s + two wild 1s → true
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
        room.apply(
            &id[0],
            ClientMsg::Bid {
                quantity: 5,
                face: 6,
            },
        ); // true
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
        room.apply(
            &id[0],
            ClientMsg::Bid {
                quantity: 3,
                face: 6,
            },
        ); // false → id[0] loses
        room.apply(&id[1], ClientMsg::CallLiar);
        // Loser (id[0]) opens the next round.
        assert_eq!(
            room.liars_view(&id[1])
                .unwrap()
                .current_player_id
                .as_deref(),
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
        room.apply(
            &id[0],
            ClientMsg::Bid {
                quantity: 4,
                face: 4,
            },
        );
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
        room.apply(
            &id[0],
            ClientMsg::Bid {
                quantity: 3,
                face: 1,
            },
        );
        room.apply(&id[1], ClientMsg::CallLiar);
        let rev = room.liars_view(&id[1]).unwrap().reveal.unwrap();
        assert!(!rev.bid_was_true);
        assert_eq!(rev.actual, 2);
        assert_eq!(rev.loser_id, id[0]);
    }

    // ---------- Yatzy ----------

    fn start_yatzy_room(n: usize) -> (Room, Vec<String>) {
        let mut room = room_with(n);
        let id = ids(&room);
        room.apply(
            &id[0],
            ClientMsg::SetMode {
                mode: "yatzy".into(),
            },
        );
        (room, id)
    }

    /// Force the current dice for deterministic scoring/turn tests.
    fn set_dice(room: &mut Room, dice: [u8; 5]) {
        let g = room.yatzy.as_mut().unwrap();
        g.dice = dice;
        g.rolled = true;
    }

    #[test]
    fn yatzy_scoring_rules() {
        use YatzyCat::*;
        // Upper section = sum of the matching faces.
        assert_eq!(yatzy_score_cat(Ones, &[1, 1, 3, 4, 5]), 2);
        assert_eq!(yatzy_score_cat(Sixes, &[6, 6, 6, 2, 1]), 18);
        // Pairs.
        assert_eq!(yatzy_score_cat(OnePair, &[5, 5, 3, 3, 1]), 10); // highest pair
        assert_eq!(yatzy_score_cat(OnePair, &[2, 3, 4, 5, 6]), 0);
        assert_eq!(yatzy_score_cat(TwoPairs, &[5, 5, 3, 3, 1]), 16);
        assert_eq!(yatzy_score_cat(TwoPairs, &[5, 5, 5, 3, 1]), 0); // only one pair face
                                                                    // N of a kind = sum of the N.
        assert_eq!(yatzy_score_cat(ThreeKind, &[4, 4, 4, 2, 1]), 12);
        assert_eq!(yatzy_score_cat(FourKind, &[4, 4, 4, 4, 1]), 16);
        assert_eq!(yatzy_score_cat(ThreeKind, &[4, 4, 2, 2, 1]), 0);
        // Straights are fixed points.
        assert_eq!(yatzy_score_cat(SmallStraight, &[1, 2, 3, 4, 5]), 15);
        assert_eq!(yatzy_score_cat(SmallStraight, &[2, 3, 4, 5, 6]), 0);
        assert_eq!(yatzy_score_cat(LargeStraight, &[2, 3, 4, 5, 6]), 20);
        // Full house = sum of all five; five-of-a-kind is NOT a full house.
        assert_eq!(yatzy_score_cat(FullHouse, &[3, 3, 3, 5, 5]), 19);
        assert_eq!(yatzy_score_cat(FullHouse, &[3, 3, 3, 3, 5]), 0);
        assert_eq!(yatzy_score_cat(FullHouse, &[4, 4, 4, 4, 4]), 0);
        // Chance + Yatzy.
        assert_eq!(yatzy_score_cat(Chance, &[1, 2, 3, 4, 5]), 15);
        assert_eq!(yatzy_score_cat(Yatzy, &[2, 2, 2, 2, 2]), 50);
        assert_eq!(yatzy_score_cat(Yatzy, &[2, 2, 2, 2, 3]), 0);
    }

    #[test]
    fn yatzy_start_deals_blank_cards() {
        let (room, id) = start_yatzy_room(2);
        assert_eq!(room.mode, Mode::Yatzy);
        let v = room.yatzy_view().unwrap();
        assert_eq!(v.order.len(), 2);
        assert_eq!(v.current_player_id.as_deref(), Some(id[0].as_str()));
        assert!(!v.rolled);
        assert_eq!(v.rolls_left, 3);
        assert!(v.dice.is_empty()); // nothing rolled yet
        assert!(v.cards.iter().all(|c| c.cells.is_empty() && c.total == 0));
    }

    #[test]
    fn yatzy_roll_holds_and_rolls_left() {
        let (mut room, id) = start_yatzy_room(1);
        room.apply(&id[0], ClientMsg::YatzyRoll);
        let v = room.yatzy_view().unwrap();
        assert!(v.rolled);
        assert_eq!(v.rolls_left, 2);
        assert_eq!(v.dice.len(), 5);
        // Hold all dice, remember them, roll again — held dice are unchanged.
        for i in 0..5 {
            room.apply(&id[0], ClientMsg::YatzyHold { index: i });
        }
        let before = room.yatzy_view().unwrap().dice.clone();
        room.apply(&id[0], ClientMsg::YatzyRoll);
        let v2 = room.yatzy_view().unwrap();
        assert_eq!(v2.rolls_left, 1);
        assert_eq!(v2.dice, before); // everything held → identical
    }

    #[test]
    fn yatzy_no_roll_beyond_three() {
        let (mut room, id) = start_yatzy_room(1);
        for _ in 0..5 {
            room.apply(&id[0], ClientMsg::YatzyRoll);
        }
        assert_eq!(room.yatzy_view().unwrap().rolls_left, 0);
    }

    #[test]
    fn yatzy_score_fills_box_and_advances_turn() {
        let (mut room, id) = start_yatzy_room(2);
        room.apply(&id[0], ClientMsg::YatzyRoll);
        set_dice(&mut room, [5, 5, 5, 2, 1]);
        room.apply(
            &id[0],
            ClientMsg::YatzyScore {
                category: YatzyCat::Fives,
            },
        );
        let v = room.yatzy_view().unwrap();
        // Box filled with 15, turn passed to player 2, dice reset.
        let card0 = v.cards.iter().find(|c| c.player_id == id[0]).unwrap();
        assert_eq!(card0.total, 15);
        assert_eq!(card0.cells.len(), 1);
        assert_eq!(v.current_player_id.as_deref(), Some(id[1].as_str()));
        assert!(!v.rolled);
        assert_eq!(v.rolls_left, 3);
    }

    #[test]
    fn yatzy_cannot_reuse_a_box_or_play_out_of_turn() {
        let (mut room, id) = start_yatzy_room(2);
        room.apply(&id[0], ClientMsg::YatzyRoll);
        set_dice(&mut room, [3, 3, 3, 2, 1]); // three 3s → Threes = 9
                                              // Out of turn — ignored.
        room.apply(
            &id[1],
            ClientMsg::YatzyScore {
                category: YatzyCat::Threes,
            },
        );
        assert_eq!(
            room.yatzy_view().unwrap().current_player_id.as_deref(),
            Some(id[0].as_str())
        );
        // Score threes (=9), turn → id[1], back to id[0] next turn.
        room.apply(
            &id[0],
            ClientMsg::YatzyScore {
                category: YatzyCat::Threes,
            },
        );
        room.apply(&id[1], ClientMsg::YatzyRoll);
        set_dice(&mut room, [1, 1, 1, 1, 1]);
        room.apply(
            &id[1],
            ClientMsg::YatzyScore {
                category: YatzyCat::Ones,
            },
        );
        // id[0] again — the already-used Threes box is rejected.
        room.apply(&id[0], ClientMsg::YatzyRoll);
        set_dice(&mut room, [3, 3, 6, 6, 6]);
        room.apply(
            &id[0],
            ClientMsg::YatzyScore {
                category: YatzyCat::Threes,
            },
        );
        let card0 = room
            .yatzy_view()
            .unwrap()
            .cards
            .into_iter()
            .find(|c| c.player_id == id[0])
            .unwrap();
        assert_eq!(card0.cells.len(), 1); // still just the one Threes box
        assert_eq!(card0.total, 9);
    }

    #[test]
    fn yatzy_upper_bonus_at_63() {
        let (mut room, id) = start_yatzy_room(1);
        let g = room.yatzy.as_mut().unwrap();
        // Max the upper section (n×face×… ≥ 63): all four/five of each face.
        let card = g.scores.get_mut(&id[0]).unwrap();
        card.insert(YatzyCat::Ones, 4);
        card.insert(YatzyCat::Twos, 8);
        card.insert(YatzyCat::Threes, 12);
        card.insert(YatzyCat::Fours, 16);
        card.insert(YatzyCat::Fives, 20);
        card.insert(YatzyCat::Sixes, 24); // upper = 84 ≥ 63
        let (upper, bonus, total) = room.yatzy.as_ref().unwrap().totals(&id[0]);
        assert_eq!(upper, 84);
        assert_eq!(bonus, 50);
        assert_eq!(total, 134);
    }

    #[test]
    fn yatzy_game_over_when_all_cards_full() {
        let (mut room, id) = start_yatzy_room(1);
        // Fill 14 boxes directly, then score the 15th through the normal path.
        {
            let card = room.yatzy.as_mut().unwrap().scores.get_mut(&id[0]).unwrap();
            for &c in YATZY_ALL.iter().take(14) {
                card.insert(c, 3);
            }
        }
        room.apply(&id[0], ClientMsg::YatzyRoll);
        set_dice(&mut room, [6, 6, 6, 6, 6]);
        room.apply(
            &id[0],
            ClientMsg::YatzyScore {
                category: YatzyCat::Yatzy,
            },
        );
        let v = room.yatzy_view().unwrap();
        assert!(v.over);
        assert_eq!(v.winner.as_deref(), Some(id[0].as_str()));
        assert_eq!(v.current_player_id, None);
    }

    #[test]
    fn yatzy_join_before_start_includes_newcomer() {
        // Host creates a Yatzy game alone; a friend joins before anyone rolls.
        let (mut room, id) = start_yatzy_room(1);
        assert_eq!(room.yatzy_view().unwrap().order.len(), 1);
        let (bob, _) = room.add_player("Bob".into());
        room.on_player_joined();
        let v = room.yatzy_view().unwrap();
        assert_eq!(v.order.len(), 2); // re-dealt to include Bob
        assert!(v.order.contains(&bob));
        assert!(v.cards.iter().all(|c| c.cells.is_empty()));
        // But a match in progress is NOT reset by a later join.
        room.apply(&id[0], ClientMsg::YatzyRoll);
        set_dice(&mut room, [6, 6, 6, 6, 6]);
        room.apply(
            &id[0],
            ClientMsg::YatzyScore {
                category: YatzyCat::Sixes,
            },
        );
        let (carol, _) = room.add_player("Carol".into());
        room.on_player_joined();
        let v2 = room.yatzy_view().unwrap();
        assert_eq!(v2.order.len(), 2); // Carol spectates (match already started)
        assert!(!v2.order.contains(&carol));
    }

    #[test]
    fn yatzy_preview_reflects_current_dice() {
        let (mut room, id) = start_yatzy_room(1);
        room.apply(&id[0], ClientMsg::YatzyRoll);
        set_dice(&mut room, [1, 2, 3, 4, 5]);
        let v = room.yatzy_view().unwrap();
        let small = v
            .preview
            .iter()
            .find(|c| c.category == YatzyCat::SmallStraight)
            .unwrap();
        assert_eq!(small.value, 15);
        let chance = v
            .preview
            .iter()
            .find(|c| c.category == YatzyCat::Chance)
            .unwrap();
        assert_eq!(chance.value, 15);
    }

    // ---------- Farkle ----------

    fn start_farkle_room(n: usize) -> (Room, Vec<String>) {
        let mut room = room_with(n);
        let id = ids(&room);
        room.apply(
            &id[0],
            ClientMsg::SetMode {
                mode: "farkle".into(),
            },
        );
        (room, id)
    }

    /// Force the current Farkle dice + into the "must pick" state.
    fn set_farkle_dice(room: &mut Room, dice: Vec<u8>) {
        let g = room.farkle.as_mut().unwrap();
        g.remaining = dice.len() as u8;
        g.dice = dice;
        g.must_pick = true;
        g.busted = false;
    }

    #[test]
    fn farkle_scoring_rules() {
        // Singles.
        assert_eq!(farkle_score_exact(&[1]), Some(100));
        assert_eq!(farkle_score_exact(&[5]), Some(50));
        assert_eq!(farkle_score_exact(&[1, 5]), Some(150));
        // A lone non-1/5 die can't be set aside.
        assert_eq!(farkle_score_exact(&[2]), None);
        assert_eq!(farkle_score_exact(&[1, 2]), None); // the 2 is dead
                                                       // Three of a kind + the doubling ladder.
        assert_eq!(farkle_score_exact(&[1, 1, 1]), Some(1000));
        assert_eq!(farkle_score_exact(&[2, 2, 2]), Some(200));
        assert_eq!(farkle_score_exact(&[6, 6, 6]), Some(600));
        assert_eq!(farkle_score_exact(&[1, 1, 1, 1]), Some(2000)); // 4 of a kind
        assert_eq!(farkle_score_exact(&[5, 5, 5, 5, 5]), Some(2000)); // 500×4
        assert_eq!(farkle_score_exact(&[2, 2, 2, 2, 2, 2]), Some(1600)); // 200×8
                                                                         // Combined.
        assert_eq!(farkle_score_exact(&[1, 1, 1, 5]), Some(1050));
        // Six-dice specials.
        assert_eq!(farkle_score_exact(&[1, 2, 3, 4, 5, 6]), Some(1500)); // straight
        assert_eq!(farkle_score_exact(&[2, 2, 3, 3, 4, 4]), Some(1500)); // three pairs
        assert_eq!(farkle_score_exact(&[2, 2, 2, 4, 4, 4]), Some(2500)); // two triplets
    }

    #[test]
    fn farkle_bust_detection() {
        assert!(farkle_has_score(&[1, 2, 3])); // has a 1
        assert!(farkle_has_score(&[5, 6, 2])); // has a 5
        assert!(farkle_has_score(&[3, 3, 3])); // triple
        assert!(!farkle_has_score(&[2, 3, 4])); // nothing
        assert!(!farkle_has_score(&[2, 3, 4, 6])); // nothing
        assert!(farkle_has_score(&[2, 2, 3, 3, 4, 4])); // three pairs (6 dice)
    }

    #[test]
    fn farkle_start_zeroes_scores() {
        let (room, id) = start_farkle_room(2);
        assert_eq!(room.mode, Mode::Farkle);
        let v = room.farkle_view().unwrap();
        assert_eq!(v.order.len(), 2);
        assert_eq!(v.current_player_id.as_deref(), Some(id[0].as_str()));
        assert_eq!(v.remaining, 6);
        assert!(!v.must_pick && !v.busted);
        assert!(v.scores.iter().all(|s| s.score == 0));
    }

    #[test]
    fn farkle_set_aside_and_bank() {
        let (mut room, id) = start_farkle_room(2);
        room.apply(&id[0], ClientMsg::FarkleRoll);
        set_farkle_dice(&mut room, vec![1, 1, 1, 2, 3, 4]); // three 1s + junk
                                                            // Keep the three 1s (indices 0,1,2) → 1000.
        room.apply(
            &id[0],
            ClientMsg::FarkleSetAside {
                keep: vec![0, 1, 2],
            },
        );
        let v = room.farkle_view().unwrap();
        assert_eq!(v.turn_score, 1000);
        assert_eq!(v.remaining, 3);
        assert!(!v.must_pick);
        // Bank → score 1000, turn passes to id[1].
        room.apply(&id[0], ClientMsg::FarkleBank);
        let v2 = room.farkle_view().unwrap();
        let p0 = v2.scores.iter().find(|s| s.player_id == id[0]).unwrap();
        assert_eq!(p0.score, 1000);
        assert_eq!(v2.current_player_id.as_deref(), Some(id[1].as_str()));
        assert_eq!(v2.turn_score, 0);
    }

    #[test]
    fn farkle_invalid_selection_rejected() {
        let (mut room, id) = start_farkle_room(1);
        room.apply(&id[0], ClientMsg::FarkleRoll);
        set_farkle_dice(&mut room, vec![1, 2, 3, 4, 6, 6]);
        // Trying to keep a lone 2 (index 1) is invalid — ignored.
        room.apply(&id[0], ClientMsg::FarkleSetAside { keep: vec![1] });
        let v = room.farkle_view().unwrap();
        assert_eq!(v.turn_score, 0);
        assert!(v.must_pick); // still waiting for a valid pick
    }

    #[test]
    fn farkle_hot_dice_refreshes_to_six() {
        let (mut room, id) = start_farkle_room(1);
        room.apply(&id[0], ClientMsg::FarkleRoll);
        set_farkle_dice(&mut room, vec![1, 1, 1, 1, 1, 1]); // all six score
        room.apply(
            &id[0],
            ClientMsg::FarkleSetAside {
                keep: vec![0, 1, 2, 3, 4, 5],
            },
        );
        let v = room.farkle_view().unwrap();
        assert_eq!(v.remaining, 6); // hot dice → full hand again
        assert_eq!(v.turn_score, 8000); // six 1s = 1000×8
    }

    #[test]
    fn farkle_bust_loses_turn_points() {
        let (mut room, id) = start_farkle_room(2);
        room.apply(&id[0], ClientMsg::FarkleRoll);
        set_farkle_dice(&mut room, vec![1, 1, 1, 2, 3, 4]);
        room.apply(
            &id[0],
            ClientMsg::FarkleSetAside {
                keep: vec![0, 1, 2],
            },
        ); // +1000
           // Next roll busts.
        room.apply(&id[0], ClientMsg::FarkleRoll);
        {
            let g = room.farkle.as_mut().unwrap();
            g.dice = vec![2, 3, 4]; // no score
            g.turn_score = 0;
            g.busted = true;
            g.must_pick = false;
        }
        // Pass (bank while busted) → 0 banked, turn to id[1].
        room.apply(&id[0], ClientMsg::FarkleBank);
        let v = room.farkle_view().unwrap();
        let p0 = v.scores.iter().find(|s| s.player_id == id[0]).unwrap();
        assert_eq!(p0.score, 0);
        assert_eq!(v.current_player_id.as_deref(), Some(id[1].as_str()));
    }

    #[test]
    fn farkle_reaching_target_wins() {
        let (mut room, id) = start_farkle_room(1);
        room.farkle
            .as_mut()
            .unwrap()
            .scores
            .insert(id[0].clone(), 9500);
        room.apply(&id[0], ClientMsg::FarkleRoll);
        set_farkle_dice(&mut room, vec![1, 1, 1, 2, 3, 4]); // +1000 → 10500
        room.apply(
            &id[0],
            ClientMsg::FarkleSetAside {
                keep: vec![0, 1, 2],
            },
        );
        room.apply(&id[0], ClientMsg::FarkleBank);
        let v = room.farkle_view().unwrap();
        assert!(v.over);
        assert_eq!(v.winner.as_deref(), Some(id[0].as_str()));
    }
}
