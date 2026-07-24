<script lang="ts">
  import { onMount } from "svelte";

  import type { DieSpec, RollRecord } from "$lib/api";
  import { DiceScene, type HoverInfo } from "$lib/dice/DiceScene";
  import { themeByName } from "$lib/dice/themes";
  import { i18n } from "$lib/i18n/i18n.svelte";
  import { diceAudio } from "$lib/stores/audio.svelte";
  import { shake } from "$lib/stores/shake.svelte";

  import NixieDice from "./NixieDice.svelte";

  type Props = {
    lastRoll: RollRecord | null;
    diceSet: DieSpec[];
    deck: string;
    canRoll: boolean;
    rolling: boolean;
    onRoll: () => void;
    onSettled?: () => void;
  };
  let { lastRoll, diceSet, deck, canRoll, rolling, onRoll, onSettled }: Props =
    $props();

  // Render branch chosen from the tray: all-nixie → glowing tubes; all-d6
  // (non-nixie) → the 3D physics cube scene; anything else (polyhedra — until the
  // polyhedral 3D engine lands) → a numeric token grid.
  const allNixie = $derived(
    diceSet.length > 0 && diceSet.every((d) => d.material === "nixie"),
  );
  const allD6 = $derived(
    diceSet.length > 0 && diceSet.every((d) => d.kind === "d6"),
  );
  const use3D = $derived(allD6 && !allNixie);
  const nixieColor = $derived(themeByName("nixie").nixieColor ?? "#ff6a12");

  let canvas = $state<HTMLCanvasElement>();
  let scene: DiceScene | null = null;
  // Under test automation (Playwright sets navigator.webdriver), skip the heavy
  // WebGL/physics scene and render the numeric fallback: headless software-GL is
  // flaky/slow with several contexts, and e2e checks the roll→result flow, not the
  // 3D render. Real users never have webdriver=true, so production is unaffected.
  const automated =
    typeof navigator !== "undefined" && navigator.webdriver === true;
  let failed = $state(automated);
  let seenRollId = -1;
  let lastTrigger = 0;
  let hover = $state<HoverInfo | null>(null);

  // Create / destroy the 3D scene as the render branch toggles (only the all-d6
  // cube tray uses it for now).
  $effect(() => {
    if (!use3D) {
      scene?.dispose();
      scene = null;
      return;
    }
    if (canvas && !scene && !failed) {
      try {
        scene = new DiceScene(canvas, {
          onImpact: (s, material, t) =>
            material === "water"
              ? diceAudio.splash(s)
              : diceAudio.clack(s, material, t),
          onSettled: () => onSettled?.(),
        });
        scene.setDeck(deck);
        scene.setDice(diceSet);
        seenRollId = lastRoll?.id ?? -1;
        // Restore the last result (e.g. switching back) instead of face 1.
        if (lastRoll && lastRoll.dice.length === diceSet.length) {
          scene.showValues(lastRoll.dice.map((d) => d.value));
        }
      } catch (e) {
        console.error("dice scene init failed", e);
        failed = true;
      }
    }
  });

  $effect(() => {
    const d = deck;
    if (scene) scene.setDeck(d);
  });
  $effect(() => {
    const set = diceSet;
    if (scene) scene.setDice(set);
  });
  $effect(() => {
    const r = lastRoll;
    if (scene && r && r.id !== seenRollId) {
      seenRollId = r.id;
      hover = null;
      scene.roll(r.dice.map((d) => d.value));
    }
  });

  // Shake vigour agitates the liquid table (the "bass on a speaker" tremble).
  $effect(() => {
    const level = shake.shaking ? shake.intensity : 0;
    scene?.setAgitation(level);
  });

  // Shake-to-roll (mobile): while shaking, the dice rattle in a cup; when the
  // shaking stops they're released and fall (a roll fires) — only on our turn.
  $effect(() => {
    shake.onShakeStart(() => {
      if (canRoll) diceAudio.startRattle();
    });
    shake.onShakeIntensity((level) => diceAudio.setRattleIntensity(level));
    shake.onShakeEnd((rolled) => {
      diceAudio.stopRattle();
      if (rolled) triggerRoll();
    });
    return () => {
      shake.onShakeStart(null);
      shake.onShakeIntensity(null);
      shake.onShakeEnd(null);
      diceAudio.stopRattle();
    };
  });

  onMount(() => () => {
    scene?.dispose();
    scene = null;
  });

  // De-duped roll trigger shared by tap / fling / keyboard / shake.
  function triggerRoll() {
    const now = performance.now();
    if (now - lastTrigger < 400) return;
    lastTrigger = now;
    diceAudio.unlock();
    if (canRoll) onRoll();
  }

  // Desktop "mouse throw": a quick flick (fast pointer release) rolls.
  let downT = 0;
  let downX = 0;
  let downY = 0;
  function onDown(e: PointerEvent) {
    diceAudio.unlock();
    downT = performance.now();
    downX = e.clientX;
    downY = e.clientY;
  }
  function onUp(e: PointerEvent) {
    if (!downT) return;
    const dt = performance.now() - downT;
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    downT = 0;
    if (dist / Math.max(dt, 1) > 0.6) triggerRoll(); // a flick
  }

  // Hover a settled die to reveal its decided value (dice can land leaning).
  function onHoverMove(e: PointerEvent) {
    hover = scene ? scene.pickAt(e.clientX, e.clientY) : null;
  }
  function onHoverLeave() {
    hover = null;
    scene?.clearHover();
  }
</script>

