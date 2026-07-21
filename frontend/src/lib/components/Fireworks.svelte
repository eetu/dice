<script lang="ts">
  // Decorative ASCII fireworks — a tiny particle sim rendered into a <pre>, used
  // as a celebratory win-screen background. Pure DOM text updates (CSP-clean, no
  // canvas/WebGL). Honors prefers-reduced-motion: a single static burst, no loop.
  import { onMount } from "svelte";

  let host = $state<HTMLDivElement>();
  let pre = $state<HTMLPreElement>();

  type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    rocket: boolean;
    targetY: number;
    life: number;
    max: number;
  };

  onMount(() => {
    const el = pre;
    const container = host;
    if (!el || !container) return;

    const FS = 14; // px — monospace cell ≈ 0.6×FS wide, 1×FS tall (line-height:1)
    const G = 0.055; // gravity per frame
    let cols = 48;
    let rows = 20;
    let particles: Particle[] = [];

    el.style.fontSize = `${FS}px`;

    function measure() {
      const w = container!.clientWidth || 320;
      const h = container!.clientHeight || 220;
      cols = Math.max(20, Math.floor(w / (FS * 0.6)));
      rows = Math.max(12, Math.floor(h / FS));
    }

    function sparkChar(life: number, max: number): string {
      const t = life / max;
      if (t > 0.75) return "@";
      if (t > 0.5) return "O";
      if (t > 0.3) return "*";
      if (t > 0.15) return "+";
      return ".";
    }

    function explode(x: number, y: number) {
      const n = 16 + Math.floor(Math.random() * 18);
      const speed = 0.5 + Math.random() * 0.55;
      const life = 12 + Math.floor(Math.random() * 14);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
        const s = speed * (0.4 + Math.random() * 0.9);
        particles.push({
          x,
          y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s * 0.6,
          rocket: false,
          targetY: 0,
          life,
          max: life,
        });
      }
    }

    function launch() {
      particles.push({
        x: 4 + Math.random() * (cols - 8),
        y: rows - 1,
        vx: 0,
        vy: -(0.55 + Math.random() * 0.3),
        rocket: true,
        targetY: 2 + Math.random() * (rows * 0.45),
        life: 1,
        max: 1,
      });
    }

    function render() {
      const grid: string[][] = Array.from({ length: rows }, () =>
        new Array(cols).fill(" "),
      );
      for (const p of particles) {
        const xi = Math.round(p.x);
        const yi = Math.round(p.y);
        if (yi >= 0 && yi < rows && xi >= 0 && xi < cols) {
          grid[yi][xi] = p.rocket ? "|" : sparkChar(p.life, p.max);
        }
      }
      if (el) el.textContent = grid.map((r) => r.join("")).join("\n");
    }

    function step() {
      // Occasionally launch a rocket (cap concurrent rockets).
      if (
        Math.random() < 0.09 &&
        particles.filter((p) => p.rocket).length < 3
      ) {
        launch();
      }
      const next: Particle[] = [];
      for (const p of particles) {
        if (p.rocket) {
          p.y += p.vy;
          if (p.y <= p.targetY) {
            explode(p.x, p.y);
            continue; // rocket consumed
          }
          next.push(p);
        } else {
          p.vy += G;
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 1;
          if (p.life > 0 && p.y < rows) next.push(p);
        }
      }
      particles = next;
      render();
    }

    measure();

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      // Static keepsake: a few frozen bursts, no animation loop.
      for (let i = 0; i < 4; i++) {
        explode(
          6 + Math.random() * (cols - 12),
          3 + Math.random() * (rows - 8),
        );
      }
      for (const p of particles) p.life = Math.floor(p.max * 0.6);
      render();
      return;
    }

    // A couple of opening bursts so it's lively immediately.
    launch();
    launch();
    const timer = setInterval(step, 55);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    ro?.observe(container);

    return () => {
      clearInterval(timer);
      ro?.disconnect();
    };
  });
</script>

<div class="fw" bind:this={host} aria-hidden="true">
  <pre bind:this={pre}></pre>
</div>

<style>
  .fw {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
  }
  pre {
    margin: 0;
    /* Must be monospace so the grid aligns into rows/columns. */
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    line-height: 1;
    letter-spacing: 0;
    color: var(--halo-accent);
    opacity: 0.5;
    white-space: pre;
    user-select: none;
  }
</style>
