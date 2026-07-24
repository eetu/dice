<script lang="ts">
  // A small non-blocking status toast, centered near the top of the viewport.
  // Presentational: the parent controls when it mounts (mount/unmount drives the
  // fly transition). `busy` shows a reconnecting spinner.
  import { fly } from "svelte/transition";

  type Props = {
    message: string;
    variant?: "warn" | "info";
    busy?: boolean;
  };
  let { message, variant = "warn", busy = false }: Props = $props();
</script>

<div class="anchor" aria-live="polite">
  <div
    class="toast {variant}"
    role="status"
    transition:fly={{ y: -14, duration: 200 }}
  >
    {#if busy}<span class="spin" aria-hidden="true"></span>{/if}
    <span class="msg">{message}</span>
  </div>
</div>

<style>
  /* Fixed, centered anchor so the toast's own fly-transform doesn't fight the
     centering. Non-interactive — it never blocks taps on the board below. */
  .anchor {
    position: fixed;
    top: max(0.75rem, env(safe-area-inset-top));
    left: 0;
    right: 0;
    z-index: 50;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .toast {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    max-width: min(32rem, calc(100vw - 1.5rem));
    padding: 0.55rem 1rem;
    border-radius: var(--halo-radius-pill);
    background: var(--halo-bg-main);
    box-shadow: var(--halo-shadow);
    border: 1px solid var(--halo-border);
    font-size: 0.9rem;
    color: var(--halo-text-main);
  }
  /* Opaque warm tint (mix against the solid page colour, not the translucent
     accent-soft token) so the header behind never bleeds through. */
  .toast.warn {
    background: color-mix(in srgb, var(--halo-accent) 12%, var(--halo-bg-main));
    border-color: var(--halo-accent);
  }
  .msg {
    line-height: 1.3;
  }
  /* Reconnecting spinner — an accent ring with one open quadrant. */
  .spin {
    flex: none;
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--halo-accent) 30%, transparent);
    border-top-color: var(--halo-accent);
    animation: toastspin 0.7s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
  @keyframes toastspin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
