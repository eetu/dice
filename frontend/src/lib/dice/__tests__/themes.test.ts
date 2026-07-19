import { describe, expect, it } from "vitest";

import { DEFAULT_THEME, themeByName, THEMES } from "../themes";

describe("dice themes", () => {
  it("includes the default theme", () => {
    expect(THEMES.some((t) => t.name === DEFAULT_THEME)).toBe(true);
  });

  it("themeByName resolves known names and falls back for unknown ones", () => {
    expect(themeByName("ivory").name).toBe("ivory");
    expect(themeByName("does-not-exist")).toBe(THEMES[0]);
  });

  it("has exactly one nixie theme with a glow colour", () => {
    const nixie = THEMES.filter((t) => t.nixie);
    expect(nixie).toHaveLength(1);
    expect(nixie[0].nixieColor).toBeTruthy();
  });
});
