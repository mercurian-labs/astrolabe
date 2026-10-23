// Astrolabe · share cards · renderer
//
// Prints the link-preview cards and the share assets from the HTML templates in cards/, at each
// asset's exact size, in headless Chromium with software WebGL (SwiftShader), so the grain comes out
// the same on every machine. Cards are not rendered at build time: run this after changing a
// template, the art or the headline, and commit what it writes.
//
//   node apps/landing/scripts/render-cards.mjs            # everything
//   node apps/landing/scripts/render-cards.mjs og/card    # only outputs whose path contains this
//
// Writes public/og/ (served, under 300 KB each so WhatsApp shows the large preview), public/icons/
// and public/favicon.svg, and share/ (uploaded by hand: GitHub's social preview under the repository's
// Settings → General → Social preview, the X and LinkedIn header and the avatar on the accounts).
// Needs the Playwright Chromium (`vp exec playwright install chromium` if missing).

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { headline } from "../src/site.js";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(APP, "../..");
const require = createRequire(
  join(ROOT, "node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/"),
);
const { chromium } = require("playwright");

const MAX_BYTES = 300 * 1024;
const q = (params) => new URLSearchParams(params).toString();

// Every asset: where it goes, which template prints it, at what size and in what format.
const JOBS = [
  // The main card, one file per direction (the lab at /lab/link-cards compares them).
  {
    out: "public/og/card-night.jpg",
    page: `plate.html?${q({ ink: "night", line: headline })}`,
    w: 1200,
    h: 630,
  },
  {
    out: "public/og/card-day.jpg",
    page: `plate.html?${q({ ink: "day", line: headline })}`,
    w: 1200,
    h: 630,
  },
  {
    out: "public/og/card-instrument.jpg",
    // An October afternoon in New York: the sun low in the south-west, the rete well clear of the rule.
    page: `instrument.html?${q({ line: headline, t: "2026-10-21T15:30", tz: "America/New_York", ground: "hemisphere" })}`,
    w: 1200,
    h: 630,
  },
  // The page cards, for the legal pages (and later posts): the same plate, a title and a caption.
  ...[
    ["privacy-policy", "Privacy policy"],
    ["terms-of-service", "Terms of service"],
    ["licenses", "Licenses"],
  ].map(([slug, title]) => ({
    out: `public/og/page-${slug}.jpg`,
    page: `plate.html?${q({ ink: "night", layout: "page", title, caption: `Fig. 0 · astrolabe.sh/${slug}` })}`,
    w: 1200,
    h: 630,
  })),
  // Share assets, uploaded by hand.
  {
    out: "share/github-social-preview.jpg",
    page: `plate.html?${q({ ink: "night", layout: "github", line: headline })}`,
    w: 1280,
    h: 640,
  },
  {
    out: "share/header-1500x500.jpg",
    page: `plate.html?${q({ ink: "night", layout: "header", line: headline })}`,
    w: 1500,
    h: 500,
  },
  {
    out: "share/avatar-400.jpg",
    page: `plate.html?${q({ ink: "night", layout: "avatar" })}`,
    w: 400,
    h: 400,
  },
  // Icons: the home-screen icon (opaque; iOS rounds it itself) and the manifest's maskable pair.
  { out: "public/icons/apple-touch-icon.png", page: "icon.html?safe=0.86", w: 180, h: 180 },
  { out: "public/icons/icon-192-maskable.png", page: "icon.html?safe=0.8", w: 192, h: 192 },
  { out: "public/icons/icon-512-maskable.png", page: "icon.html?safe=0.8", w: 512, h: 512 },
];

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

// cards/ at /cards/, the page's own scripts and styles at /src/, public/ at the root as the site serves it.
function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = /^\/(cards|src)\//.test(path) ? join(APP, path) : join(APP, "public", path);
    if (relative(APP, file).startsWith("..")) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res
        .writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// The light favicon is the brand's icon as drawn; on a dark tab the tile turns to the night band's
// charcoal and the A to its ivory.
async function favicon() {
  const svg = await readFile(join(APP, "public/assets/brand/icon-small.svg"), "utf8");
  const style =
    '<style>@media (prefers-color-scheme: dark) { rect { fill: #1e1c1a } path[fill="#292724"] { fill: #eaddc7 } }</style>';
  const out = join(APP, "public/favicon.svg");
  await writeFile(out, svg.replace(/^(<svg[^>]*>)/, `$1${style}`));
  return out;
}

const filter = process.argv[2];
const jobs = JOBS.filter((job) => !filter || job.out.includes(filter));
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const report = [];
try {
  for (const job of jobs) {
    const page = await browser.newPage({
      viewport: { width: job.w, height: job.h },
      deviceScaleFactor: 1,
      // The instrument arrives set rather than sweeping in.
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${origin}/cards/${job.page}`, { waitUntil: "load" });
    await page.evaluate(() => window.card);
    if (errors.length) throw new Error(`${job.out}: ${errors.join("; ")}`);
    const out = join(APP, job.out);
    await mkdir(dirname(out), { recursive: true });
    let bytes;
    let quality;
    if (out.endsWith(".png")) {
      bytes = await page.screenshot({ type: "png", omitBackground: false });
    } else {
      // The highest quality that keeps the file under the cap.
      for (quality = 92; quality >= 60; quality -= 2) {
        bytes = await page.screenshot({ type: "jpeg", quality });
        if (bytes.length <= MAX_BYTES) break;
      }
    }
    if (bytes.length > MAX_BYTES)
      throw new Error(`${job.out} is ${bytes.length} bytes, over the cap`);
    await writeFile(out, bytes);
    report.push([job.out, `${job.w}×${job.h}`, quality ? `q${quality}` : "png", bytes.length]);
    await page.close();
  }
  if (!filter || "public/favicon.svg".includes(filter)) {
    const out = await favicon();
    report.push(["public/favicon.svg", "1024×1024", "svg", (await stat(out)).size]);
  }
} finally {
  await browser.close();
  server.close();
}
for (const [out, size, format, bytes] of report)
  console.log(
    `${out.padEnd(40)} ${size.padEnd(10)} ${format.padEnd(4)} ${(bytes / 1024).toFixed(1).padStart(6)} KB`,
  );
