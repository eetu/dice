import { expect, test } from "@playwright/test";

// Opening a game link directly (QR) with no stored name asks for one first,
// instead of silently joining as "Player N".
test("direct join with no stored name prompts for a name", async ({
  browser,
}) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByPlaceholder("Anonymous").fill("Host");
  await host.getByRole("button", { name: "Create a game" }).click();
  await host.waitForURL(/\/g\/[A-Z0-9]{5}/);
  const code = host.url().split("/g/")[1];

  // A fresh visitor opens the link directly — fresh context = empty storage.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/g/${code}`);
  await expect(
    guest.getByRole("heading", { name: "Pick a name to join" }),
  ).toBeVisible();
  await guest.getByPlaceholder("Anonymous").fill("Guest");
  await guest.getByRole("button", { name: "Join" }).click();

  // Joined under the chosen name (host's player list shows it, not "Player 2").
  await expect(host.getByText("Guest")).toBeVisible();
});
