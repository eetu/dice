<script lang="ts">
  // Self-hosted fonts (no runtime Google Fonts dependency → same-origin CSP,
  // works offline on the LAN). Weights used by the halo tokens.
  import "@fontsource/inter/300.css";
  import "@fontsource/inter/400.css";
  import "@fontsource/inter/500.css";
  import "@fontsource/inter/600.css";
  import "@fontsource/inter/700.css";
  import "@fontsource/space-grotesk/400.css";
  import "@fontsource/space-grotesk/500.css";
  import "@fontsource/space-grotesk/600.css";
  import "$lib/styles/halo.css";

  import { theme, watchSystemTheme } from "$lib/stores/theme.svelte";

  let { children } = $props();

  // Reflect the resolved theme onto <html data-theme>, which the halo tokens
  // key off. Keep it live for OS changes while in `auto`.
  $effect(() => {
    document.documentElement.dataset.theme = theme.resolved;
  });
  $effect(() => watchSystemTheme());
</script>

{@render children()}
