<script lang="ts">
  // Route-level failures (a load or navigation error) — SvelteKit renders this
  // after `hooks.client.ts` has kept the real message and reported it. Render and
  // $effect errors go to the boundary in +layout.svelte instead; failures before
  // any Svelte code runs go to the boot watchdog in app.html.
  import { page } from "$app/state";
  import ErrorCard from "$lib/components/ErrorCard.svelte";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { diagnostics } from "$lib/report";

  const details = $derived(
    diagnostics(`${page.status} ${page.error?.message ?? ""}`.trim()),
  );
</script>

<ErrorCard
  title={i18n.m.crashTitle}
  body={i18n.m.crashBody}
  {details}
  actionLabel={i18n.m.reload}
  onAction={() => location.reload()}
/>
