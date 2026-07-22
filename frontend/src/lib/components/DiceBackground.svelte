<script lang="ts">
  // Ambient repeating die-face texture behind the app. The tiling + theming comes
  // from @anarkisti/igyb (glyphTile); dice owns the glyph — we draw real pips here and
  // hand igyb the draw callback. Colours are read from the live halo tokens so it
  // tracks the light/dark theme.
  //
  // Two touches on top of the plain tile, kept muted so the game stays the focus:
  //  • Diagonal lattice — the whole field is rotated by TILT, and each die is
  //    counter-rotated by the same angle so the dice read upright while their rows
  //    run on the diagonal (an argyle arrangement, not a straight grid).
  //  • Interactivity — the field drifts a few px opposite the pointer (a parallax
  //    depth cue). It's driven off a window listener so it also responds to touch
  //    drags and never intercepts a tap (the layer stays pointer-events:none).
  // The per-cell shimmer is igyb's own (its wave already travels diagonally).
  import {
    type GlyphEnv,
    glyphTile,
    mix,
    type Palette,
    toRgb,
    toRgbString,
  } from "@anarkisti/igyb/core";
  import { tick } from "svelte";

  import { theme } from "$lib/stores/theme.svelte";

  type Props = { opacity?: number };
  let { opacity = 1 }: Props = $props();

  let el: HTMLDivElement;

  // Lattice tilt (degrees). Drives both the CSS rotation of the field and the
  // per-die counter-rotation below, so they stay in lockstep from one constant.
  const TILT = -16;

  // Pip layouts for faces 1–6 (unit coordinates within the die square).
  const PIPS: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [
      [0.3, 0.3],
      [0.7, 0.7],
    ],
    3: [
      [0.3, 0.3],
      [0.5, 0.5],
      [0.7, 0.7],
    ],
    4: [
      [0.3, 0.3],
      [0.7, 0.3],
      [0.3, 0.7],
      [0.7, 0.7],
    ],
    5: [
      [0.3, 0.3],
      [0.7, 0.3],
      [0.5, 0.5],
      [0.3, 0.7],
      [0.7, 0.7],
    ],
    6: [
      [0.3, 0.28],
      [0.7, 0.28],
      [0.3, 0.5],
      [0.7, 0.5],
      [0.3, 0.72],
      [0.7, 0.72],
    ],
  };

  function drawDie(
    ctx: CanvasRenderingContext2D,
    size: number,
    i: number,
    env: GlyphEnv,
  ): void {
    const n = (i % 6) + 1; // the per-cell hash mixes faces across the field
    const s = size * 0.8;
    const o = -s / 2;
    // Silver glint: brighten the outline from the base glyph colour (palette.fg)
    // toward the glint accent near the pointer (squared to keep it tight) and
    // thicken it a touch — a metallic catch of the light. Colours come off the
    // per-cell env palette, so there's no module-level colour state to keep synced.
    const t = env.highlight * env.highlight;
    ctx.strokeStyle = ctx.fillStyle = mix(
      env.palette.fg,
      env.palette.accent(0),
      t,
    );
    ctx.save();
    ctx.rotate((-TILT * Math.PI) / 180); // keep the die upright under the field tilt
    ctx.lineWidth = size * 0.035 * (1 + t * 0.5);
    ctx.beginPath();
    ctx.roundRect(o, o, s, s, size * 0.16);
    ctx.stroke();
    for (const [x, y] of PIPS[n]) {
      ctx.beginPath();
      ctx.arc(o + x * s, o + y * s, size * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // A subtle "raised" tint: lift each channel of the themed page bg by a flat
  // amount so the die outlines read as gently embossed. (igyb's `lighten` mixes
  // *toward white* — proportional — whereas dice wants a small flat lift that
  // stays tiny on the light-grey body yet still shows on the near-black dark one;
  // so keep this dice-specific helper, built on igyb's parse/format.)
  function raise(color: string, add: number): string {
    const [r, g, b] = toRgb(color);
    return toRgbString([r + add, g + add, b + add]);
  }

  // The palette, read live from the halo tokens. Passed to glyphTile as a *thunk*
  // so `refresh()` (below) can re-invoke it on a theme flip and re-read the tokens
  // in place, rather than tearing the background down.
  function palette(): Palette {
    const bg =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--halo-body")
        .trim() || "#111";
    const dark = theme.resolved === "dark";
    // Draw the pattern a touch lighter than the page bg — more lift in dark, where
    // the near-black body would otherwise swallow a small nudge.
    const glyph = raise(bg, dark ? 9 : 7);
    // Glint peak the outline brightens toward under the pointer: cool silver in
    // dark, plain white in light. Carried as the accent so drawDie reads it off env.
    const glint = dark ? "rgb(205, 214, 236)" : "rgb(255, 255, 255)";
    return { bg, fg: glyph, accents: [glint] };
  }

  // Reference to the running background, shared with the theme-flip effect below.
  let bg: ReturnType<typeof glyphTile> | undefined;

  // Create the tiled background once. A light/dark flip re-themes it in place (see
  // the next effect) instead of destroying and recreating it.
  $effect(() => {
    // The glint follows the pointer — a mouse-hover delight. On touch the "pointer"
    // is the finger, which sits right where you're tapping (dice, buttons), lighting
    // up behind the controls. So gate it to fine pointers; touch keeps the calm
    // static texture.
    const fine = window.matchMedia("(pointer: fine)").matches;
    bg = glyphTile(el, {
      glyph: drawDie,
      size: 76,
      speed: 0.3,
      interactive: fine,
      pointerSource: "window", // canvas is pointer-events:none → track via window
      theme: palette, // thunk: refresh() re-invokes it to re-read the tokens
    });
    bg.start();
    return () => {
      bg?.destroy();
      bg = undefined;
    };
  });

  // Re-theme in place when the light/dark theme flips. tick() defers the refresh
  // until after the layout has written the new `data-theme` onto <html>, so the
  // thunk re-reads the *current* --halo-body — not the previous theme's colour
  // (which would make the pattern lag a step and look inverted).
  $effect(() => {
    theme.resolved;
    void tick().then(() => bg?.refresh());
  });

  // Parallax: nudge the field a few px opposite the pointer. A window listener so
  // it tracks over game content too (the layer itself never gets pointer events),
  // and picks up touch drags. Skipped when the user prefers reduced motion.
  $effect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    function onMove(e: PointerEvent) {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      el.style.setProperty("--px", `${-nx * 16}px`);
      el.style.setProperty("--py", `${-ny * 16}px`);
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  });
</script>

<div class="dice-bg" style:opacity aria-hidden="true">
  <div bind:this={el} class="field" style:--rot={`${TILT}deg`}></div>
</div>

<style>
  .dice-bg {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }
  /* Oversized so the rotated (and parallax-shifted) lattice still covers the
     viewport corners. */
  .field {
    position: absolute;
    inset: -25%;
    transform: translate(var(--px, 0), var(--py, 0)) rotate(var(--rot, 0));
    transition: transform 0.3s ease-out;
    will-change: transform;
  }
  @media (prefers-reduced-motion: reduce) {
    .field {
      transition: none;
    }
  }
</style>
