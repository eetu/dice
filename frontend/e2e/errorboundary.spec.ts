import { expect, type Page, test } from "@playwright/test";

// Coverage of the "started, then broke" half of error handling. A throw during
// render or inside an $effect is invisible to SvelteKit's handleError (that only
// sees load/navigation), so without a boundary it left a half-dead screen and no
// report. Both halves are asserted: the user gets something actionable, and the
// backend hears about it with the right `kind`.

// Playwright can't read a `sendBeacon` Blob body, so capture the payloads in the
// page instead — this asserts exactly what the app tries to send.
async function captureBeacons(page: Page) {
  await page.addInitScript(() => {
    const captured: unknown[] = [];
    Object.defineProperty(window, "__beacons", { value: captured });
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: (_url: string, body: Blob) => {
        captured.push(body);
        return true;
      },
    });
  });
}

async function beaconKinds(
  page: Page,
): Promise<{ kind: string; message: string }[]> {
  return page.evaluate(async () => {
    const blobs = (window as unknown as { __beacons: Blob[] }).__beacons;
    return Promise.all(
      blobs.map(async (b) => JSON.parse(await b.text()) as never),
    );
  });
}

test("a render error shows the error card and reports itself as 'render'", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await captureBeacons(page);

  // Hijack the game socket and feed it a structurally wrong snapshot: `players`
  // as a string makes a $derived call .filter() on it, which throws while
  // rendering — the exact class of failure a boundary exists for.
  await page.routeWebSocket(/\/ws\/games\//, (ws) => {
    ws.send(
      JSON.stringify({
        type: "sync",
        state: {
          code: "ABCDE",
          players: "not-an-array",
          turnIdx: 0,
          currentPlayerId: null,
          diceSet: [],
          history: [],
          mode: "free",
          diceTheme: "ivory",
          deck: "felt",
        },
      }),
    );
  });

  await page.goto("/");
  await page.getByPlaceholder("Anonymous").fill("Boom");
  await page.getByRole("button", { name: "Create a game" }).click();

  // The boundary's fallback, not a blank or half-rendered table.
  await expect(
    page.getByRole("heading", { name: "Something broke" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  // Carrying what a report needs.
  const card = page.locator("pre.diag");
  await expect(card).toContainText("build:");
  await expect(card).toContainText("browser: Mozilla/");

  await expect
    .poll(async () => (await beaconKinds(page)).map((b) => b.kind))
    .toContain("render");

  await ctx.close();
});

// Shipped bug, caught by its own telemetry within the hour: the watchdog's
// timeout fired on every session that stayed open past it, and since the app HAD
// booted, `show()` relabelled it `runtime` — so a healthy page reported
// "timed out waiting for the app to start". One false report per session, which
// would bury every real signal.
test("a healthy page reports nothing, even past the watchdog timeout", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // BEFORE navigating: the watchdog's timer is registered during page load, and a
  // clock installed afterwards can't wind a timer the real clock already owns
  // (which quietly made this test vacuous the first time).
  await page.clock.install();
  await captureBeacons(page);

  await page.goto("/");
  // The app must still boot under a faked clock, or the rest proves nothing.
  await expect(
    page.getByRole("button", { name: "Create a game" }),
  ).toBeVisible();

  await page.clock.fastForward("00:30"); // well past the 12s watchdog

  expect(await beaconKinds(page)).toEqual([]);
  await expect(page.locator("#boot-fail")).toBeHidden();

  await ctx.close();
});

// A dead or expired code is the single most common 404 on this app. It's a normal
// outcome with a correct message, not an app failure worth reporting.
test("an expired game code is not reported as an error", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await captureBeacons(page);
  await page.addInitScript(() => localStorage.setItem("dice:name", "Guest"));

  await page.goto("/g/ZZZZZ");
  await expect(
    page.getByRole("heading", { name: "Game not found" }),
  ).toBeVisible();

  expect(await beaconKinds(page)).toEqual([]);

  await ctx.close();
});

test("an uncaught error after boot reports as 'runtime', not 'boot'", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await captureBeacons(page);

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Create a game" }),
  ).toBeVisible();

  // Async, so it lands on window.onerror rather than anywhere Svelte can see —
  // the case a boundary explicitly does NOT cover, hence the watchdog's handlers.
  await page.evaluate(() =>
    setTimeout(() => {
      throw new Error("post-boot boom");
    }, 0),
  );

  // "boot" would be a lie: the app started fine and broke later, and the two need
  // to be distinguishable in the telemetry.
  await expect
    .poll(async () => await beaconKinds(page))
    .toEqual([
      expect.objectContaining({
        kind: "runtime",
        message: expect.stringContaining("post-boot boom"),
      }),
    ]);
  // And a running app is never shouted over by the pre-boot panel.
  await expect(page.locator("#boot-fail")).toBeHidden();

  await ctx.close();
});
