<script lang="ts">
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import Pencil from "@lucide/svelte/icons/pencil";

  import type { Player } from "$lib/api";
  import { i18n } from "$lib/i18n/i18n.svelte";

  type Props = {
    players: Player[];
    turnIdx: number;
    myId: string | null;
    onReorder: (order: string[]) => void;
    onRename: (name: string) => void;
  };
  let { players, turnIdx, myId, onReorder, onRename }: Props = $props();

  // Working copy so a live pointer-drag can reorder locally without waiting for
  // the server round-trip. Re-synced from props whenever we're not dragging.
  let list = $state<Player[]>([]);
  let dragId = $state<string | null>(null);
  let rowEls = $state<HTMLLIElement[]>([]);

  $effect(() => {
    if (!dragId) list = [...players];
  });

  // Turn highlight follows the current player's *id* (not an index) so it stays
  // correct while the local list is mid-reorder.
  const currentId = $derived(players[turnIdx]?.id ?? null);

  let editingId = $state<string | null>(null);
  let draft = $state("");

  function startDrag(e: PointerEvent, id: string) {
    dragId = id;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag, { once: true });
  }

  function onMove(e: PointerEvent) {
    if (!dragId) return;
    const from = list.findIndex((p) => p.id === dragId);
    if (from < 0) return;
    let target = list.length - 1;
    for (let i = 0; i < rowEls.length; i++) {
      const el = rowEls[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        target = i;
        break;
      }
    }
    if (target !== from) {
      const [moved] = list.splice(from, 1);
      list.splice(target, 0, moved);
    }
  }

  function endDrag() {
    window.removeEventListener("pointermove", onMove);
    const order = list.map((p) => p.id);
    const prev = players.map((p) => p.id);
    dragId = null;
    if (order.join() !== prev.join()) onReorder(order);
  }

  function startEdit(p: Player) {
    editingId = p.id;
    draft = p.name;
  }
  function commit() {
    const n = draft.trim();
    if (n) onRename(n);
    editingId = null;
  }
</script>

<div class="players halo-card">
  <h3>{i18n.m.players} <span class="count">{players.length}</span></h3>
  <ul>
    {#each list as p, i (p.id)}
      <li
        bind:this={rowEls[i]}
        class:turn={p.id === currentId}
        class:dragging={p.id === dragId}
      >
        <button
          class="handle"
          aria-label={i18n.m.dragReorder(p.name)}
          onpointerdown={(e) => startDrag(e, p.id)}
          ><GripVertical size={16} /></button
        >
        <span
          class="dot"
          class:on={p.connected}
          title={p.connected ? "online" : "offline"}
        ></span>
        {#if editingId === p.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            bind:value={draft}
            onblur={commit}
            onkeydown={(e) => e.key === "Enter" && commit()}
            maxlength="24"
            autofocus
          />
        {:else}
          <span class="pname">{p.name}</span>
          {#if p.id === myId}
            <button
              class="edit"
              onclick={() => startEdit(p)}
              aria-label={i18n.m.renameSelf}><Pencil size={13} /></button
            >
          {/if}
        {/if}
        {#if p.id === currentId}<span class="badge">turn</span>{/if}
      </li>
    {/each}
  </ul>
  <p class="hint">{i18n.m.dragHint}</p>
</div>

<style>
  .players {
    padding: 1.1rem 1.25rem;
  }
  h3 {
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .count {
    font-weight: 400;
    color: var(--halo-text-muted);
    font-size: 0.8rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    transition:
      background var(--halo-d-fast),
      box-shadow var(--halo-d-fast);
  }
  li.turn {
    background: var(--halo-accent-soft);
    box-shadow: inset 3px 0 0 var(--halo-accent);
  }
  li.dragging {
    box-shadow: var(--halo-shadow);
    opacity: 0.95;
  }
  .handle {
    display: inline-flex;
    align-items: center;
    background: none;
    border: none;
    color: var(--halo-text-muted);
    cursor: grab;
    padding: 0 0.15rem;
    touch-action: none;
    user-select: none;
  }
  .handle:active {
    cursor: grabbing;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--halo-disconnected);
    flex: none;
  }
  .dot.on {
    background: var(--halo-connected);
  }
  .pname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input {
    flex: 1;
    font: inherit;
    padding: 0.2em 0.4em;
    border: 1px solid var(--halo-accent);
    border-radius: var(--halo-radius-pill);
    background: var(--halo-bg-main);
    color: var(--halo-text-main);
  }
  .edit {
    display: inline-flex;
    align-items: center;
    background: none;
    border: none;
    color: var(--halo-text-muted);
    padding: 0 0.2em;
  }
  .badge {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--halo-accent);
    font-weight: 600;
  }
  .hint {
    margin: 0.75rem 0 0;
    font-size: 0.75rem;
    color: var(--halo-text-muted);
  }
</style>
