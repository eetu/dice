<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { api, ApiError, type Mode } from "$lib/api";
  import DiceBackground from "$lib/components/DiceBackground.svelte";
  import LangToggle from "$lib/components/LangToggle.svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import Wordmark from "$lib/components/Wordmark.svelte";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { session } from "$lib/stores/session.svelte";

  let name = $state(session.name);
  let joinCode = $state("");
  let mode = $state<Mode>("free"); // which game to start when creating
  let busy = $state(false);
  let error = $state("");

  const GAMES: { mode: Mode; label: () => string }[] = [
    { mode: "free", label: () => i18n.m.freeDice },
    { mode: "liars", label: () => i18n.m.liarsDice },
    { mode: "yatzy", label: () => i18n.m.yatzyDice },
    { mode: "farkle", label: () => i18n.m.farkleDice },
  ];

  async function create() {
    if (busy) return;
    busy = true;
    error = "";
    session.setName(name.trim());
    try {
      const creds = await api.createGame(name.trim(), mode);
      session.saveCreds(creds.code, {
        playerId: creds.playerId,
        token: creds.token,
      });
      await goto(resolve("/g/[code]", { code: creds.code }));
    } catch {
      error = i18n.m.errCreate;
      busy = false;
    }
  }

  async function join() {
    const code = joinCode.trim().toUpperCase();
    if (busy || !code) return;
    busy = true;
    error = "";
    session.setName(name.trim());
    try {
      const creds = await api.joinGame(code, name.trim());
      session.saveCreds(creds.code, {
        playerId: creds.playerId,
        token: creds.token,
      });
      await goto(resolve("/g/[code]", { code: creds.code }));
    } catch (e) {
      error =
        e instanceof ApiError && e.status === 404
          ? i18n.m.errNoGame(code)
          : i18n.m.errJoin;
      busy = false;
    }
  }
</script>

<DiceBackground />

<div class="page">
  <main class="lobby halo-card">
    <div class="brand">
      <Wordmark size="2.6rem" />
      <p class="tagline">{i18n.m.tagline}</p>
    </div>

    <label class="field">
      <span>{i18n.m.yourName}</span>
      <input
        bind:value={name}
        placeholder={i18n.m.namePlaceholder}
        maxlength="24"
      />
    </label>

    <div class="field">
      <span>{i18n.m.game}</span>
      <div class="seg" role="group" aria-label={i18n.m.game}>
        {#each GAMES as g (g.mode)}
          <button
            type="button"
            class:on={mode === g.mode}
            aria-pressed={mode === g.mode}
            onclick={() => (mode = g.mode)}
          >
            {g.label()}
          </button>
        {/each}
      </div>
    </div>

    <button class="primary" onclick={create} disabled={busy}>
      {i18n.m.createGame}
    </button>

    <div class="divider"><span>{i18n.m.orJoin}</span></div>

    <form
      class="join"
      onsubmit={(e) => {
        e.preventDefault();
        join();
      }}
    >
      <input
        bind:value={joinCode}
        placeholder={i18n.m.codePlaceholder}
        aria-label={i18n.m.gameCode}
        maxlength="5"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit" disabled={busy}>{i18n.m.join}</button>
    </form>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  </main>

  <div class="prefs">
    <ThemeToggle />
    <LangToggle />
  </div>
</div>

<style>
  .page {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    padding: 1.5rem;
  }
  .prefs {
    position: relative;
    z-index: 1;
    width: min(24rem, 100%);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .lobby {
    position: relative;
    z-index: 1;
    width: min(24rem, 100%);
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    padding: 2rem;
  }
  .brand {
    text-align: center;
    margin-bottom: 0.5rem;
  }
  .tagline {
    margin: 0.4rem 0 0;
    color: var(--halo-text-muted);
    font-size: 0.95rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--halo-text-muted);
  }
  input {
    font-family: inherit;
    font-size: 1rem;
    min-height: 44px;
    padding: 0.6em 0.75em;
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
  }
  /* Game selector — 2×2 grid so four games fit without overflowing. */
  .seg {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.4rem;
  }
  .seg button {
    min-height: 44px;
    padding: 0.5em 0.3em;
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
  .primary {
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    border: none;
    border-radius: var(--halo-radius);
    min-height: 44px;
    padding: 0.8em;
    font-size: 1rem;
    font-weight: 600;
    transition: filter var(--halo-d-fast);
  }
  .primary:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--halo-text-muted);
    font-size: 0.8rem;
  }
  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--halo-border);
  }
  .join {
    display: flex;
    gap: 0.5rem;
  }
  .join input {
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-family: var(--halo-font-heading);
    text-align: center;
  }
  .join button {
    background: var(--halo-off-bg);
    color: var(--halo-text-main);
    border: none;
    border-radius: var(--halo-radius);
    min-height: 44px;
    padding: 0 1.2em;
    font-weight: 600;
  }
  .error {
    margin: 0;
    color: var(--halo-error);
    font-size: 0.9rem;
    text-align: center;
  }
  @media (max-width: 640px) {
    /* Tighter gutters on a phone. */
    .page {
      padding: 1rem;
    }
    .lobby {
      padding: 1.5rem;
    }
  }
</style>
