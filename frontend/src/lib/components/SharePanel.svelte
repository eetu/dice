<script lang="ts">
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { qrDataUrl } from "$lib/qr";
  import { theme } from "$lib/stores/theme.svelte";

  type Props = { code: string };
  let { code }: Props = $props();

  const joinUrl = $derived(`${location.origin}/g/${code}`);
  let qr = $state("");
  let copied = $state<"" | "code" | "link">("");

  $effect(() => {
    qrDataUrl(joinUrl, theme.resolved === "dark").then((d) => (qr = d));
  });

  async function copy(text: string, what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      copied = what;
      setTimeout(() => (copied = ""), 1500);
    } catch {
      /* clipboard unavailable (insecure context / denied) */
    }
  }
</script>

<div class="share">
  <div class="qr">
    {#if qr}
      <img src={qr} alt={i18n.m.qrAlt} width="200" height="200" />
    {/if}
  </div>
  <div class="details">
    <div class="label">{i18n.m.gameCode}</div>
    <button
      class="code"
      onclick={() => copy(code, "code")}
      title={i18n.m.copyCode}
    >
      {code}
    </button>
    <button class="link" onclick={() => copy(joinUrl, "link")}>
      {copied === "link"
        ? i18n.m.linkCopied
        : copied === "code"
          ? i18n.m.codeCopied
          : i18n.m.copyInviteLink}
    </button>
    <p class="hint">{i18n.m.shareHint}</p>
  </div>
</div>

<style>
  .share {
    display: flex;
    gap: 1.25rem;
    align-items: center;
  }
  .qr {
    width: 200px;
    height: 200px;
    flex: none;
    display: grid;
    place-items: center;
    background: var(--halo-bg-light);
    border-radius: var(--halo-radius);
  }
  .qr img {
    display: block;
  }
  .details {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  .label {
    font-size: 0.8rem;
    color: var(--halo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .code {
    font-family: var(--halo-font-heading);
    font-size: 2.4rem;
    font-weight: 600;
    letter-spacing: 0.15em;
    color: var(--halo-accent);
    background: none;
    border: none;
    padding: 0;
    text-align: left;
  }
  .link {
    align-self: flex-start;
    background: var(--halo-accent-soft);
    color: var(--halo-accent);
    border: none;
    border-radius: var(--halo-radius-pill);
    padding: 0.5em 0.9em;
    font-size: 0.9rem;
    font-weight: 500;
  }
  .hint {
    margin: 0.25rem 0 0;
    font-size: 0.8rem;
    color: var(--halo-text-muted);
  }
  @media (max-width: 520px) {
    .share {
      flex-direction: column;
      text-align: center;
    }
    .details {
      align-items: center;
    }
    .link {
      align-self: center;
    }
  }
</style>
