<script lang="ts">
  // The free-mode dice-tray builder: add typed dice (d4..d100), give each its own
  // material, remove them. Edits are optimistic locally and pushed whole via
  // `onChange` (the server echoes back through the snapshot — last write wins).
  import type { DieKind, DieSpec } from "$lib/api";
  import Select from "$lib/components/Select.svelte";
  import { DECKS } from "$lib/dice/decks";
  import { themeByName, THEMES } from "$lib/dice/themes";
  import { i18n } from "$lib/i18n/i18n.svelte";

  type Props = {
    diceSet: DieSpec[];
    deck: string;
    max: number;
    onChange: (dice: DieSpec[]) => void;
    onDeckChange: (deck: string) => void;
  };
  let { diceSet, deck, max, onChange, onDeckChange }: Props = $props();

  const deckOptions = DECKS.map((d) => ({
    name: d.name,
    label: i18n.m.decks[d.name] ?? d.label,
  }));

  const KINDS: DieKind[] = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
  // Per-die materials = the 3D themes. `nixie` is a whole-scene render mode (a
  // single tube can't show a multi-digit value), so it's not a per-die option.
  const materials = THEMES.filter((t) => !t.nixie).map((t) => ({
    name: t.name,
    label: i18n.m.themes[t.name] ?? t.label,
  }));

  // Optimistic local copy: derives from the server snapshot but can be overridden
  // locally on edit (a writable $derived re-syncs when the snapshot echoes back).
  let local = $derived(diceSet.map((d) => ({ ...d })));

  // New quick-adds inherit the last material chosen (starts at ivory).
  let addMaterial = $state("ivory");

  function commit(next: DieSpec[]) {
    local = next;
    onChange(next);
  }
  function addDie(kind: DieKind) {
    if (local.length >= max) return;
    commit([...local, { kind, material: addMaterial }]);
  }
  function removeDie(i: number) {
    commit(local.filter((_, j) => j !== i));
  }
  function setMaterial(i: number, material: string) {
    addMaterial = material;
    commit(local.map((d, j) => (j === i ? { ...d, material } : d)));
  }

  function swatch(material: string): string {
    return "#" + themeByName(material).body.toString(16).padStart(6, "0");
  }
</script>

<div class="tray">
  <!-- Quick-add: one button per die type. -->
  <div class="quick">
    {#each KINDS as k (k)}
      <button
        class="add"
        onclick={() => addDie(k)}
        disabled={local.length >= max}
        aria-label={i18n.m.addDie(k)}>{k}</button
      >
    {/each}
  </div>

  <!-- The current tray: one row per die (kind · material · remove). -->
  <ul class="list">
    {#each local as d, i (i)}
      <li>
        <span class="kind">{d.kind}</span>
        <span class="sw" style="background:{swatch(d.material)}"></span>
        <select
          value={d.material}
          onchange={(e) => setMaterial(i, e.currentTarget.value)}
          aria-label={i18n.m.dieMaterial}
        >
          {#each materials as m (m.name)}
            <option value={m.name}>{m.label}</option>
          {/each}
        </select>
        <button
          class="rm"
          onclick={() => removeDie(i)}
          aria-label={i18n.m.removeDie(d.kind)}>×</button
        >
      </li>
    {/each}
  </ul>

  <p class="count">{i18n.m.trayCount(local.length, max)}</p>

  <!-- The table surface (room-wide) lives here too, next to the dice. -->
  <div class="table-sel">
    <Select
      label={i18n.m.tableSelectLabel}
      value={deck}
      options={deckOptions}
      onChange={onDeckChange}
    />
  </div>
</div>

<style>
  .tray {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .add {
    flex: 1 1 3rem;
    min-height: 44px;
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
    font-family: var(--halo-font-heading);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .add:hover:not(:disabled) {
    border-color: var(--halo-accent);
    color: var(--halo-accent);
  }
  .add:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-height: 40vh;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
  }
  .kind {
    min-width: 2.6rem;
    font-family: var(--halo-font-heading);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .sw {
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    flex: none;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  }
  select {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.95rem;
    color: var(--halo-text-main);
    background: var(--halo-bg-main);
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    padding: 0.4em 0.6em;
  }
  .rm {
    flex: none;
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: var(--halo-radius);
    background: none;
    color: var(--halo-text-muted);
    font-size: 1.3rem;
    line-height: 1;
  }
  .rm:hover {
    color: var(--halo-error);
  }
  .count {
    margin: 0;
    text-align: center;
    font-size: 0.8rem;
    color: var(--halo-text-muted);
    font-variant-numeric: tabular-nums;
  }
  /* Table surface — separated from the dice list by a divider. */
  .table-sel {
    padding-top: 0.9rem;
    border-top: 1px solid var(--halo-border);
  }
</style>
