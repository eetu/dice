import adapter from "@sveltejs/adapter-static";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    // Force runes mode (Svelte 5). Can be removed in Svelte 6.
    runes: ({ filename }) =>
      filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
  },
  kit: {
    // Pure SPA: the Rust backend embeds this and serves index.html for every
    // unmatched path. Output to dist/ (STATIC_DIR) with a 200-status fallback.
    adapter: adapter({
      pages: "dist",
      assets: "dist",
      fallback: "index.html",
      precompress: false,
      strict: true,
    }),
    // Detect a new deploy: SvelteKit polls `_app/version.json` (its `version.name`
    // defaults to a unique build timestamp, so it changes on every build — incl.
    // `:main` rebuilds that don't bump the Cargo semver) and flips `updated`. The
    // root layout reloads on it. Frontend + backend ship in one image, so a new
    // build == a redeploy, which also wipes the in-memory games — so a reload is
    // safe (there's no live game to lose).
    version: {
      pollInterval: 60_000,
    },
  },
};

export default config;
