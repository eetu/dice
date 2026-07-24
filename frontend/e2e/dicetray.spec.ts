import { expect, test } from "@playwright/test";

// The free-mode dice tray: add a polyhedral die and roll the mixed set. Guards
// the typed-dice wire (SetDiceSet + RollDie) end to end through the real stack.
test("free mode: add a d20 to the tray and roll the mixed set", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const alice = await ctx.newPage();

  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);

  // Open the dice tray (🎲 on the stage) and add a d20 to the default two d6.
  await alice.locator("button.dice-btn").click();
  await alice.getByRole("button", { name: "Add d20" }).click();
  await alice.keyboard.press("Escape"); // close the native <dialog>

  // Roll: the server rolls all three dice and a history row streams back.
  await alice.locator("button.roll").click();
  await expect(alice.locator(".history li")).toHaveCount(1);
  // The d20 face carries its kind tag (title) in history.
  await expect(alice.locator('.history .face[title="d20"]')).toBeVisible();

  await ctx.close();
});
