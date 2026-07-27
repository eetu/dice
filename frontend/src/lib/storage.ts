// Every persisted on-device preference (display name, per-game creds, theme,
// language, mute, shake) goes through here instead of touching `localStorage`
// directly.
//
// Why: `typeof localStorage === "undefined"` is NOT a safe guard. `localStorage`
// is a getter on Window, and it *throws* `SecurityError` when the browser is set
// to block site data — Chrome for Android "block all cookies", Samsung Internet
// "block cookies and site data", and any hand-rolled Android WebView (where DOM
// storage defaults to off, i.e. links opened inside a chat app). `typeof`
// evaluates the getter, so it throws instead of guarding. Each store reads its
// initial value at module-eval time inside the ROOT LAYOUT's import graph, so a
// single throw there renders an empty <body>: the app looks broken rather than
// merely forgetful.
//
// Nothing here throws. When the real store is unusable we keep values in memory
// for the tab, so a game is fully playable and just doesn't survive a reload.

const mem = new Map<string, string>();

// `undefined` = not probed yet; `null` = probed and unusable. Memoized so the
// throwing getter is touched exactly once.
let backing: Storage | null | undefined;

function probe(): Storage | null {
  try {
    // A real write, not just a read: some engines hand out a readable store
    // whose `setItem` throws (Safari private mode, any zero-quota config).
    const s = globalThis.localStorage;
    s.setItem("dice:probe", "1");
    s.removeItem("dice:probe");
    return s;
  } catch {
    return null;
  }
}

function store(): Storage | null {
  if (backing === undefined) backing = probe();
  return backing;
}

export const storage = {
  get(key: string): string | null {
    const s = store();
    if (!s) return mem.get(key) ?? null;
    try {
      return s.getItem(key);
    } catch {
      return mem.get(key) ?? null;
    }
  },

  set(key: string, value: string): void {
    const s = store();
    if (s) {
      try {
        s.setItem(key, value);
        return;
      } catch {
        /* over quota — at least keep it for this tab */
      }
    }
    mem.set(key, value);
  },

  remove(key: string): void {
    mem.delete(key);
    const s = store();
    if (!s) return;
    try {
      s.removeItem(key);
    } catch {
      /* gone from `mem` either way */
    }
  },

  /** True when this device persists nothing — prefs and the saved seat live
   *  only until reload. Surfaced in the UI so it reads as a browser setting
   *  instead of a bug. */
  get blocked(): boolean {
    return store() === null;
  },
};
