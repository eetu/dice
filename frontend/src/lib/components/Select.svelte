<script lang="ts">
  // A labeled native <select> — native pickers work well on touch. Options are
  // structural { name, label } (THEMES / DECKS satisfy this).
  type Option = { name: string; label: string };
  type Props = {
    label: string;
    value: string;
    options: Option[];
    onChange: (name: string) => void;
  };
  let { label, value, options, onChange }: Props = $props();
</script>

<label class="field">
  <span>{label}</span>
  <select {value} onchange={(e) => onChange(e.currentTarget.value)}>
    {#each options as o (o.name)}
      <option value={o.name}>{o.label}</option>
    {/each}
  </select>
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex: 1;
    min-width: 0;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--halo-text-muted);
  }
  select {
    font: inherit;
    font-size: 0.95rem;
    text-transform: none;
    letter-spacing: normal;
    width: 100%;
    color: var(--halo-text-main);
    background: var(--halo-bg-light);
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    padding: 0.55em 0.7em;
  }
</style>
