import { expect, test } from "@playwright/test";

import { setNameInDialog } from "./helpers";

// Opening an invite link seats you IMMEDIATELY, then asks for a name. It used to
// ask first, which put a form between the link and the game — the access logs
// showed over a minute spent on it, and a room can be closed in that window (the
// host leaving as the last human frees the code), so the invitee got "Game not
// found" and blamed the link.

test("opening a link seats you at once, then offers a rename", async ({
  browser,
}) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByPlaceholder("Anonymous").fill("Host");
  await host.getByRole("button", { name: "Create a game" }).click();
  await host.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = host.url().split("/g/")[1];

  // A fresh visitor opens the link — fresh context = empty storage, no name.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/g/${code}`);

  // Seated before answering anything: the host already sees a second player, and
  // the guest already has the table (not a gate).
  await expect(host.locator(".players li")).toHaveCount(2);
  await expect(guest.locator(".players li")).toHaveCount(2);

  // …and the name question is waiting, prefilled with the assigned name.
  const dialog = guest.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Pick a name" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Player 2");

  await setNameInDialog(guest, "Guest");
  await expect(host.getByText("Guest")).toBeVisible();
});

test("a browser that already knows your name is not asked again", async ({
  browser,
}) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByPlaceholder("Anonymous").fill("Host");
  await host.getByRole("button", { name: "Create a game" }).click();
  await host.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = host.url().split("/g/")[1];

  // Same browser, name already remembered from a previous game.
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.addInitScript(() =>
    localStorage.setItem("dice:name", "Returning"),
  );
  await guest.goto(`/g/${code}`);

  await expect(host.getByText("Returning")).toBeVisible();
  // Straight into the game — no question at all.
  await expect(guest.getByRole("dialog")).toBeHidden();
  await ctx.close();
});
