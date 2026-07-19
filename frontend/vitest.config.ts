import { defineConfig } from "vitest/config";

// Node unit project only (pure logic). Browser/component tests (real chromium via
// @vitest/browser-playwright) can be added later as a second project matching
// *.svelte.test.ts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.svelte.test.ts"],
        },
      },
    ],
  },
});
