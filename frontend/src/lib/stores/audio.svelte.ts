// On-device dice sound, synthesized with the Web Audio API (no assets). A clack
// = a filtered noise burst + a low knock; a tick = a short blip (nixie flips).
// The context is created lazily inside a user gesture and resumed if suspended
// (iOS/Safari autoplay policy).

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

const MUTE_KEY = "dice:muted";
function readMuted(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(MUTE_KEY) === "1"
  );
}

type Rattle = {
  interval: ReturnType<typeof setInterval>;
  nextTime: number; // ctx time of the next grain to schedule
  intensity: number; // 0..1 shake vigour
};

class DiceAudio {
  #ctx: AudioContext | null = null;
  #noise: AudioBuffer | null = null;
  #rattle: Rattle | null = null;
  muted = $state(readMuted());

  #ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.#ctx) {
      const Ctor =
        window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const len = Math.floor(ctx.sampleRate * 0.2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.#ctx = ctx;
      this.#noise = buf;
    }
    if (this.#ctx.state === "suspended") void this.#ctx.resume();
    return this.#ctx;
  }

  /** Call from a user gesture to prime the context before the first sound. */
  unlock(): void {
    if (!this.muted) this.#ensure();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    }
    if (this.muted) this.stopRattle();
    else this.#ensure();
  }

  /** A die impact, shaped by the table `material` (felt / wood / concrete /
   *  metal) and the dice `theme`. The low "knock" is the thunk (body) and is kept
   *  prominent; felt muffles the highs, metal rings. `strength` ∈ 0..1 = volume. */
  clack(strength = 0.6, material = "felt", theme = "ivory"): void {
    if (this.muted) return;
    const ctx = this.#ensure();
    if (!ctx || !this.#noise) return;
    const t = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1, strength));

    // Defaults = felt: a soft, low, muffled thunk (little high-end click).
    let knockFreq = 130;
    let knockGain = 0.62;
    let knockDecay = 0.16;
    let noiseFreq = 700;
    let noiseGain = 0.09;
    let noiseDecay = 0.05;
    let noiseQ = 0.9;
    let ring = 0;
    let ringGain = 0.15;
    const ringDecay = 0.32;
    if (material === "wood") {
      knockFreq = 172;
      knockGain = 0.5;
      knockDecay = 0.12;
      noiseFreq = 1700;
      noiseGain = 0.24;
      noiseDecay = 0.08;
      noiseQ = 1.3;
    } else if (material === "concrete") {
      knockFreq = 104; // heavy, dense, low thud
      knockGain = 0.72;
      knockDecay = 0.2;
      noiseFreq = 1100;
      noiseGain = 0.16;
      noiseDecay = 0.045;
      noiseQ = 1.0;
    } else if (material === "metal") {
      knockFreq = 210;
      knockGain = 0.32;
      knockDecay = 0.09;
      noiseFreq = 3400;
      noiseGain = 0.3;
      noiseDecay = 0.12;
      noiseQ = 2.0;
      ring = 4600; // bright metallic ring
    } else if (material === "water") {
      knockFreq = 90; // deep, soft plop
      knockGain = 0.5;
      knockDecay = 0.14;
      noiseFreq = 900; // splashy, damp
      noiseGain = 0.2;
      noiseDecay = 0.1;
      noiseQ = 0.7;
    }

    // Dice-material timbre (layered on the surface).
    if (theme === "gold") {
      ring = ring || 5200;
      ringGain = Math.max(ringGain, 0.11);
      noiseFreq *= 1.1;
    } else if (theme === "obsidian") {
      knockFreq *= 0.9;
      knockGain *= 1.1;
    } else if (theme === "ruby" || theme === "emerald") {
      noiseFreq *= 1.15;
    }

