// Table (deck) materials — the surface the dice land on. Room-wide (shared via
// the game snapshot's `deck`). `material` drives both the look (colour /
// roughness / metalness) and the impact sound (see audio.svelte.ts).

export type DeckMaterial = "felt" | "wood" | "concrete" | "metal" | "water";

export type Deck = {
  /** id — matches the backend `deck` string. */
  name: string;
  label: string;
  material: DeckMaterial;
  /** Surface colour (hex int for three.js). */
  color: number;
  roughness: number;
  metalness: number;
  /** A rippling liquid surface (dice splash it; it trembles while shaking). */
  liquid?: boolean;
  /** Liquid crest / trough tint colours (only used when `liquid`). */
  crest?: number;
  trough?: number;
};

export const DECKS: Deck[] = [
  {
    name: "felt-green",
    label: "Green felt",
    material: "felt",
    color: 0x1f6b3a,
    roughness: 0.98,
    metalness: 0,
  },
  {
    name: "felt-red",
    label: "Red felt",
    material: "felt",
    color: 0x7a1f2b,
    roughness: 0.98,
    metalness: 0,
  },
  {
    name: "felt-blue",
    label: "Blue felt",
    material: "felt",
    color: 0x1f3a6b,
    roughness: 0.98,
    metalness: 0,
  },
  {
    name: "oak",
    label: "Oak wood",
    material: "wood",
    color: 0x6b4a2a,
    roughness: 0.55,
    metalness: 0,
  },
  {
    name: "walnut",
    label: "Walnut wood",
    material: "wood",
    color: 0x3a281a,
    roughness: 0.5,
    metalness: 0,
  },
  {
    name: "concrete",
    label: "Concrete",
    material: "concrete",
    color: 0x8b8a86,
    roughness: 0.92,
    metalness: 0,
  },
  {
    name: "steel",
    label: "Steel",
    material: "metal",
    color: 0x9aa2ab,
    roughness: 0.3,
    metalness: 0.85,
  },
  {
    name: "water",
    label: "Water",
    material: "water",
    color: 0x1f74b0,
    roughness: 0.12, // wet (overridden to a fixed sheen by the liquid surface)
    metalness: 0,
    liquid: true,
    crest: 0x9fe0ff, // bright foam highlight on wave crests
    trough: 0x083a6b, // deep blue in the troughs
  },
];

export const DEFAULT_DECK = "felt-green";

export function deckByName(name: string): Deck {
  return DECKS.find((d) => d.name === name) ?? DECKS[0];
}
