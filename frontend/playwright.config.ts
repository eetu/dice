import { defineConfig, devices } from "@playwright/test";

// e2e = the whole stack: the real backend serving the built SPA (one origin, so
// /api + /ws are same-origin, no proxy needed). Build first: `yarn build` +
// `cargo build`. Browsers: `yarn e2e:install`.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3099",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "../target/debug/dice-backend",
    env: { DICE_BIND: "127.0.0.1:3099", STATIC_DIR: "dist" },
    url: "http://127.0.0.1:3099/status",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
