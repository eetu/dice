import { expect, test } from "@playwright/test";

// Rejoin / drop scenarios — the reconnect path is load-bearing (phones sleep,
// wifi flaps) and was a source of 1.0 inconsistencies. Each test drives the real
// stack (backend + built SPA), same as the golden path.

// A reload keeps the same identity (stored creds re-attach) — it must NOT spawn a
// duplicate player, and the game stays playable.
test("reloading rejoins as the same player, not a duplicate", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const alice = await ctx.newPage();

  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);

  await expect(alice.locator(".players li")).toHaveCount(1);
  await expect(alice.locator("button.roll")).toHaveText("Roll");

  // Drop + come back: a reload closes the socket and re-connects with the stored
  // token, so the room recognizes the same player.
  await alice.reload();

  await expect(alice.locator(".players li")).toHaveCount(1);
  await expect(alice.locator("button.roll")).toHaveText("Roll");

  await ctx.close();
});

// Leaving as the sole player destroys the room immediately — revisiting the code
// then reports "not found" (no stale/zombie board to rejoin).
test("leaving as the last player destroys the room", async ({ browser }) => {
  const ctx = await browser.newContext();
  const alice = await ctx.newPage();

  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = alice.url().split("/g/")[1];

  // Leave (header button → confirm in the dialog) → back to the lobby.
  await alice.locator("header button.leave").click();
  await alice.locator("button.danger").click();
  await alice.waitForURL(/\/$/);

  // The code is gone: revisiting it surfaces the not-found notice.
  await alice.goto(`/g/${code}`);
  await expect(alice.getByText("Game not found")).toBeVisible();

  await ctx.close();
});

// When the current player drops, the table waits — but anyone can force past them
// with the manual Skip, and the turn advances.
test("a dropped current player can be skipped", async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = alice.url().split("/g/")[1];

  await bob.goto(`/g/${code}`);
  await bob.getByPlaceholder("Anonymous").fill("Bob");
  await bob.getByRole("button", { name: "Join" }).click();
  await expect(alice.locator(".players li")).toHaveCount(2);

  // Alice rolls → the turn passes to Bob.
  await alice.locator("button.roll").click();
  await expect(alice.locator("button.roll")).toContainText("turn");

  // Bob drops (closes his context) — Alice sees his turn stall and a Skip appears.
  await bobCtx.close();
  await expect(alice.locator("button.skip")).toBeVisible();

  // Skipping forces past Bob → the turn comes back to Alice.
  await alice.locator("button.skip").click();
  await expect(alice.locator("button.roll")).toHaveText("Roll");

  await aliceCtx.close();
});
