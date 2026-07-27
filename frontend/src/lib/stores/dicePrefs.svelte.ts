// On-device dice rendering preferences (not synced — a personal visual choice,
// like light/dark). Currently just `rounded` (soft vs flat-faceted dice bodies).

import { storage } from "$lib/storage";

const ROUNDED_KEY = "dice:rounded";

function readRounded(): boolean {
  // Default on; only an explicit "0" turns it off.
  return storage.get(ROUNDED_KEY) !== "0";
}

class DicePrefs {
  rounded = $state(readRounded());

  setRounded(on: boolean): void {
    this.rounded = on;
    storage.set(ROUNDED_KEY, on ? "1" : "0");
  }
}

export const dicePrefs = new DicePrefs();
