// Realistic 3D dice: three.js rendering + cannon-es physics. The result is
// authoritative (from the server), so we make the tumble *land* on it — no
// post-settle rotation:
//
//   1. Throw the dice with random impulse and simulate to rest OFF-SCREEN,
//      recording every frame's transforms (record-then-playback = deterministic,
//      the render can't diverge from the sim).
//   2. A cube is symmetric, so whichever face physics settles face-up can be
//      RELABELLED to show the target value — a constant `labelQuat` rotation of
//      the pip layout, applied to the whole recorded tumble. The die shows the
//      right number from frame one and comes to rest on it.
//
// Fixed, real die pips (opposite faces sum to 7).

import * as CANNON from "cannon-es";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { type Deck, deckByName } from "./decks";
import { FACES, labelQuatFor, shownUpValue, UP } from "./orient";
import { themeByName } from "./themes";

const DIE = 1.1; // die edge length (world units)
const TRAY = 3.4; // tray half-extent (x/z)
const GRAVITY = -32;
const STEP = 1 / 60; // fixed physics timestep (also the playback frame rate)
const EJECT_MS = 200; // fast "snap the old dice off the table" flourish before a roll
// Where the dice get yanked to — off the front-right edge, toward the camera
// (the "lizard tongue" anchor). Well off-screen so they fully clear the tray.
const EJECT_ANCHOR = new THREE.Vector3(8, 1.2, 9);
const SETTLE_SPEED = 0.16; // below this (lin+ang) a die counts as at rest
const SETTLE_FRAMES = 8; // consecutive rest frames before the sim stops
const MIN_SIM_FRAMES = 24; // always tumble at least this long
const MAX_SIM_FRAMES = 360; // hard cap (~6s) so a stuck die can't hang the sim

// Pip grid coords per value (in {-1,0,1}); mapped onto each face's in-plane axes.
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [-1, 1],
    [0, 0],
    [1, -1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ],
};

function inPlaneAxes(normal: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const ref = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  const u = new THREE.Vector3().crossVectors(ref, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return [u, v];
}

// Liquid table: a subdivided plane whose surface ripples on dice impacts and
// trembles while the phone is shaken ("paint on a speaker"). Implemented by
// injecting displacement into a MeshStandardMaterial so it keeps the scene's PBR
// lighting + environment reflections — that's what sells the wet look.
const SURF = 14; // liquid plane size (covers the framed tray + margin)
const SURF_SEG = 100; // subdivisions = ripple resolution
const MAX_RIPPLES = 12; // ring buffer of concurrent impact ripples
const SURF_EPS = (SURF / SURF_SEG).toFixed(4); // finite-diff step for normals

// Shared height field: expanding+decaying rings from impacts, plus an ambient
// boil scaled by shake vigour. Used for both displacement and normal recompute.
const LIQUID_PARS = /* glsl */ `
  uniform float uTime;
  uniform float uAgitation;
  uniform float uLiquid;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  varying float vLiquidH;
  float liquidHeight(vec2 p) {
    if (uLiquid < 0.5) return 0.0; // only the liquid deck ripples
    float h = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      if (r.w <= 0.0 || age < 0.0 || age > 3.0) continue;
      float d = distance(p, r.xy);
      float front = smoothstep(0.0, 0.7, age * 3.2 - d); // ring expands outward
      float env = exp(-d * 0.55) * exp(-age * 2.3) * front * r.w;
      h += sin(d * 7.0 - age * 12.0) * env * 0.17;
    }
    if (uAgitation > 0.001) {
      float t = uTime;
      h += uAgitation * 0.09 * (
        sin(p.x * 3.1 + t * 9.0) * cos(p.y * 2.7 - t * 8.0) +
        0.5 * sin((p.x + p.y) * 5.3 - t * 13.0)
      );
    }
    return h;
  }
`;
const LIQUID_VERT = /* glsl */ `
  float lh = liquidHeight(position.xy);
  vLiquidH = lh;
  transformed.z += lh;
`;
const LIQUID_NORMAL = /* glsl */ `
  {
    float e = ${SURF_EPS};
    float hl = liquidHeight(position.xy - vec2(e, 0.0));
    float hr = liquidHeight(position.xy + vec2(e, 0.0));
    float hd = liquidHeight(position.xy - vec2(0.0, e));
    float hu = liquidHeight(position.xy + vec2(0.0, e));
    objectNormal = normalize(vec3(hl - hr, hd - hu, 2.0 * e));
  }
`;
const LIQUID_FRAG_PARS = /* glsl */ `
  uniform vec3 uAccent;
  uniform vec3 uTrough;
  varying float vLiquidH;
`;
// Tint crests toward the warm accent, troughs toward indigo — the two-tone pop.
const LIQUID_FRAG_TINT = /* glsl */ `
  float crest = clamp(vLiquidH * 5.5, -1.0, 1.0);
  if (crest > 0.0) {
    diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, crest * 0.75);
  } else {
    diffuseColor.rgb = mix(diffuseColor.rgb, uTrough, -crest * 0.55);
  }
`;

type LiquidUniforms = {
  uTime: { value: number };
  uAgitation: { value: number };
  uLiquid: { value: number }; // 1 on the liquid deck, else 0
  uRipples: { value: THREE.Vector4[] };
  uAccent: { value: THREE.Color };
  uTrough: { value: THREE.Color };
};

// A subtle grayscale noise texture → felt/table micro-relief (bump map) for the
// non-liquid decks (the liquid deck uses a smooth wet surface instead).
function makeFeltTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + Math.floor(Math.random() * 50);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

type Die = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  body: CANNON.Body;
  bodyMat: THREE.MeshPhysicalMaterial;
  pipMat: THREE.MeshStandardMaterial;
  target: number;
  /** Constant per-roll relabel so the settled face reads as `target`. */
  labelQuat: THREE.Quaternion;
};

