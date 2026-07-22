<script lang="ts">
  // Mobile-first Farkle board. Reads the public `farkle` view; the scoreboard is a
  // wrapping row of chips (one number per player) so it never needs a horizontal
  // scroll. Tap scoring dice to set them aside, then bank or push your luck.
  import Trophy from "@lucide/svelte/icons/trophy";

  import Fireworks from "$lib/components/Fireworks.svelte";
  import { scoreSelection } from "$lib/games/farkle";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { diceAudio } from "$lib/stores/audio.svelte";
  import { farkle } from "$lib/stores/farkle.svelte";
  import { game } from "$lib/stores/game.svelte";

  type Props = {
    myId: string | null;
    onRoll: () => void;
    onSetAside: (keep: number[]) => void;
    onBank: () => void;
    onNewMatch: () => void;
  };
  let { myId, onRoll, onSetAside, onBank, onNewMatch }: Props = $props();

  const CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const PIPS: Record<number, number[]> = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };

  const view = $derived(farkle.view);
  const players = $derived(game.snapshot?.players ?? []);
  function nameOf(id: string | null): string {
    if (!id) return i18n.m.someone;
    if (id === myId) return i18n.m.you;
    return players.find((p) => p.id === id)?.name ?? i18n.m.playerFallback;
  }
  function abbrev(name: string): string {
    return name.length <= 10 ? name : name.slice(0, 9) + "…";
  }

  const isMyTurn = $derived(!!view && !!myId && view.currentPlayerId === myId);
  const canPick = $derived(!!view && isMyTurn && view.mustPick && !view.busted);

  // Local selection (indices into the current dice). Cleared whenever the dice
  // change (a new roll, or after setting aside).
  let selected = $state<number[]>([]);
  let rollAnim = $state(0);
  let prevHadDice = false;
  $effect(() => {
    const v = farkle.view;
    const has = !!v && v.dice.length > 0;
    if (has && !prevHadDice) {
      rollAnim++;
      diceAudio.roll();
      selected = [];
    } else if (!has) {
      selected = [];
    }
    prevHadDice = has;
  });

  function toggle(i: number) {
    if (!canPick) return;
    selected = selected.includes(i)
      ? selected.filter((x) => x !== i)
      : [...selected, i];
  }

  const selScore = $derived(
    view ? scoreSelection(selected.map((i) => view.dice[i])) : null,
  );

  function doRoll() {
    diceAudio.unlock();
    onRoll();
  }

  const ranked = $derived(
    [...(view?.scores ?? [])].sort((a, b) => b.score - a.score),
  );

  const status = $derived.by(() => {
    if (!view) return "";
    if (view.busted) return i18n.m.farkleBusted;
    if (isMyTurn) {
      if (view.mustPick) return i18n.m.farklePick;
      if (view.turnScore > 0 && view.remaining === 6)
        return i18n.m.farkleHotDice;
      return i18n.m.farkleYourRoll;
    }
    return i18n.m.farkleWaiting(nameOf(view.currentPlayerId));
  });
</script>

