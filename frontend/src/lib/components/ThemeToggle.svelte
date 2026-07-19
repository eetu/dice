<script lang="ts">
  import Monitor from "@lucide/svelte/icons/monitor";
  import Moon from "@lucide/svelte/icons/moon";
  import Sun from "@lucide/svelte/icons/sun";

  import { setTheme, theme } from "$lib/stores/theme.svelte";
</script>

<!-- Segmented light/dark/auto control (house pattern, cf. tracker/party). -->
<div class="seg">
  <button class:on={theme.mode === "light"} onclick={() => setTheme("light")}>
    <Sun size={15} /> light
  </button>
  <button class:on={theme.mode === "dark"} onclick={() => setTheme("dark")}>
    <Moon size={15} /> dark
  </button>
  <button class:on={theme.mode === "auto"} onclick={() => setTheme("auto")}>
    <Monitor size={15} /> auto
  </button>
</div>

<style>
  .seg {
    display: flex;
    gap: 0.4rem;
  }
  .seg button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4em;
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
    color: #fff;
    border-color: var(--halo-accent);
  }
</style>
