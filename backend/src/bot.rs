//! Server-side bot players. A bot is a normal [`crate::room::Player`] with
//! `bot: true` and a secret skill — it holds no WebSocket; instead a per-room
//! "pump" task acts on its turns with human-ish delays (see [`schedule_pump`]).
//!
//! Everything decision-shaped lives here as PURE functions of plain data so the
//! policies are unit-testable without a room: `yatzy_decide`, `farkle_decide`,
//! `liars_decide` (plus the binomial-tail math they share). The room glue
//! (`Room::bot_next_action`) extracts state and maps decisions to [`ClientMsg`].
//!
//! Skill levels: `Easy` plays naively, `Hard` plays expectation-driven, and
//! `Cheater` plays Hard *plus* cheats server-side — sneakily: best-of-2 biased
//! rolls (see [`biased`]) and perfect information in Liar's Dice, camouflaged so
//! no single action is provably unfair. The skill is NEVER serialized to the
//! wire (see the `#[serde(skip)]` on `Player::skill`).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use rand::RngExt;
use serde::{Deserialize, Serialize};

use crate::room::{ClientMsg, Room, YatzyCat};

/// Bot skill level. Wire values (in `AddBot`): "easy" | "hard" | "cheater".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BotSkill {
    Easy,
    Hard,
    Cheater,
}

/// Modern Finnish names with an emoji flare for the honest bots. Emoji are
/// single-codepoint only — the scorecard's name abbreviation slices UTF-16
/// units, and a leading single-codepoint emoji survives that cleanly (a ZWJ
/// sequence would not).
const BOT_NAMES: &[&str] = &[
    "🎲 Miro",
    "🎲 Venla",
    "🤖 Eino",
    "🎲 Aino",
    "🤖 Leevi",
    "🎲 Lilja",
    "🤖 Otso",
    "🎲 Nella",
    "⚡ Jonne",
    "🧶 Ritva",
    "🔥 Rakel",
];

/// The cheater's own pool: insufferably smug "born lucky" characters — the
/// kind you learn to quietly resent at 3 a.m. (Yes, the pool softly reveals
/// who the cheater is once you know it; that slow social realization is the
/// feature.) Jorma is non-negotiable.
const CHEATER_NAMES: &[&str] = &[
    "🃏 Jorma",
    "🍀 Onni",
    "🐍 Ville",
    "😈 Taisto",
    "💰 Roope",
    "🎩 Konsta",
];

/// Pick a RANDOM unused bot name from the skill's pool (so tables don't always
/// meet the same first bot), with a numeric-suffix fallback when the whole
/// pool is taken.
pub fn pick_name(taken: &[String], skill: BotSkill) -> String {
    let pool = match skill {
        BotSkill::Cheater => CHEATER_NAMES,
        _ => BOT_NAMES,
    };
    let mut rng = rand::rng();
    let free: Vec<&str> = pool
        .iter()
        .copied()
        .filter(|n| !taken.iter().any(|t| t == n))
        .collect();
    if !free.is_empty() {
        return free[rng.random_range(0..free.len())].to_string();
    }
    let base = pool[rng.random_range(0..pool.len())];
    let mut n = 2;
    loop {
        let cand = format!("{base} {n}");
        if !taken.iter().any(|t| t == &cand) {
            return cand;
        }
        n += 1;
    }
}

// ---------- shared math ----------

/// P(X >= k) for X ~ Binomial(n, p). Exact in f64 (n stays small: dice counts).
pub(crate) fn binom_tail(n: u32, p: f64, k: u32) -> f64 {
    if k == 0 {
        return 1.0;
    }
    if k > n {
        return 0.0;
    }
    // Walk terms C(n,i) p^i (1-p)^(n-i) from i=0, accumulating the tail.
    let q = 1.0 - p;
    let mut term = q.powi(n as i32); // i = 0
    let mut below = 0.0; // P(X < k)
    for i in 0..k {
        below += term;
        // term(i+1) = term(i) * (n-i)/(i+1) * p/q
        term *= (n - i) as f64 / (i + 1) as f64 * (p / q);
    }
    (1.0 - below).clamp(0.0, 1.0)
}

/// Best-of-`k` candidate generation — the cheater's "luck". Every candidate is
/// a legitimate uniform roll, so no single result is provably unfair; over a
/// match the bias is a steady tailwind. `k` = 2 keeps it sneaky.
pub(crate) fn biased<T>(k: usize, mut gen: impl FnMut() -> T, eval: impl Fn(&T) -> i64) -> T {
    let mut best = gen();
    let mut best_v = eval(&best);
    for _ in 1..k {
        let cand = gen();
        let v = eval(&cand);
        if v > best_v {
            best = cand;
            best_v = v;
        }
    }
    best
}

