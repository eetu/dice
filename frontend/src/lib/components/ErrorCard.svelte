<script lang="ts">
  // The "something broke" surface, shared by the route error page (+error.svelte)
  // and the render/effect boundary in the root layout. One selectable diagnostics
  // lump: on a phone, long-press → Select all → Copy is the most reliable way for
  // someone to hand us what actually happened.
  import { resolve } from "$app/paths";
  import { i18n } from "$lib/i18n/i18n.svelte";

  type Props = {
    title: string;
    body: string;
    /** Pre-formatted, newline-separated. Never HTML — it can contain a URL.
     *  Omitted when nothing actually broke (a 404): a build + UA dump reads as
     *  "the app is broken, please report it" when the URL was just wrong. */
    details?: string;
    /** Primary action. Omit when there is nothing to retry — then "Back to start"
     *  is the button rather than a ghost link beside one. */
    actionLabel?: string;
    onAction?: () => void;
  };
  let { title, body, details, actionLabel, onAction }: Props = $props();
</script>

<div class="notice halo-card">
  <h2>{title}</h2>
  <p>{body}</p>
  {#if details}
    <pre class="diag">{details}</pre>
  {/if}
  <div class="actions">
    {#if actionLabel && onAction}
      <button class="btn" onclick={onAction}>{actionLabel}</button>
      <a class="ghost" href={resolve("/")}>{i18n.m.backToStart}</a>
    {:else}
      <a class="btn" href={resolve("/")}>{i18n.m.backToStart}</a>
    {/if}
  </div>
</div>

<style>
  .notice {
    max-width: 26rem;
    margin: 3rem auto;
    padding: 2rem;
    text-align: center;
    color: var(--halo-text-main);
  }
  h2 {
    margin: 0 0 0.5rem;
    font-family: var(--halo-font-heading);
  }
  p {
    margin: 0;
    color: var(--halo-text-muted);
    font-size: 0.95rem;
  }
  .diag {
    margin: 1.25rem 0 0;
    padding: 0.75rem;
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    color: var(--halo-text-muted);
    font-size: 0.75rem;
    line-height: 1.6;
    text-align: left;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }
  .btn {
    display: inline-block;
    margin-top: 1rem;
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    text-decoration: none;
    border: none;
    border-radius: var(--halo-radius);
    padding: 0.6em 1.2em;
    font-weight: 600;
  }
  .ghost {
    margin-top: 1rem;
    color: var(--halo-text-muted);
    font-size: 0.9rem;
  }
</style>
