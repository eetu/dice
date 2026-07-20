import { expect, test } from "@playwright/test";

// Yatzy end to end (mobile): the host picks the game in the lobby, a friend joins
// before anyone rolls (so the pristine match re-deals to include them), then the
// host rolls and scores a box and the turn passes.
test("yatzy: create, join, roll, score, turn passes (mobile)", async ({
  browser,
}) => {
  const aliceCtx = await browser.newContext({
    viewport: { width: 390, height: 800 },
  });
  const bobCtx = await browser.newContext({
    viewport: { width: 390, height: 800 },
  });
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  // Alice creates a Yatzy game (pick the game, then create).
  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Yatzy", exact: true }).click();
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = alice.url().split("/g/")[1];

  // Bob joins the link before any roll → he's dealt into the match, not spectating.
  await bob.goto(`/g/${code}`);
  await bob.getByPlaceholder("Anonymous").fill("Bob");
  await bob.getByRole("button", { name: "Join" }).click();

  // Both see the shared scorecard, with both players' columns.
  await expect(alice.locator(".yatzy table.card")).toBeVisible();
  await expect(bob.locator(".yatzy table.card")).toBeVisible();
  await expect(alice.locator(".yatzy thead th")).toHaveCount(3); // blank + 2 players

  // Alice's turn: roll, then score the first open box.
  await expect(alice.locator("button.roll")).toBeEnabled();
  await alice.locator("button.roll").click();
  await alice.locator("button.score").first().click();

  // Turn passed to Bob: his roll is live, Alice's is not.
  await expect(bob.locator("button.roll")).toBeEnabled();
  await expect(alice.locator("button.roll")).toBeDisabled();

  // The header code is the invite button — it opens the QR/share panel even in a
  // board game (the felt's QR flip isn't available here).
  await bob.locator("button.code-chip").click();
  await expect(bob.locator(".qr img")).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});
