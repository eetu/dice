import svelte from "@anarkisti/eslint-config/svelte";

import svelteConfig from "./svelte.config.js";

// Shared house preset (node base + eslint-plugin-svelte + TS parser wiring).
export default [
  ...svelte(svelteConfig),
  { ignores: ["dist/", "build/", ".svelte-kit/", "src/lib/vendor/"] },
];
