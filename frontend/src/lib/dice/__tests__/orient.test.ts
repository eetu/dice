import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { FACES, labelQuatFor, shownUpValue } from "../orient";

describe("die relabel (land on target, no post-settle rotation)", () => {
  it("shows the target up-face after relabel, for any rest orientation", () => {
    for (let i = 0; i < 500; i++) {
      const rest = new THREE.Quaternion(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize();
      for (let target = 1; target <= 6; target++) {
        const label = labelQuatFor(target, rest);
        const visual = rest.clone().multiply(label);
        expect(shownUpValue(visual)).toBe(target);
      }
    }
  });

  it("works for exact axis-aligned rests (each face up), every target", () => {
    const up = new THREE.Vector3(0, 1, 0);
    for (const face of FACES) {
      const rest = new THREE.Quaternion().setFromUnitVectors(face.normal, up);
      for (let target = 1; target <= 6; target++) {
        const label = labelQuatFor(target, rest);
        expect(shownUpValue(rest.clone().multiply(label))).toBe(target);
      }
    }
  });
});
