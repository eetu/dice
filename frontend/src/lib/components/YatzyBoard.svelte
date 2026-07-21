<script lang="ts">
  // Mobile-first Nordic Yatzy board. Reads the public `yatzy` view (dice, holds,
  // scorecards, and a live per-box preview computed server-side) and reports
  // intent via callbacks. Dice are the tap targets themselves (no button chrome):
  // tap a die to hold it between rolls; tap a scorecard box to score there.
  import Trophy from "@lucide/svelte/icons/trophy";

  import type { YatzyCat } from "$lib/api";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { diceAudio } from "$lib/stores/audio.svelte";
  import { game } from "$lib/stores/game.svelte";
  import { yatzy } from "$lib/stores/yatzy.svelte";

  type Props = {
    myId: string | null;
    onRoll: () => void;
    onHold: (index: number) => void;
    onScore: (category: YatzyCat) => void;
    onNewMatch: () => void;
  };
  let { myId, onRoll, onHold, onScore, onNewMatch }: Props = $props();

  // 3x3 pip layout per face (grid cells 1..9, row-major) — same as LiarsBoard.
  const CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const PIPS: Record<number, number[]> = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };

  const UPPER: YatzyCat[] = [
    "ones",
    "twos",
    "threes",
    "fours",
    "fives",
    "sixes",
  ];
  const LOWER: YatzyCat[] = [
    "onePair",
    "twoPairs",
    "threeKind",
    "fourKind",
    "smallStraight",
    "largeStraight",
    "fullHouse",
    "chance",
    "yatzy",
  ];

  const view = $derived(yatzy.view);
  const players = $derived(game.snapshot?.players ?? []);
  function nameOf(id: string | null): string {
    if (!id) return i18n.m.someone;
    if (id === myId) return i18n.m.you;
    return players.find((p) => p.id === id)?.name ?? i18n.m.playerFallback;
  }
  // Narrower columns as more players join, so the card stays readable before it
  // needs to scroll. Header names abbreviate gracefully (First L. / truncate).
  const nameMax = $derived(
    (view?.order.length ?? 0) <= 2
      ? 10
      : (view?.order.length ?? 0) <= 3
        ? 8
        : 6,
  );
  function abbrevName(name: string, max: number): string {
    const n = name.trim();
    if (n.length <= max) return n;
    const parts = n.split(/\s+/);
    if (parts.length > 1) {
      const initials = parts
        .slice(1)
        .map((p) => p[0])
        .join("");
      const combined = `${parts[0]} ${initials}`;
      if (combined.length <= max) return combined;
      if (parts[0].length <= max) return parts[0];
    }
    return n.slice(0, Math.max(1, max - 1)) + "…";
  }

  // A roll just happened when the roll count drops — retrigger the tumble
  // animation and play the roll sound (everyone at the table hears it).
  let rollAnim = $state(0);
  let prevRollsLeft = -1;
  $effect(() => {
    const v = yatzy.view;
    if (!v) {
      prevRollsLeft = -1;
      return;
    }
    if (v.rolled && prevRollsLeft !== -1 && v.rollsLeft < prevRollsLeft) {
      rollAnim++;
      diceAudio.roll();
    }
    prevRollsLeft = v.rollsLeft;
  });

  function doRoll() {
    diceAudio.unlock(); // prime audio on the roller's gesture
    onRoll();
  }

  const isMyTurn = $derived(!!view && !!myId && view.currentPlayerId === myId);
  const iPlay = $derived(!!view && !!myId && view.order.includes(myId));
  const canHold = $derived(
    !!view && isMyTurn && view.rolled && view.rollsLeft > 0,
  );
  const canScore = $derived(!!view && isMyTurn && view.rolled);

  // What an open box would score for the current dice (the current player).
  function previewOf(cat: YatzyCat): number {
    return view?.preview.find((c) => c.category === cat)?.value ?? 0;
  }
  // A player's filled value for a box, or undefined if the box is still open.
  function filledValue(pid: string, cat: YatzyCat): number | undefined {
    return view?.cards
      .find((c) => c.playerId === pid)
      ?.cells.find((x) => x.category === cat)?.value;
  }
  function cardTotals(pid: string) {
    return (
      view?.cards.find((c) => c.playerId === pid) ?? {
        upper: 0,
        bonus: 0,
        total: 0,
      }
    );
  }
  // Any upper box still open for this player (so the bonus is still reachable)?
  function upperOpen(pid: string): boolean {
    return UPPER.some((c) => filledValue(pid, c) === undefined);
  }

  // Dice to render: the live dice, or 5 blanks (0) before the first roll.
  const diceFaces = $derived(view?.dice.length ? view.dice : [0, 0, 0, 0, 0]);

  const status = $derived.by(() => {
    if (!view) return "";
    if (!iPlay) return i18n.m.spectating;
    if (isMyTurn) {
      if (!view.rolled) return i18n.m.yatzyYourTurn;
      if (view.rollsLeft === 0) return i18n.m.yatzyScratchHint;
      return i18n.m.yatzyRollsLeft(view.rollsLeft);
    }
    return i18n.m.yatzyWaitingRoll(nameOf(view.currentPlayerId));
  });