export type HoverInfo = { value: number; x: number; y: number };

export type DiceSceneOptions = {
  onImpact?: (strength: number, material: string, theme: string) => void;
  onSettled?: (values: number[]) => void;
};

export class DiceScene {
  #renderer: THREE.WebGLRenderer;
  #scene = new THREE.Scene();
  #camera: THREE.PerspectiveCamera;
  #world: CANNON.World;
  #diceMat = new CANNON.Material("dice");
  #floorMat = new CANNON.Material("floor");
  #wallMat = new CANNON.Material("wall");
  #pipGeo = new THREE.CircleGeometry(DIE * 0.085, 20);
  #dice: Die[] = [];
  #themeName = "ivory";
  #opts: DiceSceneOptions;
  #ro: ResizeObserver;

  #phase: "idle" | "eject" | "playing" = "idle";
  #raf = 0;
  // Pre-roll snap-out: elapsed time + each die's captured start transform.
  #ejectElapsed = 0;
  #ejectStart: {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    axis: THREE.Vector3;
  }[] = [];
  #last = 0;
  #idleRenders = 0;

  // Recorded tumble: one flat [x,y,z,qx,qy,qz,qw] block per die, per frame.
  #frames: Float32Array[] = [];
  #impacts: Record<number, number> = {};
  #impactPos: Record<number, { x: number; z: number }> = {};
  #recording = false;
  #recFrame = 0;
  #playFrame = 0;
  #playAccum = 0;

  // Hover-to-read (many dice can land leaning, hiding the top face).
  #raycaster = new THREE.Raycaster();
  #pointer = new THREE.Vector2();
  #hovered: Die | null = null;
  #hasResult = false;

  // Table surface. Non-liquid decks = a matte bump-mapped plane; the `water` deck
  // = a rippling wet surface (gated by uLiquid).
  #feltMat!: THREE.MeshStandardMaterial;
  #feltTex!: THREE.CanvasTexture;
  #deckName = "felt-green";
  #liquid!: LiquidUniforms;
  #liquidDeck = false; // is the current deck the liquid one?
  #ripples: THREE.Vector4[] = []; // ring buffer, mutated in place (same ref as uniform)
  #rippleIdx = 0;
  #surfTime = 0; // monotonic seconds driving the surface

  constructor(canvas: HTMLCanvasElement, opts: DiceSceneOptions = {}) {
    this.#opts = opts;
    this.#renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.15;
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;

    this.#camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.#camera.position.set(0, 8.5, 5.5);
    this.#camera.lookAt(0, 0, 0);

    const pmrem = new THREE.PMREMGenerator(this.#renderer);
    this.#scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 0.6);
    this.#scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    const c = key.shadow.camera as THREE.OrthographicCamera;
    c.left = -6;
    c.right = 6;
    c.top = 6;
    c.bottom = -6;
    this.#scene.add(key);

    // Liquid table (deck) — the dice land on it, cast shadows, and kick up
    // ripples. A wet MeshStandardMaterial (low roughness → env reflections) with
    // displacement injected via onBeforeCompile. Opaque dark backdrop = a
    // contained "pool of paint on a speaker" scene.
    const deck = deckByName(this.#deckName);
    this.#feltTex = makeFeltTexture();
    this.#liquid = {
      uTime: { value: 0 },
      uAgitation: { value: 0 },
      uLiquid: { value: 0 },
      uRipples: {
        value: Array.from(
          { length: MAX_RIPPLES },
          () => new THREE.Vector4(0, 0, -999, 0),
        ),
      },
      uAccent: { value: new THREE.Color(0xf78f08) },
      uTrough: { value: new THREE.Color(0x3b2a7a) },
    };
    this.#ripples = this.#liquid.uRipples.value;
    this.#feltMat = new THREE.MeshStandardMaterial({
      color: deck.color,
      roughness: deck.roughness,
      metalness: deck.metalness,
      bumpScale: 0.015,
    });
    this.#feltMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.#liquid.uTime;
      shader.uniforms.uAgitation = this.#liquid.uAgitation;
      shader.uniforms.uLiquid = this.#liquid.uLiquid;
      shader.uniforms.uRipples = this.#liquid.uRipples;
      shader.uniforms.uAccent = this.#liquid.uAccent;
      shader.uniforms.uTrough = this.#liquid.uTrough;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${LIQUID_PARS}`)
        .replace(
          "#include <beginnormal_vertex>",
          `#include <beginnormal_vertex>\n${LIQUID_NORMAL}`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${LIQUID_VERT}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${LIQUID_FRAG_PARS}`)
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>\n${LIQUID_FRAG_TINT}`,
        );
    };
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(SURF, SURF, SURF_SEG, SURF_SEG),
      this.#feltMat,
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.#scene.add(felt);
    this.#applyDeck(deck);

    this.#world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
    this.#world.allowSleep = true;
    this.#world.addContactMaterial(
      new CANNON.ContactMaterial(this.#diceMat, this.#floorMat, {
        friction: 0.35,
        restitution: 0.3,
      }),
    );
    this.#world.addContactMaterial(
      new CANNON.ContactMaterial(this.#diceMat, this.#diceMat, {
        friction: 0.25,
        restitution: 0.25,
      }),
    );
    // Walls: no bounce + grip, so dice deaden against them instead of ricocheting
    // into (and wedging on) a corner.
    this.#world.addContactMaterial(
      new CANNON.ContactMaterial(this.#diceMat, this.#wallMat, {
        friction: 0.6,
        restitution: 0.0,
      }),
    );
    this.#addFloor();
    this.#addWalls();

    this.#ro = new ResizeObserver(() => this.#resize());
    this.#ro.observe(canvas.parentElement ?? canvas);
    this.#resize();
  }

  #addFloor() {
    const body = new CANNON.Body({ mass: 0, material: this.#floorMat });
    body.addShape(new CANNON.Plane());
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    this.#world.addBody(body);
  }

  #addWalls() {
    const t = 0.5;
    // Tall enough that a high spawn stack / a lively bounce can't clear the top.
    const h = 10;
    const specs: [number, number][] = [
      [TRAY + t, 0],
      [-TRAY - t, 0],
      [0, TRAY + t],
      [0, -TRAY - t],
    ];
    for (const [x, z] of specs) {
      const body = new CANNON.Body({ mass: 0, material: this.#wallMat });
      body.addShape(new CANNON.Box(new CANNON.Vec3(TRAY + t, h, t)));
      body.position.set(x, h, z);
      if (x !== 0)
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2);
      this.#world.addBody(body);
    }
  }

  #makeDie(): Die {
    const theme = themeByName(this.#themeName);
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: theme.body,
      metalness: theme.metalness,
      roughness: theme.roughness,
      clearcoat: theme.clearcoat,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1,
    });
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(DIE, DIE, DIE, 5, DIE * 0.12),
      bodyMat,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const pipMat = new THREE.MeshStandardMaterial({
      color: theme.pip,
      roughness: 0.55,
    });
    const g = DIE * 0.24;
    for (const f of FACES) {
      const [u, v] = inPlaneAxes(f.normal);
      for (const [a, b] of PIPS[f.value]) {
        const pip = new THREE.Mesh(this.#pipGeo, pipMat);
        pip.position
          .copy(f.normal)
          .multiplyScalar(DIE / 2 + 0.006)
          .addScaledVector(u, a * g)
          .addScaledVector(v, b * g);
        pip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.normal);
        group.add(pip);
      }
    }
    this.#scene.add(group);
    mesh.userData.die = true;

    const body = new CANNON.Body({
      mass: 1,
      material: this.#diceMat,
      shape: new CANNON.Box(new CANNON.Vec3(DIE / 2, DIE / 2, DIE / 2)),
      allowSleep: true,
      sleepSpeedLimit: 0.15,
      sleepTimeLimit: 0.1,
      linearDamping: 0.06,
      angularDamping: 0.09,
    });
    body.addEventListener(
      "collide",
      (e: { contact: CANNON.ContactEquation }) => {
        if (!this.#recording) return;
        const s = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (s > 1.5) {
          const strength = Math.min(s / 12, 1);
          if (strength > (this.#impacts[this.#recFrame] ?? 0)) {
            this.#impacts[this.#recFrame] = strength;
            // Where the ripple should spring from (plane-local: x, -z).
            this.#impactPos[this.#recFrame] = {
              x: body.position.x,
              z: body.position.z,
            };
          }
        }
      },
    );
    this.#world.addBody(body);

    return {
      group,
      mesh,
      body,
      bodyMat,
      pipMat,
      target: 1,
      labelQuat: new THREE.Quaternion(),
    };
  }

  #removeDie(die: Die) {
    this.#scene.remove(die.group);
    die.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry instanceof RoundedBoxGeometry)
        o.geometry.dispose();
    });
    die.bodyMat.dispose();
    die.pipMat.dispose();
    this.#world.removeBody(die.body);
  }

  setDiceCount(n: number) {
    n = Math.max(1, Math.min(12, n));
    // No-op if unchanged — a rename/presence Sync must NOT re-layout the dice
    // (which would wipe the shown result back to face 1).
    if (n === this.#dice.length) return;
    while (this.#dice.length < n) this.#dice.push(this.#makeDie());
    while (this.#dice.length > n) this.#removeDie(this.#dice.pop()!);
    if (this.#phase === "idle") this.#layoutIdle();
  }

  /** Tidy centered grid of rest positions that fits inside the tray. A single
   *  row overflows the frame at high dice counts, so wrap into a near-square
   *  grid (cols ≈ √n) — every position stays well within ±TRAY. */
  #restPositions(): [number, number][] {
    const n = this.#dice.length;
    const gap = DIE * 1.35;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const rowCount = Math.min(cols, n - r * cols); // last row may be short
      out.push([(c - (rowCount - 1) / 2) * gap, (r - (rows - 1) / 2) * gap]);
    }
    return out;
  }

  /** Rest the dice in a tidy grid (showing face 1) when nothing is rolling. */
  #layoutIdle() {
    const pos = this.#restPositions();
    this.#dice.forEach((d, i) => {
      const [x, z] = pos[i];
      d.labelQuat.identity();
      d.group.position.set(x, DIE / 2, z);
      d.group.quaternion.identity();
      d.body.position.set(x, DIE / 2, z);
      d.body.quaternion.set(0, 0, 0, 1);
    });
    this.#requestStatic();
  }

  setTheme(name: string) {
    if (name === this.#themeName) return;
    this.#themeName = name;
    const theme = themeByName(name);
    for (const d of this.#dice) {
      d.bodyMat.color.setHex(theme.body);
      d.bodyMat.metalness = theme.metalness;
      d.bodyMat.roughness = theme.roughness;
      d.bodyMat.clearcoat = theme.clearcoat;
      d.pipMat.color.setHex(theme.pip);
    }
    this.#requestStatic();
  }

  /** Change the table (room-wide). */
  setDeck(name: string) {
    if (name === this.#deckName) return;
    this.#deckName = name;
    this.#applyDeck(deckByName(name));
    this.#requestStatic();
  }

  /** Apply a deck to the surface material: matte + bump for normal decks, or a
   *  smooth wet rippling surface for the liquid deck. */
  #applyDeck(deck: Deck) {
    const liquid = !!deck.liquid;
    this.#liquidDeck = liquid;
    this.#feltMat.color.setHex(deck.color);
    this.#feltMat.roughness = liquid ? 0.14 : deck.roughness;
    this.#feltMat.metalness = liquid ? 0 : deck.metalness;
    this.#feltMat.envMapIntensity = liquid ? 1.4 : 1;
    const nextBump = liquid ? null : this.#feltTex;
    if (this.#feltMat.bumpMap !== nextBump) {
      this.#feltMat.bumpMap = nextBump;
      this.#feltMat.needsUpdate = true; // adding/removing a map recompiles
    }
    this.#liquid.uLiquid.value = liquid ? 1 : 0;
    this.#liquid.uAccent.value.setHex(deck.crest ?? 0xf78f08);
    this.#liquid.uTrough.value.setHex(deck.trough ?? 0x3b2a7a);
    this.#scene.background = new THREE.Color(deck.color).multiplyScalar(
      liquid ? 0.22 : 0.3,
    );
    if (!liquid) {
      this.#liquid.uAgitation.value = 0;
      for (const r of this.#ripples) r.w = 0; // clear any lingering ripples
    }
  }

  /** Spawn a ripple ring at world (x, z) with 0..1 strength (plane-local x, -z).
   *  No-op off the liquid deck. */
  #spawnRipple(x: number, z: number, strength: number) {
    if (!this.#liquidDeck) return;
    const r = this.#ripples[this.#rippleIdx % MAX_RIPPLES];
    r.set(x, -z, this.#surfTime, Math.min(1, 0.45 + strength));
    this.#rippleIdx++;
    if (!this.#raf) this.#start();
  }

  /** Push shake vigour (0..1) into the surface as an ambient "bass" tremble.
   *  Only the liquid deck reacts. */
  setAgitation(level: number) {
    if (!this.#liquidDeck) {
      this.#liquid.uAgitation.value = 0;
      return;
    }
    const v = Math.max(0, Math.min(1, level));
    this.#liquid.uAgitation.value = v;
    if (v > 0 && !this.#raf) this.#start();
  }

  /** True while the liquid is still moving (keeps the render loop alive). */
  #surfaceActive(): boolean {
    if (this.#liquid.uAgitation.value > 0.001) return true;
    for (const r of this.#ripples) {
      if (r.w > 0 && this.#surfTime - r.z < 2.5) return true;
    }
    return false;
  }

  /** Statically show the given values with no tumble — used when the 3D scene is
   *  (re)created after a theme switch so it restores the last result instead of
   *  resetting to face 1. Positions reset to the tidy row; only the faces matter. */
  showValues(values: number[]) {
    this.setDiceCount(values.length);
    const identity = new THREE.Quaternion();
    const pos = this.#restPositions();
    this.#dice.forEach((d, i) => {
      d.target = values[i] ?? 1;
      d.labelQuat.copy(labelQuatFor(d.target, identity));
      const [x, z] = pos[i];
      d.body.position.set(x, DIE / 2, z);
      d.body.quaternion.set(0, 0, 0, 1);
      d.group.position.set(x, DIE / 2, z);
      d.group.quaternion.copy(d.labelQuat); // body identity ∘ label = label
    });
    this.#hasResult = true;
    this.#requestStatic();
  }

  /** Throw the dice; they tumble and settle showing `targets` (1..6 each). */
  roll(targets: number[]) {
    this.setDiceCount(targets.length);

    // Random throw for each die.
    this.#dice.forEach((d, i) => {
      d.target = targets[i] ?? 1;
      const b = d.body;
      b.wakeUp();
      // Drop from a central patch (well inside the walls) with a gentle sideways
      // nudge, so dice scatter over the felt rather than rocketing into corners.
      b.position.set(
        (Math.random() - 0.5) * (TRAY - 1.6),
        4.5 + i * 1.1,
        (Math.random() - 0.5) * (TRAY - 1.6),
      );
      b.quaternion.setFromEuler(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );
      b.velocity.set(
        (Math.random() - 0.5) * 4,
        -4 - Math.random() * 3,
        (Math.random() - 0.5) * 4,
      );
      b.angularVelocity.set(
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22,
      );
    });

    // Simulate to rest off-screen, recording every frame.
    this.#frames = [];
    this.#impacts = {};
    this.#impactPos = {};
    this.#recording = true;
    let restRun = 0;
    for (let frame = 0; frame < MAX_SIM_FRAMES; frame++) {
      this.#recFrame = frame;
      this.#world.step(STEP);
      const snap = new Float32Array(this.#dice.length * 7);
      let maxSpeed = 0;
      this.#dice.forEach((d, i) => {
        const b = d.body;
        const o = i * 7;
        snap[o] = b.position.x;
        snap[o + 1] = b.position.y;
        snap[o + 2] = b.position.z;
        snap[o + 3] = b.quaternion.x;
        snap[o + 4] = b.quaternion.y;
        snap[o + 5] = b.quaternion.z;
        snap[o + 6] = b.quaternion.w;
        maxSpeed = Math.max(
          maxSpeed,
          b.velocity.length() + b.angularVelocity.length(),
        );
      });
      this.#frames.push(snap);
      restRun = maxSpeed < SETTLE_SPEED ? restRun + 1 : 0;
      if (frame >= MIN_SIM_FRAMES && restRun >= SETTLE_FRAMES) break;
    }
    this.#recording = false;

    // Relabel each die so its settled up-face reads as the target value.
    const q = new THREE.Quaternion();
    this.#dice.forEach((d) => {
      q.set(
        d.body.quaternion.x,
        d.body.quaternion.y,
        d.body.quaternion.z,
        d.body.quaternion.w,
      );
      d.labelQuat.copy(labelQuatFor(d.target, q));
    });

    // A cube at rest on a flat floor is either lying flat or balanced/wedged
    // (typically against a wall) — there is no stable "slightly tilted" rest. So
    // any die that settled NOT flat is wedged: ease the tail of its tumble down to
    // a flat, face-up pose. Value stays correct — the relabel is recomputed
    // against the flat orientation with the same tested labelQuatFor.
    const FLATTEN_TAIL = 12;
    const flat = new THREE.Quaternion(); // identity — axis-aligned, lies flat
    const axis = new THREE.Vector3();
    const eased = new THREE.Quaternion();
    const total = this.#frames.length;
    this.#dice.forEach((d, di) => {
      const o = di * 7;
      const last = this.#frames[total - 1];
      if (last[o + 1] > DIE * 1.5) return; // stacked on another die — leave it
      q.set(last[o + 3], last[o + 4], last[o + 5], last[o + 6]);
      const upness = Math.max(
        Math.abs(axis.set(1, 0, 0).applyQuaternion(q).y),
        Math.abs(axis.set(0, 1, 0).applyQuaternion(q).y),
        Math.abs(axis.set(0, 0, 1).applyQuaternion(q).y),
      );
      if (upness >= 0.97) return; // already flat
      // A random yaw so flattened dice don't look grid-aligned next to natural ones.
      flat.setFromAxisAngle(axis.set(0, 1, 0), Math.random() * Math.PI * 2);
      d.labelQuat.copy(labelQuatFor(d.target, flat));
      const start = Math.max(0, total - FLATTEN_TAIL);
      const s0 = this.#frames[start];
      const fromQ = new THREE.Quaternion(
        s0[o + 3],
        s0[o + 4],
        s0[o + 5],
        s0[o + 6],
      );
      const fromX = s0[o];
      const fromY = s0[o + 1];
      const fromZ = s0[o + 2];
      const restX = last[o];
      const restZ = last[o + 2];
      const span = Math.max(1, total - 1 - start);
      for (let f = start; f < total; f++) {
        const tt = (f - start) / span;
        eased.copy(fromQ).slerp(flat, tt);
        const fr = this.#frames[f];
        fr[o] = fromX + (restX - fromX) * tt;
        fr[o + 1] = fromY + (DIE / 2 - fromY) * tt;
        fr[o + 2] = fromZ + (restZ - fromZ) * tt;
        fr[o + 3] = eased.x;
        fr[o + 4] = eased.y;
        fr[o + 5] = eased.z;
        fr[o + 6] = eased.w;
      }
      // Keep the body consistent with the flattened rest (for #settledValues).
      d.body.position.set(restX, DIE / 2, restZ);
      d.body.quaternion.set(flat.x, flat.y, flat.z, flat.w);
      d.body.velocity.setZero();
      d.body.angularVelocity.setZero();
    });

    // Snap the current (on-table) dice off first, then the recorded tumble drops
    // the new ones in. Capture each die's current transform + a random spin axis.
    this.#ejectStart = this.#dice.map((d) => ({
      pos: d.group.position.clone(),
      quat: d.group.quaternion.clone(),
      axis: new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize(),
    }));
    this.#ejectElapsed = 0;
    this.#playFrame = 0;
    this.#playAccum = 0;
    this.#phase = "eject";
    this.#spawnRipple(0, 0, 1); // the "bass hit" that launches the roll
    this.#start();
  }

  #applyFrame(frame: number) {
    const snap = this.#frames[frame];
    if (!snap) return;
    const q = new THREE.Quaternion();
    this.#dice.forEach((d, i) => {
      const o = i * 7;
      if (o + 6 >= snap.length) return; // die added after this recording — skip
      d.group.position.set(snap[o], snap[o + 1], snap[o + 2]);
      q.set(snap[o + 3], snap[o + 4], snap[o + 5], snap[o + 6]);
      // Visual = physics orientation ∘ relabel (mesh is symmetric; only pips shift).
      d.group.quaternion.copy(q).multiply(d.labelQuat);
    });
  }

  #settledValues(): number[] {
    const q = new THREE.Quaternion();
    return this.#dice.map((d) => {
      q.set(
        d.body.quaternion.x,
        d.body.quaternion.y,
        d.body.quaternion.z,
        d.body.quaternion.w,
      );
      q.multiply(d.labelQuat);
      return shownUpValue(q);
    });
  }

  #tick = (now: number) => {
    const dt = this.#last ? Math.min((now - this.#last) / 1000, 1 / 30) : STEP;
    this.#last = now;
    this.#surfTime += dt;
    this.#liquid.uTime.value = this.#surfTime;

    if (this.#phase === "eject") {
      this.#ejectElapsed += dt * 1000;
      const p = Math.min(1, this.#ejectElapsed / EJECT_MS);
      // A whip curve: a hair of wind-up (e dips <0), then a fast snap to the
      // anchor (e → 1). Dice accelerate off, spinning + shrinking as they go.
      const e = 1.15 * p * p - 0.15 * p;
      const scl = 1 - 0.65 * Math.max(0, e);
      const spin = new THREE.Quaternion();
      this.#dice.forEach((d, i) => {
        const s = this.#ejectStart[i];
        if (!s) return;
        d.group.position.lerpVectors(s.pos, EJECT_ANCHOR, e);
        spin.setFromAxisAngle(s.axis, e * 7);
        d.group.quaternion.copy(s.quat).multiply(spin);
        d.group.scale.setScalar(scl);
      });
      if (p >= 1) {
        for (const d of this.#dice) d.group.scale.setScalar(1);
        this.#phase = "playing";
        this.#playFrame = 0;
        this.#playAccum = 0;
        this.#applyFrame(0); // new dice appear at their drop-in position
      }
    } else if (this.#phase === "playing") {
      this.#playAccum += dt;
      const lastFrame = this.#frames.length - 1;
      while (this.#playFrame < lastFrame && this.#playAccum >= STEP) {
        this.#playFrame++;
        this.#playAccum -= STEP;
        const s = this.#impacts[this.#playFrame];
        if (s) {
          this.#opts.onImpact?.(
            s,
            deckByName(this.#deckName).material,
            this.#themeName,
          );
          const pos = this.#impactPos[this.#playFrame];
          if (pos) this.#spawnRipple(pos.x, pos.z, s); // splash where it landed
        }
      }
      this.#applyFrame(this.#playFrame);
      if (this.#playFrame >= lastFrame) {
        this.#phase = "idle";
        this.#idleRenders = 3;
        this.#hasResult = true;
        this.#opts.onSettled?.(this.#settledValues());
      }
    }

    this.#renderer.render(this.#scene, this.#camera);

    // Keep animating while the liquid is still moving; otherwise idle out.
    if (this.#phase === "idle" && !this.#surfaceActive()) {
      if (this.#idleRenders-- <= 0) {
        this.#raf = 0;
        return;
      }
    }
    this.#raf = requestAnimationFrame(this.#tick);
  };

  #start() {
    if (this.#raf) return;
    this.#last = 0;
    this.#raf = requestAnimationFrame(this.#tick);
  }

  /** Render a single frame (after theme/layout/resize changes while idle). */
  #requestStatic() {
    if (this.#raf) return;
    this.#idleRenders = 2;
    this.#phase = "idle";
    this.#start();
  }

  #resize() {
    const canvas = this.#renderer.domElement;
    const parent = canvas.parentElement;
    const w = parent?.clientWidth ?? canvas.clientWidth ?? 300;
    const h = parent?.clientHeight ?? canvas.clientHeight ?? 300;
    if (w === 0 || h === 0) return;
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#fitCamera();
    this.#requestStatic();
  }

  // Dolly the camera along a fixed viewing angle until the whole tray (plus a
  // die's height at the edge) fits inside the frame with a margin — at ANY
  // aspect ratio. Prevents dice that settle near an edge from being clipped.
  #fitCamera() {
    const cam = this.#camera;
    const target = new THREE.Vector3(0, 0.4, 0);
    const dir = new THREE.Vector3(0, 8.5, 5.5).normalize();
    const R = TRAY + DIE * 0.3;
    const corners: THREE.Vector3[] = [];
    for (const y of [0, DIE])
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          corners.push(new THREE.Vector3(sx * R, y, sz * R));
    const LIMIT = 0.92; // keep the tray corners within 92% of the frame
    const p = new THREE.Vector3();
    const fits = (dist: number) => {
      cam.position.copy(dir).multiplyScalar(dist).add(target);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      for (const c of corners) {
        p.copy(c).project(cam);
        if (Math.abs(p.x) > LIMIT || Math.abs(p.y) > LIMIT) return false;
      }
      return true;
    };
    let lo = 5;
    let hi = 40;
    for (let i = 0; i < 6 && !fits(hi); i++) hi *= 1.4;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi); // leave the camera at the smallest fitting distance
  }

  /** Raycast a viewport point; returns the hovered die's decided value + its
   *  on-canvas position (or null). Only after the dice have settled. */
  pickAt(clientX: number, clientY: number): HoverInfo | null {
    if (this.#phase !== "idle" || !this.#hasResult) {
      this.#setHovered(null);
      return null;
    }
    const rect = this.#renderer.domElement.getBoundingClientRect();
    this.#pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    const hit = this.#raycaster.intersectObjects(
      this.#dice.map((d) => d.mesh),
      false,
    )[0];
    const die = hit
      ? (this.#dice.find((d) => d.mesh === hit.object) ?? null)
      : null;
    this.#setHovered(die);
    if (!die) return null;
    const p = die.group.position.clone().project(this.#camera);
    return {
      value: die.target,
      x: (p.x * 0.5 + 0.5) * rect.width,
      y: (-p.y * 0.5 + 0.5) * rect.height,
    };
  }

  clearHover() {
    this.#setHovered(null);
  }

  #setHovered(die: Die | null) {
    if (this.#hovered === die) return;
    this.#hovered?.bodyMat.emissive.setHex(0x000000);
    this.#hovered = die;
    die?.bodyMat.emissive.setHex(0x3a3a3a);
    this.#requestStatic();
  }

  dispose() {
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#ro.disconnect();
    for (const d of [...this.#dice]) this.#removeDie(d);
    this.#pipGeo.dispose();
    this.#feltMat.dispose();
    this.#feltTex.dispose();
    this.#renderer.dispose();
  }
}
