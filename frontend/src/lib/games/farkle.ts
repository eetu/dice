// Farkle scoring — a hand-mirror of `farkle_score_exact` in backend/src/room.rs.
// The backend is authoritative (it validates every set-aside); this client copy
// exists only for live UI feedback (which selections are legal + what they score).
// Keep the two in lockstep — the unit test mirrors the backend's cases.

function counts(dice: number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) if (d >= 1 && d <= 6) c[d]++;
  return c;
}

// Sum requiring every die to be used: singles only for 1s (100) / 5s (50);
// three+ of a kind uses the doubling ladder (3=base, 4=2×, 5=4×, 6=8×; base 1000
// for 1s else face×100). A lone 2/3/4/6 → not all dice used → null.
function perFace(c: number[]): number | null {
  let total = 0;
  for (let f = 1; f <= 6; f++) {
    const n = c[f];
    if (n === 0) continue;
    if (n >= 3) {
      const base = f === 1 ? 1000 : f * 100;
      total += base * (1 << (n - 3));
    } else if (f === 1) {
      total += n * 100;
    } else if (f === 5) {
      total += n * 50;
    } else {
      return null;
    }
  }
  return total;
}

function isThreePairs(c: number[]): boolean {
  let pairs = 0;
  for (let f = 1; f <= 6; f++) {
    if (c[f] % 2 !== 0) return false;
    pairs += c[f] / 2;
  }
  return pairs === 3;
}

function isTwoTriplets(c: number[]): boolean {
  let t = 0;
  for (let f = 1; f <= 6; f++) if (c[f] === 3) t++;
  return t === 2;
}

/** Score an EXACT selection (all dice must be used), or null if any die scores
 *  nothing. Six-dice specials (straight / three pairs / two triplets) apply when
 *  6 dice are selected. */
export function scoreSelection(dice: number[]): number | null {
  const c = counts(dice);
  let best = perFace(c);
  if (dice.length === 6) {
    const consider = (v: number) => {
      best = Math.max(best ?? 0, v);
    };
    if ([1, 2, 3, 4, 5, 6].every((f) => c[f] === 1)) consider(1500);
    if (isThreePairs(c)) consider(1500);
    if (isTwoTriplets(c)) consider(2500);
  }
  return best !== null && best > 0 ? best : null;
}

/** Does a roll contain any scoring die? (false = a Farkle / bust.) */
export function hasAnyScore(dice: number[]): boolean {
  const c = counts(dice);
  if (c[1] > 0 || c[5] > 0) return true;
  for (let f = 1; f <= 6; f++) if (c[f] >= 3) return true;
  return dice.length === 6 && (isThreePairs(c) || isTwoTriplets(c));
}
