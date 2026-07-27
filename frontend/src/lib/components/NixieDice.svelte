<script lang="ts">
  import { onMount } from "svelte";

  import type { DieKind, DieSpec, RollRecord } from "$lib/api";
  import { DIE_SIDES } from "$lib/api";
  import type { NixieDiceScene } from "$lib/dice/nixieScene";
  import { diceAudio } from "$lib/stores/audio.svelte";

  type Props = {
    lastRoll: RollRecord | null;
    diceSet: DieSpec[];
    color: string;
    onSettled?: () => void;
    /** The tube scene couldn't be loaded (old browser, dead chunk) — the parent
     *  shows the numeric dice instead of an empty stage. */
    onFailed?: () => void;
  };
  let { lastRoll, diceSet, color, onSettled, onFailed }: Props = $props();

  // One tube per digit of the kind's highest value (d20 → 2 tubes, d100 → 3);
  // a value shorter than its die's tube count leaves the leading tubes unlit.
  const tubesFor = (kind: DieKind) => String(DIE_SIDES[kind]).length;
  function digitsFor(kind: DieKind, value: number): string[] {
    const out = String(value).split("");
    while (out.length < tubesFor(kind)) out.unshift("");
    return out;
  }
  const dark = () =>
    diceSet.map((d) => Array<string>(tubesFor(d.kind)).fill(""));

  let container = $state<HTMLDivElement>();
  // The scene module imports @glowbox/nixie (touches Path2D at import) + three
  // addons, so it's dynamic-imported in onMount to stay browser-only.
  let scene: NixieDiceScene | null = null;
  let seen = -1;
  let spinning = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    let alive = true;
    void import("$lib/dice/nixieScene")
      .then((mod) => {
        if (!alive || !container) return;
        scene = mod.createNixieDiceScene(container, {
          color,
          glass: "#aab3c0", // clear, faintly cool glass (was near-black / smoked)
          backdrop: "#08080c",
        });
        if (lastRoll && lastRoll.dice.length === diceSet.length) {
          seen = lastRoll.id;
          scene.setDigits(lastRoll.dice.map((d) => digitsFor(d.kind, d.value)));
        } else {
          scene.setDigits(dark());
        }
      })
      .catch((e: unknown) => {
        console.error("nixie scene load failed", e);
        if (alive) onFailed?.();
      });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      scene?.dispose();
      scene = null;
    };
  });

  // Idle / tray change → dark (unlit) tube groups matching the current tray.
  $effect(() => {
    const groups = dark();
    if (
      scene &&
      !spinning &&
      (!lastRoll || lastRoll.dice.length !== groups.length)
    ) {
      scene.setDigits(groups);
    }
  });

  $effect(() => {
    const c = color;
    scene?.setColor(c);
  });

  // New roll → flicker random digits, then land on the authoritative result.
  $effect(() => {
    const r = lastRoll;
    if (scene && r && r.id !== seen) {
      seen = r.id;
      spin(r.dice.map((d) => digitsFor(d.kind, d.value)));
    }
  });

  function spin(targets: string[][]) {
    if (!scene) return;
    if (timer) clearTimeout(timer);
    spinning = true;
    const dur = 850;
    const step = 75;
    const t0 = performance.now();
    const run = () => {
      if (!scene) return;
      if (performance.now() - t0 >= dur) {
        scene.setDigits(targets);
        spinning = false;
        timer = null;
        diceAudio.tick(0.5);
        onSettled?.();
        return;
      }
      scene.setDigits(
        targets.map((g) => g.map(() => String(Math.floor(Math.random() * 10)))),
      );
      diceAudio.tick(0.25);
      timer = setTimeout(run, step);
    };
    run();
  }
</script>

<div class="nixie" bind:this={container}></div>

<style>
  .nixie {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 40%, #14141c 0%, #08080c 70%);
  }
  .nixie :global(canvas) {
    display: block;
  }
</style>
