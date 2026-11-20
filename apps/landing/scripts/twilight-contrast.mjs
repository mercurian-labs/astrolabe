// Contrast of the page's text against its paper in its two themes, and of the drawn app's text in
// both of its own, from drafting.css. Body and UI text need 4.5:1.
// Run: node apps/landing/scripts/twilight-contrast.mjs

import * as NodeFS from "node:fs";

const css = NodeFS.readFileSync(new URL("../src/styles/drafting.css", import.meta.url), "utf8");
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start));
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055);
const oklch = (text) => {
  const [L, C, H] = text.split(/\s+/).map(Number);
  const a = C * Math.cos((H * Math.PI) / 180) || 0;
  const b = C * Math.sin((H * Math.PI) / 180) || 0;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, gam(v))));
};
// A token from the theme's block, falling back to :root's.
const token = (source, name) => {
  const pattern = new RegExp(`--${name}: (#[0-9a-f]{6}|oklch\\(([^)]+)\\))`);
  const [, value, inner] = source.match(pattern) || block(":root").match(pattern);
  return inner ? oklch(inner) : hex(value);
};
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (c) => {
  const [r, g, b] = c.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const PAIRS = [
  ["ink", "paper"],
  ["ink-2", "paper"],
  ["ink-3", "paper"],
  ["rust-text", "paper"],
  ["on-rust", "rust"],
  ["app-text", "app-surface"],
  ["app-text", "app-sidebar"],
  ["app-muted", "app-surface"],
  ["app-muted", "app-sidebar"],
  ["app-muted", "app-canvas"],
  ["app-info", "app-surface"],
  ["app-warn", "app-warn-bg"],
  ["app-info", "app-info-bg"],
  ["app-add", "app-add-bg"],
  ["app-accent-fg", "app-accent"],
];

let low = false;
for (const [theme, source] of [
  ["light", block(":root")],
  ["dark", block(':root[data-theme="dark"]')],
]) {
  console.log(`${theme}:`);
  for (const [fg, bg] of PAIRS) {
    const ratio = contrast(token(source, fg), token(source, bg));
    low ||= ratio < 4.5;
    console.log(
      `  ${`${fg} / ${bg}`.padEnd(26)} ${ratio.toFixed(2).padStart(5)}${ratio < 4.5 ? "  low" : ""}`,
    );
  }
}
process.exitCode = low ? 1 : 0;