// ---------- Yatzy policy ----------

pub(crate) enum YatzyAction {
    /// Keep rolling with these holds (the glue diffs them into `YatzyHold`s).
    Roll {
        hold: [bool; 5],
    },
    Score(YatzyCat),
}

/// Scratch order when every open box previews 0 — cheapest boxes first.
const SCRATCH: [YatzyCat; 15] = [
    YatzyCat::Ones,
    YatzyCat::Twos,
    YatzyCat::Threes,
    YatzyCat::SmallStraight,
    YatzyCat::LargeStraight,
    YatzyCat::Yatzy,
    YatzyCat::TwoPairs,
    YatzyCat::FullHouse,
    YatzyCat::FourKind,
    YatzyCat::ThreeKind,
    YatzyCat::Fours,
    YatzyCat::OnePair,
    YatzyCat::Fives,
    YatzyCat::Sixes,
    YatzyCat::Chance,
];

fn upper_face(cat: YatzyCat) -> Option<u8> {
    Some(match cat {
        YatzyCat::Ones => 1,
        YatzyCat::Twos => 2,
        YatzyCat::Threes => 3,
        YatzyCat::Fours => 4,
        YatzyCat::Fives => 5,
        YatzyCat::Sixes => 6,
        _ => return None,
    })
}

fn face_counts(dice: &[u8]) -> [u8; 7] {
    let mut c = [0u8; 7];
    for &d in dice {
        if (1..=6).contains(&d) {
            c[d as usize] += 1;
        }
    }
    c
}

fn upper_cat(f: u8) -> YatzyCat {
    match f {
        1 => YatzyCat::Ones,
        2 => YatzyCat::Twos,
        3 => YatzyCat::Threes,
        4 => YatzyCat::Fours,
        5 => YatzyCat::Fives,
        6 => YatzyCat::Sixes,
        _ => YatzyCat::Chance,
    }
}

/// How much is chasing more dice of face `f` worth, given the OPEN boxes?
/// 0 = the face is dead — no open box can cash it in, so holding it only
/// wastes rerolls (this is what keeps the bot from chasing sixes after the
/// Sixes box and every of-a-kind box are already filled).
fn chase_value(f: u8, cnt: u8, open: &[YatzyCat], upper_sum: u16) -> u32 {
    use YatzyCat::*;
    let fv = f as u32;
    let c = cnt as u32;
    let mut v = 0;
    if open.contains(&upper_cat(f)) {
        // count × face now, plus bonus pressure while the +50 is live.
        v += c * fv + if upper_sum < 63 { 2 * fv } else { 0 };
    }
    if open.contains(&Yatzy) {
        v += c * 10; // the 50-pointer: raw count matters most
    }
    if open.contains(&FourKind) {
        v += c * fv;
    }
    if open.contains(&ThreeKind) {
        v += c.min(3) * fv;
    }
    if open.contains(&FullHouse) {
        v += c.min(3) * 3;
    }
    if open.contains(&TwoPairs) {
        v += c.min(2) * fv / 2;
    }
    if open.contains(&OnePair) {
        v += fv;
    }
    if open.contains(&Chance) && f >= 4 {
        v += fv; // high faces always help Chance
    }
    v
}

