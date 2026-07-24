<script lang="ts">
  import type { RollRecord } from "$lib/api";
  import { i18n } from "$lib/i18n/i18n.svelte";

  type Props = { history: RollRecord[] };
  let { history }: Props = $props();

  // Newest first, without mutating the source array.
  const rolls = $derived([...history].reverse());
</script>

<div class="history halo-card">
  <h3>{i18n.m.history}</h3>
  {#if rolls.length === 0}
    <p class="muted">{i18n.m.historyEmpty}</p>
  {:else}
    <ul>
      {#each rolls as r (r.id)}
        <li>
          <span class="who">{r.playerName}</span>
          <span class="faces">
            {#each r.dice as d, i (i)}
              <span class="face" class:poly={d.kind !== "d6"} title={d.kind}
                >{d.value}</span
              >
            {/each}
          </span>
          <span class="sum">{r.total}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .history {
    /* No horizontal padding on the card: the scroll list spans full width so its
       scrollbar sits flush at the card edge (not floating over the totals). The
       header + rows carry the horizontal inset instead. */
    padding: 1.1rem 0;
    /* Fill the remaining height of the right column; the list scrolls inside. */
    flex: 1;
    min-height: 8rem;
    display: flex;
    flex-direction: column;
  }
  h3 {
    margin: 0 1.25rem 0.75rem;
    font-size: 0.95rem;
    flex: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    /* Thin, subtle scrollbar (row padding-right keeps the totals clear of it). */
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--halo-text-muted) 40%, transparent)
      transparent;
  }
  ul::-webkit-scrollbar {
    width: 8px;
  }
  ul::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--halo-text-muted) 40%, transparent);
    border-radius: 4px;
  }
  ul::-webkit-scrollbar-track {
    background: transparent;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    padding: 0 1.25rem;
  }
  .who {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--halo-text-muted);
  }
  .faces {
    display: flex;
    gap: 0.2rem;
  }
  .face {
    display: inline-grid;
    place-items: center;
    min-width: 1.4rem;
    height: 1.4rem;
    padding: 0 0.3rem;
    background: var(--halo-bg-light);
    border-radius: var(--halo-radius-pill);
    font-family: var(--halo-font-heading);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  /* Polyhedral dice (non-d6) get an accent ring so the tray reads at a glance. */
  .face.poly {
    box-shadow: inset 0 0 0 1px var(--halo-accent);
    color: var(--halo-accent);
  }
  .sum {
    font-weight: 600;
    min-width: 2ch;
    text-align: right;
  }
  .muted {
    color: var(--halo-text-muted);
    font-size: 0.9rem;
    margin: 0 1.25rem;
  }
</style>
