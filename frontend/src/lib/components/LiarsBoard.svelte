<script lang="ts">
  // Mobile-first Liar's Dice board (Classic quantity+face rules). Reads the
  // personalized `liars` view (your own cup in full, others by count) + player
  // names from the game snapshot; reports intent via callbacks.
  import Trophy from "@lucide/svelte/icons/trophy";

  import Fireworks from "$lib/components/Fireworks.svelte";
  import WinnerGlow from "$lib/components/WinnerGlow.svelte";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { diceAudio } from "$lib/stores/audio.svelte";
  import { game } from "$lib/stores/game.svelte";
  import { liars } from "$lib/stores/liars.svelte";

  type Props = {
    myId: string | null;
    onBid: (quantity: number, face: number) => void;
    onCall: () => void;
    onNextRound: () => void;
    onNewMatch: () => void;
  };
  let { myId, onBid, onCall, onNextRound, onNewMatch }: Props = $props();

  // 3x3 pip layout per face (grid cells 1..9, row-major).
  const CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const PIPS: Record<number, number[]> = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };

  const view = $derived(liars.view);
  const players = $derived(game.snapshot?.players ?? []);
  function nameOf(id: string | null): string {
    if (!id) return i18n.m.someone;
    if (id === myId) return i18n.m.you;
    return players.find((p) => p.id === id)?.name ?? i18n.m.playerFallback;
  }

  const isMyTurn = $derived(!!view && !!myId && view.currentPlayerId === myId);
  const opponents = $derived(
    (view?.players ?? []).filter((p) => p.playerId !== myId),
  );

  // A fresh hand was dealt (match start or a new round) whenever we (re-)enter the
  // bidding phase — tumble your cup and play the roll sound.
  let dealAnim = $state(0);
  let prevPhase: string | null = null;
  $effect(() => {
    const v = liars.view;
    if (!v) {
      prevPhase = null;
      return;
    }
    if (v.phase === "bidding" && prevPhase !== "bidding") {
      dealAnim++;
      diceAudio.roll();
    }
    prevPhase = v.phase;
  });

  // Bid draft — reset to the smallest legal raise whenever the state changes.
  let draftQty = $state(1);
  let draftFace = $state(2);
  $effect(() => {
    const v = liars.view;
    if (!v || v.phase !== "bidding") return;
    if (v.bid) {
      if (v.bid.face < 6) {
        draftQty = v.bid.quantity;
        draftFace = v.bid.face + 1;
      } else {
        draftQty = Math.min(v.totalDice, v.bid.quantity + 1);
        draftFace = 1;
      }
    } else {
      draftQty = 1;
      draftFace = 2;
    }
  });

  const validBid = $derived.by(() => {
    const v = liars.view;
    if (!v) return false;
    if (draftQty < 1 || draftQty > v.totalDice) return false;
    if (!v.bid) return true;
    return (
      draftQty > v.bid.quantity ||
      (draftQty === v.bid.quantity && draftFace > v.bid.face)
    );
  });

  function stepQty(d: number) {
    const max = view?.totalDice ?? 1;
    draftQty = Math.max(1, Math.min(max, draftQty + d));
  }

  // Picking a bid face blips (a die selection, shared with the other games).
  function pickFace(f: number) {
    if (f !== draftFace) diceAudio.blip();
    draftFace = f;
  }

  const revealText = $derived.by(() => {
    const r = view?.reveal;
    if (!r) return "";
    return i18n.m.liarsReveal(
      nameOf(r.callerId),
      r.actual,
      r.bidWasTrue,
      nameOf(r.loserId),
      r.loserId === myId,
    );
  });
</script>

