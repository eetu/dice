<script lang="ts">
  // Mobile-first Liar's Dice board (Classic quantity+face rules). Reads the
  // personalized `liars` view (your own cup in full, others by count) + player
  // names from the game snapshot; reports intent via callbacks.
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
    if (!id) return "Someone";
    if (id === myId) return "You";
    return players.find((p) => p.id === id)?.name ?? "Player";
  }

  const isMyTurn = $derived(!!view && !!myId && view.currentPlayerId === myId);
  const opponents = $derived(
    (view?.players ?? []).filter((p) => p.playerId !== myId),
  );

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

  const revealText = $derived.by(() => {
    const r = view?.reveal;
    if (!r) return "";
    const verdict = r.bidWasTrue ? "the bid held" : "the bid was a bluff";
    return `${nameOf(r.callerId)} called liar — there ${r.actual === 1 ? "was" : "were"} ${r.actual}, so ${verdict}. ${nameOf(r.loserId)} lose${r.loserId === myId ? "" : "s"} a die.`;
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
    <p class="muted">Dealing…</p>
  {:else if view.phase === "over"}
    <div class="over">
      <p class="crown">🏆</p>
      <h2>{nameOf(view.winner)} win{view.winner === myId ? "" : "s"}!</h2>
      <button class="primary" onclick={onNewMatch}>Play again</button>
    </div>
  {:else}
    <!-- Opponents: face-down cups + counts -->
    <div class="opponents">
      {#each opponents as p (p.playerId)}
        <div
          class="opp"
          class:turn={view.currentPlayerId === p.playerId}
          class:out={p.out}
        >
          <span class="opp-name">{nameOf(p.playerId)}</span>
          <div class="cups">
            {#if p.out}
              <span class="knocked">out</span>
            {:else}
              {#each Array.from({ length: p.diceCount }) as _, i (i)}
                <span class="cup"></span>
              {/each}
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- Standing bid -->
    <div class="bidline">
      {#if view.bid}
        <span class="who">{nameOf(view.bid.playerId)} bids</span>
        <span class="claim">{view.bid.quantity} ×</span>
        {@render face(view.bid.face)}
      {:else}
        <span class="muted">{nameOf(view.currentPlayerId)} to open</span>
      {/if}
      <span class="total">{view.totalDice} dice in play · 1s are wild</span>
    </div>

    <!-- Reveal -->
    {#if view.phase === "reveal" && view.reveal}
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
        <button class="primary" onclick={onNextRound}>Next round</button>
      </div>
    {/if}

    <!-- Your cup + bidding controls (thumb-reachable) -->
    <div class="you">
      <div class="your-dice" class:my-turn={isMyTurn}>
        {#if view.yourDice.length}
          {#each view.yourDice as d, i (i)}{@render face(d)}{/each}
        {:else}
          <span class="knocked">You're out — spectating</span>
        {/if}
      </div>

      {#if view.phase === "bidding" && view.yourDice.length}
        {#if isMyTurn}
          <div class="controls">
            <div class="row">
              <div class="qty">
                <button
                  aria-label="Fewer"
                  onclick={() => stepQty(-1)}
                  disabled={draftQty <= 1}>−</button
                >
                <span class="n">{draftQty}</span>
                <button
                  aria-label="More"
                  onclick={() => stepQty(1)}
                  disabled={draftQty >= view.totalDice}>+</button
                >
              </div>
              <div class="facepick">
                {#each [1, 2, 3, 4, 5, 6] as f (f)}
                  <button
                    class="fp"
                    class:sel={draftFace === f}
                    aria-label={`Face ${f}`}
                    onclick={() => (draftFace = f)}>{@render face(f)}</button
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
                Bid {draftQty} × {@render face(draftFace)}
              </button>
              <button class="liar" disabled={!view.bid} onclick={onCall}>
                Liar!
              </button>
            </div>
          </div>
        {:else}
          <p class="waiting">Waiting for {nameOf(view.currentPlayerId)}…</p>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .liars {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .muted {
    color: var(--halo-text-muted);
    text-align: center;
    margin: auto;
  }

  /* Opponents */
  .opponents {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
  }
  .opp {
    flex: 1 1 auto;
    min-width: 7rem;
    max-width: 14rem;
    padding: 0.6rem 0.75rem;
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    border: 1px solid transparent;
  }
  .opp.turn {
    border-color: var(--halo-accent);
    box-shadow: inset 3px 0 0 var(--halo-accent);
  }
  .opp.out {
    opacity: 0.5;
  }
  .opp-name {
    font-size: 0.85rem;
    color: var(--halo-text-muted);
  }
  .cups {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.35rem;
    min-height: 1.1rem;
  }
  .cup {
    width: 1rem;
    height: 1rem;
    border-radius: 4px;
    background: var(--halo-off-bg);
    box-shadow: inset 0 0 0 1px var(--halo-border);
  }
  .knocked {
    font-size: 0.8rem;
    color: var(--halo-text-muted);
    font-style: italic;
  }

  /* Standing bid */
  .bidline {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem;
    font-size: 1.1rem;
  }
  .bidline .claim {
    font-weight: 700;
    font-family: var(--halo-font-heading);
  }
  .bidline .total {
    flex-basis: 100%;
    text-align: center;
    font-size: 0.8rem;
    color: var(--halo-text-muted);
  }

  /* Reveal */
  .reveal {
    background: var(--halo-bg-light);
    border-radius: var(--halo-radius);
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
  .wrap.hit {
    opacity: 1;
  }
  /* A 1 counting as a wild for the bid face. */
  .wrap.wild {
    opacity: 1;
  }
  .wrap.wild .die {
    box-shadow: inset 0 0 0 2px var(--halo-accent);
  }

  /* Your area */
  .you {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .your-dice {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
    padding: 0.75rem;
    background: var(--halo-bg-light);
    border-radius: var(--halo-radius);
    border: 1px solid transparent;
  }
  .your-dice.my-turn {
    border-color: var(--halo-accent);
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
  }
  .qty {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .qty button {
    width: 2.6rem;
    height: 2.6rem;
    font-size: 1.4rem;
    border-radius: var(--halo-radius);
    border: 1px solid var(--halo-border);
    background: var(--halo-bg-light);
    color: var(--halo-text-main);
  }
  .qty button:disabled {
    opacity: 0.4;
  }
  .qty .n {
    min-width: 1.5rem;
    text-align: center;
    font-size: 1.5rem;
    font-family: var(--halo-font-heading);
    font-weight: 700;
  }
  .facepick {
    display: flex;
    gap: 0.3rem;
  }
  .fp {
    padding: 0.3rem;
    border-radius: var(--halo-radius);
    border: 1px solid var(--halo-border);
    background: var(--halo-bg-light);
  }
  .fp.sel {
    border-color: var(--halo-accent);
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
    color: #fff;
    border: none;
    border-radius: var(--halo-radius);
    padding: 0.9em 1em;
    font-size: 1.05rem;
    font-weight: 600;
  }
  .actions .bid:disabled {
    background: var(--halo-off-bg);
    color: var(--halo-text-muted);
  }
  .actions .liar {
    flex: 0 0 auto;
    background: none;
    border: 2px solid var(--halo-error);
    color: var(--halo-error);
    border-radius: var(--halo-radius);
    padding: 0.9em 1.2em;
    font-size: 1.05rem;
    font-weight: 700;
  }
  .actions .liar:disabled {
    opacity: 0.4;
  }
  .waiting {
    text-align: center;
    color: var(--halo-text-muted);
    margin: 0;
  }

  /* Winner */
  .over {
    margin: auto;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
  }
  .crown {
    font-size: 2.5rem;
    margin: 0;
  }
  .over h2 {
    margin: 0;
  }
  .over .primary,
  .reveal .primary {
    background: var(--halo-accent);
    color: #fff;
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
  /* Smaller dice inside the bid line + face picker + reveal + button. */
  .bidline .die,
  .fp .die,
  .rdice .die,
  .actions .bid .die {
    width: 1.6rem;
    height: 1.6rem;
    padding: 0.18rem;
  }
  .bidline .pip.on,
  .fp .pip.on,
  .rdice .pip.on,
  .actions .bid .pip.on {
    width: 0.22rem;
    height: 0.22rem;
  }
  .actions .bid .die {
    background: rgba(255, 255, 255, 0.2);
    box-shadow: none;
  }
  .actions .bid .pip.on {
    background: #fff;
  }
</style>
