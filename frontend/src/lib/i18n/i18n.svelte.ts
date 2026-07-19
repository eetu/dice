// Tiny rune-based i18n. Components read `i18n.m.<key>` (reactive on `lang`).
// Default = the browser language (Finnish device → fi, else en), overridable and
// persisted. No dependency; catalogs are typed so a missing key fails the build.

import { type Catalog, en } from "./en";
import { fi } from "./fi";

const CATALOGS: Record<string, Catalog> = { en, fi };
const KEY = "dice:lang";

function initialLang(): string {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in CATALOGS) return saved;
  }
  if (
    typeof navigator !== "undefined" &&
    navigator.language?.toLowerCase().startsWith("fi")
  ) {
    return "fi";
  }
  return "en";
}

class I18n {
  lang = $state(initialLang());

  /** The active catalog — reads `lang`, so `i18n.m.foo` is reactive. */
  get m(): Catalog {
    return CATALOGS[this.lang] ?? en;
  }

  get available(): string[] {
    return Object.keys(CATALOGS);
  }

  set(lang: string): void {
    this.lang = lang in CATALOGS ? lang : "en";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(KEY, this.lang);
    }
  }
}

export const i18n = new I18n();
