<script lang="ts">
  import { onMount } from "svelte";

  import type { RollRecord } from "$lib/api";
  import type { NixieDiceScene } from "$lib/dice/nixieScene";
  import { diceAudio } from "$lib/stores/audio.svelte";

  type Props = {
    lastRoll: RollRecord | null;
    diceCount: number;
    color: string;
    onSettled?: () => void;
  };
  let { lastRoll, diceCount, color, onSettled }: Props = $props();

  let container = $state<HTMLDivElement>();
  // The scene module imports @glowbox/nixie (touches Path2D at import) + three
  // addons, so it's dynamic-imported in onMount to stay browser-only.
  let scene: NixieDiceScene | null = null;
  let seen = -1;
  let spinning = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    let alive = true;
    void import("$lib/dice/nixieScene").then((mod) => {
      if (!alive || !container) return;
      scene = mod.createNixieDiceScene(container, {
        color,
        glass: "#aab3c0", // clear, faintly cool glass (was near-black / smoked)
        backdrop: "#08080c",
      });
      if (lastRoll && lastRoll.dice.length === diceCount) {
        seen = lastRoll.id;
        scene.setDigits(lastRoll.dice.map((d) => String(d.value)));
      } else {
        scene.setDigits(Array(diceCount).fill(""));
      }
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      scene?.dispose();
      scene = null;
    };
  });

  // Idle / count change → dark (unlit) tubes matching the current count.
  $effect(() => {
    const n = diceCount;
    if (scene && !spinning && (!lastRoll || lastRoll.dice.length !== n)) {
      scene.setDigits(Array(n).fill(""));
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
      spin(r.dice.map((d) => String(d.value)));
    }
  });

  function spin(targets: string[]) {
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
        targets.map(() => String(1 + Math.floor(Math.random() * 6))),
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
