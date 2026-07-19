// Screen Wake Lock: keep the display awake while the game is in the foreground.
// A slow multi-player round shouldn't let the phone sleep — sleeping drops the
// WebSocket and marks the player offline. The lock auto-releases when the tab is
// hidden, so we re-acquire on visibility change. Best-effort: unsupported or
// denied (e.g. low battery) is a silent no-op.

class WakeLock {
  #sentinel: WakeLockSentinel | null = null;
  #active = false;

  get supported(): boolean {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }

  async #acquire(): Promise<void> {
    if (!this.#active || this.#sentinel) return;
    try {
      this.#sentinel = await navigator.wakeLock.request("screen");
      this.#sentinel.addEventListener("release", () => {
        this.#sentinel = null;
      });
    } catch {
      // denied / not allowed right now (e.g. tab not visible) — ignore.
    }
  }

  #onVisibility = (): void => {
    if (document.visibilityState === "visible") void this.#acquire();
  };

  /** Start holding the lock (call on mount; safe to call when unsupported). */
  enable(): void {
    if (!this.supported || this.#active) return;
    this.#active = true;
    document.addEventListener("visibilitychange", this.#onVisibility);
    void this.#acquire();
  }

  /** Release the lock (call on unmount). */
  disable(): void {
    this.#active = false;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.#onVisibility);
    }
    void this.#sentinel?.release();
    this.#sentinel = null;
  }
}

export const wakeLock = new WakeLock();
