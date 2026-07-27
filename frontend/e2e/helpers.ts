import { expect, type Page } from "@playwright/test";

/** Take a seat after opening an invite link.
 *
 *  Opening the link joins you straight away as "Player N" — a name is NOT asked
 *  for first (that form used to sit between the link and the game, and a room can
 *  be closed while you're filling it in). The rename dialog that appears
 *  afterwards is what sets the name, and it's skipped entirely for a browser that
 *  already remembers one.
 *
 *  Lives here because seven specs drive it; keeping it in one place is what makes
 *  the next change to this flow cheap. */
export async function setNameInDialog(page: Page, name: string) {
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("Your name");
  await expect(input).toBeVisible();
  await input.fill(name);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}
