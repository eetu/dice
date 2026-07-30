<script lang="ts">
  // Route-level failures (a load or navigation error) — SvelteKit renders this
  // after `hooks.client.ts` has kept the real message and reported it. Render and
  // $effect errors go to the boundary in +layout.svelte instead; failures before
  // any Svelte code runs go to the boot watchdog in app.html.
  //
  // This is ALSO the app's 404 page: with no route matching the URL, SvelteKit's
  // client router lands here with status 404 (there's no server to fall back to —
  // the backend serves the SPA shell for every path). A mistyped or truncated
  // invite link is not a crash, so it gets its own card: "Something broke" plus a
  // stack of diagnostics to relay is a false alarm, and Reload can't fix a typo.
  import { page } from "$app/state";
  import ErrorCard from "$lib/components/ErrorCard.svelte";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { diagnostics } from "$lib/report";

  const details = $derived(
    diagnostics(`${page.status} ${page.error?.message ?? ""}`.trim()),
  );
</script>

{#if page.status === 404}
  <ErrorCard title={i18n.m.missingTitle} body={i18n.m.missingBody} />
{:else}
  <ErrorCard
    title={i18n.m.crashTitle}
    body={i18n.m.crashBody}
    {details}
    actionLabel={i18n.m.reload}
    onAction={() => location.reload()}
  />
{/if}
