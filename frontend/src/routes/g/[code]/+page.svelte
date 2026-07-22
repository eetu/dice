<script lang="ts">
  import QrCode from "@lucide/svelte/icons/qr-code";
  import Settings from "@lucide/svelte/icons/settings";
  import { onMount } from "svelte";

  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { api, ApiError, type Mode, type YatzyCat } from "$lib/api";
  import DiceStage from "$lib/components/DiceStage.svelte";
  import FarkleBoard from "$lib/components/FarkleBoard.svelte";
  import LangToggle from "$lib/components/LangToggle.svelte";
  import LiarsBoard from "$lib/components/LiarsBoard.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import PlayerList from "$lib/components/PlayerList.svelte";
  import RollHistory from "$lib/components/RollHistory.svelte";
  import Select from "$lib/components/Select.svelte";
  import SharePanel from "$lib/components/SharePanel.svelte";
  import Switch from "$lib/components/Switch.svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import Toolbar from "$lib/components/Toolbar.svelte";
  import Wordmark from "$lib/components/Wordmark.svelte";
  import YatzyBoard from "$lib/components/YatzyBoard.svelte";
  import { DECKS } from "$lib/dice/decks";
  import { THEMES } from "$lib/dice/themes";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { diceAudio } from "$lib/stores/audio.svelte";
  import { farkle } from "$lib/stores/farkle.svelte";
  import { game } from "$lib/stores/game.svelte";
  import { liars } from "$lib/stores/liars.svelte";
  import { session } from "$lib/stores/session.svelte";
  import { shake } from "$lib/stores/shake.svelte";
  import { wakeLock } from "$lib/stores/wakelock";
  import { socket } from "$lib/stores/ws.svelte";
  import { yatzy } from "$lib/stores/yatzy.svelte";

  const code = $derived((page.params.code ?? "").toUpperCase());

  let phase = $state<
    "connecting" | "ready" | "notfound" | "error" | "ended" | "name"
  >("connecting");
  let myId = $state<string | null>(null);
  let showSettings = $state(false);
  let showShareModal = $state(false); // header code → share panel (all modes)
  let confirmLeave = $state(false); // leaving is destructive — confirm first
  let nameDraft = $state(""); // the name-prompt input (QR/link join, no stored name)

  const snap = $derived(game.snapshot);
  const players = $derived(snap?.players ?? []);
  const currentPlayer = $derived(snap ? (players[snap.turnIdx] ?? null) : null);
  const isMyTurn = $derived(!!myId && snap?.currentPlayerId === myId);
  const currentOffline = $derived(!!currentPlayer && !currentPlayer.connected);
  const mode = $derived(snap?.mode ?? "free");
  // Options with translated labels for the Select dropdowns.
  const themeOptions = $derived(
    THEMES.map((t) => ({
      name: t.name,
      label: i18n.m.themes[t.name] ?? t.label,
    })),
  );
  const deckOptions = $derived(
    DECKS.map((d) => ({
      name: d.name,
      label: i18n.m.decks[d.name] ?? d.label,
    })),
  );
  // The socket concluded the room is gone (server restart / expired) — surface
  // it instead of reconnecting forever.
  $effect(() => {
    if (socket.ended) phase = "ended";
  });
  const myName = $derived(
    players.find((p) => p.id === myId)?.name ?? session.name,
  );

  onMount(() => {
    // Joining fresh via QR/link with no stored name → ask for one first (a
    // returning member has creds + a name already, so connect straight away).
    if (!session.credsFor(code) && !session.name.trim()) {
      phase = "name";
    } else {
      connect();
    }
    shake.restore(); // re-arm shake from the stored on-device preference
    wakeLock.enable(); // keep the display awake during a slow round
    return () => {
      socket.disconnect();
      game.reset();
      liars.reset();
      yatzy.reset();
      farkle.reset();
      wakeLock.disable();
    };
  });

  async function connect() {
    phase = "connecting";
    game.reset();
    let creds = session.credsFor(code);
    if (creds) {
      // We think we're a member — verify the room still exists first.
      try {
        await api.getGame(code);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          session.clearCreds(code);
          creds = null;
        }
      }
    }
    if (!creds) {
      try {
        const c = await api.joinGame(code, session.name);
        creds = { playerId: c.playerId, token: c.token };
        session.saveCreds(code, creds);
      } catch (e) {
        phase =
          e instanceof ApiError && e.status === 404 ? "notfound" : "error";
        return;
      }
    }
    myId = creds.playerId;
    socket.connect(code, creds.token);
    phase = "ready";
  }

  function roll() {
    if (isMyTurn && !game.rolling) socket.send({ type: "roll" });
  }
  function setDice(count: number) {
    socket.send({ type: "setDiceCount", count });
  }
  function skip() {
    socket.send({ type: "skipTurn" });
  }
  function setDiceTheme(theme: string) {
    socket.send({ type: "setDiceTheme", theme });
  }
  function setDeck(deck: string) {
    socket.send({ type: "setDeck", deck });
  }
  async function toggleShake() {
    if (shake.enabled) {
      shake.disable();
    } else {
      diceAudio.unlock();
      await shake.enable();
    }
  }
  function reorder(order: string[]) {
    socket.send({ type: "reorder", order });
  }
  function setMode(m: Mode) {
    socket.send({ type: "setMode", mode: m });
  }
  function bid(quantity: number, face: number) {
    socket.send({ type: "bid", quantity, face });
  }
  function callLiar() {
    socket.send({ type: "callLiar" });
  }
  function nextRound() {
    socket.send({ type: "nextRound" });
  }
  function yatzyRoll() {
    socket.send({ type: "yatzyRoll" });
  }
  function yatzyHold(index: number) {
    socket.send({ type: "yatzyHold", index });
  }
  function yatzyScore(category: YatzyCat) {
    socket.send({ type: "yatzyScore", category });
  }
  function farkleRoll() {
    socket.send({ type: "farkleRoll" });
  }
  function farkleSetAside(keep: number[]) {
    socket.send({ type: "farkleSetAside", keep });
  }
  function farkleBank() {
    socket.send({ type: "farkleBank" });
  }
  function rename(name: string) {
    session.setName(name);
    socket.send({ type: "setName", name });
  }
  function renameFromInput(v: string) {
    const n = v.trim();
    if (n && n !== myName) rename(n);
  }
  function submitName() {
    session.setName(nameDraft.trim());
    connect();
  }
  async function leave() {
    confirmLeave = false;
    socket.send({ type: "leave" });
    session.clearCreds(code);
    socket.disconnect();
    await goto(resolve("/"));
  }
