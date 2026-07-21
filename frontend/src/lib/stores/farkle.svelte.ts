// Farkle state, driven by the public `farkle` WS message. Like Yatzy nothing is
// hidden — every client gets the same view. The board reads `farkle.view`.

import type { FarkleView } from "$lib/api";

class Farkle {
  view = $state<FarkleView | null>(null);

  apply(view: FarkleView): void {
    this.view = view;
  }

  reset(): void {
    this.view = null;
  }
}

export const farkle = new Farkle();
