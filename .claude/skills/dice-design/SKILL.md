---
name: dice-design
description: Visual identity for the dice app — layers the app-specific glyph, wordmark, layout, and voice on top of the shared halo-design tokens. Use when styling or adding UI to dice.
---

# dice-design

Thin app layer over **halo-design** (Inter + Space Grotesk, single warm orange
accent `#f78f08`, 6px soft cards, light/dark). The canonical tokens live at
`frontend/src/lib/styles/halo.css` (imported once in the root `+layout.svelte`);
use `--halo-*` in scoped `<style>` blocks. Only the four deltas below are
app-specific.

## Glyph

A die showing the **5-face**: a full-bleed dark square (`#0f0f0f`), an
accent-orange rounded die, dark pips. Source: `frontend/static/favicon.svg`
(+ `icon-maskable.svg` at the safe-zone scale). Regenerate PNGs with `just icons`.

## Wordmark

`dice`, lowercase, Inter 600, `-0.04em` tracking, with a trailing **accent
period** — `dice` + `<span class="accent">.</span>` (the canonical family form;
`<Wordmark />` — `frontend/src/lib/components/Wordmark.svelte`).

## Layout

- **Lobby** (`/`): a single centered card — name field, big accent "Create a
  game", a divider, then a code field + Join.
- **Game** (`/g/[code]`): a two-column grid — the dice **stage** (fills the
  card, the star of the screen) + toolbar on the left; players / share / history
  on the right. Collapses to one column under 820px.
- The dice stage is the focal point: near-full-bleed 3D canvas, controls and
  captions kept minimal around it.

## Voice

Playful and terse — "Roll dice together, in turns.", "Your turn — tap or shake to
roll", "Rolls will appear here." No jargon, no instructions longer than a line.
