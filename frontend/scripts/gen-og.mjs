// Regenerate the committed social-preview image (`static/og.png`) — the thumbnail
// a chat app shows when someone pastes an invite link.
//
// It shoots the REAL lobby sign rather than a hand-drawn mock, so the preview
// can't drift from the app: same neon canvas, same theme tokens. The page is
// opened at exactly OG size with device-pixel-ratio 1, so the canvas paints at
// final resolution and the screenshot needs no resampling (hence no imagemagick,
// unlike `gen-icons.sh`).
//
// Run from frontend/ AFTER a build — it serves `dist/`:
//   yarn build && node scripts/gen-og.mjs      # or `just og`
// Needs the Playwright chromium (`yarn e2e:install`). Commit the result.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

import { chromium } from "@playwright/test";

const DIST = "dist";
const OUT = "static/og.png";
// The Open Graph canonical size. Mirrored in `og:image:width/height` in app.html —
// crawlers trust those tags, so the two must agree.
const SIZE = { width: 1200, height: 630 };

// Just the sign on a flat wall: the ambient backdrop, the form and the card
// chrome are the app's furniture, not its portrait. Making the card transparent
// also decides the sign's wall colour — it reads the first opaque ancestor, which
// then becomes the body background, so the canvas has no visible edge.
const OG_CSS = `
  .dice-bg { display: none !important; }
  .prefs, .ver, .lobby > :not(.brand) { display: none !important; }
  .lobby {
    width: ${SIZE.width - 160}px !important;
    padding: 0 !important;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
  }
  .brand { margin: 0 !important; }
`;

const MIME = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

// dist/ over http, because module scripts don't load from file://. Same SPA
// fallback as the Rust backend, so any path resolves to the shell.
const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const candidates = [
    normalize(join(DIST, decodeURIComponent(pathname))),
    join(DIST, "index.html"),
  ];
  for (const file of candidates) {
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
      return;
    } catch {
      /* a directory or a miss — fall through to the shell */
    }
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: SIZE,
  deviceScaleFactor: 1,
  // Dark: the tubes glow. (In light the dice invert to ink, which is right on a
  // white page but reads as a line drawing in a chat list.)
  colorScheme: "dark",
  // Skips the strike-up — the sign is simply lit, which is what makes the shot
  // deterministic instead of a race with the animation.
  reducedMotion: "reduce",
});

// Into the shell itself: the sign sizes its canvas and reads its wall colour ONCE,
// at mount, so a stylesheet added after `goto` would arrive too late.
await page.route(`${base}/`, async (route) => {
  const response = await route.fetch();
  const html = (await response.text()).replace(
    "</head>",
    `<style>${OG_CSS}</style></head>`,
  );
  await route.fulfill({ response, body: html });
});

await page.goto(base);
await page.locator(".brand canvas").waitFor();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500); // let the tubes settle on a lit frame
await page.screenshot({ path: OUT });

await browser.close();
server.close();
console.log(`wrote ${OUT} (${SIZE.width}×${SIZE.height})`);
