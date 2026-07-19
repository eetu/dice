// Shake-to-roll via DeviceMotion. iOS requires DeviceMotionEvent.requestPermission()
// from a user gesture (the same ceremony as supersaw's TiltBend); Android just
// adds the listener.
//
// Interaction model: while the phone is being shaken the dice "rattle in a cup"
// (a looping sound + the `shaking` flag, updated with the shake vigour); when the
// shaking stops the dice are released and fall — a roll fires. A quick jolt is
// ignored: the shake must be sustained past MIN_SHAKE_MS before a release counts.

type PermissionRequestable = {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
};

const SHAKE_THRESHOLD = 18; // m/s² (incl. gravity ~9.8) that counts as active shaking
const QUIET_MS = 350; // no spike for this long ⇒ shaking stopped (release)
const MIN_SHAKE_MS = 250; // must shake at least this long for the release to roll

const PREF_KEY = "dice:shake";
function wantsShake(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(PREF_KEY) === "1"
  );
}
function savePref(on: boolean): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  }
}

class Shake {
  readonly supported =
    typeof window !== "undefined" && "DeviceMotionEvent" in window;
  enabled = $state(false);
  /** True while the phone is actively being shaken (drives the rattle + UI). */
  shaking = $state(false);
  /** 0..1 shake vigour, for scaling the on-screen shake animation. */
  intensity = $state(0);

  #onStart: (() => void) | null = null;
  #onIntensity: ((level: number) => void) | null = null;
  #onEnd: ((rolled: boolean) => void) | null = null;

  #startedAt = 0;
  #quietTimer: ReturnType<typeof setTimeout> | null = null;

  /** True on iOS Safari, where a permission prompt is required first. */
  get needsPermission(): boolean {
    if (!this.supported) return false;
    const dme = window.DeviceMotionEvent as unknown as PermissionRequestable;
    return typeof dme.requestPermission === "function";
  }

  /** Fires once when a shake session begins. */
  onShakeStart(cb: (() => void) | null): void {
    this.#onStart = cb;
  }
  /** Fires with 0..1 shake vigour while shaking (rattle loudness/speed). */
  onShakeIntensity(cb: ((level: number) => void) | null): void {
    this.#onIntensity = cb;
  }
  /** Fires when shaking stops; `rolled` = it was sustained enough to release. */
  onShakeEnd(cb: ((rolled: boolean) => void) | null): void {
    this.#onEnd = cb;
  }

  async enable(): Promise<boolean> {
    if (!this.supported || this.enabled) return this.enabled;
    if (this.needsPermission) {
      const dme = window.DeviceMotionEvent as unknown as PermissionRequestable;
      try {
        const res = await dme.requestPermission?.();
        if (res !== "granted") return false;
      } catch {
        return false;
      }
    }
    window.addEventListener("devicemotion", this.#onMotion);
    this.enabled = true;
    savePref(true);
    return true;
  }

  disable(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("devicemotion", this.#onMotion);
    }
    this.enabled = false;
    savePref(false);
    this.#finish(false); // stop any in-progress rattle without rolling
  }

  /** Re-arm from the stored on-device preference (call once on mount). Where a
   *  permission prompt is needed (iOS), it can't be requested without a user
   *  gesture, so enable on the first interaction instead. */
  restore(): void {
    if (!this.supported || this.enabled || !wantsShake()) return;
    if (this.needsPermission) {
      window.addEventListener("pointerdown", () => void this.enable(), {
        once: true,
      });
    } else {
      void this.enable();
    }
  }

  #onMotion = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    if (mag < SHAKE_THRESHOLD) return;
    const now = performance.now();
    if (!this.shaking) {
      this.shaking = true;
      this.#startedAt = now;
      this.#onStart?.();
    }
    const level = Math.min(1, (mag - SHAKE_THRESHOLD) / 24);
    this.intensity = level;
    this.#onIntensity?.(level);
    if (this.#quietTimer) clearTimeout(this.#quietTimer);
    this.#quietTimer = setTimeout(() => this.#onQuiet(), QUIET_MS);
  };

  #onQuiet = (): void => {
    this.#quietTimer = null;
    const rolled =
      this.shaking && performance.now() - this.#startedAt >= MIN_SHAKE_MS;
    this.#finish(rolled);
  };

  #finish(rolled: boolean): void {
    if (this.#quietTimer) {
      clearTimeout(this.#quietTimer);
      this.#quietTimer = null;
    }
    if (!this.shaking) return;
    this.shaking = false;
    this.intensity = 0;
    this.#onEnd?.(rolled);
  }
}

export const shake = new Shake();
