// 3D nixie dice: a row of real bent-wire cathode tubes in refractive glass, one
// per die, the die's value lit and bloomed. Adapted from glowbox's example
// `nixieScene.ts` — the nixie geometry (cathode stack, wire gauge, honeycomb
// grille, wire colour) comes from @glowbox/nixie; this file owns the 3D part
// (extruding the paths, the glass, the bloom). Changes vs the clock example:
// no colon slots (every tube is a die), no orbit, and render-on-demand (the
// component flips digits during a "roll", so we render when they change).

import {
  GLYPH_VIEWBOX,
  NIXIE_WIRE_COLOR,
  nixieCathodes,
  nixieMesh,
  nixieStyle,
} from "@glowbox/nixie";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type NixieDiceOptions = {
  color: string; // lit-numeral glow (CSS)
  glass: string; // glass tint (CSS)
  backdrop: string; // scene backdrop (CSS)
};

export type NixieDiceScene = {
  setDigits(digits: string[]): void;
  setColor(color: string): void;
  resize(): void;
  dispose(): void;
};

const TUBE_R = 0.62;
const TUBE_H = 2.05;
const CONTENT_H = 2.95; // base → domed top, for camera framing
const GAP = 0.16;
const INNER_R = TUBE_R * 0.72;
const S = Math.min(
  (INNER_R * 2) / GLYPH_VIEWBOX.width,
  (TUBE_H * 0.6) / GLYPH_VIEWBOX.height,
);
const WIRE_R = nixieStyle("classic").strokeWidth * S * 0.28;
const STACK_SPACING = 0.055;
const FRONT_Z = 4.5 * STACK_SPACING;

const toWorld = (px: number, py: number, z: number) =>
  new THREE.Vector3(
    (px - GLYPH_VIEWBOX.width / 2) * S,
    -(py - GLYPH_VIEWBOX.height / 2) * S,
    z,
  );

interface SVGLoaderLike {
  parse(text: string): {
    paths: { subPaths: { getPoints(divisions: number): THREE.Vector2[] }[] }[];
  };
}
let _svg: SVGLoaderLike | null = null;
function svgLoader(): SVGLoaderLike {
  if (!_svg) _svg = new SVGLoader() as unknown as SVGLoaderLike;
  return _svg;
}

