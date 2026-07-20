<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import type { Snippet } from "svelte";

  import { i18n } from "$lib/i18n/i18n.svelte";

  // Native <dialog> chrome: showModal() gives the backdrop, focus trap, and
  // Escape-to-close for free. Content is slotted as children.
  type Props = {
    open: boolean;
    label: string;
    onClose: () => void;
    children: Snippet;
  };
  let { open, label, onClose, children }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    const d = dialog;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-label={label}
  onclose={onClose}
  onclick={(e) => {
    if (e.target === dialog) onClose(); // backdrop click
  }}
>
  <div class="body">
    <header class="mhead">
      <h3>{label}</h3>
      <button class="x" aria-label={i18n.m.closeSettings} onclick={onClose}>
        <X size={18} />
      </button>
    </header>
    {@render children()}
  </div>
</dialog>

<style>
  dialog {
    border: none;
    border-radius: var(--halo-radius);
    background: var(--halo-bg-main);
    color: var(--halo-text-main);
    padding: 0;
    width: min(24rem, calc(100vw - 2rem));
    box-shadow: var(--halo-shadow);
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
  }
  .body {
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .mhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
  }
  .x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    margin: -0.5rem -0.5rem -0.5rem 0; /* absorb the larger hit area into the header */
    background: none;
    border: none;
    color: var(--halo-text-muted);
    cursor: pointer;
    padding: 0.2em;
  }
  .x:hover {
    color: var(--halo-text-main);
  }
  @media (max-width: 640px) {
    /* Bottom sheet: full-width, pinned to the bottom edge, height driven by its
       content (capped + scrollable) rather than filling the whole screen. */
    dialog {
      width: 100%;
      max-width: none;
      margin: 0;
      inset: auto 0 0 0;
      border-radius: var(--halo-radius) var(--halo-radius) 0 0;
      max-height: 85dvh;
      overflow-y: auto;
    }
    .body {
      padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
    }
  }
</style>
