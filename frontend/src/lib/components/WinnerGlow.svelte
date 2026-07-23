<script lang="ts">
  // A soft, warm mesh-gradient wash for the win screen — sits *behind* the ASCII
  // Fireworks to give the celebration depth/colour without stealing focus from
  // the winner + standings. Themed from the live halo accent (not a preset), kept
  // low-opacity. igyb honours prefers-reduced-motion (a static frame) + auto-pause.
  import {
    darken,
    gradientMesh,
    lighten,
    type Palette,
  } from "@anarkisti/igyb/core";

  import { theme } from "$lib/stores/theme.svelte";

  let el = $state<HTMLDivElement>();
  // Accent-over-near-black is punchier than accent-over-light-grey, so ease the
  // wash back in dark to keep it a glow, not a flood.
  const opacity = $derived(theme.resolved === "dark" ? 0.2 : 0.32);

  function palette(): Palette {
    const s = getComputedStyle(document.documentElement);
    const accent = s.getPropertyValue("--halo-accent").trim() || "#e8853a";
    const body = s.getPropertyValue("--halo-body").trim() || "#111";
    // Drifting blobs in warm accent tones over the page body.
    return {
      bg: body,
      fg: accent,
      accents: [
        accent,
        lighten(accent, 0.32),
        darken(accent, 0.22),
        lighten(accent, 0.55),
      ],
    };
  }

  $effect(() => {
    if (!el) return;
    const bg = gradientMesh(el, { theme: palette, scale: 0.9, speed: 0.5 });
    bg.start();
    return () => bg.destroy();
  });
</script>

<div class="glow" bind:this={el} style:opacity aria-hidden="true"></div>

<style>
  /* Fills the whole viewport — behind the header/title and the page padding, but
     above the die-face backdrop (it lives in the z-index:1 .page context, and -1
     puts it at the back of that context). Opacity is set inline (theme-aware),
     low enough that the winner name + standings stay the hero. */
  .glow {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }
</style>
