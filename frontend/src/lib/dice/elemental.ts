// Animated "inner life" for the elemental glass dice. The emissive glow core
// renders with a small fbm-noise shader instead of a flat colour, so seen
// through the refractive shell the die churns from within: flames lick upward,
// water rolls, smoke twirls, earth grains drift and glint. The pattern comes
// from the theme's `glass.motion`; DiceScene drives `uTime` (shared clock, a
// per-die random phase de-syncs the dice) while any core is visible.

import * as THREE from "three";

import type { DiceTheme } from "./themes";

const MODES = { flame: 0, slosh: 1, swirl: 2, grain: 3 } as const;
export type CoreMotion = keyof typeof MODES;

const VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uPhase;
uniform float uScale;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uIntensity;
uniform int uMode;
varying vec3 vPos;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 p = vPos * uScale;
  float t = uTime + uPhase;
  vec3 col;
  if (uMode == 0) {
    // lava: near-black cooled crust, slow-creeping molten channels whose
    // centres run yellow-hot, gently pulsing
    vec3 q = p * 2.1 + vec3(0.0, -t * 0.1, 0.0);
    float crust = fbm(q);
    float vein = 1.0 - abs(2.0 * fbm(q * 1.2 + vec3(5.2, 1.3, 2.8)) - 1.0);
    float crack = smoothstep(0.58, 0.95, vein);
    float hot = smoothstep(0.78, 0.97, vein);
    float pulse = 0.85 + 0.15 * sin(t * 1.2 + crust * 6.0);
    vec3 melt = mix(uColB, vec3(1.0, 0.93, 0.45), hot) * (uIntensity * pulse);
    col = uColA * (0.4 + 0.5 * crust) + melt * crack;
  } else if (uMode == 1) {
    // water: deep rolling blue shot through with white foam streaks
    float body = fbm(p * 1.8 + vec3(t * 0.2, 0.1 * sin(t * 0.5), t * 0.12));
    float st = 1.0 -
      abs(2.0 * fbm(vec3(p.x * 2.6, p.y * 1.1, p.z * 2.6) +
                    vec3(0.0, -t * 0.25, 4.7)) - 1.0);
    float foam = smoothstep(0.72, 0.97, st);
    col = mix(uColA, uColB, body) * uIntensity;
    col = mix(col, vec3(0.93, 0.98, 1.0), foam * 0.85);
  } else if (uMode == 2) {
    // air: dark storm smoke twirling around the axis, pale wisps riding it
    float ang = t * 0.35 + p.y * 2.2;
    vec2 xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
    float w = fbm(vec3(xz.x, p.y + t * 0.08, xz.y) * 2.4);
    float wisp = smoothstep(0.35, 0.9, w);
    col = mix(uColA, uColB * uIntensity, wisp);
  } else {
    // earth: grey cracked stone, green growth veining the seams, rare glints
    vec3 q = p * 2.4 + vec3(0.0, t * 0.05, 0.0);
    float rock = fbm(q);
    float vein = 1.0 - abs(2.0 * fbm(q * 1.3 + vec3(2.9, 7.1, 0.4)) - 1.0);
    float moss = smoothstep(0.45, 0.85, vein);
    float glint =
      smoothstep(0.85, 0.96, noise(p * 9.0 + vec3(0.0, t * 0.15, 0.0)));
    col = mix(vec3(0.2, 0.195, 0.185), vec3(0.52, 0.51, 0.49), rock);
    col = mix(col, uColB * uIntensity, moss);
    col += uColB * glint * uIntensity * 0.7;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** One core material per die (its own uniforms). `radius` = the die's
 *  circumradius, so the noise density matches across die sizes. */
export function makeCoreMaterial(radius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: Math.random() * 20 },
      uScale: { value: 2.0 / radius },
      uColA: { value: new THREE.Color(0x000000) },
      uColB: { value: new THREE.Color(0xffffff) },
      uIntensity: { value: 1 },
      uMode: { value: 0 },
    },
  });
}

/** Point a core material at a theme's glass params (colours, strength, motion). */
export function applyCoreTheme(
  mat: THREE.ShaderMaterial,
  glass: NonNullable<DiceTheme["glass"]>,
): void {
  const u = mat.uniforms;
  (u.uColA.value as THREE.Color).setHex(glass.glowDim);
  (u.uColB.value as THREE.Color).setHex(glass.glow);
  u.uIntensity.value = glass.glowIntensity;
  u.uMode.value = MODES[glass.motion];
}
