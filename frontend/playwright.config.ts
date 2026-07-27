import { defineConfig, devices } from "@playwright/test";

// e2e = the whole stack: the real backend serving the built SPA (one origin, so
// /api + /ws are same-origin, no proxy needed). Build first: `yarn build` +
// `cargo build`. Browsers: `yarn e2e:install`.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  // Serialize on CI so at most one test's two contexts run at once — keeps the
  // shared runner from thrashing and makes failures deterministic.
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3099",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "../target/debug/dice-backend",
    env: {
      DICE_BIND: "127.0.0.1:3099",
      STATIC_DIR: "dist",
      // The whole suite creates/joins from one IP (and the server is reused
      // across runs) — don't let the public-endpoint abuse guards 429 the
      // later specs.
      DICE_RL_CREATE_PER_MIN: "1000",
      DICE_RL_JOIN_PER_MIN: "1000",
      // The error-reporting specs deliberately provoke failures, which beacon.
      DICE_RL_CLIENT_ERR_PER_MIN: "1000",
    },
    url: "http://127.0.0.1:3099/status",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