/// Decide the bot's next Yatzy move for the CURRENT dice (caller guarantees a
/// roll has happened). Pure; `open` = this bot's still-open categories.
pub(crate) fn yatzy_decide(
    dice: [u8; 5],
    rolls_left: u8,
    open: &[YatzyCat],
    upper_sum: u16,
    skill: BotSkill,
) -> YatzyAction {
    let preview = |cat: YatzyCat| crate::room::yatzy_score_cat(cat, &dice);
    let score_best = |metric: &dyn Fn(YatzyCat, u16) -> i32| -> YatzyAction {
        let best = open
            .iter()
            .map(|&c| (c, preview(c)))
            .filter(|&(_, v)| v > 0)
            .max_by_key(|&(c, v)| metric(c, v));
        match best {
            Some((cat, _)) => YatzyAction::Score(cat),
            // Everything previews 0 → scratch the cheapest open box.
            None => YatzyAction::Score(
                SCRATCH
                    .iter()
                    .copied()
                    .find(|c| open.contains(c))
                    .unwrap_or(YatzyCat::Chance),
            ),
        }
    };

    match skill {
        BotSkill::Easy => {
            if rolls_left > 0 {
                // Hold every die of the most frequent face that some OPEN box
                // can still use (ties → higher face); all faces dead → hold
                // nothing and reroll everything.
                let counts = face_counts(&dice);
                let best_f = (1..=6u8)
                    .filter(|&f| chase_value(f, counts[f as usize], open, upper_sum) > 0)
                    .max_by_key(|&f| counts[f as usize]);
                let mut hold = [false; 5];
                if let Some(f) = best_f {
                    for (i, &d) in dice.iter().enumerate() {
                        hold[i] = d == f;
                    }
                }
                YatzyAction::Roll { hold }
            } else {
                score_best(&|_c, v| v as i32)
            }
        }
        // Cheater plays the Hard policy — its edge is the biased rolls.
        BotSkill::Hard | BotSkill::Cheater => {
            // A made big combo is banked immediately, even with rolls left.
            let made = [
                YatzyCat::Yatzy,
                YatzyCat::LargeStraight,
                YatzyCat::FullHouse,
                YatzyCat::SmallStraight,
            ]
            .into_iter()
            .filter(|c| open.contains(c))
            .map(|c| (c, preview(c)))
            .filter(|&(_, v)| v > 0)
            .max_by_key(|&(_, v)| v);
            if let Some((cat, _)) = made {
                return YatzyAction::Score(cat);
            }
            if rolls_left == 0 {
                // Upper boxes earn extra credit while the +50 bonus is live.
                return score_best(&|c, v| {
                    let mut m = v as i32;
                    if let Some(f) = upper_face(c) {
                        if upper_sum < 63 {
                            m += (v as i32).min(3 * f as i32);
                        }
                    }
                    m
                });
            }
            let counts = face_counts(&dice);
            // One-die-per-present-face holds for a straight run.
            let straight_hold = |lo: u8, hi: u8| {
                let mut hold = [false; 5];
                for f in lo..=hi {
                    if counts[f as usize] > 0 {
                        if let Some(i) = dice.iter().position(|&d| d == f) {
                            hold[i] = true;
                        }
                    }
                }
                hold
            };
            // Chase a straight outright when 4 of its 5 faces are already there.
            for (cat, lo, hi) in [
                (YatzyCat::LargeStraight, 2u8, 6u8),
                (YatzyCat::SmallStraight, 1u8, 5u8),
            ] {
                if !open.contains(&cat) {
                    continue;
                }
                let present = (lo..=hi).filter(|&f| counts[f as usize] > 0).count();
                if present >= 4 {
                    return YatzyAction::Roll {
                        hold: straight_hold(lo, hi),
                    };
                }
            }
            // Otherwise chase the face with the best payoff among OPEN boxes:
            // chase value first (0 = dead face, never held), then count, then
            // the higher face.
            let best = (1..=6u8)
                .map(|f| (chase_value(f, counts[f as usize], open, upper_sum), f))
                .max_by_key(|&(v, f)| (v, counts[f as usize], f))
                .filter(|&(v, _)| v > 0);
            if let Some((_, f)) = best {
                let mut hold = [false; 5];
                for (i, &d) in dice.iter().enumerate() {
                    hold[i] = d == f;
                }
                return YatzyAction::Roll { hold };
            }
            // Every face is dead for the kind/upper boxes. If a straight is
            // still open, keep its partial run; else reroll everything.
            for (cat, lo, hi) in [
                (YatzyCat::LargeStraight, 2u8, 6u8),
                (YatzyCat::SmallStraight, 1u8, 5u8),
            ] {
                if open.contains(&cat) {
                    return YatzyAction::Roll {
                        hold: straight_hold(lo, hi),
                    };
                }
            }
            YatzyAction::Roll { hold: [false; 5] }
        }
    }
}

// ---------- Farkle policy ----------

pub(crate) enum FarkleAction {
    SetAside(Vec<usize>),
    Roll,
    Bank,
}

/// Every valid set-aside: non-empty index subsets whose EXACT selection scores
/// (validated by the same `farkle_score_exact` the handler uses, so anything
/// returned here always passes). ≤ 2^6−1 = 63 subsets.
pub(crate) fn farkle_selections(dice: &[u8]) -> Vec<(Vec<usize>, u32)> {
    let n = dice.len().min(6);
    let mut out = Vec::new();
    for mask in 1u32..(1u32 << n) {
        let idx: Vec<usize> = (0..n).filter(|i| mask & (1 << i) != 0).collect();
        let picked: Vec<u8> = idx.iter().map(|&i| dice[i]).collect();
        if let Some(score) = crate::room::farkle_score_exact(&picked) {
            out.push((idx, score));
        }
    }
    out
}

