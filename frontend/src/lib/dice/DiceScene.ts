// Realistic 3D dice: three.js rendering + cannon-es physics. The result is
// authoritative (from the server), so we make the tumble *land* on it — no
// post-settle rotation:
//
//   1. Throw the dice with random impulse and simulate to rest OFF-SCREEN,
//      recording every frame's transforms (record-then-playback = deterministic,
//      the render can't diverge from the sim).
//   2. Every solid is symmetric, so whichever face physics settles face-up can
//      be RELABELLED to show the target value — a `labelQuat` from the solid's
//      rotation group (see `shapes.ts::relabelRotationFor`), applied to the whole
//      recorded tumble. The die shows the right number from frame one, resting on
//      it. `shapes.ts` supplies each die type's geometry, collider, read-axes,
//      rotation group, and numbering (d6 keeps real pips; the rest use numerals).

import * as CANNON from "cannon-es";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { type Deck, deckByName, type DeckMaterial } from "./decks";
import { applyCoreTheme, makeCoreMaterial } from "./elemental";
import { FACES, UP } from "./orient";
import {
  type DieShape,
  type DieType,
  relabelRotationFor,
  shapeFor,
  shownValueFor,
} from "./shapes";
import { themeByName } from "./themes";

/** One die to render: its type, material, the target value it must show,
 *  (for a d100's tens die) whether numerals display ×10 ("00".."90"), and
 *  `percentile` = part of a d100 pair (underlined numerals set it apart from a
 *  loose d10 on the table). */
export type RenderDie = {
  type: DieType;
  material: string;
  value: number;
  tens?: boolean;
  percentile?: boolean;
};

const DIE = 1.1; // die edge length (world units)
const TRAY = 3.9; // tray half-extent (x/z) — roomy so dice rarely wedge on a wall
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

// ---------- numeral glyph atlas (polyhedral dice) ----------

/** The numeral shown on a face for a value: d10 shows 10 as "0"; a d100 tens die
 *  shows ×10 ("00".."90"); everything else is the value verbatim. */
function glyphFor(type: DieType, value: number, tens: boolean): string {
  if (tens) return String((value % 10) * 10).padStart(2, "0");
  if (type === "d10") return value === 10 ? "0" : String(value);
  return String(value);
}

/** Atlas key for a face numeral: the d100 pair's numerals carry an UNDERLINE
 *  (baked into the glyph, flat on the face — like real percentile sets), which
 *  is what tells the pair apart from a loose d10 on the same table. */
function glyphKey(
  type: DieType,
  value: number,
  tens: boolean,
  percentile: boolean,
): string {
  const g = glyphFor(type, value, tens);
  return percentile ? `_${g}` : g;
}

type GlyphAtlas = {
  texture: THREE.CanvasTexture;
  /** UV rect (flipY=false space, y down) for a glyph string. */
  cell: (glyph: string) => [number, number, number, number];
};

/** One shared canvas texture holding every numeral cell, built once per scene.
 *  Cells keyed with a `_` prefix are the d100 pair's underlined variants. */
