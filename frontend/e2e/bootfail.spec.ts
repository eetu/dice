import { expect, test } from "@playwright/test";

// The two ways the app used to render a blank page with nothing to report — the
// exact shape of the bug report that prompted all this ("it didn't work on my
// Android phone", no screenshot, no browser, no error).

// Chrome for Android "block all cookies", Samsung Internet's equivalent, and any
// WebView with DOM storage off (i.e. links opened inside a chat app) make reading
// `window.localStorage` THROW. Every store reads at module-eval time inside the
// root layout's import graph, so that used to kill the whole SPA.
test("the app still works when the browser blocks site data", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: Access is denied for this document");
      },
    });
  });

  await page.goto("/");
  // Rendered, not blank — and the watchdog stayed quiet.
  await expect(
    page.getByRole("button", { name: "Create a game" }),
  ).toBeVisible();
  await expect(page.locator("#boot-fail")).toBeHidden();
  // Says why nothing will be remembered, so it reads as a browser setting.
  await expect(page.getByText(/blocking site data/)).toBeVisible();

  // And a game is fully playable, persistence being the only casualty.
  await page.getByPlaceholder("Anonymous").fill("Blocked");
  await page.getByRole("button", { name: "Create a game" }).click();
  await page.waitForURL(/\/g\/[A-Z0-9]{5}/);
  await expect(page.locator("button.roll")).toHaveText("Roll");
  await page.locator("button.roll").click();
  await expect(page.locator(".history li")).toHaveCount(1);

  await ctx.close();
});

// When the bundle itself can't run (too old a browser, or — as production
// actually did — a stale shell whose chunks now return the HTML shell with a 200,
// which the browser refuses to execute as a module), the inline watchdog in
// app.html is the only code left to say so.
test("a broken bundle shows a reportable failure instead of a blank page", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route("**/_app/immutable/entry/*.js", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html>" }),
  );

  await page.goto("/g/ABCDE");

  const panel = page.locator("#boot-fail");
  await expect(panel).toBeVisible();
  // Must carry what a bug report needs: the build and the browser.
  await expect(panel).toContainText("dice couldn't start.");
  await expect(panel).toContainText("build:");
  await expect(panel).toContainText("browser: Mozilla/");
  await expect(panel).toContainText("/g/ABCDE");

  await ctx.close();
});
