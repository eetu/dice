// The one piece of dice maths the *render path* needs without the 3D engine.
// It lives apart from `shapes.ts` on purpose: that module imports three.js,
// cannon-es and RoundedBoxGeometry, so importing this helper from there dragged
// ~800 KB of WebGL onto the game route and made the invite link unopenable on a
// browser too old to parse it. Pure arithmetic, no dependencies — keep it that way.

/** Expand a d100 roll value (1..100) into its two display dice: a tens d10
 *  (shown 00..90) and a units d10 (shown 0..9). 100 → "00" + "0". */
export function d100Digits(value: number): { tens: number; units: number } {
  const m = value % 100; // 100 → 0
  return { tens: Math.floor(m / 10), units: m % 10 };
}