    // Low knock — the thunk. Sine with a pitch-down sweep for a natural thud.
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(knockFreq * (0.95 + Math.random() * 0.1), t);
    osc.frequency.exponentialRampToValueAtTime(
      knockFreq * 0.5,
      t + knockDecay * 0.7,
    );
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(knockGain * vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + knockDecay);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + knockDecay + 0.03);

    // Surface texture — a short filtered noise burst over the thunk.
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = noiseFreq * (0.85 + Math.random() * 0.3);
    bp.Q.value = noiseQ;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(noiseGain * vol, t + 0.003);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + noiseDecay);
    src.connect(bp).connect(gn).connect(ctx.destination);
    src.start(t);
    src.stop(t + noiseDecay + 0.03);

    // Metallic ring (metal table, or metal dice) — two partials for timbre.
    if (ring) {
      for (const [mult, gm, dm] of [
        [1, 1, 1],
        [1.48, 0.5, 0.7],
      ] as const) {
        const r = ctx.createOscillator();
        r.type = "sine";
        r.frequency.value = ring * mult * (0.97 + Math.random() * 0.06);
        const gr = ctx.createGain();
        gr.gain.setValueAtTime(0.0001, t);
        gr.gain.exponentialRampToValueAtTime(ringGain * gm * vol, t + 0.004);
        gr.gain.exponentialRampToValueAtTime(0.0001, t + ringDecay * dm);
        r.connect(gr).connect(ctx.destination);
        r.start(t);
        r.stop(t + ringDecay * dm + 0.03);
      }
    }
  }

  /** A water splash — dice landing on the liquid table. A bright entry plip, a
   *  band-swept noise "spray" (settling water), and a few descending bubble
   *  droplets. `strength` ∈ 0..1 = volume. */
  splash(strength = 0.6): void {
    if (this.muted) return;
    const ctx = this.#ensure();
    if (!ctx || !this.#noise) return;
    const t = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1, strength));

    // Entry plip — a very short bright noise tick.
    const plip = ctx.createBufferSource();
    plip.buffer = this.#noise;
    const pf = ctx.createBiquadFilter();
    pf.type = "bandpass";
    pf.frequency.value = 3200 + Math.random() * 1500;
    pf.Q.value = 1.2;
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.0001, t);
    pg.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.003);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    plip.connect(pf).connect(pg).connect(ctx.destination);
    plip.start(t);
    plip.stop(t + 0.06);

    // Spray — noise through a bandpass sweeping high → low as it settles.
    const spray = ctx.createBufferSource();
    spray.buffer = this.#noise;
    spray.loop = true;
    const sf = ctx.createBiquadFilter();
    sf.type = "bandpass";
    sf.frequency.setValueAtTime(4200, t);
    sf.frequency.exponentialRampToValueAtTime(700, t + 0.28);
    sf.Q.value = 0.8;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.22 * vol, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    spray.connect(sf).connect(sg).connect(ctx.destination);
    spray.start(t);
    spray.stop(t + 0.38);

    // Bubbles — a couple of quick descending sine blips (droplets).
    const bubbles = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < bubbles; i++) {
      const bt = t + 0.02 + Math.random() * 0.18;
      const f0 = 500 + Math.random() * 500;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f0, bt);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.45, bt + 0.09);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, bt);
      bg.gain.exponentialRampToValueAtTime(0.16 * vol, bt + 0.006);
      bg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.12);
      osc.connect(bg).connect(ctx.destination);
      osc.start(bt);
      osc.stop(bt + 0.14);
    }
  }

  /** Start the "dice rattling in a plastic cup" loop, held while the phone is
   *  shaken. Rather than a continuous wash, a look-ahead scheduler fires many
   *  discrete plastic clicks at rapid, irregular intervals (= several dice
   *  bouncing) plus the occasional hollow cup thock. Idempotent; drive density
   *  with `setRattleIntensity`, end with `stopRattle` (the dice then "fall"). */
  startRattle(): void {
    if (this.muted || this.#rattle) return;
    const ctx = this.#ensure();
    if (!ctx || !this.#noise) return;
    const state: Rattle = {
      interval: 0 as unknown as ReturnType<typeof setInterval>,
      nextTime: ctx.currentTime,
      intensity: 0.5,
    };
    const LOOKAHEAD = 0.1; // schedule grains up to 100ms ahead
    const pump = () => {
      const c = this.#ctx;
      if (!c) return;
      while (state.nextTime < c.currentTime + LOOKAHEAD) {
        this.#rattleGrain(c, state.nextTime, state.intensity);
        // Denser, more even when shaken hard; sparser + more random when gentle.
        const base = 0.03 - state.intensity * 0.014;
        state.nextTime += base * (0.5 + Math.random() * 1.2);
      }
    };
    state.interval = setInterval(pump, 25);
    this.#rattle = state;
    pump();
  }

  /** One plastic-dice grain: a short bright click (dice-on-plastic) + a chance
   *  of a low hollow thock (the cup body). */
  #rattleGrain(ctx: AudioContext, t: number, intensity: number): void {
    if (!this.#noise) return;
    const vol = 0.1 + intensity * 0.16;

    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2600 + Math.random() * 3400; // bright, plastic
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    const dur = 0.018 + Math.random() * 0.03;
    const peak = vol * (0.5 + Math.random() * 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);

    if (Math.random() < 0.28) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 180 + Math.random() * 130;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(og).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    }
  }

  /** Modulate the rattle density/loudness by shake vigour (0..1). */
  setRattleIntensity(level: number): void {
    if (!this.#rattle) return;
    this.#rattle.intensity = Math.max(0, Math.min(1, level));
  }

  /** Stop the rattle (shaking ended → the dice are released). */
  stopRattle(): void {
    if (!this.#rattle) return;
    clearInterval(this.#rattle.interval);
    this.#rattle = null;
  }

  /** A short blip for nixie digit flips. */
  tick(strength = 0.4): void {
    if (this.muted) return;
    const ctx = this.#ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 2200 + Math.random() * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * strength, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}

export const diceAudio = new DiceAudio();
