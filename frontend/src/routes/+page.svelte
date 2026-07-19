<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { api, ApiError } from "$lib/api";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import Wordmark from "$lib/components/Wordmark.svelte";
  import { session } from "$lib/stores/session.svelte";

  let name = $state(session.name);
  let joinCode = $state("");
  let busy = $state(false);
  let error = $state("");

  async function create() {
    if (busy) return;
    busy = true;
    error = "";
    session.setName(name.trim());
    try {
      const creds = await api.createGame(name.trim());
      session.saveCreds(creds.code, {
        playerId: creds.playerId,
        token: creds.token,
      });
      await goto(resolve("/g/[code]", { code: creds.code }));
    } catch {
      error = "Couldn't create a game — is the server running?";
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
          ? `No game "${code}" — it may have expired.`
          : "Couldn't join — try again.";
      busy = false;
    }
  }
</script>

<div class="page">
  <main class="lobby halo-card">
    <div class="brand">
      <Wordmark size="2.6rem" />
      <p class="tagline">Roll dice together, in turns.</p>
    </div>

    <label class="field">
      <span>Your name</span>
      <input bind:value={name} placeholder="Anonymous" maxlength="24" />
    </label>

    <button class="primary" onclick={create} disabled={busy}
      >Create a game</button
    >

    <div class="divider"><span>or join one</span></div>

    <form
      class="join"
      onsubmit={(e) => {
        e.preventDefault();
        join();
      }}
    >
      <input
        bind:value={joinCode}
        placeholder="CODE"
        maxlength="5"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit" disabled={busy}>Join</button>
    </form>

    {#if error}
      <p class="error">{error}</p>
    {/if}
  </main>

  <div class="theme-row"><ThemeToggle /></div>
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
  .theme-row {
    width: min(24rem, 100%);
  }
  .lobby {
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
    padding: 0.6em 0.75em;
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
  }
  .primary {
    background: var(--halo-accent);
    color: #fff;
    border: none;
    border-radius: var(--halo-radius);
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
    padding: 0 1.2em;
    font-weight: 600;
  }
  .error {
    margin: 0;
    color: var(--halo-error);
    font-size: 0.9rem;
    text-align: center;
  }
</style>
