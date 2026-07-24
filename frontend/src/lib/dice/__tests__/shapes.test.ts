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
      expect(() => shape.makeGeometry(false).dispose(), t).not.toThrow();
      expect(() => shape.makeGeometry(true).dispose(), t).not.toThrow();
      expect(() => shape.makeCollider(), t).not.toThrow();
    }
  });

  it("rounded bodies are closed + outward (no see-through facets)", () => {
    // The rounded construction must produce only outward-wound triangles (an
    // inward one back-face-culls into a see-through hole) and exact outward
    // unit normals (anything else shades as dents/grooves).
    for (const t of ALL.filter((x) => x !== "d6")) {
      const g = shapeFor(t).makeGeometry(true);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const nrm = g.attributes.normal as THREE.BufferAttribute;
      expect(nrm, t).toBeDefined();
      let minWind = Infinity; // triangle winding: geometric normal · centroid
      let minNormalDot = Infinity; // vertex normal · position (outwardness)
      let normalLenOff = 0; // worst |,|normal| - 1|
      for (let i = 0; i < pos.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i);
        const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
        const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        const gn = new THREE.Vector3()
          .subVectors(b, a)
          .cross(new THREE.Vector3().subVectors(c, a));
        if (gn.lengthSq() > 1e-12) {
          minWind = Math.min(
            minWind,
            gn.normalize().dot(a.clone().add(b).add(c).normalize()),
          );
        }
      }
      for (let i = 0; i < nrm.count; i++) {
        const n = new THREE.Vector3().fromBufferAttribute(nrm, i);
        const p = new THREE.Vector3().fromBufferAttribute(pos, i);
        normalLenOff = Math.max(normalLenOff, Math.abs(n.length() - 1));
        minNormalDot = Math.min(minNormalDot, n.dot(p.normalize()));
      }
      expect(minWind, `${t} winding`).toBeGreaterThan(0);
      expect(minNormalDot, `${t} normal direction`).toBeGreaterThan(0);
      expect(normalLenOff, `${t} normal length`).toBeLessThan(1e-3);
      g.dispose();
    }
  });

  it("d10 kite faces are planar (each kite's two triangles are coplanar)", () => {
    const g = shapeFor("d10").makeGeometry(false);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const triNormal = (t: number) => {
      const a = new THREE.Vector3().fromBufferAttribute(pos, t * 3);
      const b = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 2);
      return new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
        .normalize();
    };
    // polyGeometry fan-triangulates each of the 10 kites into 2 triangles.
    for (let k = 0; k < 10; k++) {
      const n0 = triNormal(2 * k);
      const n1 = triNormal(2 * k + 1);
      expect(Math.abs(n0.dot(n1)), `kite ${k}`).toBeGreaterThan(0.999);
    }
    g.dispose();
  });

  it("d12 pentagon faces are planar + wound convex (no bowtie spikes)", () => {
    const g = shapeFor("d12").makeGeometry(false);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const vtx = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
    const triNormal = (t: number) =>
      new THREE.Vector3()
        .subVectors(vtx(t * 3 + 1), vtx(t * 3))
        .cross(new THREE.Vector3().subVectors(vtx(t * 3 + 2), vtx(t * 3)))
        .normalize();
    // 12 pentagons, each fan-triangulated into 3 triangles.
    for (let f = 0; f < 12; f++) {
      const n0 = triNormal(3 * f);
      for (let t = 3 * f; t < 3 * f + 3; t++) {
        const n = triNormal(t);
        // coplanar (parallel to the face's first triangle)…
        expect(Math.abs(n.dot(n0)), `face ${f} coplanar`).toBeGreaterThan(
          0.999,
        );
        // …and all wound the same way (outward) — a bowtie would flip one.
        const c = vtx(t * 3)
          .add(vtx(t * 3 + 1))
          .add(vtx(t * 3 + 2));
        expect(n.dot(c), `face ${f} winding`).toBeGreaterThan(0);
      }
    }
    g.dispose();
  });

  it("d100 splits a value into tens + units digits", () => {
    expect(d100Digits(1)).toEqual({ tens: 0, units: 1 });
    expect(d100Digits(57)).toEqual({ tens: 5, units: 7 });
    expect(d100Digits(90)).toEqual({ tens: 9, units: 0 });
    expect(d100Digits(100)).toEqual({ tens: 0, units: 0 }); // "00" + "0"
  });
});