function makeGlyphAtlas(): GlyphAtlas {
  const glyphs = new Set<string>();
  for (let n = 0; n <= 20; n++) glyphs.add(String(n));
  for (let t = 0; t <= 9; t++) {
    glyphs.add(String(t * 10).padStart(2, "0")); // tens faces 00..90
    glyphs.add(`_${t}`); // underlined units 0..9
    glyphs.add(`_${String(t * 10).padStart(2, "0")}`); // underlined tens
  }
  const list = [...glyphs];
  const cols = 8;
  const rows = Math.ceil(list.length / cols);
  const cell = 128;
  const c = document.createElement("canvas");
  c.width = cols * cell;
  c.height = rows * cell;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const index = new Map<string, number>();
  list.forEach((key, i) => {
    index.set(key, i);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const underline = key.startsWith("_");
    const g = underline ? key.slice(1) : key;
    const cx = col * cell + cell / 2;
    // Underlined numerals sit a touch higher so glyph + bar center together.
    const cy = row * cell + cell / 2 + (underline ? -4 : 4);
    // Two-digit glyphs get a slightly smaller font so they fit the cell.
    const size = g.length > 1 ? 62 : 84;
    ctx.font = `700 ${size}px ${"Space Grotesk, system-ui, sans-serif"}`;
    ctx.fillText(g, cx, cy);
    if (underline) {
      const w = ctx.measureText(g).width;
      const y = cy + size * 0.52;
      ctx.fillRect(cx - w / 2, y, w, 7);
    }
  });
  const texture = new THREE.CanvasTexture(c);
  texture.flipY = false;
  texture.anisotropy = 4;
  return {
    texture,
    cell: (g) => {
      const i = index.get(g) ?? 0;
      const col = i % cols;
      const row = Math.floor(i / cols);
      return [col / cols, row / rows, (col + 1) / cols, (row + 1) / rows];
    },
  };
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

/** A deck material's surface detail: a near-white grayscale texture used both
 *  as a colour map (multiplies the deck colour — so one texture serves oak AND
 *  walnut) and as the bump map. */
type Surface = { tex: THREE.CanvasTexture; bumpScale: number };

/** Procedural surface detail per deck material — woodgrain planks, concrete
 *  speckle, brushed steel. All patterns are drawn with integer wave counts /
 *  pure noise so they tile seamlessly. Felt + water return null (felt keeps
 *  its plain micro-noise bump; the liquid deck is a shader). */
function makeSurface(material: DeckMaterial): Surface | null {
  if (material === "felt" || material === "water") return null;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const set = (x: number, y: number, v: number) => {
    const i = ((y & (size - 1)) * size + (x & (size - 1))) * 4;
    const cl = Math.max(0, Math.min(255, v));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = cl;
    img.data[i + 3] = 255;
  };
  const TAU = Math.PI * 2;
  let bumpScale: number;
  let repeat: number;
  if (material === "wood") {
    // Real sawn wood: fine PARALLEL fibers (every row its own tone, slowly
    // undulating along x) under long, gently drifting darker grain lines —
    // no chevron waves. All wave counts are integers → seamless tiling.
    const rowTone: number[] = [];
    for (let y = 0; y < size; y++) {
      rowTone.push(
        234 +
          9 * Math.sin((y / size) * TAU * 13) +
          5 * Math.sin((y / size) * TAU * 37) +
          (Math.random() * 10 - 5),
      );
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v =
          rowTone[y] +
          4 * Math.sin((x / size) * TAU * 2 + (y / size) * TAU * 3) +
          (Math.random() * 5 - 2.5);
        set(x, y, v);
      }
    }
    // Dense short fiber flecks — the subtly lighter/darker dashes that give
    // sawn oak its streaky sheen.
    for (let k = 0; k < 900; k++) {
      const y = Math.floor(Math.random() * size);
      const x0 = Math.floor(Math.random() * size);
      const len = 8 + Math.floor(Math.random() * 32);
      const dv = (Math.random() - 0.45) * 22;
      for (let dx = 0; dx < len; dx++) {
        set(x0 + dx, y, rowTone[y] + dv + (Math.random() * 4 - 2));
      }
    }
    // Long thin grain lines drifting only a few pixels across the tile.
    for (let k = 0; k < 26; k++) {
      const y0 = Math.random() * size;
      const m = 1 + Math.floor(Math.random() * 2);
      const amp = 1.5 + Math.random() * 3;
      const phase = Math.random() * TAU;
      const shade = 198 + Math.random() * 16;
      const thick = Math.random() < 0.3 ? 2 : 1;
      for (let x = 0; x < size; x++) {
        const y = Math.round(y0 + amp * Math.sin((x / size) * TAU * m + phase));
        for (let dy = 0; dy < thick; dy++) set(x, y + dy, shade);
      }
    }
    bumpScale = 0.015;
    repeat = 2;
  } else if (material === "concrete") {
    // Two-octave noise (coarse patches + fine grit), specks and dark pores.
    const coarse: number[] = [];
    const blocks = size / 8;
    for (let i = 0; i < blocks * blocks; i++) coarse.push(Math.random());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cb = coarse[Math.floor(y / 8) * blocks + Math.floor(x / 8)];
        set(x, y, 232 + cb * 12 + (Math.random() * 16 - 8));
      }
    }
    for (let k = 0; k < 700; k++) {
      const x = Math.floor(Math.random() * size);
      const y = Math.floor(Math.random() * size);
      set(x, y, 210 + Math.random() * 55);
    }
    for (let k = 0; k < 40; k++) {
      // pores: small dark pits
      const x = Math.floor(Math.random() * size);
      const y = Math.floor(Math.random() * size);
      set(x, y, 170);
      set(x + 1, y, 185);
      set(x, y + 1, 185);
    }
    bumpScale = 0.035;
    repeat = 3;
  } else {
    // metal: brushed steel — fine horizontal strokes (constant per row wraps
    // in x; row noise has no vertical structure to seam).
    for (let y = 0; y < size; y++) {
      const row = 230 + Math.random() * 18 + (Math.random() < 0.06 ? 8 : 0);
      for (let x = 0; x < size; x++) {
        set(x, y, row + (Math.random() * 6 - 3));
      }
    }
    bumpScale = 0.005;
    repeat = 3;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  // Used as a colour map too — near-white sRGB values barely darken the deck.
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, bumpScale };
}