/// P(the next roll of `r` dice scores nothing) — pinned empirical table.
const P_BUST: [f64; 7] = [0.0, 0.667, 0.444, 0.278, 0.157, 0.077, 0.024];
/// Expected points gained by rolling `r` dice (given it scores) — pinned.
const EXP_GAIN: [f64; 7] = [0.0, 25.0, 50.0, 85.0, 140.0, 205.0, 400.0];

/// Decide the bot's next Farkle move. Pure. `dice` = the just-rolled dice (only
/// meaningful while `must_pick`); `remaining` = dice available to roll next.
#[allow(clippy::too_many_arguments)]
pub(crate) fn farkle_decide(
    dice: &[u8],
    turn_score: u32,
    remaining: u8,
    must_pick: bool,
    busted: bool,
    banked: u32,
    target: u32,
    skill: BotSkill,
) -> FarkleAction {
    if busted {
        return FarkleAction::Bank; // the pass path
    }
    if must_pick {
        let sels = farkle_selections(dice);
        let Some(max_score) = sels.iter().map(|&(_, s)| s).max() else {
            return FarkleAction::Bank; // unreachable: must_pick implies a score
        };
        let pick = match skill {
            BotSkill::Easy => sels
                .into_iter()
                .max_by_key(|(k, s)| (*s, k.len()))
                .map(|(k, _)| k),
            BotSkill::Hard | BotSkill::Cheater => {
                let n = dice.len();
                let after = |kept: usize| if kept >= n { 6usize } else { n - kept };
                // The selection we'd make if we intend to keep rolling values a
                // big remaining pool; the banking selection just takes the points.
                let cont = sels
                    .iter()
                    .max_by_key(|(k, s)| *s as u64 + 60 * after(k.len()) as u64)
                    .cloned();
                let bank = sels.iter().max_by_key(|&&(_, s)| s).cloned();
                match (cont, bank) {
                    (Some((ck, cs)), Some((bk, _))) => {
                        let r2 = after(ck.len());
                        let winning = banked + turn_score + max_score >= target;
                        let keep_rolling =
                            !winning && EXP_GAIN[r2] > P_BUST[r2] * (turn_score + cs) as f64;
                        Some(if keep_rolling { ck } else { bk })
                    }
                    _ => None,
                }
            }
        };
        return match pick {
            Some(k) => FarkleAction::SetAside(k),
            None => FarkleAction::Bank,
        };
    }
    // Between rolls: keep pushing or bank the turn score?
    if turn_score == 0 {
        return FarkleAction::Roll; // banking zero is pointless — start the turn
    }
    let r = remaining.clamp(1, 6) as usize;
    let push = match skill {
        BotSkill::Easy => turn_score < 300 && remaining >= 3,
        BotSkill::Hard | BotSkill::Cheater => {
            banked + turn_score < target
                && (remaining == 6 || EXP_GAIN[r] > P_BUST[r] * turn_score as f64)
        }
    };
    if push {
        FarkleAction::Roll
    } else {
        FarkleAction::Bank
    }
}

// ---------- Liar's Dice policy ----------

pub(crate) enum LiarsAction {
    Bid { quantity: u32, face: u8 },
    Call,
}

/// Own dice matching a bid face: literal matches + wild 1s (except on ace bids).
fn mine(own: &[u8], face: u8) -> u32 {
    own.iter()
        .filter(|&&d| d == face || (face != 1 && d == 1))
        .count() as u32
}

fn p_hit(face: u8) -> f64 {
    if face == 1 {
        1.0 / 6.0
    } else {
        1.0 / 3.0
    }
}

/// P(at least `q` dice across all cups show `face`), from this hand's view.
fn p_true(own: &[u8], total: u32, q: u32, face: u8) -> f64 {
    let m = mine(own, face);
    if q <= m {
        return 1.0;
    }
    let unknown = total.saturating_sub(own.len() as u32);
    binom_tail(unknown, p_hit(face), q - m)
}

/// Expected count of `face` across all cups, from this hand's view.
fn expected(own: &[u8], total: u32, face: u8) -> f64 {
    mine(own, face) as f64 + total.saturating_sub(own.len() as u32) as f64 * p_hit(face)
}

/// The minimal legal raises over `bid`: same quantity at a higher face, then
/// quantity+1 at any face (matching `liars_bid`'s raise rule), capped at `total`.
fn legal_raises(bid: (u32, u8), total: u32) -> Vec<(u32, u8)> {
    let (q0, f0) = bid;
    let mut out: Vec<(u32, u8)> = (f0 + 1..=6).map(|f| (q0, f)).collect();
    if q0 < total {
        out.extend((1..=6u8).map(|f| (q0 + 1, f)));
    }
    out.retain(|&(q, _)| q >= 1 && q <= total);
    out
}

