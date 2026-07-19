// The reactive room state, driven by WS messages. Components read `game.snapshot`
// directly; the dice stage watches `game.lastRoll` to launch an animation.

import type { RollRecord, Snapshot } from "$lib/api";

class Game {
  snapshot = $state<Snapshot | null>(null);
  /** Bumped on every `rolled` message (own rolls and others') — the dice stage
   *  keys its animation off this. */
  lastRoll = $state<RollRecord | null>(null);
  /** True while a roll animates — disables the Roll button during the throw. */
  rolling = $state(false);
  #rollTimer: ReturnType<typeof setTimeout> | null = null;

  reset(): void {
    this.snapshot = null;
    this.lastRoll = null;
    this.endRoll();
  }

  /** Clear the rolling state (called on settle, or by the safety timeout). */
  endRoll(): void {
    this.rolling = false;
    if (this.#rollTimer) {
      clearTimeout(this.#rollTimer);
      this.#rollTimer = null;
    }
  }

  applySync(state: Snapshot): void {
    this.snapshot = state;
    // Keep the "last roll" caption consistent with renamed history.
    const last = this.lastRoll;
    if (last) {
      const rec = state.history.find((r) => r.id === last.id);
      if (rec) this.lastRoll = rec;
    }
  }

  applyRolled(
    record: RollRecord,
    turnIdx: number,
    currentPlayerId: string | null,
  ): void {
    if (this.snapshot) {
      this.snapshot.history.push(record);
      this.snapshot.turnIdx = turnIdx;
      this.snapshot.currentPlayerId = currentPlayerId;
    }
    this.lastRoll = record;
    this.rolling = true;
    if (this.#rollTimer) clearTimeout(this.#rollTimer);
    // Safety cap in case a settle callback never arrives (e.g. nixie / WebGL off).
    this.#rollTimer = setTimeout(() => this.endRoll(), 2600);
  }

  applyPresence(playerId: string, connected: boolean): void {
    const p = this.snapshot?.players.find((x) => x.id === playerId);
    if (p) p.connected = connected;
  }
}

export const game = new Game();