</script>

<div class="page" class:boarded={mode === "yatzy" || mode === "farkle"}>
  <header>
    <div class="hleft">
      <a class="home" href={resolve("/")} onclick={() => socket.disconnect()}
        ><Wordmark /></a
      >
      <span
        class="status"
        class:connected={socket.status === "connected"}
        role="img"
        aria-label={socket.status === "connected"
          ? i18n.m.connected
          : i18n.m.disconnected}
        title={socket.status === "connected"
          ? i18n.m.connected
          : i18n.m.disconnected}
      ></span>
    </div>
    <button
      class="code-chip"
      onclick={() => (showShareModal = true)}
      aria-label={i18n.m.invite}
      title={i18n.m.invite}
    >
      {code}
      <span class="qr"><QrCode size={14} /></span>
    </button>
    <div class="hright">
      <button
        class="gear"
        onclick={() => (showSettings = true)}
        aria-label={i18n.m.settings}
        title={i18n.m.settings}><Settings size={16} /></button
      >
      <button class="leave" onclick={() => (confirmLeave = true)}
        >{i18n.m.leave}</button
      >
    </div>
  </header>

  {#if phase === "notfound"}
    <div class="notice halo-card">
      <h2>{i18n.m.notFoundTitle}</h2>
      <p>{i18n.m.notFoundBody(code)}</p>
      <a class="btn" href={resolve("/")}>{i18n.m.backToStart}</a>
    </div>
  {:else if phase === "ended"}
    <div class="notice halo-card">
      <h2>{i18n.m.endedTitle}</h2>
      <p>{i18n.m.endedBody(code)}</p>
      <a class="btn" href={resolve("/")}>{i18n.m.backToStart}</a>
    </div>
  {:else if phase === "error"}
    <div class="notice halo-card">
      <h2>{i18n.m.errorTitle}</h2>
      <p>{i18n.m.errorBody}</p>
      <button class="btn" onclick={connect}>{i18n.m.retry}</button>
    </div>
  {:else if phase === "name"}
    <div class="notice halo-card">
      <h2>{i18n.m.joinPromptTitle}</h2>
      <form
        class="namegate"
        onsubmit={(e) => {
          e.preventDefault();
          submitName();
        }}
      >
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={nameDraft}
          placeholder={i18n.m.namePlaceholder}
          aria-label={i18n.m.yourName}
          maxlength="24"
          autocomplete="off"
          autofocus
        />
        <button type="submit">{i18n.m.join}</button>
      </form>
    </div>
  {:else if !snap}
    <div class="notice">{i18n.m.connecting}</div>
  {:else}
    {#if mode === "liars"}
      <div class="board">
        <LiarsBoard
          {myId}
          onBid={bid}
          onCall={callLiar}
          onNextRound={nextRound}
          onNewMatch={() => setMode("liars")}
        />
      </div>
    {:else if mode === "yatzy"}
      <div class="board">
        <YatzyBoard
          {myId}
          onRoll={yatzyRoll}
          onHold={yatzyHold}
          onScore={yatzyScore}
          onNewMatch={() => setMode("yatzy")}
        />
      </div>
    {:else if mode === "farkle"}
      <div class="board">
        <FarkleBoard
          {myId}
          onRoll={farkleRoll}
          onSetAside={farkleSetAside}
          onBank={farkleBank}
          onNewMatch={() => setMode("farkle")}
        />
      </div>
    {:else}
      <div class="grid">
        <section class="stage-col">
          <div class="stage-face">
            <DiceStage
              lastRoll={game.lastRoll}
              diceCount={snap.diceCount}
              diceTheme={snap.diceTheme}
              deck={snap.deck}
              canRoll={isMyTurn && !game.rolling}
              rolling={game.rolling}
              onRoll={roll}
              onSettled={() => game.endRoll()}
            />
            {#if currentPlayer}
              <div class="turn-overlay" class:mine={isMyTurn}>
                {isMyTurn ? i18n.m.yourTurn : currentPlayer.name}
              </div>
            {/if}
          </div>
          <Toolbar
            {isMyTurn}
            currentName={currentPlayer?.name ?? null}
            {currentOffline}
            rolling={game.rolling}
            onRoll={roll}
            onSkip={skip}
          />
        </section>

        <aside class="side">
          <PlayerList
            {players}
            turnIdx={snap.turnIdx}
            {myId}
            onReorder={reorder}
            onRename={rename}
          />
          <RollHistory history={snap.history} />
        </aside>
      </div>
    {/if}

    <Modal
      open={showSettings}
      label={i18n.m.settings}
      onClose={() => (showSettings = false)}
    >
      <div class="setting-col">
        <span>{i18n.m.yourName}</span>
        <input
          class="name-input"
          value={myName}
          onblur={(e) => renameFromInput(e.currentTarget.value)}
          onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          maxlength="24"
          placeholder={i18n.m.namePlaceholder}
          aria-label={i18n.m.yourName}
          autocomplete="off"
        />
      </div>
      <div class="setting-col">
        <span>{i18n.m.game}</span>
        <div class="seg" role="group" aria-label={i18n.m.game}>
          <button
            class:on={mode === "free"}
            aria-pressed={mode === "free"}
            onclick={() => setMode("free")}
          >
            {i18n.m.freeDice}
          </button>
          <button
            class:on={mode === "liars"}
            aria-pressed={mode === "liars"}
            onclick={() => setMode("liars")}
          >
            {i18n.m.liarsDice}
          </button>
          <button
            class:on={mode === "yatzy"}
            aria-pressed={mode === "yatzy"}
            onclick={() => setMode("yatzy")}
          >
            {i18n.m.yatzyDice}
          </button>
          <button
            class:on={mode === "farkle"}
            aria-pressed={mode === "farkle"}
            onclick={() => setMode("farkle")}
          >
            {i18n.m.farkleDice}
          </button>
        </div>
      </div>
      {#if mode === "free"}
        <div class="setting">
          <span>{i18n.m.diceCount}</span>
          <div class="stepper">
            <button
              aria-label={i18n.m.fewer}
              onclick={() => setDice(snap.diceCount - 1)}
              disabled={snap.diceCount <= 1}>−</button
            >
            <span class="count">{snap.diceCount}</span>
            <button
              aria-label={i18n.m.more}
              onclick={() => setDice(snap.diceCount + 1)}
              disabled={snap.diceCount >= 8}>+</button
            >
          </div>
        </div>
        <Select
          label={i18n.m.diceSelectLabel}
          value={snap.diceTheme}
          options={themeOptions}
          onChange={setDiceTheme}
        />
        <Select
          label={i18n.m.tableSelectLabel}
          value={snap.deck}
          options={deckOptions}
          onChange={setDeck}
        />
      {/if}
      <div class="setting-col">
        <span>{i18n.m.appearance}</span>
        <ThemeToggle />
      </div>
      <div class="setting-col">
        <span>{i18n.m.language}</span>
        <LangToggle />
      </div>
      <div class="setting">
        <span>{i18n.m.sound}</span>
        <Switch
          checked={!diceAudio.muted}
          label={i18n.m.sound}
          onChange={() => diceAudio.toggleMute()}
        />
      </div>
      {#if shake.supported}
        <div class="setting">
          <span>{i18n.m.shakeSetting}</span>
          <Switch
            checked={shake.enabled}
            label={i18n.m.shakeSetting}
            onChange={toggleShake}
          />
        </div>
      {/if}
    </Modal>
  {/if}

  <Modal
    open={showShareModal}
    label={i18n.m.invite}
    onClose={() => (showShareModal = false)}
  >
    <SharePanel {code} />
  </Modal>

  <Modal
    open={confirmLeave}
    label={i18n.m.leaveTitle}
    onClose={() => (confirmLeave = false)}
  >
    <p class="confirm-body">{i18n.m.leaveBody}</p>
    <div class="confirm-actions">
      <button class="ghost" onclick={() => (confirmLeave = false)}>
        {i18n.m.cancel}
      </button>
      <button class="danger" onclick={leave}>{i18n.m.leave}</button>
    </div>
  </Modal>
</div>

<style>
  .page {
    position: relative;
    z-index: 1;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    max-width: 1100px;
    margin: 0 auto;
  }
  /* 3-column grid so the code stays dead-centre regardless of the side widths. */
  header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .hleft {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }
  .hright {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    justify-self: end;
  }
  .home {
    text-decoration: none;
  }
  /* The room code doubles as the invite button (QR icon → share panel). */
  .code-chip {
    justify-self: center;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 44px;
    padding: 0 0.8rem;
    /* Solid pill so the backdrop doesn't bleed through, matching .gear/.leave. */
    background: var(--halo-bg-main);
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius-pill);
    cursor: pointer;
    font-family: var(--halo-font-heading);
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: 0.15em;
    color: var(--halo-text-main);
  }
  .code-chip .qr {
    display: inline-flex;
    color: var(--halo-accent);
  }
  .code-chip:hover .qr {
    filter: brightness(1.1);
  }
  .status {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--halo-disconnected);
  }
  .status.connected {
    background: var(--halo-connected);
  }
  .leave {
    background: var(--halo-bg-main);
    border: 1px solid var(--halo-border);
    color: var(--halo-text-muted);
    border-radius: var(--halo-radius-pill);
    min-height: 44px;
    padding: 0.35em 0.9em;
    font-size: 0.85rem;
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 22rem;
    gap: 1rem;
  }
  /* Liar's Dice board fills the same space as the free-mode grid. */
  .board {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .board :global(.liars),
  .board :global(.yatzy),
  .board :global(.farkle) {
    flex: 1;
    min-width: 0;
  }
  .stage-col {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .gear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--halo-bg-main);
    border: 1px solid var(--halo-border);
    color: var(--halo-text-muted);
    border-radius: var(--halo-radius-pill);
    min-width: 44px;
    min-height: 44px;
    padding: 0.4em 0.6em;
  }
  .gear:hover {
    color: var(--halo-text-main);
  }
  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.9rem;
    color: var(--halo-text-muted);
  }
  /* A stacked label + full-width control (matches Select's field layout) — used
     for the segmented Appearance control. */
  .setting-col {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .setting-col > span {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--halo-text-muted);
  }
  .name-input {
    font: inherit;
    font-size: 0.95rem;
    width: 100%;
    color: var(--halo-text-main);
    background: var(--halo-bg-light);
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    padding: 0.55em 0.7em;
  }
  .name-input:focus {
    border-color: var(--halo-accent);
  }
  /* Keep the global accent ring for keyboard focus; drop it only for pointer. */
  .name-input:focus:not(:focus-visible) {
    outline: none;
  }
  /* Game selector — 2×2 grid so four games fit without overflowing. */
  .seg {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.4rem;
  }
  .seg button {
    min-height: 44px;
    padding: 0.55em 0.4em;
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
    font-size: 0.9rem;
  }
  .seg button.on {
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    border-color: var(--halo-accent);
    font-weight: 600;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .stepper button {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--halo-radius);
    border: 1px solid var(--halo-border);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
    font-size: 1.2rem;
    line-height: 1;
  }
  .stepper button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .stepper .count {
    min-width: 1.5rem;
    text-align: center;
    color: var(--halo-text-main);
  }

  /* The felt fills the stage column above the toolbar; the turn overlay sits on
     top of it. Invites live on the header code-chip (QR), so there's no in-stage
     invite panel. */
  .stage-face {
    position: relative;
    flex: 1;
    min-height: 16rem;
    /* Soft scrim in the page colour so the ambient die-face backdrop is calm behind
       the (transparent) dice and the turn text; fades out so it never reads as a box. */
    background: radial-gradient(
      120% 92% at 50% 44%,
      var(--halo-body) 46%,
      transparent 100%
    );
  }
  .side {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  /* Current player's name, overlaid on the felt (top-center). */
  .turn-overlay {
    position: absolute;
    top: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Dark translucent pill so it stays legible on any felt (green/red/steel…). */
    background: rgba(10, 10, 14, 0.72);
    color: #fff;
    border-radius: var(--halo-radius-pill);
    padding: 0.3em 0.85em;
    font-size: 0.9rem;
    font-weight: 600;
    backdrop-filter: blur(2px);
    pointer-events: none;
  }
  .turn-overlay.mine {
    color: var(--halo-accent);
  }
  .notice {
    text-align: center;
    padding: 2rem;
    color: var(--halo-text-muted);
  }
  .notice.halo-card {
    max-width: 26rem;
    margin: 3rem auto;
    color: var(--halo-text-main);
  }
  .btn {
    display: inline-block;
    margin-top: 1rem;
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    text-decoration: none;
    border: none;
    border-radius: var(--halo-radius);
    padding: 0.6em 1.2em;
    font-weight: 600;
  }
  .namegate {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .namegate input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 1rem;
    padding: 0.6em 0.75em;
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
  }
  .namegate button {
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    border: none;
    border-radius: var(--halo-radius);
    min-height: 44px;
    padding: 0 1.2em;
    font-weight: 600;
  }
  /* Leave-confirm dialog */
  .confirm-body {
    margin: 0;
    color: var(--halo-text-muted);
    font-size: 0.95rem;
    line-height: 1.45;
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
  }
  .confirm-actions button {
    border-radius: var(--halo-radius);
    padding: 0.6em 1.2em;
    font-weight: 600;
    font-size: 0.95rem;
  }
  .confirm-actions .ghost {
    background: var(--halo-bg-light);
    border: 1px solid var(--halo-border);
    color: var(--halo-text-main);
  }
  /* Explicit red (not --halo-error: it's tomato/pink, not button-safe with white
     text). Readable white-on-red in both themes. */
  .confirm-actions .danger {
    background: #dc2626;
    border: 1px solid #dc2626;
    color: #fff;
  }
  @media (max-width: 820px) {
    /* App-fill: the felt expands to fill between the header and the bottom Roll
       button; the full player list + history are hidden (turn is shown on the
       felt overlay). Page can still grow + scroll on very short screens. */
    .page {
      height: auto;
      min-height: 100dvh;
      /* Tighter gutters on a phone — more room for the felt / scorecard. */
      padding: 0.6rem;
    }
    header {
      margin-bottom: 0.6rem;
    }
    /* Yatzy keeps a fixed viewport so its scorecard scrolls INSIDE the board and
       the dice + roll stay pinned as a footer (they'd otherwise fall below the
       fold on a phone). */
    .page.boarded {
      height: 100dvh;
      min-height: 0;
      overflow: hidden;
    }
    .grid {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr;
    }
    .side {
      display: none;
    }
  }
</style>
