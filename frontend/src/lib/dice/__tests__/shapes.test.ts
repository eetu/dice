import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  d100Digits,
  type DieType,
  relabelRotationFor,
  shapeFor,
  shownValueFor,
} from "../shapes";

const ALL: DieType[] = ["d4", "d6", "d8", "d10", "d12", "d20"];
const GROUP_ORDER: Record<DieType, number> = {
  d4: 12,
  d6: 24,
  d8: 24,
  d10: 10,
  d12: 60,
  d20: 60,
};
const FACE_COUNT: Record<DieType, number> = {
  d4: 4, // vertices (vertex-read)
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
};

function randomQuat(): THREE.Quaternion {
  return new THREE.Quaternion(
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
  ).normalize();
}

describe("die shapes", () => {
  it("has the correct proper-rotation-group order per solid", () => {
    for (const t of ALL) {
      expect(shapeFor(t).rotations.length, t).toBe(GROUP_ORDER[t]);
    }
  });

  it("exposes one read-axis per face (or vertex for d4)", () => {
    for (const t of ALL) {
      expect(shapeFor(t).readAxes.length, t).toBe(FACE_COUNT[t]);
    }
  });

  it("numbers 1..n with each value once", () => {
    for (const t of ALL) {
      const vals = shapeFor(t)
        .readAxes.map((a) => a.value)
        .sort((a, b) => a - b);
      const n = FACE_COUNT[t];
      expect(vals, t).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it("relabels any rest orientation to show the target (every solid)", () => {
    for (const t of ALL) {
      const shape = shapeFor(t);
      const values = shape.readAxes.map((a) => a.value);
      for (let i = 0; i < 120; i++) {
        const rest = randomQuat();
        for (const target of values) {
          const g = relabelRotationFor(target, rest, shape);
          const visual = rest.clone().multiply(g);
          expect(
            shownValueFor(visual, shape.readAxes),
            `${t} → ${target}`,
          ).toBe(target);
        }
      }
    }
  });

  it("relabel result is always a member of the rotation group (a symmetry)", () => {
    for (const t of ALL) {
      const shape = shapeFor(t);
      const rest = randomQuat();
      for (const { value } of shape.readAxes) {
        const g = relabelRotationFor(value, rest, shape);
        const isMember = shape.rotations.some(
          (r) => Math.abs(r.dot(g)) > 1 - 1e-6,
        );
        expect(isMember, t).toBe(true);
      }
    }
  });

  it("face dice pair opposite faces to a constant sum", () => {
    const sums: Partial<Record<DieType, number>> = {
      d8: 9,
      d12: 13,
      d20: 21,
    };
    for (const [t, sum] of Object.entries(sums) as [DieType, number][]) {
      const shape = shapeFor(t);
      for (const a of shape.readAxes) {
        // find the antipodal read-axis
        const anti = shape.readAxes.reduce((best, b) =>
          b.dir.distanceTo(a.dir.clone().negate()) <
          best.dir.distanceTo(a.dir.clone().negate())
            ? b
            : best,
        );
        expect(a.value + anti.value, t).toBe(sum);
      }
    }
  });

  it("builds geometry + collider without throwing", () => {
    for (const t of ALL) {
      const shape = shapeFor(t);
      expect(() => shape.makeGeometry().dispose(), t).not.toThrow();
      expect(() => shape.makeCollider(), t).not.toThrow();
    }
  });

  it("d100 splits a value into tens + units digits", () => {
    expect(d100Digits(1)).toEqual({ tens: 0, units: 1 });
    expect(d100Digits(57)).toEqual({ tens: 5, units: 7 });
    expect(d100Digits(90)).toEqual({ tens: 9, units: 0 });
    expect(d100Digits(100)).toEqual({ tens: 0, units: 0 }); // "00" + "0"
  });
});
