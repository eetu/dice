import svelte from "@anarkisti/eslint-config/svelte";

import svelteConfig from "./svelte.config.js";

// Shared house preset (node base + eslint-plugin-svelte + TS parser wiring).
export default [
  ...svelte(svelteConfig),
  { ignores: ["dist/", "build/", ".svelte-kit/", "src/lib/vendor/"] },
  // Build-time constant injected by Vite `define` (see vite.config.ts).
  { languageOptions: { globals: { __APP_VERSION__: "readonly" } } },
  // Build scripts run in node, not the browser.
  {
    files: ["scripts/**"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
];
