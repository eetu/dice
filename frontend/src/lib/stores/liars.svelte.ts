// Liar's Dice state, driven by the personalized `liars` WS message. Each socket
// only ever receives its OWN hand in full (others by count) — see room.rs. The
// board reads `liars.view` directly.

import type { LiarsView } from "$lib/api";

class Liars {
  view = $state<LiarsView | null>(null);

  apply(view: LiarsView): void {
    this.view = view;
  }

  reset(): void {
    this.view = null;
  }
}

export const liars = new Liars();
