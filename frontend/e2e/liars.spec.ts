import { expect, test } from "@playwright/test";

// Liar's Dice golden path across two mobile clients: switch mode → bid → call →
// reveal, exercising the hidden per-socket views end-to-end under the real CSP.
const MOBILE = { viewport: { width: 390, height: 844 } };

test("liar's dice: two players bid, call, and reveal (mobile)", async ({
  browser,
}) => {
  const actx = await browser.newContext(MOBILE);
  const bctx = await browser.newContext(MOBILE);
  const alice = await actx.newPage();
  const bob = await bctx.newPage();

  // Alice creates a game.
  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = alice.url().split("/g/")[1];

  // Bob joins by code.
  await bob.goto("/");
  await bob.getByPlaceholder("Anonymous").fill("Bob");
  await bob.getByPlaceholder("CODE").fill(code);
  await bob.getByRole("button", { name: "Join" }).click();
  await bob.waitForURL(new RegExp(`/g/${code}`));
  // Bob's REST join has completed (the lobby awaits it before navigating), so he
  // is in the room; wait for his game page to be ready (the player list is
  // display:none at mobile widths, so key off the always-present gear).
  await expect(bob.getByRole("button", { name: "Settings" })).toBeVisible();

  // Alice switches the room to Liar's Dice.
  await alice.getByRole("button", { name: "Settings" }).click();
  await alice.getByRole("button", { name: "Liar's Dice" }).click();
  await alice.keyboard.press("Escape"); // close the settings sheet

  // Alice opens (her turn): bid controls; Bob waits.
  const aliceBid = alice.getByRole("button", { name: /^Bid/ });
  await expect(aliceBid).toBeVisible();
  await expect(bob.getByText(/Waiting for/)).toBeVisible();

  // Alice bids; turn passes to Bob, who calls liar.
  await aliceBid.click();
  const bobLiar = bob.getByRole("button", { name: "Liar!" });
  await expect(bobLiar).toBeEnabled();
  await bobLiar.click();

  // Both see the reveal.
  await expect(bob.getByText(/called liar/)).toBeVisible();
  await expect(alice.getByRole("button", { name: "Next round" })).toBeVisible();

  await actx.close();
  await bctx.close();
});
