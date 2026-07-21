import { expect, test } from "@playwright/test";

// With 4+ players the Yatzy scorecard switches from the side-by-side matrix to a
// paged single-player card (tabs + swipe) so it never scrolls horizontally.
test("yatzy: large groups page one card at a time (mobile)", async ({
  browser,
}) => {
  const names = ["Alice", "Bob", "Carol", "Dave"];
  const ctxs = await Promise.all(
    names.map(() =>
      browser.newContext({ viewport: { width: 390, height: 800 } }),
    ),
  );
  const pages = await Promise.all(ctxs.map((c) => c.newPage()));

  // Alice creates a Yatzy game.
  const alice = pages[0];
  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Yatzy", exact: true }).click();
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = alice.url().split("/g/")[1];

  // The others join (all before anyone rolls → the pristine match re-deals with
  // everyone, so the order reaches four).
  for (let i = 1; i < names.length; i++) {
    await pages[i].goto(`/g/${code}`);
    await pages[i].getByPlaceholder("Anonymous").fill(names[i]);
    await pages[i].getByRole("button", { name: "Join" }).click();
  }

  // Paged mode: a tab per player, and NO matrix table.
  await expect(alice.locator(".yatzy .ptabs .ptab")).toHaveCount(4);
  await expect(alice.locator(".yatzy table.card")).toHaveCount(0);

  // Tapping another player's tab focuses their card.
  await alice.locator(".yatzy .ptab", { hasText: "Carol" }).click();
  await expect(alice.locator(".yatzy .ptab.focused")).toContainText("Carol");

  await Promise.all(ctxs.map((c) => c.close()));
});