/// Decide the bot's Liar's Dice move. Pure. `truth` (cheater only) = the exact
/// LITERAL face counts across every cup (index 1..=6); `camo` ∈ [0,1) — below
/// 0.15 the cheater plays the plain Hard action as camouflage.
pub(crate) fn liars_decide(
    own: &[u8],
    total: u32,
    bid: Option<(u32, u8)>,
    skill: BotSkill,
    truth: Option<&[u32; 7]>,
    camo: f64,
) -> LiarsAction {
    match skill {
        BotSkill::Easy => match bid {
            None => {
                // Open on our strongest non-ace face, at a comfortable quantity.
                let f = (2..=6u8).max_by_key(|&f| mine(own, f)).unwrap_or(6);
                let q = ((expected(own, total, f) * 0.75).floor() as u32).clamp(1, total.max(1));
                LiarsAction::Bid {
                    quantity: q,
                    face: f,
                }
            }
            Some((q0, f0)) => {
                if q0 as f64 > expected(own, total, f0) + 1.0 {
                    return LiarsAction::Call;
                }
                for (q, f) in legal_raises((q0, f0), total) {
                    if expected(own, total, f) + 0.5 >= q as f64 {
                        return LiarsAction::Bid {
                            quantity: q,
                            face: f,
                        };
                    }
                }
                LiarsAction::Call
            }
        },
        BotSkill::Hard => match bid {
            None => {
                // Open at the largest quantity we still believe at ≥50%.
                let mut best = (1u32, 6u8);
                for f in 1..=6u8 {
                    let mut q = 1;
                    while q < total && p_true(own, total, q + 1, f) >= 0.5 {
                        q += 1;
                    }
                    if q > best.0 || (q == best.0 && f > best.1) {
                        best = (q, f);
                    }
                }
                LiarsAction::Bid {
                    quantity: best.0,
                    face: best.1,
                }
            }
            Some((q0, f0)) => {
                if p_true(own, total, q0, f0) < 0.25 {
                    return LiarsAction::Call;
                }
                let best = legal_raises((q0, f0), total)
                    .into_iter()
                    .map(|(q, f)| (q, f, p_true(own, total, q, f)))
                    .filter(|&(_, _, p)| p >= 0.40)
                    .max_by(|a, b| a.2.total_cmp(&b.2));
                match best {
                    Some((q, f, _)) => LiarsAction::Bid {
                        quantity: q,
                        face: f,
                    },
                    None => LiarsAction::Call,
                }
            }
        },
        BotSkill::Cheater => {
            let Some(t) = truth else {
                // No truth supplied — degrade to Hard (defensive).
                return liars_decide(own, total, bid, BotSkill::Hard, None, camo);
            };
            if camo < 0.15 {
                // Camouflage: a plausible plain-Hard action.
                return liars_decide(own, total, bid, BotSkill::Hard, None, camo);
            }
            // Wilds count toward every face except aces themselves.
            let true_count = |f: u8| {
                if f == 1 {
                    t[1]
                } else {
                    t[f as usize] + t[1]
                }
            };
            match bid {
                None => {
                    // Open under the true count so the bid can never be caught.
                    let f = (2..=6u8).max_by_key(|&f| true_count(f)).unwrap_or(6);
                    let q = true_count(f)
                        .min(expected(own, total, f).floor() as u32 + 1)
                        .clamp(1, total.max(1));
                    LiarsAction::Bid {
                        quantity: q,
                        face: f,
                    }
                }
                Some((q0, f0)) => {
                    if q0 > true_count(f0) {
                        return LiarsAction::Call; // KNOWN false — always safe
                    }
                    // The bid is true: never call it. Prefer the strongest raise
                    // that is still true (opponents calling it lose)...
                    let raises = legal_raises((q0, f0), total);
                    let safe = raises
                        .iter()
                        .filter(|&&(q, f)| q <= true_count(f))
                        .max_by_key(|&&(q, f)| (q, f));
                    if let Some(&(q, f)) = safe {
                        return LiarsAction::Bid {
                            quantity: q,
                            face: f,
                        };
                    }
                    // ...else the least-implausible unsafe raise (a real bluff —
                    // still indistinguishable from a Hard player's move).
                    let best = raises
                        .into_iter()
                        .map(|(q, f)| (q, f, p_true(own, total, q, f)))
                        .max_by(|a, b| a.2.total_cmp(&b.2));
                    match best {
                        Some((q, f, _)) => LiarsAction::Bid {
                            quantity: q,
                            face: f,
                        },
                        None => LiarsAction::Call,
                    }
                }
            }
        }
    }
}

