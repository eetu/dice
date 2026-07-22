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
  import { type GlyphEnv, glyphTile, type Palette } from "@anarkisti/igyb/core";
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
    // Silver glint: brighten the outline toward `glintTo` near the pointer (squared
    // to keep it tight) and thicken it a touch — a metallic catch of the light.
    const t = env.highlight * env.highlight;
    ctx.strokeStyle = ctx.fillStyle = mix(glintFrom, glintTo, t);
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

  // Lighten a #rrggbb by a fixed per-channel amount → a subtle "raised" tint from
  // any themed bg (near-white nudges to white; near-black lifts a touch).
  function lighten(hex: string, add: number): string {
    const n = Number.parseInt(hex.replace("#", ""), 16);
    if (Number.isNaN(n)) return hex;
    const c = (shift: number): number =>
      Math.min(255, ((n >> shift) & 255) + add);
    return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
  }

  // Silver-glint endpoints (base outline → glint peak), refreshed from the theme in
  // palette(); drawDie mixes between them by the per-cell pointer highlight.
  let glintFrom: [number, number, number] = [24, 24, 24];
  let glintTo: [number, number, number] = [205, 214, 236];

  function rgbTriplet(s: string): [number, number, number] {
    const m = s.match(/\d+/g);
    return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [24, 24, 24];
  }
  function mix(
    a: [number, number, number],
    b: [number, number, number],
    t: number,
  ): string {
    const c = (i: number): number => Math.round(a[i] + (b[i] - a[i]) * t);
    return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
  }

  function palette(): Palette {
    const s = getComputedStyle(document.documentElement);
    // The real page background is --halo-body (light-grey in light, near-black in
    // dark); draw the pattern one step lighter than it, in both themes.
    const bg = s.getPropertyValue("--halo-body").trim() || "#111";
    // lighten() only pushes toward white, so a single lift can't serve both
    // themes: on the light-grey body a tiny nudge already reads, but on the
    // near-black dark body the same nudge is invisible. Lift more in dark.
    const glyph = lighten(bg, theme.resolved === "dark" ? 9 : 7);
    glintFrom = rgbTriplet(glyph);
    // Glint peak: cool silver in dark, plain white in light.
    glintTo = theme.resolved === "dark" ? [205, 214, 236] : [255, 255, 255];
    return { bg, fg: glyph, accents: [glyph] };
  }

  $effect(() => {
    theme.resolved; // re-read palette when the light/dark theme flips

    // Wait for the DOM to settle before reading the palette: the layout writes
    // the new `data-theme` onto <html> in its own effect, and this effect can
    // run first on a flip. Reading --halo-body before that write yields the
    // *previous* theme's colour — the pattern would lag a step and look
    // inverted. tick() defers the read until after data-theme lands.
    let bg: ReturnType<typeof glyphTile> | undefined;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled) return;
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
        theme: palette(),
      });
      bg.start();
    });
    return () => {
      cancelled = true;
      bg?.destroy();
    };
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
