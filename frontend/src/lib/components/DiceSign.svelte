<script lang="ts">
  import { createNeonSign, type NeonArt, type NeonSign } from "@glowbox/neon";
  import { onMount } from "svelte";

  import { theme } from "$lib/stores/theme.svelte";

  type Props = {
    /** Accessible name — the canvas is an image to assistive tech, and the
     *  sign appends its shown text ("<label>: dice"). */
    label?: string;
  };
  let { label = "dice" }: Props = $props();

  // The lobby sign: script "dice" beside two overlapping dice — the composition
  // from the sibling glowbox /neon gallery (dice authored in nib). The front die
  // is `opaque`: it CUTS the rear die's tubes shy of its edge, the way a sign
  // maker ends a run where glass covers glass.
  const DIE_5 = [
    "M 26 8 L 74 8 C 83.941 8 92 16.059 92 26 L 92 74 C 92 83.941 83.941 92 74 92 L 26 92 C 16.059 92 8 83.941 8 74 L 8 26 C 8 16.059 16.059 8 26 8 Z",
    "M 36 28 C 36 32.418 32.418 36 28 36 C 23.582 36 20 32.418 20 28 C 20 23.582 23.582 20 28 20 C 32.418 20 36 23.582 36 28 Z",
    "M 80 28 C 80 32.418 76.418 36 72 36 C 67.582 36 64 32.418 64 28 C 64 23.582 67.582 20 72 20 C 76.418 20 80 23.582 80 28 Z",
    "M 58 50 C 58 54.418 54.418 58 50 58 C 45.582 58 42 54.418 42 50 C 42 45.582 45.582 42 50 42 C 54.418 42 58 45.582 58 50 Z",
    "M 36 72 C 36 76.418 32.418 80 28 80 C 23.582 80 20 76.418 20 72 C 20 67.582 23.582 64 28 64 C 32.418 64 36 67.582 36 72 Z",
    "M 80 72 C 80 76.418 76.418 80 72 80 C 67.582 80 64 76.418 64 72 C 64 67.582 67.582 64 72 64 C 76.418 64 80 67.582 80 72 Z",
  ];
  const DIE_3 = [
    "M 146 8 L 194 8 C 203.941 8 212 16.059 212 26 L 212 74 C 212 83.941 203.941 92 194 92 L 146 92 C 136.059 92 128 83.941 128 74 L 128 26 C 128 16.059 136.059 8 146 8 Z",
    "M 156 28 C 156 32.418 152.418 36 148 36 C 143.582 36 140 32.418 140 28 C 140 23.582 143.582 20 148 20 C 152.418 20 156 23.582 156 28 Z",
    "M 178 50 C 178 54.418 174.418 58 170 58 C 165.582 58 162 54.418 162 50 C 162 45.582 165.582 42 170 42 C 174.418 42 178 45.582 178 50 Z",
    "M 200 72 C 200 76.418 196.418 80 192 80 C 187.582 80 184 76.418 184 72 C 184 67.582 187.582 64 192 64 C 196.418 64 200 67.582 200 72 Z",
  ];
  // The dice are white glass, so their polarity follows the theme while the gold
  // lettering always shines: white light on a white card is invisible, but the
  // same tube ABSORBING inks the card — one sign, mixed polarity.
  const artFor = (resolved: string): NeonArt[] => {
    const polarity = resolved === "dark" ? "emit" : "absorb";
    return [
      {
        d: DIE_3,
        place: "left",
        size: 0.62,
        rotate: 9,
        dx: -0.32,
        dy: -0.22,
        gas: "co2",
        polarity,
      },
      {
        d: DIE_5,
        place: "left",
        size: 0.74,
        rotate: -11,
        dx: 0.18,
        dy: 0.16,
        gas: "co2",
        polarity,
        opaque: true,
      },
    ];
  };

  let canvas = $state<HTMLCanvasElement>();
  // $state.raw: the sign is an opaque handle (owns a 2D context), not reactive data.
  let sign = $state.raw<NeonSign | null>(null);

  // The sign wears the theme: its wall is literally the card's own background,
  // read off the live cascade rather than duplicating a token.
  function cardBg(): string {
    for (let n = canvas?.parentElement; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "transparent" && !c.startsWith("rgba(0, 0, 0, 0)"))
        return c;
    }
    return getComputedStyle(document.body).backgroundColor || "#ffffff";
  }
  onMount(() => {
    if (!canvas) return;
    // Someone who just arrived gets the switch thrown for them: the glass hangs
    // there unlit for a beat, then the tubes strike alight one after another.
    // Reduced motion skips the show and is simply on.
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = createNeonSign(canvas, {
      text: "dice",
      gas: "gold",
      art: artFor(theme.resolved),
      label,
      padding: 0.1,
      wall: cardBg(),
      on: reduced,
    });
    sign = s;
    const wake = reduced ? null : setTimeout(() => s?.power(true), 700);
    return () => {
      if (wake) clearTimeout(wake);
      s?.dispose();
      sign = null;
    };
  });

  // Rap the glass: the tapped tube stutters. The sign attaches nothing itself —
  // it answers `sectionAt`, we own the listener.
  function rap(e: PointerEvent) {
    const s = sign;
    if (!s) return;
    const tube = s.sectionAt(e.clientX, e.clientY);
    if (tube != null) s.jolt(tube);
  }

  // Follow the toggle (and live OS changes in auto). One frame late on purpose:
  // the root layout writes data-theme in its own effect, so the cascade has to
  // settle before the card's new background can be read back.
  $effect(() => {
    const t = theme.resolved;
    const s = sign;
    if (!s) return;
    const frame = requestAnimationFrame(() =>
      s.setOptions({ wall: cardBg(), art: artFor(t) }),
    );
    return () => cancelAnimationFrame(frame);
  });
</script>

<!-- The wrapper is presentational: rapping the glass is decoration, not an
     action, and the canvas inside keeps the sign's own role="img" + label. -->
<div class="sign" role="presentation" onpointerdown={rap}>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  /* No plaque: the sign's wall matches the card, so the glass floats on it. */
  .sign {
    aspect-ratio: 2.2 / 1;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
