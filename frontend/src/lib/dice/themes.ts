// Dice material themes. Room-wide (shared via the game snapshot's `diceTheme`).
// Non-nixie themes drive the three.js physical material; `nixie` is rendered by
// the glowbox <NixieTube> path instead of the 3D mesh (see DiceStage).

export type DiceTheme = {
  /** id — matches the backend `diceTheme` string. */
  name: string;
  label: string;
  /** Die body colour (hex int for three.js). */
  body: number;
  /** Pip colour (hex int). */
  pip: number;
  metalness: number;
  roughness: number;
  clearcoat: number;
  /** Rendered as glowing nixie tubes instead of a 3D mesh. */
  nixie?: boolean;
  /** Glow colour for the nixie theme (CSS string). */
  nixieColor?: string;
  /** Elemental glass: a translucent (transmission) body with an emissive inner
   *  core — the die glows from within (see DiceScene's #applyMaterial). */
  glass?: {
    /** 0..1 — how much light passes through the body. */
    transmission: number;
    ior: number;
    /** Refraction depth (world units). */
    thickness: number;
    /** Tint light picks up passing through, + how quickly (Beer–Lambert). */
    attenuationColor: number;
    attenuationDistance: number;
    /** Inner-core palette: `glowDim` = the dark base (crust/deep/storm),
     *  `glow` = the bright element colour, `glowIntensity` = its strength. */
    glowDim: number;
    glow: number;
    glowIntensity: number;
    /** The core's animated churn pattern (see `elemental.ts`). */
    motion: "flame" | "slosh" | "swirl" | "grain";
  };
};

export const THEMES: DiceTheme[] = [
  {
    name: "ivory",
    label: "Ivory",
    body: 0xf2ecdd,
    pip: 0x4a4034,
    metalness: 0.0,
    roughness: 0.42,
    clearcoat: 0.35,
  },
  {
    name: "obsidian",
    label: "Obsidian",
    body: 0x1b1b20,
    pip: 0xf0f0f0,
    metalness: 0.25,
    roughness: 0.28,
    clearcoat: 0.55,
  },
  {
    name: "ruby",
    label: "Ruby",
    body: 0xb0142e,
    pip: 0xffe6e6,
    metalness: 0.1,
    roughness: 0.22,
    clearcoat: 0.6,
  },
  {
    name: "emerald",
    label: "Emerald",
    body: 0x0f7a4d,
    pip: 0xeafff2,
    metalness: 0.1,
    roughness: 0.28,
    clearcoat: 0.5,
  },
  {
    name: "gold",
    label: "Gold",
    body: 0xc9a227,
    pip: 0x40330a,
    metalness: 1.0,
    roughness: 0.3,
    clearcoat: 0.0,
  },
  // The four elemental glass dice: translucent body, inner glow.
  // The elemental dice: a thin, nearly clear shell (a saturated shell would
  // tint away the interior) over a dominant animated core — the die should
  // read as MADE of the element, dark and high-contrast, not tinted candy.
  {
    name: "fire",
    label: "Fire",
    // Lava: near-black crust inside, molten channels pulsing yellow-hot,
    // deep-red glow in the thick glass. Light numerals to read on the dark body.
    // Polished obsidian, not frosted: roughness on a transmissive shell blurs
    // the view of the core until the background washes it out.
    body: 0xd8c3b5,
    pip: 0xffd9a0,
    metalness: 0.0,
    roughness: 0.03,
    clearcoat: 0.15,
    glass: {
      transmission: 0.94,
      ior: 1.45,
      thickness: 1.2,
      attenuationColor: 0x7a1a08,
      attenuationDistance: 1.6,
      glowDim: 0x140608,
      glow: 0xff7300,
      glowIntensity: 3.2,
      motion: "flame",
    },
  },
  {
    name: "water",
    label: "Water",
    // A living wave: deep saturated blues rolling inside, white foam streaks.
    body: 0x9fcdec,
    pip: 0xf2fbff,
    metalness: 0.0,
    roughness: 0.03,
    clearcoat: 0.2,
    glass: {
      transmission: 0.94,
      ior: 1.33,
      thickness: 1.4,
      attenuationColor: 0x1c5f9e,
      attenuationDistance: 1.5,
      glowDim: 0x0b3663,
      glow: 0x2f8fd6,
      glowIntensity: 1.5,
      motion: "slosh",
    },
  },
  {
    name: "air",
    label: "Air",
    // Storm smoke: dark grey churn with pale wisps twirling through it.
    body: 0xb8c4cc,
    pip: 0xf2f7fa,
    metalness: 0.0,
    roughness: 0.03,
    clearcoat: 0.25,
    glass: {
      transmission: 0.95,
      ior: 1.28,
      thickness: 1.0,
      attenuationColor: 0x6d7a84,
      attenuationDistance: 1.8,
      glowDim: 0x272e36,
      glow: 0xe9f0f5,
      glowIntensity: 1.2,
      motion: "swirl",
    },
  },
  {
    name: "earth",
    label: "Earth",
    // Stone golem: grey cracked rock inside, green growth veining the seams
    // with rare bright glints.
    body: 0xbdbcb1,
    pip: 0xe9e5d4,
    metalness: 0.0,
    roughness: 0.04,
    clearcoat: 0.15,
    glass: {
      transmission: 0.92,
      ior: 1.5,
      thickness: 1.4,
      attenuationColor: 0x55604a,
      attenuationDistance: 1.6,
      glowDim: 0x3d3b35,
      glow: 0x5bd645,
      glowIntensity: 2.4,
      motion: "grain",
    },
  },
  {
    name: "nixie",
    label: "Nixie",
    body: 0x0a0a0e,
    pip: 0xff6a12,
    metalness: 0.0,
    roughness: 0.5,
    clearcoat: 0.0,
    nixie: true,
    nixieColor: "#ff6a12",
  },
];

export const DEFAULT_THEME = "ivory";

export function themeByName(name: string): DiceTheme {
  return THEMES.find((t) => t.name === name) ?? THEMES[0];
}
