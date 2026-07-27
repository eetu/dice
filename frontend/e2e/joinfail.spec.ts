import { expect, test } from "@playwright/test";

// Every join failure except 404 used to collapse into one "Something went wrong
// reaching the server", so a full room, a rate limit and a dead server were
// indistinguishable — to the player AND to whoever they reported it to. These are
// client-side mapping tests (the server's own status codes are covered by the
// Rust integration suite), so they stub the response.

async function createGame(browser: import("@playwright/test").Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByPlaceholder("Anonymous").fill("Host");
  await page.getByRole("button", { name: "Create a game" }).click();
  await page.waitForURL(/\/g\/[A-Z0-9]{5}/);
  return { ctx, code: page.url().split("/g/")[1] };
}

const CASES = [
  {
    status: 409,
    body: { error: "game is full" },
    heading: "This game is full",
  },
  {
    status: 429,
    body: { error: "too many requests" },
    heading: "Too many attempts",
  },
  {
    status: 503,
    body: { error: "server is at capacity" },
    heading: "The server is full",
  },
];

for (const c of CASES) {
  test(`a ${c.status} join says what actually went wrong`, async ({
    browser,
  }) => {
    const { ctx: hostCtx, code } = await createGame(browser);

    const guestCtx = await browser.newContext();
    const guest = await guestCtx.newPage();
    await guest.route("**/api/games/*/join", (route) =>
      route.fulfill({ status: c.status, json: c.body }),
    );

    await guest.goto(`/g/${code}`);
    // Refused, so there is no seat and no rename dialog — just the error.

    await expect(guest.getByRole("heading", { name: c.heading })).toBeVisible();
    // The server's own words, verbatim and selectable, so they can be relayed.
    await expect(guest.locator("code.diag")).toContainText(String(c.status));
    await expect(guest.locator("code.diag")).toContainText(c.body.error);
    // Still offers a way forward.
    await expect(guest.getByRole("button", { name: "Retry" })).toBeVisible();

    await guestCtx.close();
    await hostCtx.close();
  });
}
