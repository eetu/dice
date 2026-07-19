import { expect, test } from "@playwright/test";

// Golden path across two independent players (separate browser contexts =
// separate localStorage identities): create → join → roll in turns, and the
// result streams to both screens live. Also exercises the real SPA runtime
// (stores, WebSocket, and the dice stage booting) end to end.
test("two players roll in turns and both see the result", async ({
  browser,
}) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  // Alice creates a game.
  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = alice.url().split("/g/")[1];

  // Bob opens the shared link; with no stored name he's prompted for one.
  await bob.goto(`/g/${code}`);
  await bob.getByPlaceholder("Anonymous").fill("Bob");
  await bob.getByRole("button", { name: "Join" }).click();

  // Both see two players.
  await expect(alice.locator(".players li")).toHaveCount(2);
  await expect(bob.locator(".players li")).toHaveCount(2);

  // It's Alice's turn — she rolls (the toolbar button, not the stage tap target).
  await expect(alice.locator("button.roll")).toHaveText("Roll");
  await alice.locator("button.roll").click();

  // The roll lands in both histories, attributed to Alice.
  await expect(alice.locator(".history li")).toHaveCount(1);
  await expect(bob.locator(".history li")).toHaveCount(1);
  await expect(bob.locator(".history").getByText("Alice")).toBeVisible();

  // Turn advanced to Bob (his button reads "Roll"; Alice's now shows the turn).
  await expect(bob.locator("button.roll")).toHaveText("Roll");
  await expect(alice.locator("button.roll")).toContainText("turn");

  await aliceCtx.close();
  await bobCtx.close();
});
