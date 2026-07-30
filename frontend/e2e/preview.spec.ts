import { expect, test } from "@playwright/test";

// What a chat app's crawler sees when someone pastes an invite link. It runs no
// JS and it fetches the invite URL, not the lobby — so these assertions are made
// on the raw shell the backend serves for a `/g/CODE` deep link, exactly as
// WhatsApp/Telegram/Slack would receive it.

const SHELL_TAGS = [
  'property="og:title"',
  'property="og:description"',
  'property="og:image" content="https://dice.invinite.tech/og.png"',
  'property="og:image:alt"',
  'name="twitter:card" content="summary_large_image"',
];

test("an invite link carries the link-preview tags", async ({ request }) => {
  const res = await request.get("/g/ABCDE");
  expect(res.status()).toBe(200);
  const html = await res.text();

  for (const tag of SHELL_TAGS) expect(html).toContain(tag);
  // Absolute, or a crawler resolves it against nothing useful — the whole reason
  // the URL is pinned to the canonical origin rather than left relative.
  expect(html).not.toContain('og:image" content="/');
  // A preview must not put a live game code into someone else's chat history.
  expect(html).not.toContain("ABCDE");
});

test("the preview image is served and matches its declared size", async ({
  request,
}) => {
  const res = await request.get("/og.png");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");

  // PNG IHDR: 8-byte signature, chunk length + type, then width/height as BE u32.
  const png = await res.body();
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);

  // The declared dimensions are what crawlers lay out against, so drift between
  // the tags and the committed asset shows up as a cropped or letterboxed card.
  const shell = await (await request.get("/")).text();
  expect(shell).toContain(`property="og:image:width" content="${width}"`);
  expect(shell).toContain(`property="og:image:height" content="${height}"`);
  expect({ width, height }).toEqual({ width: 1200, height: 630 });
});