// ---------- the pump (per-room bot scheduler) ----------

/// Delay class for a bot action, scaled from `DICE_BOT_DELAY_MS`.
pub(crate) enum BotDelay {
    /// A small in-turn step (toggling one hold).
    Quick,
    /// A "thinking" pause before a roll / score / bid.
    Think,
    /// Lingering on a Liar's reveal so humans can read it.
    Reveal,
}

impl BotDelay {
    fn duration(&self, base_ms: u64) -> Duration {
        let (lo, hi) = match self {
            BotDelay::Quick => (0.3, 0.55),
            BotDelay::Think => (0.85, 1.9),
            BotDelay::Reveal => (3.0, 4.0),
        };
        let mut rng = rand::rng();
        Duration::from_millis((base_ms as f64 * rng.random_range(lo..hi)).round() as u64)
    }
}

/// Ensure a pump task is running for this room if a bot has something to do.
/// Call ONLY while no room lock is held (the std Mutex is not reentrant) —
/// i.e. after every apply/join scope, never inside one.
pub fn schedule_pump(room: Arc<Mutex<Room>>, base_delay_ms: u64) {
    {
        let mut r = room.lock().unwrap();
        if r.pump_running || r.bot_next_action().is_none() {
            return;
        }
        r.pump_running = true;
    }
    tokio::spawn(pump(room, base_delay_ms));
}

