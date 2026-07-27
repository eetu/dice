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
  import ErrorCard from "$lib/components/ErrorCard.svelte";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { describe, diagnostics, report } from "$lib/report";
  import { theme, watchSystemTheme } from "$lib/stores/theme.svelte";

  let { children } = $props();

  // The ambient shimmer animates only in the lobby. In a game it freezes to a
  // static frame — a 60 fps full-viewport canvas repaint behind the table is
  // pure battery/heat (the 3D stage owns the motion there).
  const bgLive = $derived(!page.url.pathname.startsWith("/g/"));

  // We rendered — stand the boot watchdog in app.html down (and keep it from
  // ever shouting over a live app). Also clears its panel if a slow network beat
  // the timeout.
  $effect(() => {
    window.__diceBooted = true;
    window.__diceHideBootFail?.();
  });

  // A new build was deployed (SvelteKit's version poll flipped `updated`) —
  // hard-reload to pick up the new SPA (and its matching protocol). If the
  // backend persists games across the restart (DICE_STATE_FILE) the reload
  // reconnects with the stored creds and resumes; otherwise the game was
  // ephemeral and there was nothing to lose. Either way the reload is safe.
  //
  // ONCE per tab, though: a browser serving a stale cached shell reports itself
  // as outdated forever, and reloading into the same stale shell is how a blank
  // page becomes a blank *reload loop*. One reload picks up a real deploy; if it
  // didn't, reloading again won't either.
  //
  // Tradeoff: a tab left open across TWO deploys only auto-reloads for the first
  // one (after that it keeps running an older client until reloaded by hand).
  // That's strictly better than a tab that reloads into a blank page forever.
  $effect(() => {
    if (!updated.current || reloadedAlready()) return;
    location.reload();
  });

  /** sessionStorage marker (per tab, survives the reload — unlike a variable).
   *  Wrapped: the same browsers that block site data make this throw. */
  function reloadedAlready(): boolean {
    const KEY = "dice:reloaded";
    try {
      if (sessionStorage.getItem(KEY)) return true;
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* can't remember — one reload attempt is still better than none */
    }
    return false;
  }

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

<!-- Error boundary for the whole app. This is the layer that catches a throw
  during RENDER or inside an $effect — which `hooks.client.ts` doesn't see (it
  only gets load/navigation errors) and which otherwise leaves a half-dead screen
  with no explanation. Errors in event handlers or async work aren't catchable
  here by design (Svelte doesn't route them through boundaries); those surface as
  window `error`/`unhandledrejection` and are reported by the watchdog in
  app.html. The backdrop is deliberately OUTSIDE, so the fallback still has one.
  Note a boundary can't catch throws from this layout's own script/effects. -->
<svelte:boundary onerror={(e) => report("render", describe(e))}>
  <div class="bg-content">{@render children()}</div>

  {#snippet failed(error, reset)}
    <div class="bg-content">
      <ErrorCard
        title={i18n.m.crashTitle}
        body={i18n.m.crashBody}
        details={diagnostics(describe(error))}
        actionLabel={i18n.m.retry}
        onAction={reset}
      />
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .bg-content {
    position: relative;
    z-index: 1;
  }
</style>
