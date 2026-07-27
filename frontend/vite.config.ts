import { readFileSync } from "node:fs";

import { sveltekit } from "@sveltejs/kit/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";
import { qrcode } from "vite-plugin-qrcode";

// App version baked in at build time (shown as a small tag in the UI). Kept in
// lockstep with the Cargo workspace version by hand — one release, one number.
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

// Same version, reachable from `app.html` as %sveltekit.env.PUBLIC_APP_VERSION%
// (the `define` below only substitutes inside the bundle, and app.html's boot
// watchdog has to work when the bundle is exactly what's broken). SvelteKit
// requires the PUBLIC_ prefix for template env vars.
process.env.PUBLIC_APP_VERSION = pkg.version;

// Vite dev server (:5173). Output → dist/ (adapter-static), embedded/served by
// the Rust backend in prod. In dev, proxy the backend routes so the SPA is
// same-origin too. The backend listens on :3040 (DICE_BIND default).
//
// `yarn dev:host` (or `just dev host`) exposes the dev server on the LAN over
// HTTPS and prints the network URL (+ a QR to scan), so a phone/tablet can
// connect. HTTPS matters here: iOS gates DeviceMotion (shake-to-roll) — and
// requestPermission — to secure contexts, so plain http over the LAN can't test
// it. Self-signed cert (accept the one-time device warning). Off by default so
// plain `yarn dev` + the vitest browser tests stay localhost/http.
const exposeHost = !!process.env.DEV_HOST;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Pin the syntax floor instead of inheriting Vite's default
  // (`baseline-widely-available` ≈ Chrome 111), which quietly excluded browsers
  // that are still very much in use on Android: Samsung Internet 13/14 (Chromium
  // 87/92, the stock browser on Galaxy phones) and pinned Android System WebViews
  // (what every in-app browser renders in). es2020 ≈ Chromium 87. The 3D engine
  // is dynamic-imported (see DiceStage.svelte), so a dependency needing newer
  // syntax can no longer take the whole route down with it.
  build: { target: "es2020" },
  plugins: [sveltekit(), ...(exposeHost ? [basicSsl(), qrcode()] : [])],
  server: {
    ...(exposeHost ? { host: true } : {}),
    // The proxy runs on this machine, so `localhost` still reaches the backend
    // even when a phone hits the dev server over the LAN.
    proxy: {
      "/api": "http://localhost:3040",
      "/status": "http://localhost:3040",
      // WebSocket upgrade needs `ws: true` or the handshake 404s.
      "/ws": { target: "ws://localhost:3040", ws: true },
    },
  },
});