/// The per-room bot loop: sleep a human-ish delay, re-check, act, repeat. Exits
/// (clearing the flag under the lock, so `schedule_pump` can re-arm) as soon as
/// nothing bot-actionable remains — a human's turn, game over, or nobody
/// watching. Bot applies bypass `touch()` so bots can't keep a room alive past
/// its TTL.
async fn pump(room: Arc<Mutex<Room>>, base_delay_ms: u64) {
    let mut safety = 0u32;
    let mut last_bot = String::new();
    loop {
        let planned = {
            let mut r = room.lock().unwrap();
            match r.bot_next_action() {
                Some((id, _, delay)) => Some((id, delay.duration(base_delay_ms))),
                None => {
                    r.pump_running = false;
                    return;
                }
            }
        };
        let (bot_id, delay) = planned.expect("checked above");
        tokio::time::sleep(delay).await; // no lock held across the await

        let mut r = room.lock().unwrap();
        match r.bot_next_action() {
            // Only act if the SAME bot still has the move — anything else
            // (skip, mode switch, bot removed) re-evaluates from scratch.
            Some((id, msg, _)) if id == bot_id => {
                if id != last_bot {
                    safety = 0;
                    last_bot = id.clone();
                }
                r.apply_untouched(&id, msg);
                safety += 1;
                if safety > 60 {
                    // A wedged policy must never spin a turn forever — force on.
                    r.apply_untouched(&id, ClientMsg::SkipTurn);
                    safety = 0;
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ----- shared math -----

    #[test]
    fn binom_tail_spot_values() {
        // P(X>=0) is always 1; P(X>=n+1) is 0.
        assert_eq!(binom_tail(10, 0.5, 0), 1.0);
        assert_eq!(binom_tail(3, 0.5, 4), 0.0);
        // P(X>=1) for n=2,p=1/3 = 1 - (2/3)^2 = 5/9.
        assert!((binom_tail(2, 1.0 / 3.0, 1) - 5.0 / 9.0).abs() < 1e-12);
        // Symmetric coin: P(X>=2) for n=3 = 0.5.
        assert!((binom_tail(3, 0.5, 2) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn biased_picks_higher_eval() {
        let mut vals = [3i64, 7].into_iter();
        let out = biased(2, || vals.next().unwrap(), |&v| v);
        assert_eq!(out, 7);
    }

    // ----- yatzy -----

    fn all_open() -> Vec<YatzyCat> {
        SCRATCH.to_vec()
    }

    #[test]
    fn yatzy_hard_banks_a_made_yatzy_early() {
        let a = yatzy_decide([4; 5], 2, &all_open(), 0, BotSkill::Hard);
        assert!(matches!(a, YatzyAction::Score(YatzyCat::Yatzy)));
    }

    #[test]
    fn yatzy_easy_holds_most_frequent_face_and_uses_all_rolls() {
        let a = yatzy_decide([3, 3, 5, 2, 3], 2, &all_open(), 0, BotSkill::Easy);
        match a {
            YatzyAction::Roll { hold } => assert_eq!(hold, [true, true, false, false, true]),
            _ => panic!("easy should keep rolling"),
        }
        // Even with 5 of a kind, easy keeps rolling while rolls remain.
        let a = yatzy_decide([6; 5], 1, &all_open(), 0, BotSkill::Easy);
        assert!(matches!(a, YatzyAction::Roll { .. }));
    }

    #[test]
    fn yatzy_scratches_cheapest_open_when_nothing_scores() {
        // Dice that score 0 in the only open boxes (no 1s; SmallStraight not made).
        let open = [YatzyCat::Ones, YatzyCat::SmallStraight];
        let a = yatzy_decide([2, 2, 4, 6, 6], 0, &open, 0, BotSkill::Hard);
        assert!(matches!(a, YatzyAction::Score(YatzyCat::Ones)));
    }

    #[test]
    fn yatzy_hard_chases_an_open_straight() {
        // 2,3,4,5 present — large straight open → hold one die per face.
        let a = yatzy_decide([2, 3, 4, 5, 5], 2, &all_open(), 0, BotSkill::Hard);
        match a {
            YatzyAction::Roll { hold } => {
                assert_eq!(hold, [true, true, true, true, false]);
            }
            _ => panic!("hard should chase the straight"),
        }
    }

    #[test]
    fn yatzy_never_holds_a_face_no_open_box_can_use() {
        // Only Ones is open: three 6s are DEAD dice (Sixes + every of-a-kind
        // box is gone) — the bot must chase the 1, not the sixes.
        let open = [YatzyCat::Ones];
        for skill in [BotSkill::Easy, BotSkill::Hard, BotSkill::Cheater] {
            match yatzy_decide([6, 6, 6, 2, 1], 2, &open, 10, skill) {
                YatzyAction::Roll { hold } => {
                    assert_eq!(
                        hold,
                        [false, false, false, false, true],
                        "{skill:?} held dead dice"
                    );
                }
                _ => panic!("should keep rolling"),
            }
        }
    }

    #[test]
    fn yatzy_falls_back_to_a_partial_straight_when_kinds_are_dead() {
        // Only SmallStraight open: no face has kind/upper value — keep the
        // distinct 2,3,4 run and reroll the pair of sixes.
        let open = [YatzyCat::SmallStraight];
        match yatzy_decide([6, 6, 2, 3, 4], 2, &open, 63, BotSkill::Hard) {
            YatzyAction::Roll { hold } => {
                assert_eq!(hold, [false, false, true, true, true]);
            }
            _ => panic!("should keep rolling"),
        }
    }

    #[test]
    fn yatzy_hold_decision_is_stable_for_unchanged_dice() {
        // The pump applies holds one index at a time; the desired hold set must
        // not depend on the current holds (only the dice), so it converges.
        let d = [1, 3, 3, 6, 3];
        let a1 = yatzy_decide(d, 1, &all_open(), 10, BotSkill::Hard);
        let a2 = yatzy_decide(d, 1, &all_open(), 10, BotSkill::Hard);
        match (a1, a2) {
            (YatzyAction::Roll { hold: h1 }, YatzyAction::Roll { hold: h2 }) => {
                assert_eq!(h1, h2)
            }
            _ => panic!("expected two identical roll decisions"),
        }
    }

    // ----- farkle -----

    #[test]
    fn farkle_selections_all_validate_against_the_scorer() {
        let mut rng = rand::rng();
        for _ in 0..200 {
            let n = rng.random_range(1..=6);
            let dice: Vec<u8> = (0..n).map(|_| rng.random_range(1..=6)).collect();
            for (idx, score) in farkle_selections(&dice) {
                let picked: Vec<u8> = idx.iter().map(|&i| dice[i]).collect();
                assert_eq!(crate::room::farkle_score_exact(&picked), Some(score));
            }
        }
    }

    #[test]
    fn farkle_easy_takes_max_score_and_banks_at_300() {
        // 1,1,5 → best selection is all three (250).
        let a = farkle_decide(
            &[1, 1, 5, 2, 3, 3],
            0,
            6,
            true,
            false,
            0,
            10_000,
            BotSkill::Easy,
        );
        match a {
            FarkleAction::SetAside(k) => {
                assert_eq!(k, vec![0, 1, 2]);
            }
            _ => panic!("must set aside while must_pick"),
        }
        // 350 on the table, 3 dice left → easy banks.
        let a = farkle_decide(&[], 350, 3, false, false, 0, 10_000, BotSkill::Easy);
        assert!(matches!(a, FarkleAction::Bank));
        // 250 with 4 left → easy keeps rolling.
        let a = farkle_decide(&[], 250, 4, false, false, 0, 10_000, BotSkill::Easy);
        assert!(matches!(a, FarkleAction::Roll));
    }

    #[test]
    fn farkle_busted_passes_and_hard_banks_the_win() {
        assert!(matches!(
            farkle_decide(&[2, 3], 0, 4, false, true, 0, 10_000, BotSkill::Hard),
            FarkleAction::Bank
        ));
        // Banking reaches the target → bank regardless of odds.
        assert!(matches!(
            farkle_decide(&[], 600, 5, false, false, 9500, 10_000, BotSkill::Hard),
            FarkleAction::Bank
        ));
    }

    #[test]
    fn farkle_hard_always_rolls_hot_dice() {
        let a = farkle_decide(&[], 1500, 6, false, false, 0, 10_000, BotSkill::Hard);
        assert!(matches!(a, FarkleAction::Roll));
    }

    #[test]
    fn farkle_hard_banks_a_big_turn_on_few_dice() {
        // 1000 on the table, 1 die left: EXP_GAIN 25 < 0.667*1000 → bank.
        let a = farkle_decide(&[], 1000, 1, false, false, 0, 10_000, BotSkill::Hard);
        assert!(matches!(a, FarkleAction::Bank));
    }

    // ----- liar's -----

    #[test]
    fn liars_raises_are_always_legal() {
        for q0 in 1..=8u32 {
            for f0 in 1..=6u8 {
                for (q, f) in legal_raises((q0, f0), 10) {
                    assert!(q > q0 || (q == q0 && f > f0));
                    assert!((1..=6).contains(&f) && (1..=10).contains(&q));
                }
            }
        }
    }

    #[test]
    fn liars_hard_calls_an_absurd_bid() {
        // 10 total dice, we hold none of face 6 — a bid of 9 sixes is absurd.
        let a = liars_decide(
            &[2, 3, 4, 2, 3],
            10,
            Some((9, 6)),
            BotSkill::Hard,
            None,
            0.9,
        );
        assert!(matches!(a, LiarsAction::Call));
    }

    #[test]
    fn liars_easy_and_hard_open_with_a_bid() {
        for skill in [BotSkill::Easy, BotSkill::Hard] {
            match liars_decide(&[5, 5, 2, 1, 3], 15, None, skill, None, 0.9) {
                LiarsAction::Bid { quantity, face } => {
                    assert!((1..=15).contains(&quantity));
                    assert!((1..=6).contains(&face));
                }
                LiarsAction::Call => panic!("cannot call with no bid standing"),
            }
        }
    }

    #[test]
    fn liars_cheater_never_calls_true_nor_overbids_when_safe_raise_exists() {
        let mut rng = rand::rng();
        for _ in 0..500 {
            let total = rng.random_range(4..=15u32);
            let own_n = rng.random_range(1..=5u32).min(total);
            let own: Vec<u8> = (0..own_n).map(|_| rng.random_range(1..=6)).collect();
            // Fabricate the table truth: literal counts summing to `total`,
            // consistent with our own hand.
            let mut truth = [0u32; 7];
            for &d in &own {
                truth[d as usize] += 1;
            }
            for _ in 0..(total - own_n) {
                truth[rng.random_range(1..=6) as usize] += 1;
            }
            let true_count = |f: u8| {
                if f == 1 {
                    truth[1]
                } else {
                    truth[f as usize] + truth[1]
                }
            };
            let q0 = rng.random_range(1..=total);
            let f0 = rng.random_range(1..=6u8);
            // camo >= 0.15 forces the honest cheater branch.
            let a = liars_decide(
                &own,
                total,
                Some((q0, f0)),
                BotSkill::Cheater,
                Some(&truth),
                0.5,
            );
            let bid_true = q0 <= true_count(f0);
            match a {
                LiarsAction::Call => assert!(!bid_true, "cheater called a TRUE bid"),
                LiarsAction::Bid { quantity, face } => {
                    let safe_exists = legal_raises((q0, f0), total)
                        .iter()
                        .any(|&(q, f)| q <= true_count(f));
                    if safe_exists {
                        assert!(
                            quantity <= true_count(face),
                            "cheater overbid the truth with a safe raise available"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn bot_names_are_unique_until_exhausted_per_pool() {
        let mut taken: Vec<String> = Vec::new();
        for _ in 0..(BOT_NAMES.len() + 3) {
            let n = pick_name(&taken, BotSkill::Hard);
            assert!(!taken.contains(&n));
            assert!(!CHEATER_NAMES.contains(&n.as_str()), "honest pool only");
            taken.push(n);
        }
        for _ in 0..(CHEATER_NAMES.len() + 3) {
            let n = pick_name(&taken, BotSkill::Cheater);
            assert!(!taken.contains(&n));
            assert!(!BOT_NAMES.contains(&n.as_str()), "cheater pool only");
            taken.push(n);
        }
    }
}
