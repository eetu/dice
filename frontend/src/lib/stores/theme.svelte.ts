// UI theme preference: auto / light / dark. This is *personal* chrome (persisted
// per device). The DICE material theme is separate and room-wide — it lives in
// the game snapshot (diceTheme) and is applied as data-dice-theme (see the game
// route). The resolved light|dark is written to data-theme on <html> by the root
// layout, which the halo tokens key off.

export type ThemeMode = "auto" | "light" | "dark";
export type Resolved = "light" | "dark";

const KEY = "dice:theme";

function initialMode(): ThemeMode {
  if (typeof localStorage === "undefined") return "auto";
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "auto" ? v : "auto";
}

function systemDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolve(mode: ThemeMode): Resolved {
  if (mode !== "auto") return mode;
  return systemDark() ? "dark" : "light";
}

export const theme = $state<{ mode: ThemeMode; resolved: Resolved }>({
  mode: initialMode(),
  resolved: resolve(initialMode()),
});

export function setTheme(mode: ThemeMode): void {
  theme.mode = mode;
  theme.resolved = resolve(mode);
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, mode);
}

// Cycle for the single toolbar button: auto → light → dark → auto.
const ORDER: ThemeMode[] = ["auto", "light", "dark"];
export function cycleTheme(): void {
  setTheme(ORDER[(ORDER.indexOf(theme.mode) + 1) % ORDER.length]);
}

/** Re-resolve on live OS changes while in `auto` (call once from the layout). */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (theme.mode === "auto") theme.resolved = resolve("auto");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
