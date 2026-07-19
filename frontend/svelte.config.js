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
  },
};

export default config;
