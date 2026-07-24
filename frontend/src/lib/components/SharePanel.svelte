<script lang="ts">
  import Bot from "@lucide/svelte/icons/bot";
  import X from "@lucide/svelte/icons/x";

  import type { BotSkill, Player } from "$lib/api";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { qrDataUrl } from "$lib/qr";
  import { theme } from "$lib/stores/theme.svelte";

  /** `onAddBot` present = the add-a-bot row is shown (the game page wires it).
   *  `bots` + `onRemoveBot` list the seated bots with a remove ✕ — this panel
   *  is reachable in EVERY mode (header code chip), unlike the free-mode
   *  player list, so bots stay removable mid-match. */
  type Props = {
    code: string;
    onAddBot?: (skill: BotSkill) => void;
    bots?: Player[];
    onRemoveBot?: (id: string) => void;
  };
  let { code, onAddBot, bots = [], onRemoveBot }: Props = $props();

  const SKILLS: { skill: BotSkill; label: () => string }[] = [
    { skill: "easy", label: () => i18n.m.botSkillEasy },
    { skill: "hard", label: () => i18n.m.botSkillHard },
    { skill: "cheater", label: () => i18n.m.botSkillCheater },
  ];

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
    <div class="label">
      {copied === "code" ? i18n.m.codeCopied : i18n.m.gameCode}
    </div>
    <button
      class="code"
      onclick={() => copy(code, "code")}
      title={i18n.m.copyCode}
      aria-label={i18n.m.copyCode}
    >
      {code}
    </button>
    <button class="link" onclick={() => copy(joinUrl, "link")}>
      {copied === "link" ? i18n.m.linkCopied : i18n.m.copyInviteLink}
    </button>
    <p class="hint">{i18n.m.shareHint}</p>

    {#if onAddBot}
      <!-- No friends at hand? Seat a bot instead (server-side player). -->
      <div class="bots">
        <span class="bots-label"><Bot size={16} /> {i18n.m.addBot}</span>
        <div class="bot-skills">
          {#each SKILLS as s (s.skill)}
            <button class="bot-skill" onclick={() => onAddBot(s.skill)}>
              {s.label()}
            </button>
          {/each}
        </div>
        {#if bots.length > 0 && onRemoveBot}
          <ul class="bot-list">
            {#each bots as b (b.id)}
              <li class="bot-row">
                <Bot size={14} />
                <span class="bot-name">{b.name}</span>
                <button
                  class="bot-rm"
                  onclick={() => onRemoveBot(b.id)}
                  aria-label={i18n.m.removeBot(b.name)}
                  title={i18n.m.removeBot(b.name)}><X size={14} /></button
                >
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
  <!-- Feedback lands on the control that was clicked (code → its label, link →
    its own label); this hidden region voices it for screen readers. -->
  <p class="sr-only" aria-live="polite">
    {copied === "code"
      ? i18n.m.codeCopied
      : copied === "link"
        ? i18n.m.linkCopied
        : ""}
  </p>
</div>

<style>
  .share {
    display: flex;
    gap: 1.75rem;
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
    /* High-contrast text; accent kept as the underline (accent-as-text was ~2.4:1). */
    color: var(--halo-text-main);
    text-decoration: underline;
    text-decoration-color: var(--halo-accent);
    text-decoration-thickness: 3px;
    text-underline-offset: 5px;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
  }
  .link {
    align-self: flex-start;
    background: var(--halo-accent-soft);
    color: var(--halo-text-main);
    border: none;
    border-radius: var(--halo-radius-pill);
    min-height: 44px;
    padding: 0.5em 0.9em;
    font-size: 0.9rem;
    font-weight: 500;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .hint {
    margin: 0.25rem 0 0;
    font-size: 0.8rem;
    color: var(--halo-text-muted);
  }
  /* Add-a-bot row — separated from the share block by a divider. */
  .bots {
    margin-top: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--halo-border);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .bots-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    color: var(--halo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .bot-skills {
    display: flex;
    gap: 0.4rem;
  }
  /* Three equal pills on ONE row — they share the width and compress rather
     than wrap (a lone pill on a second row reads broken). */
  .bot-skill {
    flex: 1 1 0;
    min-width: 0;
    white-space: nowrap;
    min-height: 40px;
    padding: 0.35em 0.4em;
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius-pill);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
    font-size: 0.9rem;
    font-weight: 500;
  }
  .bot-skill:hover {
    border-color: var(--halo-accent);
    color: var(--halo-accent);
  }
  .bot-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .bot-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.2rem 0.35rem 0.2rem 0.55rem;
    border-radius: var(--halo-radius-pill);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
    font-size: 0.9rem;
  }
  .bot-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .bot-rm {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    background: none;
    border: none;
    color: var(--halo-text-muted);
  }
  .bot-rm:hover {
    color: var(--halo-error);
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
