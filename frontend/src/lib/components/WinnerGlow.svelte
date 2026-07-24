<script lang="ts">
  // A soft, warm spotlight for the win screen — a fixed radial glow centered
  // behind the trophy/title, breathing gently. Pure CSS on the live halo
  // accent: symmetric and obviously deliberate (an igyb blob mesh here read as
  // a pointer glint stuck over the frozen ambient backdrop), zero canvas/rAF
  // cost, and it sits behind the ASCII Fireworks without stealing focus.
  import { theme } from "$lib/stores/theme.svelte";

  // Accent-over-near-black is punchier than accent-over-light-grey, so ease
  // the wash back in dark to keep it a glow, not a flood.
  const opacity = $derived(theme.resolved === "dark" ? 0.5 : 0.8);
</script>

<div class="glow" style:opacity aria-hidden="true"></div>

<style>
  /* Fills the viewport behind the win content (z-index:-1 within the page's
     stacking context, above the die-face backdrop). Centered a touch above
     mid-screen, roughly behind the trophy. */
  .glow {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: radial-gradient(
      58% 52% at 50% 42%,
      color-mix(in srgb, var(--halo-accent) 30%, transparent) 0%,
      color-mix(in srgb, var(--halo-accent) 11%, transparent) 45%,
      transparent 72%
    );
  }
  /* A slow breath — transform only (compositor-friendly). */
  @media (prefers-reduced-motion: no-preference) {
    .glow {
      animation: winner-breathe 3.4s ease-in-out infinite;
    }
  }
  @keyframes winner-breathe {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.07);
    }
  }
</style>