<!-- The stage doubles as a big roll button when it's your turn; role/tabindex are
  set together, but the linter can't see the dynamic role is interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="stage halo-card"
  data-dice-theme={diceSet[0]?.material ?? "ivory"}
  role={canRoll ? "button" : undefined}
  tabindex={canRoll ? 0 : undefined}
  class:rollable={canRoll}
  onclick={triggerRoll}
  onkeydown={(e) => (e.key === "Enter" || e.key === " ") && triggerRoll()}
  onpointerdown={onDown}
  onpointerup={onUp}
  onpointermove={onHoverMove}
  onpointerleave={onHoverLeave}
>
  {#if hover}
    <div class="pip-tip" style="left: {hover.x}px; top: {hover.y}px">
      {hover.value}
    </div>
  {/if}

  <!-- The dice visuals jitter while the phone is shaken (cup-shake); the caption
    is a sibling so it stays still. --shake (0..1) scales the amplitude. -->
  <div
    class="dice-view"
    class:shaking={shake.shaking}
    style="--shake:{shake.intensity}"
  >
    {#if allNixie}
      <NixieDice
        {lastRoll}
        diceCount={diceSet.length}
        color={nixieColor}
        {onSettled}
      />
    {:else if use3D && !failed}
      <canvas bind:this={canvas}></canvas>
    {:else}
      <!-- Numeric token grid: any polyhedral tray (until the 3D polyhedra land),
        and the WebGL-unavailable / automated fallback. Shows each die's value
        with its kind tag. -->
      <div class="fallback">
        {#if lastRoll}
          <div class="nums">
            {#each lastRoll.dice as d, i (i)}
              <span class="tok" data-kind={d.kind}>
                <b>{d.value}</b>
                <em>{d.kind}</em>
              </span>
            {/each}
          </div>
        {:else}
          <p class="muted">{i18n.m.diceFallback}</p>
        {/if}
      </div>
    {/if}
  </div>

  <div class="caption">
    {#if shake.shaking && canRoll}
      <span class="prompt">{i18n.m.shaking}</span>
    {:else if lastRoll && !rolling}
      <!-- Result appears once the dice stop and stays up until the next roll,
        even on your own turn (the Roll button / turn chip cue the action). -->
      <span>{i18n.m.rolledResult(lastRoll.playerName, lastRoll.total)}</span>
    {:else if canRoll && !lastRoll}
      <span class="prompt"
        >{shake.enabled ? i18n.m.tapOrShakeToRoll : i18n.m.tapToRoll}</span
      >
    {/if}
  </div>
</div>

<style>
  .stage {
    position: relative;
    height: 100%;
    min-height: 16rem;
    padding: 0;
    overflow: hidden;
    user-select: none;
    touch-action: manipulation;
  }
  .stage.rollable {
    cursor: pointer;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .dice-view {
    position: absolute;
    inset: 0;
    /* amplitude 0.45..1, scaled by the live shake vigour (--shake, 0..1) */
    --amp: calc(0.45 + var(--shake, 0.5) * 0.55);
  }
  /* scale(1.04) covers the edges the jitter would otherwise expose. */
  .dice-view.shaking {
    animation: cup-shake 0.2s linear infinite;
  }
  @keyframes cup-shake {
    0%,
    100% {
      transform: scale(1.04) translate(0, 0) rotate(0deg);
    }
    25% {
      transform: scale(1.04)
        translate(calc(var(--amp) * -5px), calc(var(--amp) * 4px))
        rotate(calc(var(--amp) * -1.4deg));
    }
    50% {
      transform: scale(1.04)
        translate(calc(var(--amp) * 5px), calc(var(--amp) * -4px))
        rotate(calc(var(--amp) * 1.2deg));
    }
    75% {
      transform: scale(1.04)
        translate(calc(var(--amp) * -4px), calc(var(--amp) * -5px))
        rotate(calc(var(--amp) * -1deg));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dice-view.shaking {
      animation: none;
    }
  }
  .pip-tip {
    position: absolute;
    transform: translate(-50%, -140%);
    min-width: 1.9em;
    padding: 0.15em 0.4em;
    background: var(--halo-accent);
    color: var(--halo-on-accent);
    font-family: var(--halo-font-heading);
    font-weight: 600;
    font-size: 1.25rem;
    text-align: center;
    border-radius: var(--halo-radius);
    box-shadow: var(--halo-shadow);
    pointer-events: none;
    z-index: 2;
  }
  .pip-tip::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 100%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: var(--halo-accent);
  }
  .caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 0.6rem 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    text-align: center;
    font-size: 0.95rem;
    color: var(--halo-text-main);
    pointer-events: none;
  }
  /* Dark translucent pill so the text stays legible on any felt colour. */
  .caption span {
    background: rgba(10, 10, 14, 0.5);
    color: #fff;
    padding: 0.3em 0.85em;
    border-radius: var(--halo-radius-pill);
    backdrop-filter: blur(2px);
  }
  .caption .prompt {
    color: var(--halo-accent);
    font-weight: 600;
  }
  .fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .nums {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    justify-content: center;
    max-width: 90%;
  }
  /* One token per die: the value big, the die kind as a small tag. */
  .tok {
    position: relative;
    display: grid;
    place-items: center;
    width: 4rem;
    height: 4rem;
    background: var(--halo-bg-light);
    border-radius: 12px;
    box-shadow: var(--halo-shadow);
    font-family: var(--halo-font-heading);
  }
  .tok b {
    font-size: 2rem;
    font-weight: 600;
    line-height: 1;
  }
  .tok em {
    position: absolute;
    bottom: 0.25rem;
    font-style: normal;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--halo-accent);
  }
  .muted {
    color: var(--halo-text-muted);
  }
</style>
