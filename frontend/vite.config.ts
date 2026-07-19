import { sveltekit } from "@sveltejs/kit/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";
import { qrcode } from "vite-plugin-qrcode";

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