function tubeFromPath(d: string): THREE.BufferGeometry | null {
  const parsed = svgLoader().parse(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_VIEWBOX.width} ${GLYPH_VIEWBOX.height}"><path d="${d}"/></svg>`,
  );
  const parts: THREE.BufferGeometry[] = [];
  for (const path of parsed.paths) {
    for (const sub of path.subPaths) {
      const pts = sub.getPoints(40);
      if (pts.length < 2) continue;
      const v3 = pts.map((p) => toWorld(p.x, p.y, 0));
      const curve = new THREE.CatmullRomCurve3(v3, false, "centripetal");
      parts.push(
        new THREE.TubeGeometry(
          curve,
          Math.max(20, v3.length),
          WIRE_R,
          6,
          false,
        ),
      );
    }
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function grilleGeometry(): THREE.BufferGeometry {
  const { radius, cells } = nixieMesh(
    GLYPH_VIEWBOX.width,
    GLYPH_VIEWBOX.height,
  );
  const pos: number[] = [];
  for (const c of cells) {
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      verts.push(
        toWorld(c.x + radius * Math.cos(a), c.y + radius * Math.sin(a), 0),
      );
    }
    for (let i = 0; i < 6; i++) {
      const p0 = verts[i];
      const p1 = verts[(i + 1) % 6];
      pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

function domedTubeGeometry(r: number, radial: number): THREE.LatheGeometry {
  const domeRise = r * 0.62;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(r, -TUBE_H / 2),
    new THREE.Vector2(r, TUBE_H / 2),
  ];
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    pts.push(
      new THREE.Vector2(r * Math.cos(t), TUBE_H / 2 + domeRise * Math.sin(t)),
    );
  }
  return new THREE.LatheGeometry(pts, radial);
}

function darkBackdrop(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  const m = Math.max(c.r, c.g, c.b);
  if (m > 0.14) c.multiplyScalar(0.14 / m);
  return c;
}

type Tube = { cathodes: Map<string, THREE.Mesh>; lit: string | null };

export function createNixieDiceScene(
  container: HTMLElement,
  opts: NixieDiceOptions,
): NixieDiceScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.transmissionResolutionScale = 0.5;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const scene = new THREE.Scene();
  scene.background = darkBackdrop(opts.backdrop);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

  scene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const key = new THREE.DirectionalLight(0xffffff, 0.34);
  key.position.set(4, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 0.18);
  rim.position.set(-5, 2, -4);
  scene.add(rim);

  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.color).multiplyScalar(0.2),
    emissive: new THREE.Color(opts.color),
    emissiveIntensity: 3.4,
    roughness: 0.45,
    metalness: 0,
  });
  const wireMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...NIXIE_WIRE_COLOR).multiplyScalar(0.11),
    roughness: 0.82,
    metalness: 0.2,
    envMapIntensity: 0.14,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xeef2f7,
    metalness: 0,
    roughness: 0.06,
    transmission: 1,
    thickness: 0.3,
    ior: 1.22,
    opacity: 1,
    transparent: true,
    attenuationColor: new THREE.Color(opts.glass),
    attenuationDistance: 1.4,
    envMapIntensity: 0.12,
    specularIntensity: 0.3,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x24262d,
    roughness: 0.5,
    metalness: 0.6,
  });
  const grilleMat = new THREE.LineBasicMaterial({ color: 0x4a4e58 });
  const standMat = new THREE.MeshStandardMaterial({
    color: 0x17181d,
    roughness: 0.6,
    metalness: 0.4,
  });

  const wireGeo = new Map<string, THREE.BufferGeometry | null>();
  const geomFor = (symbol: string, d: string): THREE.BufferGeometry | null => {
    if (!wireGeo.has(symbol)) wireGeo.set(symbol, d ? tubeFromPath(d) : null);
    return wireGeo.get(symbol) ?? null;
  };
  const grilleGeo = grilleGeometry();
  const glassGeo = domedTubeGeometry(TUBE_R, 32);
  const baseGeo = new THREE.CylinderGeometry(
    TUBE_R * 1.05,
    TUBE_R * 1.15,
    0.24,
    24,
  );

  const root = new THREE.Group();
  scene.add(root);
  let tubes: Tube[] = [];
  let contentW = 12;

  function layout(n: number) {
    for (const c of [...root.children]) root.remove(c);
    tubes = [];
    const [sx, sy] = nixieStyle("classic").squash;
    const cathodeSpec = nixieCathodes();

    const w = TUBE_R * 2;
    const total = n * w + (n - 1) * GAP;
    contentW = total + 0.4;
    let x = -total / 2;

    for (let i = 0; i < n; i++) {
      const cx = x + w / 2;
      x += w + GAP;

      const group = new THREE.Group();
      group.position.x = cx;
      root.add(group);

      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.renderOrder = 3;
      group.add(glass);
      const base = new THREE.Mesh(baseGeo, metalMat);
      base.position.y = -TUBE_H / 2 - 0.06;
      group.add(base);

      const stack = new THREE.Group();
      stack.scale.set(sx, sy, 1);
      group.add(stack);
      const cathodes = new Map<string, THREE.Mesh>();
      for (const c of cathodeSpec) {
        const g = geomFor(c.symbol, c.path);
        if (!g) continue;
        const m = new THREE.Mesh(g, wireMat);
        m.position.set(
          c.offset[0] * S,
          -c.offset[1] * S,
          FRONT_Z - c.depth * STACK_SPACING,
        );
        stack.add(m);
        cathodes.set(c.symbol, m);
      }
      const grille = new THREE.LineSegments(grilleGeo, grilleMat);
      grille.renderOrder = 2;
      group.add(grille);

      tubes.push({ cathodes, lit: null });
    }

    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(total + 1.0, 0.34, 1.5),
      standMat,
    );
    stand.position.y = -TUBE_H / 2 - 0.24;
    root.add(stand);
  }

  function setDigits(digits: string[]) {
    if (tubes.length !== digits.length) {
      layout(digits.length);
      frameContent();
    }
    for (let i = 0; i < digits.length; i++) {
      const t = tubes[i];
      const sym = digits[i];
      if (sym === t.lit) continue;
      if (t.lit) {
        const prev = t.cathodes.get(t.lit);
        if (prev) prev.material = wireMat;
      }
      const next = t.cathodes.get(sym);
      if (next) next.material = glowMat;
      t.lit = next ? sym : null;
    }
    render();
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.5, 0.55);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function render() {
    composer.render();
  }

  function frameContent() {
    const vfov = (camera.fov * Math.PI) / 180;
    const halfTan = Math.tan(vfov / 2);
    const fitH = CONTENT_H / 2 / halfTan;
    const fitW = contentW / 2 / (halfTan * camera.aspect);
    const dist = THREE.MathUtils.clamp(Math.max(fitH, fitW) * 1.12, 6, 40);
    camera.position.set(0, 0.5, dist);
    camera.lookAt(0, 0, 0);
  }

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frameContent();
    render();
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  layout(1);
  resize();

  return {
    setDigits,
    setColor(color: string) {
      glowMat.emissive.set(color);
      glowMat.color.set(color).multiplyScalar(0.2);
      render();
    },
    resize,
    dispose() {
      ro.disconnect();
      wireGeo.forEach((g) => g?.dispose());
      [grilleGeo, glassGeo, baseGeo].forEach((g) => g.dispose());
      [glowMat, wireMat, glassMat, metalMat, grilleMat, standMat].forEach((m) =>
        m.dispose(),
      );
      envTex.dispose();
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
