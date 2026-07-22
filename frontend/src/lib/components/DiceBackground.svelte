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
  import { glyphTile, type Palette } from "@anarkisti/igyb/core";

  import { theme } from "$lib/stores/theme.svelte";

  type Props = { opacity?: number };
  let { opacity = 0.16 }: Props = $props();

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
  ): void {
    const n = (i % 6) + 1; // the per-cell hash mixes faces across the field
    const s = size * 0.8;
    const o = -s / 2;
    ctx.save();
    ctx.rotate((-TILT * Math.PI) / 180); // keep the die upright under the field tilt
    ctx.lineWidth = size * 0.035;
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

  function palette(): Palette {
    const s = getComputedStyle(document.documentElement);
    const get = (v: string, fallback: string): string =>
      s.getPropertyValue(v).trim() || fallback;
    return {
      bg: get("--halo-bg-main", "#111"),
      // A hair lighter than the bg (subtle embossed texture, not dark outlines).
      fg: get("--halo-text-light", "#e9e9e9"),
      accents: [get("--halo-text-light", "#e9e9e9")],
    };
  }

  $effect(() => {
    theme.resolved; // re-read palette when the light/dark theme flips
    const bg = glyphTile(el, {
      glyph: drawDie,
      size: 76,
      speed: 0.3,
      theme: palette(),
    });
    bg.start();
    return () => bg.destroy();
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