type Die = {
  type: DieType;
  shape: DieShape;
  tens: boolean;
  percentile: boolean;
  group: THREE.Group;
  mesh: THREE.Mesh;
  body: CANNON.Body;
  bodyMat: THREE.MeshPhysicalMaterial;
  /** Animated inner core (the elemental-glass glow); hidden for solid themes. */
  core: THREE.Mesh;
  coreMat: THREE.ShaderMaterial;
  /** Pip/numeral material (tinted per die). */
  pipMat: THREE.MeshStandardMaterial;
  /** Per-numeral plane geometries to dispose (empty for d6, which uses pips). */
  glyphGeos: THREE.BufferGeometry[];
  target: number;
  /** This die's material (theme slug) — dice in a tray can differ. */
  material: string;
  /** Constant per-roll relabel so the settled face reads as `target`. */
  labelQuat: THREE.Quaternion;
};

export type HoverInfo = { value: string; x: number; y: number };

export type DiceSceneOptions = {
  onImpact?: (strength: number, material: string, theme: string) => void;
  onSettled?: (values: number[]) => void;
  /** The GPU dropped our context and every uploaded resource with it (Android
   *  reclaims GPU processes under memory pressure, or on backgrounding). We
   *  don't attempt a rebuild — the caller downgrades to the numeric dice, which
   *  is a live game instead of a permanently black canvas. */
  onLost?: () => void;
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
  #glyph = makeGlyphAtlas();
  // The sunken tray: inner rim faces + the raised surround "tabletop" (a plane
  // with a square hole). Both re-dressed with the deck (see #applyDeck).
  #walls: {
    geo: THREE.BufferGeometry[];
    mat: THREE.MeshStandardMaterial;
    surround: THREE.MeshStandardMaterial;
  } | null = null;
  #rounded = true; // soft (rounded) dice bodies by default
  #coreFrame = 0; // frame counter for the reduced-rate idle elemental churn
  #shadowDirty = true; // dice moved/changed since the last shadow-map render
  #reducedMotion = false; // prefers-reduced-motion → no idle core churn
  #dice: Die[] = [];
  #themeName = "ivory";
  #opts: DiceSceneOptions;
  #ro: ResizeObserver;

  #phase: "idle" | "eject" | "playing" = "idle";
  #raf = 0;
  #lost = false; // WebGL context gone — stop rendering, never reschedule
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
  // Per-material procedural detail (woodgrain / concrete / steel), lazy-built.
  #surfaces = new Map<DeckMaterial, Surface | null>();
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
      // A dice tray doesn't need the discrete GPU on dual-GPU laptops.
      powerPreference: "low-power",
    });
    canvas.addEventListener("webglcontextlost", this.#onContextLost);
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // The elemental glass themes trigger three's transmission pass (an extra
    // scene render) — a reduced-resolution buffer keeps it affordable, but too
    // low and the upsampling blur reads as milky haze over the cores. 0.65 is
    // the compromise (the idle churn renders at ~20 fps anyway).
    this.#renderer.transmissionResolutionScale = 0.65;
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.15;
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadows re-render only when the dice actually move (see #tick) — an idle
    // table (even one with churning elemental cores) reuses the last map.
    this.#renderer.shadowMap.autoUpdate = false;
    this.#reducedMotion =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    // The idle churn stops while the window is unfocused (#coresActive) — rAF
    // only auto-pauses for hidden tabs, not for a visible-but-unfocused window.
    // Refocusing kicks the loop back on.
    window.addEventListener("focus", this.#onFocus);
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

    // A TRUE recess: the play floor sits sunken below the surrounding
    // tabletop. The visible parts are the pit's inner rim faces (short boxes
    // just OUTSIDE ±TRAY, slightly darker so the depth reads) and a raised
    // surround plane with a square hole — the tabletop you look across into
    // the pit. The near rim's outer face is what hides the front edge.
    // Everything re-dresses with the deck (see #applyDeck).
    const wallH = 0.6;
    const th = 0.12;
    const rim = TRAY + th; // outer edge of the rim boxes = the hole's edge
    const span = rim * 2;
    const wallGeo: THREE.BufferGeometry[] = [
      new THREE.BoxGeometry(th, wallH, span), // x-walls
      new THREE.BoxGeometry(span, wallH, th), // z-walls
    ];
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1f6b3a,
      roughness: 0.95,
      metalness: 0,
    });
    const places: [THREE.BufferGeometry, number, number][] = [
      [wallGeo[0], TRAY + th / 2, 0],
      [wallGeo[0], -TRAY - th / 2, 0],
      [wallGeo[1], 0, TRAY + th / 2],
      [wallGeo[1], 0, -TRAY - th / 2],
    ];
    for (const [geo, x, z] of places) {
      const wall = new THREE.Mesh(geo, wallMat);
      wall.position.set(x, wallH / 2, z);
      wall.receiveShadow = true;
      this.#scene.add(wall);
    }
    // The surround tabletop: SURF-sized square with the pit cut out, at rim
    // height. Shares the deck's colour/detail via #applyDeck.
    const outer = new THREE.Shape();
    const half = SURF / 2;
    outer.moveTo(-half, -half);
    outer.lineTo(half, -half);
    outer.lineTo(half, half);
    outer.lineTo(-half, half);
    const hole = new THREE.Path();
    hole.moveTo(-rim, -rim);
    hole.lineTo(rim, -rim);
    hole.lineTo(rim, rim);
    hole.lineTo(-rim, rim);
    outer.holes.push(hole);
    const surGeo = new THREE.ShapeGeometry(outer);
    // ShapeGeometry UVs are in shape units — normalize to 0..1 across the
    // surround so texture repeat matches the pit floor's scale.
    {
      const uv = surGeo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (uv.getX(i) + half) / SURF, (uv.getY(i) + half) / SURF);
      }
    }
    const surround = new THREE.MeshStandardMaterial({
      color: 0x1f6b3a,
      roughness: 0.95,
      metalness: 0,
    });
    const sur = new THREE.Mesh(surGeo, surround);
    sur.rotation.x = -Math.PI / 2;
    sur.position.y = wallH;
    sur.receiveShadow = true;
    this.#scene.add(sur);
    wallGeo.push(surGeo);
    this.#walls = { geo: wallGeo, mat: wallMat, surround };
  }

  #makeDie(
    type: DieType,
    material = this.#themeName,
    tens = false,
    percentile = false,
  ): Die {
    const theme = themeByName(material);
    const shape = shapeFor(type);
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: theme.body,
      metalness: theme.metalness,
      roughness: theme.roughness,
      clearcoat: theme.clearcoat,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1,
    });
    const mesh = new THREE.Mesh(shape.makeGeometry(this.#rounded), bodyMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.die = true;
    group.add(mesh);

    // Inner glow core for the elemental glass themes: a smaller copy of the
    // body (same geometry, scaled) with an animated emissive-noise shader,
    // refracted through the transmissive shell. Hidden for solid themes
    // (#applyMaterial toggles it and points it at the theme's glass params).
    const coreMat = makeCoreMaterial(shape.radius);
    const core = new THREE.Mesh(mesh.geometry, coreMat);
    // The core dominates — the shell is a thin skin, and the smaller the gap,
    // the less bright table bleeds around the core to milk out the interior.
    core.scale.setScalar(0.78);
    core.visible = false;
    group.add(core);

    const glyphGeos: THREE.BufferGeometry[] = [];
    let pipMat: THREE.MeshStandardMaterial;
    if (type === "d6") {
      // Real pips (opposite faces sum to 7).
      pipMat = new THREE.MeshStandardMaterial({
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
          pip.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            f.normal,
          );
          group.add(pip);
        }
      }
    } else {
      // Numerals from the shared glyph atlas, in the material's pip colour (which
      // is contrast-designed for the body — a fixed accent washed out on
      // white/gold bodies).
      pipMat = new THREE.MeshStandardMaterial({
        map: this.#glyph.texture,
        color: theme.pip,
        roughness: 0.5,
        transparent: true,
        alphaTest: 0.35,
      });
      const size = shape.radius * (type === "d4" ? 0.5 : 0.72);
      // A d100 pair renders UNDERLINED numerals (baked into the glyph — flat
      // on the face, like real percentile sets), which is what sets the pair
      // apart from a loose d10 on the same table.
      for (const p of shape.placements) {
        const { mesh: glyph, geo } = this.#glyphMesh(
          glyphKey(type, p.value, tens, percentile),
          size,
          pipMat,
          p,
        );
        glyphGeos.push(geo);
        group.add(glyph);
      }
    }
    this.#scene.add(group);

    const body = new CANNON.Body({
      mass: 1,
      material: this.#diceMat,
      shape: shape.makeCollider(),
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

    const die: Die = {
      type,
      shape,
      tens,
      percentile,
      group,
      mesh,
      body,
      bodyMat,
      core,
      coreMat,
      pipMat,
      glyphGeos,
      target: 1,
      material: "", // sentinel — #applyMaterial below does ALL the theming
      labelQuat: new THREE.Quaternion(),
    };
    this.#applyMaterial(die, material);
    return die;
  }

  /** A numeral plane: a unit plane UV-mapped into the shared glyph atlas cell,
   *  positioned + oriented flat on a face. */
  #glyphMesh(
    glyph: string,
    size: number,
    mat: THREE.Material,
    p: { center: THREE.Vector3; normal: THREE.Vector3; up: THREE.Vector3 },
  ): { mesh: THREE.Mesh; geo: THREE.BufferGeometry } {
    const geo = new THREE.PlaneGeometry(size, size);
    const [u0, v0, u1, v1] = this.#glyph.cell(glyph);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    uv.setXY(0, u0, v0); // top-left
    uv.setXY(1, u1, v0); // top-right
    uv.setXY(2, u0, v1); // bottom-left
    uv.setXY(3, u1, v1); // bottom-right
    uv.needsUpdate = true;
    const n = p.normal.clone().normalize();
    const up = p.up.clone().normalize();
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const up2 = new THREE.Vector3().crossVectors(n, right).normalize();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up2, n),
    );
    mesh.position.copy(p.center).addScaledVector(n, 0.012);
    return { mesh, geo };
  }

  #removeDie(die: Die) {
    this.#scene.remove(die.group);
    die.mesh.geometry.dispose(); // the core shares this geometry
    for (const g of die.glyphGeos) g.dispose();
    die.bodyMat.dispose();
    die.coreMat.dispose();
    die.pipMat.dispose();
    this.#world.removeBody(die.body);
  }

  /** Reconcile the tray to `specs` (count, per-die type + material). A changed
   *  type/tens rebuilds that die; adding/removing re-lays-out; a pure material
   *  change recolors in place (so a rename / presence Sync doesn't wipe the shown
   *  result back to face 1). */
  setDice(specs: RenderDie[]) {
    const n = Math.max(1, Math.min(12, specs.length));
    let structural = n !== this.#dice.length;
    for (let i = 0; i < Math.min(n, this.#dice.length); i++) {
      const d = this.#dice[i];
      const s = specs[i];
      if (
        d.type !== s.type ||
        d.tens !== !!s.tens ||
        d.percentile !== !!s.percentile
      ) {
        this.#removeDie(d);
        this.#dice[i] = this.#makeDie(
          s.type,
          s.material,
          !!s.tens,
          !!s.percentile,
        );
        structural = true;
      }
    }
    while (this.#dice.length < n) {
      const s = specs[this.#dice.length];
      this.#dice.push(
        this.#makeDie(s.type, s.material, !!s.tens, !!s.percentile),
      );
    }
    while (this.#dice.length > n) this.#removeDie(this.#dice.pop()!);
    this.#dice.forEach((d, i) => this.#applyMaterial(d, specs[i]?.material));
    if (structural && this.#phase === "idle") this.#layoutIdle();
    else this.#requestStatic();
  }

  /** Retheme one die to a material (theme slug); no-op if already applied. */
  #applyMaterial(die: Die, name = "ivory") {
    if (die.material === name) return;
    const theme = themeByName(name);
    const bm = die.bodyMat;
    bm.color.setHex(theme.body);
    bm.metalness = theme.metalness;
    bm.roughness = theme.roughness;
    bm.clearcoat = theme.clearcoat;
    // Elemental glass: a transmissive shell + the emissive core glowing inside
    // it. transmission = 0 keeps solid themes out of the transmission pass.
    const glass = theme.glass;
    bm.transmission = glass?.transmission ?? 0;
    bm.ior = glass?.ior ?? 1.5;
    bm.thickness = glass?.thickness ?? 0;
    bm.attenuationColor.setHex(glass?.attenuationColor ?? 0xffffff);
    bm.attenuationDistance = glass?.attenuationDistance ?? Infinity;
    // Glass shells barely reflect the (bright, white) room environment — a full
    // strength env wash diffuses over the surface and pastelizes the core into
    // a toy. The specular (Fresnel) lobe is damped the same way: it's the white
    // film that milks out the dark interior at glancing angles. Direct lights
    // still give crisp highlights. (Same trick as the nixie tubes' glass.)
    bm.envMapIntensity = glass ? 0.3 : 1;
    bm.specularIntensity = glass ? 0.35 : 1;
    die.core.visible = !!glass;
    if (glass) applyCoreTheme(die.coreMat, glass);
    die.pipMat.color.setHex(theme.pip);
    die.material = name;
  }

  /** Tidy centered grid of rest positions that fits inside the tray. A single
   *  row overflows the frame at high dice counts, so wrap into a near-square
   *  grid (cols ≈ √n) — every position stays well within ±TRAY. */
  #restPositions(): [number, number][] {
    const n = this.#dice.length;
    // Gap scales with the largest die so mixed sizes never overlap in the grid.
    const maxR = Math.max(DIE / 2, ...this.#dice.map((d) => d.shape.radius));
    const gap = maxR * 2.3;
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

  /** A resting orientation showing `value` up: rotate that value's read-axis to
   *  world-up. For face dice the opposite face lies flat down; for d4 the target
   *  vertex is up (opposite face down) — a valid rest for every solid. */
  #restPose(die: Die, value: number): THREE.Quaternion {
    const axis = (
      die.shape.readAxes.find((a) => a.value === value) ?? die.shape.readAxes[0]
    ).dir;
    return new THREE.Quaternion().setFromUnitVectors(axis, UP);
  }

  /** Rest the dice in a tidy grid (showing face 1) when nothing is rolling. */
  #layoutIdle() {
    const pos = this.#restPositions();
    this.#dice.forEach((d, i) => {
      const [x, z] = pos[i];
      d.labelQuat.identity();
      const q = this.#restPose(d, 1);
      const y = d.shape.inradius;
      d.group.position.set(x, y, z);
      d.group.quaternion.copy(q);
      d.body.position.set(x, y, z);
      d.body.quaternion.set(q.x, q.y, q.z, q.w);
    });
    this.#requestStatic();
  }

  /** Toggle rounded (soft) vs flat-faceted dice bodies. Rebuilds every die with
   *  the new geometry, preserving each one's type/material/value. */
  setRounded(rounded: boolean) {
    if (rounded === this.#rounded) return;
    this.#rounded = rounded;
    const specs: RenderDie[] = this.#dice.map((d) => ({
      type: d.type,
      material: d.material,
      value: d.target,
      tens: d.tens,
      percentile: d.percentile,
    }));
    const showing = this.#hasResult;
    for (const d of this.#dice) this.#removeDie(d);
    this.#dice = [];
    if (showing) this.showValues(specs);
    else this.setDice(specs);
  }

  /** Change the table (room-wide). */
  setDeck(name: string) {
    if (name === this.#deckName) return;
    this.#deckName = name;
    this.#applyDeck(deckByName(name));
    this.#requestStatic();
  }

  /** Lazily built + cached surface detail for a deck material. */
  #surfaceFor(material: DeckMaterial): Surface | null {
    if (!this.#surfaces.has(material)) {
      this.#surfaces.set(material, makeSurface(material));
    }
    return this.#surfaces.get(material) ?? null;
  }

  /** Apply a deck to the surface material: matte + bump for normal decks (wood
   *  grain / concrete speckle / brushed steel get a procedural detail map), or
   *  a smooth wet rippling surface for the liquid deck. */
  #applyDeck(deck: Deck) {
    const liquid = !!deck.liquid;
    this.#liquidDeck = liquid;
    this.#feltMat.color.setHex(deck.color);
    this.#feltMat.roughness = liquid ? 0.14 : deck.roughness;
    this.#feltMat.metalness = liquid ? 0 : deck.metalness;
    this.#feltMat.envMapIntensity = liquid ? 1.4 : 1;
    // Surface detail: the material's procedural texture multiplies the deck
    // colour + drives the bump; felt keeps its plain micro-noise bump.
    const surf = liquid ? null : this.#surfaceFor(deck.material);
    const nextMap = surf?.tex ?? null;
    const nextBump = liquid ? null : (surf?.tex ?? this.#feltTex);
    this.#feltMat.bumpScale = surf?.bumpScale ?? 0.015;
    if (this.#feltMat.map !== nextMap || this.#feltMat.bumpMap !== nextBump) {
      this.#feltMat.map = nextMap;
      this.#feltMat.bumpMap = nextBump;
      this.#feltMat.needsUpdate = true; // adding/removing a map recompiles
    }
    // The pit dressing: rim inner faces a touch darker (that's the depth cue),
    // the raised surround tabletop in the full deck look (never liquid-shiny —
    // the water stays down in the pit).
    if (this.#walls) {
      const w = this.#walls;
      w.mat.color.setHex(deck.color).multiplyScalar(0.62);
      w.surround.color.setHex(deck.color);
      w.surround.roughness = liquid ? 0.6 : deck.roughness;
      w.surround.metalness = liquid ? 0 : deck.metalness;
      w.surround.bumpScale = surf?.bumpScale ?? 0.015;
      const sBump = liquid ? this.#feltTex : (surf?.tex ?? this.#feltTex);
      if (w.surround.map !== nextMap || w.surround.bumpMap !== sBump) {
        w.surround.map = liquid ? null : nextMap;
        w.surround.bumpMap = sBump;
        w.surround.needsUpdate = true;
      }
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
  showValues(dice: RenderDie[]) {
    this.setDice(dice);
    const pos = this.#restPositions();
    this.#dice.forEach((d, i) => {
      d.target = dice[i]?.value ?? 1;
      d.labelQuat.identity();
      const q = this.#restPose(d, d.target);
      const [x, z] = pos[i];
      const y = d.shape.inradius;
      d.body.position.set(x, y, z);
      d.body.quaternion.set(q.x, q.y, q.z, q.w);
      d.group.position.set(x, y, z);
      d.group.quaternion.copy(q);
    });
    this.#hasResult = true;
    this.#requestStatic();
  }

  /** Throw the dice; they tumble and settle showing each `value`. */
  roll(dice: RenderDie[]) {
    this.setDice(dice);

    // Random throw for each die.
    this.#dice.forEach((d, i) => {
      d.target = dice[i]?.value ?? 1;
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
        // A die wedged against a wall can pirouette on a pole/edge almost
        // friction-free (convex hulls under-model rolling friction) — the
        // classic "d10 spinning sideways forever". Once a die is barely
        // translating but still spinning fast, brake the spin progressively
        // so it winds down like a real die.
        if (b.velocity.length() < 0.5 && b.angularVelocity.length() > 1.2) {
          b.angularVelocity.scale(0.88, b.angularVelocity);
        }
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
      d.labelQuat.copy(relabelRotationFor(d.target, q, d.shape));
    });

    // A die at rest on the floor sits flat on a face — there is no stable
    // "slightly tilted" rest, so any die that settled tilted is wedged (typically
    // against a wall). Ease the tail of its tumble down to flat: swing the face
    // that ended most floor-down EXACTLY down with the minimal rotation (which
    // keeps the physics yaw, so nothing looks grid-aligned). The value stays
    // correct — the relabel is recomputed against the flat pose. Dice that came
    // to rest ON another die are left as they landed (hover reveals the value).
    const FLATTEN_TAIL = 12;
    const DOWN = new THREE.Vector3(0, -1, 0);
    const flat = new THREE.Quaternion();
    const delta = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const bestN = new THREE.Vector3();
    const eased = new THREE.Quaternion();
    const total = this.#frames.length;
    this.#dice.forEach((d, di) => {
      const o = di * 7;
      const last = this.#frames[total - 1];
      const restH = d.shape.inradius;
      if (last[o + 1] > restH * 1.6) return; // stacked on another die — leave it
      q.set(last[o + 3], last[o + 4], last[o + 5], last[o + 6]);
      // The face that settled closest to pointing straight down.
      let bestY = Infinity;
      for (const n of d.shape.restNormals) {
        axis.copy(n).applyQuaternion(q);
        if (axis.y < bestY) {
          bestY = axis.y;
          bestN.copy(axis);
        }
      }
      if (bestY <= -0.99) return; // already flat (within ~8°)
      delta.setFromUnitVectors(bestN, DOWN);
      flat.copy(delta).multiply(q);
      d.labelQuat.copy(relabelRotationFor(d.target, flat, d.shape));
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
        fr[o + 1] = fromY + (restH - fromY) * tt;
        fr[o + 2] = fromZ + (restZ - fromZ) * tt;
        fr[o + 3] = eased.x;
        fr[o + 4] = eased.y;
        fr[o + 5] = eased.z;
        fr[o + 6] = eased.w;
      }
      // Keep the body consistent with the flattened rest (for #settledValues).
      d.body.position.set(restX, restH, restZ);
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
      return shownValueFor(q, d.shape.readAxes);
    });
  }

  #tick = (now: number) => {
    if (this.#lost) return;
    const dt = this.#last ? Math.min((now - this.#last) / 1000, 1 / 30) : STEP;
    this.#last = now;
    this.#surfTime += dt;
    this.#liquid.uTime.value = this.#surfTime;
    for (const d of this.#dice) {
      if (d.core.visible) d.coreMat.uniforms.uTime.value = this.#surfTime;
    }
    // Idle elemental churn is slow — render every 3rd frame (~20 fps) so the
    // extra transmission pass stays cheap while the dice just sit there.
    const churnOnly =
      this.#phase === "idle" &&
      this.#idleRenders <= 0 &&
      !this.#surfaceActive() &&
      this.#coresActive();
    if (churnOnly && ++this.#coreFrame % 3 !== 0) {
      this.#raf = requestAnimationFrame(this.#tick);
      return;
    }
    // Shadow maps only re-render while dice are moving or after a tray/theme
    // change — the churn and liquid ripples don't move any shadow caster.
    this.#renderer.shadowMap.needsUpdate =
      this.#phase !== "idle" || this.#shadowDirty;
    if (this.#phase === "idle") this.#shadowDirty = false;

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

    // Keep animating while the liquid is still moving or an elemental core is
    // churning; otherwise idle out after the last requested static frames.
    if (this.#phase === "idle") {
      if (this.#idleRenders > 0) this.#idleRenders--;
      else if (!this.#surfaceActive() && !this.#coresActive()) {
        this.#raf = 0;
        return;
      }
    }
    this.#raf = requestAnimationFrame(this.#tick);
  };

  /** Any die showing its animated elemental core? (Keeps the loop alive —
   *  unless the user prefers reduced motion or the window is unfocused, then
   *  the cores hold still on the last frame.) */
  #coresActive(): boolean {
    return (
      !this.#reducedMotion &&
      document.hasFocus() &&
      this.#dice.some((d) => d.core.visible)
    );
  }

  #onFocus = () => {
    this.#requestStatic(); // restart the loop; churn resumes if cores are live
  };

  // Not prevented-default on purpose: honouring the loss (rather than asking for
  // a restore we can't repopulate) lets the caller fall back cleanly.
  #onContextLost = () => {
    this.#lost = true;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#opts.onLost?.();
  };

  #start() {
    if (this.#lost || this.#raf) return;
    this.#last = 0;
    this.#raf = requestAnimationFrame(this.#tick);
  }

  /** Render a single frame (after theme/layout/resize changes while idle). */
  #requestStatic() {
    this.#shadowDirty = true; // the dice/deck may have changed or moved
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
    // Cap the framebuffer area: MSAA, the shadow/transmission passes, and fill
    // rate all scale with it, and a big desktop window at dpr 2 burns GPU for
    // no visible gain on felt + a handful of dice.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const budget = 2.4e6; // ~1550×1550 device pixels
    const scale = Math.min(1, Math.sqrt(budget / (w * h * dpr * dpr)));
    this.#renderer.setPixelRatio(dpr * scale);
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
    const R = TRAY; // frame the wall boundary itself so the glass sits at the edges
    const corners: THREE.Vector3[] = [];
    // Include a raised corner (a tall die resting against the far wall) so it
    // can't clip at the top of the frame.
    for (const y of [0, DIE * 1.5])
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          corners.push(new THREE.Vector3(sx * R, y, sz * R));
    const LIMIT = 0.99; // hug the frame — tray corners within 97%
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
      // The glyph actually printed on the face (d10 "0", a d100 tens "70"),
      // not the raw face value.
      value: glyphFor(die.type, die.target, die.tens),
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
    window.removeEventListener("focus", this.#onFocus);
    this.#renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.#onContextLost,
    );
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#ro.disconnect();
    for (const d of [...this.#dice]) this.#removeDie(d);
    this.#pipGeo.dispose();
    this.#glyph.texture.dispose();
    for (const s of this.#surfaces.values()) s?.tex.dispose();
    this.#walls?.geo.forEach((g) => g.dispose());
    this.#walls?.mat.dispose();
    this.#walls?.surround.dispose();
    this.#feltMat.dispose();
    this.#feltTex.dispose();
    this.#renderer.dispose();
  }
}
