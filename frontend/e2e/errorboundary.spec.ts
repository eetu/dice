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
