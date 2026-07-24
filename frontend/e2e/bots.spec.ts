import { expect, test } from "@playwright/test";

// Bots end to end through the UI. The bot's autonomous play is covered by the
// backend integration tests; here we guard the two UI surfaces:
// - the invite panel seats bots and (in every mode, incl. mid-match) removes them
// - the free-mode player list shows a bot row with its own remove control

test("yatzy: seat a bot from the invite panel and remove it there", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const alice = await ctx.newPage();

  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Yatzy", exact: true }).click();
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);

  // The header code chip opens the share/invite panel with the bot row.
  await alice.locator("button.code-chip").click();
  await alice.getByRole("button", { name: "Hard", exact: true }).click();

  // The bot lists in the panel and joins the (pristine) match's scorecard.
  const botRow = alice.locator(".bot-row");
  await expect(botRow).toHaveCount(1);
  const botName = (await botRow.locator(".bot-name").innerText()).trim();
  expect(botName.length).toBeGreaterThan(0);
  await alice.keyboard.press("Escape");
  await expect(
    alice.locator(".yatzy thead th", { hasText: botName }),
  ).toBeVisible();

  // Reopen the panel and remove the bot — works mid-match (no player list here).
  await alice.locator("button.code-chip").click();
  await alice.locator(".bot-rm").click();
  await expect(alice.locator(".bot-row")).toHaveCount(0);

  await ctx.close();
});

test("free mode: the player list shows a bot row with a remove control", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const alice = await ctx.newPage();

  await alice.goto("/");
  await alice.getByPlaceholder("Anonymous").fill("Alice");
  await alice.getByRole("button", { name: "Create a game" }).click();
  await alice.waitForURL(/\/g\/[A-Z0-9]{5}/);

  await alice.locator("button.code-chip").click();
  await alice.getByRole("button", { name: "Easy", exact: true }).click();
  await alice.keyboard.press("Escape");

  // The side player list renders the bot with a bot mark + remove ✕.
  const botRow = alice.locator(".players li", {
    has: alice.locator(".bot-mark"),
  });
  await expect(botRow).toHaveCount(1);
  await botRow.locator(".rm-bot").click();
  await expect(alice.locator(".players li")).toHaveCount(1);

  await ctx.close();
});
