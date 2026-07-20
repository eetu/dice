<script lang="ts">
  import { i18n } from "$lib/i18n/i18n.svelte";
</script>

<!-- Segmented language selector (same house pattern as ThemeToggle). -->
<div class="seg" role="group" aria-label={i18n.m.language}>
  <button
    class:on={i18n.lang === "en"}
    aria-pressed={i18n.lang === "en"}
    onclick={() => i18n.set("en")}
  >
    {i18n.m.english}
  </button>
  <button
    class:on={i18n.lang === "fi"}
    aria-pressed={i18n.lang === "fi"}
    onclick={() => i18n.set("fi")}
  >
    {i18n.m.finnish}
  </button>
</div>

<style>
  .seg {
    display: flex;
    gap: 0.4rem;
  }
  .seg button {
    flex: 1;
    min-height: 44px;
    padding: 0.5em 0.4em;
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
    font-size: 0.85rem;
    transition: background var(--halo-d-fast);
  }
  .seg button.on {
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    border-color: var(--halo-accent);
    font-weight: 600;
  }
</style>