{#snippet face(f: number)}
  <span class="die">
    {#each CELLS as c (c)}
      <span class="pip" class:on={PIPS[f].includes(c)}></span>
    {/each}
  </span>
{/snippet}

<div class="farkle">
  {#if !view}
    <p class="muted">{i18n.m.dealing}</p>
  {:else if view.over}
    <div class="over">
      <Fireworks />
      <div class="over-content">
        <p class="crown"><Trophy size={44} /></p>
        <h2>{i18n.m.farkleWin(nameOf(view.winner), view.winner === myId)}</h2>
        <ol class="results">
          {#each ranked as r, i (r.playerId)}
            <li class:me={r.playerId === myId} class:top={i === 0}>
              <span class="rk">{i + 1}</span>
              <span class="rn">{nameOf(r.playerId)}</span>
              <span class="rs">{r.score}</span>
            </li>
          {/each}
        </ol>
        <button class="primary" onclick={onNewMatch}>{i18n.m.playAgain}</button>
      </div>
    </div>
  {:else}
    <!-- Scoreboard: wrapping chips (no horizontal scroll). -->
    <div class="scores">
      {#each view.scores as s (s.playerId)}
        <div class="chip" class:turn={s.playerId === view.currentPlayerId}>
          <span class="cn">{abbrev(nameOf(s.playerId))}</span>
          <span class="cs">{s.score}</span>
        </div>
      {/each}
    </div>
    <p class="target">{i18n.m.farkleTarget(view.target)}</p>

    <!-- Play area -->
    <div class="area">
      <p class="turnscore">{i18n.m.farkleThisTurn(view.turnScore)}</p>
      {#if view.dice.length}
        <div class="dice">
          {#each view.dice as f, i (i)}
            {#if canPick}
              <button
                class="dietile"
                class:sel={selected.includes(i)}
                aria-pressed={selected.includes(i)}
                aria-label={i18n.m.farklePick}
                onclick={() => toggle(i)}
              >
                {#key rollAnim}<span class="dieanim tumble" style="--i:{i}"
                    >{@render face(f)}</span
                  >{/key}
              </button>
            {:else}
              <span class="dietile static"
                >{#key rollAnim}<span class="dieanim tumble" style="--i:{i}"
                    >{@render face(f)}</span
                  >{/key}</span
              >
            {/if}
          {/each}
        </div>
      {:else}
        <p class="remaining">
          {view.remaining}
          {view.remaining === 1 ? "die" : "dice"}
        </p>
      {/if}
    </div>

    <!-- Sticky action footer -->
    <div class="tray">
      <p class="status" class:mine={isMyTurn}>{status}</p>
      {#if isMyTurn}
        <div class="actions">
          {#if view.busted}
            <button class="primary" onclick={onBank}>{i18n.m.farklePass}</button
            >
          {:else if view.mustPick}
            <button
              class="primary"
              disabled={selScore === null}
              onclick={() => onSetAside(selected)}
            >
              {i18n.m.farkleSetAside(selScore ?? 0)}
            </button>
          {:else}
            <button
              class="ghost"
              disabled={view.turnScore === 0}
              onclick={onBank}
            >
              {i18n.m.farkleBank(view.turnScore)}
            </button>
            <button class="primary" onclick={doRoll}>
              {view.remaining === 6
                ? i18n.m.farkleRoll
                : i18n.m.farkleRollRemaining(view.remaining)}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .farkle {
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

  /* Scoreboard chips — wrap instead of scrolling horizontally. */
  .scores {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    justify-content: center;
    flex-shrink: 0;
  }
  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
    border: 1px solid transparent;
    max-width: 9rem;
  }
  .chip.turn {
    border-color: var(--halo-accent);
    box-shadow: inset 3px 0 0 var(--halo-accent);
  }
  .cn {
    font-size: 0.8rem;
    color: var(--halo-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cs {
    font-family: var(--halo-font-heading);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .target {
    margin: 0;
    text-align: center;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--halo-text-muted);
    flex-shrink: 0;
  }

  /* Play area fills the middle. */
  .area {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    align-items: center;
    justify-content: center;
    /* Soft page-colour scrim so the turn score + status prompt read over the
       ambient backdrop; fades out so it never looks like a hard panel. */
    background: radial-gradient(
      120% 82% at 50% 50%,
      var(--halo-body) 42%,
      transparent 100%
    );
  }
  .turnscore {
    margin: 0;
    font-family: var(--halo-font-heading);
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--halo-text-main);
  }
  .remaining {
    margin: 0;
    color: var(--halo-text-muted);
  }
  .dice {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
    perspective: 700px;
  }
  .dieanim {
    display: inline-flex;
  }
  @media (prefers-reduced-motion: no-preference) {
    .dieanim.tumble {
      animation: tumble 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
      animation-delay: calc(var(--i, 0) * 60ms);
    }
  }
  @keyframes tumble {
    0% {
      transform: translateY(-22px) rotateX(-220deg) rotateZ(-40deg) scale(0.6);
      opacity: 0;
    }
    45% {
      transform: translateY(0) rotateX(30deg) rotateZ(16deg) scale(1.18);
      opacity: 1;
    }
    70% {
      transform: rotateX(-12deg) rotateZ(-6deg) scale(0.94);
    }
    100% {
      transform: none;
    }
  }
  .dietile {
    padding: 0;
    border: none;
    background: none;
    border-radius: 12px;
    transition:
      transform var(--halo-d-fast),
      box-shadow var(--halo-d-fast);
  }
  .dietile.static {
    cursor: default;
  }
  .dietile.sel {
    transform: translateY(-6px);
  }
  .dietile.sel .die {
    box-shadow: inset 0 0 0 2px var(--halo-accent);
    background: var(--halo-accent-soft);
  }

  /* Footer */
  .tray {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: stretch;
    padding-top: 0.75rem;
    padding-bottom: env(safe-area-inset-bottom, 0);
    border-top: 1px solid var(--halo-border);
  }
  .status {
    margin: 0;
    text-align: center;
    font-size: 0.9rem;
    color: var(--halo-text-muted);
  }
  .status.mine {
    color: var(--halo-accent);
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
  }
  .actions button {
    flex: 1;
    border-radius: var(--halo-radius);
    padding: 0.85em 1em;
    font-size: 1.05rem;
    font-weight: 600;
    border: 1px solid transparent;
  }
  .actions .primary {
    background: var(--halo-accent);
    color: var(--halo-on-accent);
  }
  .actions .primary:disabled {
    background: var(--halo-off-bg);
    color: var(--halo-text-muted);
    cursor: default;
  }
  .actions .ghost {
    background: var(--halo-bg-light);
    border-color: var(--halo-border);
    color: var(--halo-text-main);
  }
  .actions .ghost:disabled {
    opacity: 0.5;
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
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: min(20rem, 78vw);
  }
  .results li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.7rem;
    border-radius: var(--halo-radius);
    background: var(--halo-bg-light);
  }
  .results li.top {
    background: var(--halo-accent-soft);
    box-shadow: inset 3px 0 0 var(--halo-accent);
  }
  .results .rk {
    width: 1.2rem;
    text-align: right;
    color: var(--halo-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .results .rn {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .results li.me .rn {
    color: var(--halo-accent);
    font-weight: 600;
  }
  .results .rs {
    font-family: var(--halo-font-heading);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .over .primary {
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    border: none;
    border-radius: var(--halo-radius);
    padding: 0.8em 1.5em;
    font-size: 1.05rem;
    font-weight: 600;
  }

  /* Die face (3x3 pips). */
  .die {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    width: 2.8rem;
    height: 2.8rem;
    padding: 0.32rem;
    background: var(--halo-bg-main);
    border-radius: 12px;
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
    width: 0.38rem;
    height: 0.38rem;
  }
  @media (max-width: 820px) {
    .die {
      width: 2.5rem;
      height: 2.5rem;
    }
  }
</style>