</script>

{#snippet face(f: number)}
  <span class="die" class:blank={f < 1}>
    {#each CELLS as c (c)}
      <span class="pip" class:on={f >= 1 && PIPS[f].includes(c)}></span>
    {/each}
  </span>
{/snippet}

<!-- Re-keys on each roll so the tumble animation replays; held dice don't move.
     `--i` staggers the dice so they cascade in rather than flipping in unison. -->
{#snippet animDie(f: number, held: boolean, i: number)}
  {#key rollAnim}
    <span class="dieanim" class:tumble={!held} style="--i:{i}"
      >{@render face(f)}</span
    >
  {/key}
{/snippet}

{#snippet cell(pid: string, cat: YatzyCat)}
  {@const filled = filledValue(pid, cat)}
  {#if filled !== undefined}
    <td class="val" class:zero={filled === 0}>{filled}</td>
  {:else if pid === view?.currentPlayerId && canScore}
    <td class="open">
      <button class="score" onclick={() => onScore(cat)}>
        {previewOf(cat)}
      </button>
    </td>
  {:else}
    <td class="empty"></td>
  {/if}
{/snippet}

<div class="yatzy">
  {#if !view}
    <p class="muted">{i18n.m.dealing}</p>
  {:else if view.over}
    <div class="over">
      <p class="crown"><Trophy size={44} /></p>
      <h2>{i18n.m.yatzyWin(nameOf(view.winner), view.winner === myId)}</h2>
      <button class="primary" onclick={onNewMatch}>{i18n.m.playAgain}</button>
    </div>
  {:else}
    <!-- Scorecard: categories × players -->
    <div class="card-scroll">
      <table class="card">
        <thead>
          <tr>
            <th class="cat"></th>
            {#each view.order as pid (pid)}
              <th class:turn={pid === view.currentPlayerId} title={nameOf(pid)}
                >{abbrevName(nameOf(pid), nameMax)}</th
              >
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each UPPER as cat (cat)}
            <tr>
              <th class="cat">{i18n.m.yatzyCats[cat]}</th>
              {#each view.order as pid (pid)}{@render cell(pid, cat)}{/each}
            </tr>
          {/each}
          <tr class="sub">
            <th class="cat">{i18n.m.yatzyUpper}</th>
            {#each view.order as pid (pid)}
              <td class="val sum">{cardTotals(pid).upper}</td>
            {/each}
          </tr>
          <tr class="sub">
            <th class="cat hintcat" title={i18n.m.yatzyBonusHint}
              >{i18n.m.yatzyBonus}</th
            >
            {#each view.order as pid (pid)}
              {@const t = cardTotals(pid)}
              {#if t.bonus > 0}
                <td class="val sum">{t.bonus}</td>
              {:else if upperOpen(pid)}
                <td class="val togo" title={i18n.m.yatzyToGo(63 - t.upper)}
                  >{63 - t.upper}</td
                >
              {:else}
                <td class="val zero">0</td>
              {/if}
            {/each}
          </tr>
          {#each LOWER as cat (cat)}
            <tr>
              <th class="cat">{i18n.m.yatzyCats[cat]}</th>
              {#each view.order as pid (pid)}{@render cell(pid, cat)}{/each}
            </tr>
          {/each}
          <tr class="grand">
            <th class="cat">{i18n.m.yatzyTotal}</th>
            {#each view.order as pid (pid)}
              <td class="val sum">{cardTotals(pid).total}</td>
            {/each}
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Dice tray + roll (thumb-reachable). The die IS the hold button. -->
    <div class="tray">
      <div class="dice">
        {#each diceFaces as f, i (i)}
          {#if canHold}
            <button
              class="dietile"
              class:held={view.held[i]}
              aria-pressed={view.held[i]}
              aria-label={i18n.m.yatzyHoldHint}
              onclick={() => onHold(i)}
              >{@render animDie(f, view.held[i], i)}</button
            >
          {:else}
            <span
              class="dietile static"
              class:held={view.rolled && view.held[i]}
              >{@render animDie(f, view.rolled && view.held[i], i)}</span
            >
          {/if}
        {/each}
      </div>

      <p class="status" class:mine={isMyTurn}>{status}</p>

      {#if iPlay && !view.over}
        <button
          class="roll"
          disabled={!isMyTurn || view.rollsLeft === 0}
          onclick={doRoll}
        >
          {i18n.m.yatzyRoll(view.rollsLeft)}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .yatzy {
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

  /* Scorecard */
  .card-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .card {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .card th,
  .card td {
    padding: 0.3rem 0.5rem;
    text-align: center;
    border-bottom: 1px solid var(--halo-border);
  }
  /* Keep player columns readable; the card scrolls horizontally once they don't
     all fit rather than squeezing to nothing. */
  .card thead th:not(.cat),
  .card tbody td {
    min-width: 2.9rem;
  }
  /* Category column sticks to the left as columns scroll horizontally. */
  th.cat {
    text-align: left;
    font-weight: 400;
    color: var(--halo-text-muted);
    white-space: nowrap;
    position: sticky;
    left: 0;
    background: var(--halo-body);
    z-index: 1;
  }
  /* Player-name row sticks to the top as the scorecard scrolls vertically. */
  thead th {
    font-family: var(--halo-font-heading);
    font-weight: 600;
    color: var(--halo-text-main);
    max-width: 5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--halo-body);
  }
  thead th.cat {
    z-index: 3; /* the top-left corner is sticky on both axes */
  }
  thead th.turn {
    color: var(--halo-accent);
  }
  .val {
    font-variant-numeric: tabular-nums;
    color: var(--halo-text-main);
  }
  .val.zero {
    color: var(--halo-text-muted);
  }
  .val.sum {
    font-weight: 600;
  }
  /* Points still needed for the upper bonus — a hint, not a score. */
  .val.togo {
    color: var(--halo-text-muted);
    font-style: italic;
    font-size: 0.78rem;
  }
  /* The bonus label carries the rule as a tooltip. */
  .hintcat {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    cursor: help;
  }
  tr.sub .cat,
  tr.sub .val {
    color: var(--halo-text-muted);
  }
  tr.grand th.cat,
  tr.grand .val {
    font-family: var(--halo-font-heading);
    font-weight: 700;
    color: var(--halo-text-main);
    border-bottom: none;
    font-size: 1rem;
  }
  .empty {
    color: transparent;
  }
  /* An open box the current player can score into — the preview value, tappable. */
  .open {
    padding: 0.15rem !important;
  }
  .score {
    width: 100%;
    min-height: 40px;
    border: 1px dashed var(--halo-accent);
    border-radius: var(--halo-radius-pill);
    background: var(--halo-accent-soft);
    color: var(--halo-accent);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 0.95rem;
  }
  .score:hover {
    background: var(--halo-accent);
    color: var(--halo-on-accent);
  }

  /* Dice tray — a footer pinned below the scrolling scorecard so the dice + roll
     are always in reach (they'd otherwise fall below the fold on a phone). */
  .tray {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: center;
    padding-top: 0.75rem;
    padding-bottom: env(safe-area-inset-bottom, 0);
    border-top: 1px solid var(--halo-border);
  }
  .dice {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    flex-wrap: wrap;
    perspective: 700px; /* gives the roll tumble real depth */
  }
  .dieanim {
    display: inline-flex;
  }
  @media (prefers-reduced-motion: no-preference) {
    .dieanim.tumble {
      animation: tumble 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
      animation-delay: calc(var(--i, 0) * 70ms); /* dice cascade in */
    }
  }
  /* A full multi-axis flip that drops in and bounces to rest. */
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
    88% {
      transform: rotateX(4deg) scale(1.03);
    }
    100% {
      transform: none;
    }
  }
  /* The die itself is the tap target — no wrapping button chrome. */
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
  .dietile.held {
    transform: translateY(-5px);
  }
  .dietile.held .die {
    box-shadow: inset 0 0 0 2px var(--halo-accent);
    background: var(--halo-accent-soft);
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
  .roll {
    width: min(20rem, 100%);
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    border: none;
    border-radius: var(--halo-radius);
    padding: 0.9em 1.5em;
    font-size: 1.1rem;
    font-weight: 600;
    transition: filter var(--halo-d-fast);
  }
  .roll:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  .roll:disabled {
    background: var(--halo-off-bg);
    color: var(--halo-text-muted);
    cursor: default;
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
    margin: 0;
    color: var(--halo-accent);
    line-height: 1;
  }
  .over h2 {
    margin: 0;
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

  /* Die face (3x3 pips) — big tray dice. */
  .die {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    width: 3rem;
    height: 3rem;
    padding: 0.34rem;
    background: var(--halo-bg-main);
    border-radius: 12px;
    box-shadow: inset 0 0 0 1px var(--halo-border);
    box-sizing: border-box;
  }
  .die.blank {
    background: var(--halo-bg-light);
  }
  .pip {
    border-radius: 50%;
  }
  .pip.on {
    background: var(--halo-text-main);
    align-self: center;
    justify-self: center;
    width: 0.4rem;
    height: 0.4rem;
  }

  /* Phones: tighten the scorecard so more rows fit, shrink the footer dice a bit. */
  @media (max-width: 820px) {
    .yatzy {
      gap: 0.5rem;
    }
    .card {
      font-size: 0.82rem;
    }
    .card th,
    .card td {
      padding: 0.25rem 0.35rem;
    }
    .dice {
      gap: 0.45rem;
    }
    .die {
      width: 2.5rem;
      height: 2.5rem;
      padding: 0.28rem;
    }
    .pip.on {
      width: 0.34rem;
      height: 0.34rem;
    }
    .roll {
      padding: 0.75em 1.5em;
    }
  }
</style>
