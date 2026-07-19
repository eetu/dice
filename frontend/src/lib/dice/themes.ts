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
