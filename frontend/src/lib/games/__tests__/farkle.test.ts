import { describe, expect, it } from "vitest";

import { hasAnyScore, scoreSelection } from "../farkle";

// Mirrors backend/src/room.rs `farkle_scoring_rules` / `farkle_bust_detection`
// so the client preview can't silently drift from the authoritative scorer.
describe("farkle scoreSelection", () => {
  it("scores singles and rejects dead dice", () => {
    expect(scoreSelection([1])).toBe(100);
    expect(scoreSelection([5])).toBe(50);
    expect(scoreSelection([1, 5])).toBe(150);
    expect(scoreSelection([2])).toBeNull();
    expect(scoreSelection([1, 2])).toBeNull(); // the 2 is dead
  });

  it("scores n-of-a-kind on the doubling ladder", () => {
    expect(scoreSelection([1, 1, 1])).toBe(1000);
    expect(scoreSelection([2, 2, 2])).toBe(200);
    expect(scoreSelection([6, 6, 6])).toBe(600);
    expect(scoreSelection([1, 1, 1, 1])).toBe(2000);
    expect(scoreSelection([5, 5, 5, 5, 5])).toBe(2000);
    expect(scoreSelection([2, 2, 2, 2, 2, 2])).toBe(1600);
    expect(scoreSelection([1, 1, 1, 5])).toBe(1050);
  });

  it("scores six-dice specials", () => {
    expect(scoreSelection([1, 2, 3, 4, 5, 6])).toBe(1500); // straight
    expect(scoreSelection([2, 2, 3, 3, 4, 4])).toBe(1500); // three pairs
    expect(scoreSelection([2, 2, 2, 4, 4, 4])).toBe(2500); // two triplets
  });
});

describe("farkle hasAnyScore", () => {
  it("detects busts", () => {
    expect(hasAnyScore([1, 2, 3])).toBe(true);
    expect(hasAnyScore([5, 6, 2])).toBe(true);
    expect(hasAnyScore([3, 3, 3])).toBe(true);
    expect(hasAnyScore([2, 3, 4])).toBe(false);
    expect(hasAnyScore([2, 3, 4, 6])).toBe(false);
    expect(hasAnyScore([2, 2, 3, 3, 4, 4])).toBe(true); // three pairs
  });
});
