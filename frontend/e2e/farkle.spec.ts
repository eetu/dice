import { expect, test } from "@playwright/test";

// Farkle end to end (mobile): host picks Farkle in the lobby, a friend joins
// before anyone rolls (pristine re-deal), and the host rolls. The dice land and a
// resolve action appears (Set aside, or Pass on a bust). The turn/bust/bank logic
// itself is covered deterministically by the backend + scorer unit tests; a random
// live roll can't be asserted further without flakiness.
test("farkle: create, join, and roll (mobile)", async ({ browser }) => {
  const aliceCtx = await browser.newContext({
    viewport: { width: 390, height: 800 },
  });
  const bobCtx = await browser.newContext({
    viewport: { width: 390, height: 800 },
  });
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Farkle", exact: true }).click();
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = alice.url().split("/g/")[1];

  await bob.goto(`/g/${code}`);
  await bob.getByPlaceholder("Anonymous").fill("Bob");
  await bob.getByRole("button", { name: "Join" }).click();

  // Both see the Farkle scoreboard (two player chips), Alice's is the active one.
  await expect(alice.locator(".farkle .chip")).toHaveCount(2);
  await expect(bob.locator(".farkle .chip")).toHaveCount(2);
  // On your own board you're shown as "You"; Alice opens, so she's the active one.
  await expect(alice.locator(".farkle .chip.turn .cn")).toHaveText("You");

  // Alice's turn: roll. The dice land (shown whether or not it's a bust) and a
  // resolve action appears in the footer.
  await alice.locator(".tray button.primary").click();
  await expect(alice.locator(".farkle .dice .dietile").first()).toBeVisible();
  await expect(alice.locator(".tray button.primary")).toBeVisible();
  // Bob sees the same public dice.
  await expect(bob.locator(".farkle .dice .dietile").first()).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});
