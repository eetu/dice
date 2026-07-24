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

  /** A die impact on a solid table, shaped by the `material` (felt / wood /
   *  concrete / metal) and the dice `theme`. The low "knock" is the thunk (body)
   *  and stays prominent; felt muffles the highs, metal rings. The liquid table
   *  uses `splash()` instead. `strength` ∈ 0..1 = volume. */
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

  /** A water splash — dice landing on the liquid table. A soft "bloop" entry, a
   *  low-passed "shhp" of settling water, and a low round gloop or two — kept
   *  rounded (no sharp clicks / high blips). `strength` ∈ 0..1 = volume. */
  splash(strength = 0.6): void {
    if (this.muted) return;
    const ctx = this.#ensure();
    if (!ctx || !this.#noise) return;
    const t = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1, strength));

    // Entry "bloop" — a low descending sine (rounded, no click).
    const bloop = ctx.createOscillator();
    bloop.type = "sine";
    bloop.frequency.setValueAtTime(360 + Math.random() * 90, t);
    bloop.frequency.exponentialRampToValueAtTime(150, t + 0.13);
    const bpg = ctx.createGain();
    bpg.gain.setValueAtTime(0.0001, t);
    bpg.gain.exponentialRampToValueAtTime(0.4 * vol, t + 0.012);
    bpg.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    bloop.connect(bpg).connect(ctx.destination);
    bloop.start(t);
    bloop.stop(t + 0.2);

    // Spray — noise through a LOW-PASS sweeping down: a soft "shhp", not a hiss.
    const spray = ctx.createBufferSource();
    spray.buffer = this.#noise;
    spray.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2000, t);
    lp.frequency.exponentialRampToValueAtTime(450, t + 0.3);
    lp.Q.value = 0.4;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.14 * vol, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    spray.connect(lp).connect(sg).connect(ctx.destination);
    spray.start(t);
    spray.stop(t + 0.36);

    // A low round "gloop" or two — much lower pitch + gentler than before.
    const bubbles = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < bubbles; i++) {
      const bt = t + 0.04 + Math.random() * 0.13;
      const f0 = 150 + Math.random() * 170; // 150–320 Hz (was 500–1000)
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f0, bt);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.5, bt + 0.12);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, bt);
      bg.gain.exponentialRampToValueAtTime(0.09 * vol, bt + 0.012);
      bg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.17);
      osc.connect(bg).connect(ctx.destination);
      osc.start(bt);
      osc.stop(bt + 0.19);
    }
  }

  /** One low-passed note — the building block of the 8-bit sounds (roll tumble,
   *  win fanfare). Square by default (the pulse-channel lead/harmony); pass
   *  `type: "triangle"` for the bass voice. The low-pass keeps the square's edge
   *  mellow. `t` = start time, `peak` = level, `dur` = decay length. */
  #note(
    ctx: AudioContext,
    t: number,
    freq: number,
    peak: number,
    dur: number,
    cutoff = 2600,
    type: OscillatorType = "square",
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp).connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A quick roll — for the flat-tile games (Liar's Dice / Yatzy / Farkle) that
   *  have no physics engine. A retro chiptune "tumble": a fast run of square
   *  blips hopping around a pentatonic scale, thinning as the dice settle, capped
   *  by a lower resolve note. (The 3D dice keep their physical clack/splash.) */
  roll(n = 5): void {
    if (this.muted) return;
    const ctx = this.#ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const steps = Math.min(13, 7 + n);
    // C-major pentatonic (C D E G A) — random hops read musical, not noisy.
    const scale = [523, 587, 659, 784, 880];
    let t = t0;
    for (let i = 0; i < steps; i++) {
      const frac = i / steps; // dense at first, thinning as it settles
      const f = scale[Math.floor(Math.random() * scale.length)];
      this.#note(ctx, t, f, 0.11 * (1 - frac) + 0.03, 0.05);
      t += 0.026 + frac * 0.03;
    }
    // Resolve note — lower + a touch longer, marking the dice coming to rest.
    this.#note(ctx, t + 0.02, 392, 0.13, 0.14);
  }

  /** A triumphant 8-bit victory fanfare, played once over the winner fireworks.
   *  A "Course Clear"-style *homage* (an original phrase, not the real tune): a
   *  triplet arpeggio climb that resolves through the "Mario cadence" — the
   *  whole-step ♭VI→♭VII→I ascent (here Ab→Bb→C) that gives the level-clear its
   *  lift. Three voices matching the NES 2A03's exactly-three tonal channels: a
   *  pulse lead (top), a pulse harmony a chord-tone below, and a triangle bass. */
  fanfare(): void {
    if (this.muted) return;
    const ctx = this.#ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dt = 0.1; // triplet-eighth step

    // [lead, harmony] per triplet step (Hz). Harmony trails a chord tone below.
    // Climb over I (C), then arpeggiate ♭VI (Ab) and ♭VII (Bb) before landing.
    const steps: Array<[number, number]> = [
      [392, 330], // G4  / E4   ─ I climb
      [523, 392], // C5  / G4
      [659, 523], // E5  / C5
      [784, 659], // G5  / E5
      [831, 622], // Ab5 / Eb5  ─ ♭VI
      [1047, 831], // C6  / Ab5
      [1245, 1047], // Eb6 / C6
      [932, 698], // Bb5 / F5   ─ ♭VII
      [1175, 932], // D6  / Bb5
      [1397, 1175], // F6  / D6
    ];
    let t = t0;
    steps.forEach(([hi, lo], i) => {
      const accent = i === 0 || i === 4 || i === 7; // chord downbeats
      const v = accent ? 0.2 : 0.14;
      this.#note(ctx, t, hi, v, 0.09); // pulse 1 — lead
      this.#note(ctx, t, lo, v * 0.6, 0.09); // pulse 2 — harmony
      t += dt;
    });

    // Land on a held tonic (C major: C6 + E5, octave-doubled in the bass).
    const tf = t + 0.02;
    this.#note(ctx, tf, 1047, 0.2, 0.62); // C6 lead
    this.#note(ctx, tf, 659, 0.12, 0.62); // E5 harmony

    // Triangle bass — one sustained root per chord region, then the resolve.
    this.#note(ctx, t0, 130.81, 0.22, 0.4, 1400, "triangle"); // C3  under I
    this.#note(ctx, t0 + dt * 4, 103.83, 0.22, 0.3, 1400, "triangle"); // Ab2 under ♭VI
    this.#note(ctx, t0 + dt * 7, 116.54, 0.22, 0.3, 1400, "triangle"); // Bb2 under ♭VII
    this.#note(ctx, tf, 65.41, 0.24, 0.72, 1400, "triangle"); // C2  resolve
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

  /** A short, dry retro tick for toggling a die — hold (Yatzy), set-aside select
   *  (Farkle), or face pick (Liar's). A low-passed square (same 8-bit family as
   *  `plop` / the nixie `tick`) that steps up when selecting and down when
   *  releasing, so a toggle reads by ear. Shared by every game with dice
   *  selection. `on` = selecting (vs releasing). */
  blip(on = true): void {
    if (this.muted) return;
    const ctx = this.#ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const f0 = on ? 480 : 440;
    const f1 = on ? 600 : 340;
    const osc = ctx.createOscillator();
    osc.type = "square"; // retro edge, tamed by the low-pass below
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + 0.035);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2000;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(lp).connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** A dry, retro "place" tok for scoring a Yatzy box — a short square-wave note
   *  (tamed by a low-pass) that settles down a touch, in the same 8-bit family as
   *  the nixie `tick` rather than a cartoon bottle-pop. A restrained hollow tap
   *  underneath gives it body. `strength` ∈ 0..1 = volume. */
  plop(strength = 0.7): void {
    if (this.muted) return;
    const ctx = this.#ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1, strength));

    // Main tone — a square (retro timbre) with only a slight downward settle, so
    // it reads as "placed" not a comedic boing. Low-passed so the square edge
    // stays mellow rather than buzzy.
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1700;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14 * vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(lp).connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);

    // A restrained hollow tap underneath for body — band-passed noise, gentler Q
    // and lower level than before so it's a tap, not a whistle.
    if (this.#noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.#noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(560, t);
      bp.frequency.exponentialRampToValueAtTime(760, t + 0.04);
      bp.Q.value = 6; // hollow, but not a focused ring
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.005);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(bp).connect(gn).connect(ctx.destination);
      src.start(t);
      src.stop(t + 0.09);
    }
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
