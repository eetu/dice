import { describe, expect, it } from "vitest";

import { en } from "../en";
import { fi } from "../fi";

// `Catalog = typeof en` makes svelte-check enforce the TOP level, but nested
// records (joinFail, farkleRuleName, …) are where hand-maintained translations
// actually rot — a missing key there is a runtime `undefined` in the UI.
function nestedKeys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? nestedKeys(v as object, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("i18n catalogs", () => {
  it("fi mirrors en exactly, nested keys included", () => {
    expect(nestedKeys(fi).sort()).toEqual(nestedKeys(en).sort());
  });

  it("has a message for every join/connect failure reason", () => {
    // Mirrors FailReason in api.ts; `satisfies` there catches an omission at
    // build time, this catches a stray or renamed one.
    const reasons = [
      "notfound",
      "full",
      "busy",
      "throttled",
      "offline",
      "timeout",
      "unreachable",
      "wsRefused",
      "unknown",
    ];
    expect(Object.keys(en.joinFail).sort()).toEqual([...reasons].sort());
    for (const r of reasons) {
      const entry = en.joinFail[r as keyof typeof en.joinFail];
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.body.length).toBeGreaterThan(0);
    }
  });
});
