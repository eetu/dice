import { expect, test } from "@playwright/test";

// Codes are recycled once a room is freed, so a stored seat can point at a LIVE
// game it isn't a member of. The server used to close such a socket the same way
// it closes an unknown room, so the client told the player "this game expired" —
// untrue, and a dead end. Now it's close code 4401 and an automatic rejoin.

test("a stale saved seat on a live game rejoins instead of dead-ending", async ({
  browser,
}) => {
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto("/");
  await host.getByPlaceholder("Anonymous").fill("Host");
  await host.getByRole("button", { name: "Create a game" }).click();
  await host.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = host.url().split("/g/")[1];

  // A guest who "remembers" a seat in this game — but with a token the room has
  // never heard of (what a recycled code looks like on the client).
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.addInitScript(
    ({ code }) => {
      localStorage.setItem("dice:name", "Guest");
      localStorage.setItem(
        `dice:game:${code}`,
        JSON.stringify({
          playerId: "not-a-real-player",
          token: "not-a-real-token",
        }),
      );
    },
    { code },
  );

  await guest.goto(`/g/${code}`);

  // Seated, not stranded: both screens show two players, and the guest can play.
  await expect(guest.locator(".players li")).toHaveCount(2);
  await expect(host.locator(".players li")).toHaveCount(2);
  await expect(
    guest.getByRole("heading", { name: "Game ended" }),
  ).not.toBeVisible();
  // And it's explained, rather than silently moving them down the list.
  await expect(guest.getByText(/old seat in this game is gone/)).toBeVisible();

  await guestCtx.close();
  await hostCtx.close();
});

test("a stale saved seat on a dead code still reports not found", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("dice:name", "Guest");
    localStorage.setItem(
      "dice:game:ZZZZZ",
      JSON.stringify({ playerId: "x", token: "y" }),
    );
  });

  await page.goto("/g/ZZZZZ");

  await expect(
    page.getByRole("heading", { name: "Game not found" }),
  ).toBeVisible();
  await ctx.close();
});