{#snippet face(f: number)}
  <span class="die">
    {#each CELLS as c (c)}
      <span class="pip" class:on={PIPS[f].includes(c)}></span>
    {/each}
  </span>
{/snippet}

<div class="liars">
  {#if !view}
    <p class="muted">{i18n.m.dealing}</p>
  {:else if view.phase === "over"}
    <div class="over">
      <WinnerGlow />
      <Fireworks />
      <div class="over-content">
        <p class="crown"><Trophy size={44} /></p>
        <h2>{i18n.m.liarsWin(nameOf(view.winner), view.winner === myId)}</h2>
        <button class="primary" onclick={onNewMatch}>{i18n.m.playAgain}</button>
      </div>
    </div>
  {:else}
    <!-- The "table": opponents seated around a central bid pedestal, filling the
      space between the header and your seat below. -->
    <div class="table">
      <div class="seats">
        {#each opponents as p (p.playerId)}
          <div
            class="seat"
            class:turn={view.currentPlayerId === p.playerId}
            class:out={p.out}
          >
            <span class="seat-name">{nameOf(p.playerId)}</span>
            <div class="cups">
              {#if p.out}
                <span class="knocked">{i18n.m.outShort}</span>
              {:else}
                {#each Array.from({ length: p.diceCount }) as _, i (i)}
                  <span class="cup"></span>
                {/each}
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <div class="center">
        {#if view.phase === "reveal" && view.reveal}
          <!-- Reveal: every cup shown + the verdict. -->
          <div class="reveal">
            <p class="verdict">{revealText}</p>
            <div class="hands">
              {#each view.reveal.hands as h (h.playerId)}
                <div class="rhand" class:mine={h.playerId === myId}>
                  <span class="rname">{nameOf(h.playerId)}</span>
                  <div class="rdice">
                    {#each h.dice as d, i (i)}
                      <span
                        class="wrap"
                        class:hit={!!view.reveal && d === view.reveal.bid.face}
                        class:wild={!!view.reveal &&
                          view.reveal.bid.face !== 1 &&
                          d === 1}>{@render face(d)}</span
                      >
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
            <button class="primary" onclick={onNextRound}
              >{i18n.m.nextRound}</button
            >
          </div>
        {:else}
          <!-- Standing bid pedestal — the round's progress at a glance. -->
          <div class="pedestal">
            {#if view.bid}
              <div class="bid-amount">
                <span class="qty">{view.bid.quantity}</span>
                <span class="times">×</span>
                {@render face(view.bid.face)}
              </div>
              <span class="bid-who"
                >{i18n.m.bids(
                  nameOf(view.bid.playerId),
                  view.bid.playerId === myId,
                )}</span
              >
            {:else}
              <span class="bid-open"
                >{i18n.m.toOpen(
                  nameOf(view.currentPlayerId),
                  view.currentPlayerId === myId,
                )}</span
              >
            {/if}
            <span class="turnline" class:mine={isMyTurn}>
              {isMyTurn
                ? i18n.m.yourTurn
                : i18n.m.waitingFor(nameOf(view.currentPlayerId))}
            </span>
          </div>
        {/if}
      </div>

      <span class="in-play">{i18n.m.diceInPlay(view.totalDice)}</span>
    </div>

    <!-- Your seat: your dice + bidding controls (thumb-reachable). -->
    <div class="you" class:my-turn={isMyTurn}>
      <div class="your-dice">
        {#if view.yourDice.length}
          <!-- Re-keys on each deal so the cup tumbles when a new hand is dealt;
               `--i` staggers them so they cascade in. -->
          {#each view.yourDice as d, i (i)}{#key dealAnim}<span
                class="dieanim tumble"
                style="--i:{i}; --dir:{i % 2 ? 1 : -1}">{@render face(d)}</span
              >{/key}{/each}
        {:else}
          <span class="knocked">{i18n.m.spectating}</span>
        {/if}
      </div>

      {#if view.phase === "bidding" && view.yourDice.length && isMyTurn}
        <div class="controls">
          <div class="row">
            <div class="qty-step">
              <button
                aria-label={i18n.m.fewer}
                onclick={() => stepQty(-1)}
                disabled={draftQty <= 1}>−</button
              >
              <span class="n">{draftQty}</span>
              <button
                aria-label={i18n.m.more}
                onclick={() => stepQty(1)}
                disabled={draftQty >= view.totalDice}>+</button
              >
            </div>
            <div class="facepick">
              {#each [1, 2, 3, 4, 5, 6] as f (f)}
                <button
                  class="fp"
                  class:sel={draftFace === f}
                  aria-pressed={draftFace === f}
                  aria-label={i18n.m.faceAria(f)}
                  onclick={() => pickFace(f)}>{@render face(f)}</button
                >
              {/each}
            </div>
          </div>
          <div class="actions">
            <button
              class="bid"
              disabled={!validBid}
              onclick={() => onBid(draftQty, draftFace)}
            >
              {i18n.m.bidLabel(draftQty)}
              {@render face(draftFace)}
            </button>
            <button class="liar" disabled={!view.bid} onclick={onCall}>
              {i18n.m.liar}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .liars {
    position: relative;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .muted {
    color: var(--halo-text-muted);
    text-align: center;
    margin: auto;
  }

  /* The felt table fills the space between the header and your seat. A soft
     radial scrim lifts the seats + pedestal off the ambient dice backdrop. */
  .table {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem;
    border-radius: var(--halo-radius);
    background: radial-gradient(
      120% 90% at 50% 42%,
      var(--halo-body) 45%,
      transparent 100%
    );
  }

  /* Opponent seats, pinned near the top of the felt; wrap for large tables. */
  .seats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
    flex-shrink: 0;
  }
  .seat {
    min-width: 6rem;
    max-width: 12rem;
    padding: 0.5rem 0.7rem;
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    border: 1px solid transparent;
    text-align: center;
  }
  .seat.turn {
    border-color: var(--halo-accent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--halo-accent) 28%, transparent);
  }
  .seat.out {
    opacity: 0.5;
  }
  .seat-name {
    display: block;
    font-size: 0.85rem;
    color: var(--halo-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .seat.turn .seat-name {
    color: var(--halo-accent);
    font-weight: 600;
  }
  .cups {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    justify-content: center;
    margin-top: 0.4rem;
    min-height: 1rem;
  }
  .cup {
    width: 0.95rem;
    height: 0.95rem;
    border-radius: 4px;
    background: var(--halo-off-bg);
    box-shadow: inset 0 0 0 1px var(--halo-border);
  }
  .knocked {
    font-size: 0.8rem;
    color: var(--halo-text-muted);
    font-style: italic;
  }

  /* The central area grows to fill the felt and centers the pedestal / reveal. */
  .center {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: auto;
  }
  .pedestal {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 1rem 1.6rem;
    background: var(--halo-bg-main);
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    box-shadow: var(--halo-shadow);
    text-align: center;
  }
  .bid-amount {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--halo-font-heading);
  }
  .bid-amount .qty {
    font-size: 2.1rem;
    font-weight: 700;
    line-height: 1;
  }
  .bid-amount .times {
    color: var(--halo-text-muted);
    font-size: 1.2rem;
  }
  .bid-who,
  .bid-open {
    color: var(--halo-text-muted);
  }
  .bid-open {
    font-size: 1.1rem;
  }
  .turnline {
    font-size: 0.85rem;
    color: var(--halo-text-muted);
  }
  .turnline.mine {
    color: var(--halo-accent);
    font-weight: 600;
  }
  .in-play {
    flex-shrink: 0;
    text-align: center;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--halo-text-muted);
  }

  /* Reveal panel (replaces the pedestal during the reveal phase). */
  .reveal {
    width: min(24rem, 100%);
    background: var(--halo-bg-main);
    border: 1px solid var(--halo-border);
    border-radius: var(--halo-radius);
    box-shadow: var(--halo-shadow);
    padding: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    text-align: center;
  }
  .verdict {
    margin: 0;
    font-weight: 600;
  }
  .hands {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .rhand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .rname {
    flex: 0 0 5rem;
    text-align: right;
    font-size: 0.85rem;
    color: var(--halo-text-muted);
  }
  .rhand.mine .rname {
    color: var(--halo-accent);
    font-weight: 600;
  }
  .rdice {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .wrap {
    opacity: 0.45;
  }
  .wrap.hit,
  .wrap.wild {
    opacity: 1;
  }
  /* A 1 counting as a wild for the bid face. */
  .wrap.wild .die {
    box-shadow: inset 0 0 0 2px var(--halo-accent);
  }

  /* Your seat — the bottom tray: your dice + the bidding controls. */
  .you {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: center;
    padding-top: 0.75rem;
    padding-bottom: env(safe-area-inset-bottom, 0);
    border-top: 1px solid var(--halo-border);
  }
  .your-dice {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
    width: fit-content;
    max-width: 100%;
    padding: 0.5rem 0.9rem;
    background: var(--halo-bg-light);
    border-radius: var(--halo-radius);
    border: 1px solid transparent;
    perspective: 700px; /* depth for the deal tumble */
  }
  .you.my-turn .your-dice {
    border-color: var(--halo-accent);
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 100%;
    max-width: 26rem;
  }
  .row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
  }
  .qty-step {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .qty-step button {
    width: 2.75rem;
    height: 2.75rem;
    font-size: 1.4rem;
    border-radius: var(--halo-radius);
    border: 1px solid var(--halo-border);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
  }
  .qty-step button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .qty-step .n {
    min-width: 1.5rem;
    text-align: center;
    font-size: 1.5rem;
    font-family: var(--halo-font-heading);
    font-weight: 700;
  }
  .facepick {
    display: flex;
    gap: 0.4rem;
  }
  /* The die itself is the button — no wrapping border/background box. */
  .fp {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    border: none;
    background: none;
    border-radius: 10px;
    transition:
      transform var(--halo-d-fast),
      box-shadow var(--halo-d-fast);
  }
  /* Selected face: lift + accent ring on the die itself (not hue-only). */
  .fp.sel {
    transform: translateY(-4px);
  }
  .fp.sel .die {
    box-shadow: inset 0 0 0 2px var(--halo-accent);
    background: var(--halo-accent-soft);
  }
  .actions {
    display: flex;
    gap: 0.6rem;
  }
  .actions .bid {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4em;
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    border: none;
    border-radius: var(--halo-radius);
    padding: 0.9em 1em;
    font-size: 1.05rem;
    font-weight: 600;
  }
  .actions .bid:disabled {
    background: var(--halo-off-bg);
    color: var(--halo-text-muted);
    cursor: default;
  }
  .actions .liar {
    flex: 0 0 auto;
    /* Solid fill so the backdrop doesn't show through the outlined danger button. */
    background: var(--halo-bg-light);
    border: 2px solid var(--halo-error);
    color: var(--halo-error);
    border-radius: var(--halo-radius);
    padding: 0.9em 1.2em;
    font-size: 1.05rem;
    font-weight: 700;
  }
  .actions .liar:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Winner — fills the board so the fireworks fill the background. */
  .over {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    text-align: center;
  }
  .over-content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
    padding: 1rem;
  }
  .crown {
    margin: 0;
    color: var(--halo-accent);
    line-height: 1;
  }
  .over h2 {
    margin: 0;
  }
  .over .primary,
  .reveal .primary {
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    border: none;
    border-radius: var(--halo-radius);
    padding: 0.8em 1.5em;
    font-size: 1.05rem;
    font-weight: 600;
    align-self: center;
  }

  /* Die face (3x3 pips) */
  .die {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    width: 2.4rem;
    height: 2.4rem;
    padding: 0.28rem;
    background: var(--halo-bg-main);
    border-radius: 8px;
    box-shadow: inset 0 0 0 1px var(--halo-border);
    box-sizing: border-box;
  }
  .pip {
    border-radius: 50%;
  }
  .pip.on {
    background: var(--halo-text-main);
    align-self: center;
    justify-self: center;
    width: 0.32rem;
    height: 0.32rem;
  }
  /* Bigger die inside the bid pedestal — it's the headline. */
  .bid-amount .die {
    width: 2.8rem;
    height: 2.8rem;
    padding: 0.32rem;
  }
  .bid-amount .pip.on {
    width: 0.38rem;
    height: 0.38rem;
  }
  /* Smaller dice inside the reveal + bid button. The face picker uses the
     full-size die (it's the tap target itself, no surrounding box). */
  .rdice .die,
  .actions .bid .die {
    width: 1.6rem;
    height: 1.6rem;
    padding: 0.18rem;
  }
  .rdice .pip.on,
  .actions .bid .pip.on {
    width: 0.22rem;
    height: 0.22rem;
  }
  /* On the accent bid button: a subtle dark tile with dark (on-accent) pips. */
  .actions .bid .die {
    background: rgba(0, 0, 0, 0.14);
    box-shadow: none;
  }
  .actions .bid .pip.on {
    background: var(--halo-on-accent);
  }
  /* When disabled the button turns grey — restore a normal readable die (the old
     white-pips-on-grey rendered as an invisible die). */
  .actions .bid:disabled .die {
    background: var(--halo-bg-main);
    box-shadow: inset 0 0 0 1px var(--halo-border);
  }
  .actions .bid:disabled .pip.on {
    background: var(--halo-text-muted);
  }
</style>
