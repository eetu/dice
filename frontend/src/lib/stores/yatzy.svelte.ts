// Yatzy state, driven by the public `yatzy` WS message. Unlike Liar's Dice
// nothing is hidden — every client gets the same view (dice, holds, scorecards,
// and a live preview of what each open box would score). The board reads
// `yatzy.view` directly.

import type { YatzyView } from "$lib/api";

class Yatzy {
  view = $state<YatzyView | null>(null);

  apply(view: YatzyView): void {
    this.view = view;
  }

  reset(): void {
    this.view = null;
  }
}

export const yatzy = new Yatzy();
