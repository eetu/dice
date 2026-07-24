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

  import { page, updated } from "$app/state";
  import DiceBackground from "$lib/components/DiceBackground.svelte";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { theme, watchSystemTheme } from "$lib/stores/theme.svelte";

  let { children } = $props();

  // The ambient shimmer animates only in the lobby. In a game it freezes to a
  // static frame — a 60 fps full-viewport canvas repaint behind the table is
  // pure battery/heat (the 3D stage owns the motion there).
  const bgLive = $derived(!page.url.pathname.startsWith("/g/"));

  // A new build was deployed (SvelteKit's version poll flipped `updated`) —
  // hard-reload to pick up the new SPA (and its matching protocol). If the
  // backend persists games across the restart (DICE_STATE_FILE) the reload
  // reconnects with the stored creds and resumes; otherwise the game was
  // ephemeral and there was nothing to lose. Either way the reload is safe.
  $effect(() => {
    if (updated.current) location.reload();
  });

  // Reflect the resolved theme onto <html data-theme>, which the halo tokens
  // key off. Keep it live for OS changes while in `auto`.
  $effect(() => {
    document.documentElement.dataset.theme = theme.resolved;
  });
  $effect(() => watchSystemTheme());
  // Keep <html lang> in sync with the chosen locale.
  $effect(() => {
    document.documentElement.lang = i18n.lang;
  });
</script>

<!-- Ambient die-face backdrop on every route; content sits above it. -->
<DiceBackground live={bgLive} />

<div class="bg-content">{@render children()}</div>

<style>
  .bg-content {
    position: relative;
    z-index: 1;
  }
</style>
