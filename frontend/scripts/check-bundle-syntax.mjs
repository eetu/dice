// Guard the browser floor declared by `build.target` in vite.config.ts.
//
// Why this exists: with no explicit target, Vite defaults to
// `baseline-widely-available` (≈ Chrome 111), and three.js shipped class static
// initialisation blocks (Chromium 94+) straight into the game route's chunk. The
// lobby still ran, so `/` worked and an invite link died — on Samsung Internet
// 13/14 and pinned Android WebViews, which are ordinary phones, not museum
// pieces. Nothing in CI noticed, and the only evidence was a user saying "it
// didn't work". A dependency bump can reintroduce exactly that, so assert on the
// built output instead of trusting the config.
//
// Syntax only: esbuild transpiles syntax down to the target but does NOT polyfill
// runtime APIs, so those stay a review concern.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist/_app/immutable";

// Above es2020, and each one is a hard SyntaxError on an older engine — the whole
// chunk fails to parse, which is why they blank a page rather than degrade.
const FORBIDDEN = [
  {
    pattern: /static\s*\{/,
    name: "class static initialisation block (ES2022)",
  },
  { pattern: /\?\?=/, name: "logical assignment ??= (ES2021)" },
  { pattern: /\|\|=/, name: "logical assignment ||= (ES2021)" },
  { pattern: /&&=/, name: "logical assignment &&= (ES2021)" },
];

function jsFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return jsFiles(path);
    return path.endsWith(".js") ? [path] : [];
  });
}

let files;
try {
  files = jsFiles(DIST);
} catch {
  console.error(`check-bundle-syntax: no ${DIST} — run \`yarn build\` first`);
  process.exit(1);
}

const problems = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const { pattern, name } of FORBIDDEN) {
    if (pattern.test(source)) problems.push(`${file}: ${name}`);
  }
}

if (problems.length > 0) {
  console.error(
    "check-bundle-syntax: the bundle uses syntax above the declared floor\n" +
      "(build.target in vite.config.ts). A dependency probably needs newer\n" +
      "syntax than the target transpiles to — check that target still applies.\n",
  );
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`check-bundle-syntax: ${files.length} chunks OK`);
