// Pure die-orientation math (no WebGL / physics) so it can be unit-tested.
//
// The key trick: a cube is symmetric, so after the physics settles we can
// RELABEL the pips — a constant rotation `labelQuat` — so whichever face landed
// up displays the target value. `labelQuatFor(target, restQuat)` guarantees
// `shownUpValue(restQuat ∘ labelQuat) === target` for any rest orientation.

import * as THREE from "three";

export const UP = new THREE.Vector3(0, 1, 0);

/** Value → local outward face normal. Opposite faces sum to 7. */
export const FACES: { value: number; normal: THREE.Vector3 }[] = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0) },
  { value: 2, normal: new THREE.Vector3(1, 0, 0) },
  { value: 5, normal: new THREE.Vector3(-1, 0, 0) },
  { value: 3, normal: new THREE.Vector3(0, 0, 1) },
  { value: 4, normal: new THREE.Vector3(0, 0, -1) },
];

const NORMAL_FOR_VALUE = new Map(
  FACES.map((f) => [f.value, f.normal] as const),
);

/** The local face normal that points most nearly world-up under `quat`. */
export function restUpNormal(quat: THREE.Quaternion): THREE.Vector3 {
  let best = -Infinity;
  let pick = FACES[0].normal;
  const n = new THREE.Vector3();
  for (const f of FACES) {
    const d = n.copy(f.normal).applyQuaternion(quat).dot(UP);
    if (d > best) {
      best = d;
      pick = f.normal;
    }
  }
  return pick;
}

/** The value shown on the up face for a visual orientation `quat`. */
export function shownUpValue(quat: THREE.Quaternion): number {
  let best = -Infinity;
  let value = 1;
  const n = new THREE.Vector3();
  for (const f of FACES) {
    const d = n.copy(f.normal).applyQuaternion(quat).dot(UP);
    if (d > best) {
      best = d;
      value = f.value;
    }
  }
  return value;
}

/** Relabel rotation so the face resting up under `restQuat` reads as `target`. */
export function labelQuatFor(
  target: number,
  restQuat: THREE.Quaternion,
): THREE.Quaternion {
  const nRest = restUpNormal(restQuat);
  const nTarget = NORMAL_FOR_VALUE.get(target) ?? FACES[0].normal;
  return new THREE.Quaternion().setFromUnitVectors(nTarget, nRest);
}
