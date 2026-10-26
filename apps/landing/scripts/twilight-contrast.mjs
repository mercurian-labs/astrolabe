// Contrast of the page's text against its paper at every quarter degree of the sun's altitude, as
// twilight.js shows it (quantised to its steps), and of the drawn app's text in both its themes.
// Body and UI text need 4.5:1. Run: node apps/landing/scripts/twilight-contrast.mjs

import { readFileSync } from "node:fs";
import Twilight from "../src/scripts/twilight.js";

const { at, step, contrast, hex, FLIP } = Twilight;
const TEXT = ["--ink", "--ink-2", "--ink-3", "--rust-text"];
const ON_RUST = [hex("#fbf9f4"), hex("#a0492a")]; // the rust buttons' label

const low = {};
for (let alt = 2; alt >= -20; alt -= 0.25) {
  const { vars } = at(step(alt));
  const paper = hex(vars["--paper"]);
  for (const name of TEXT) {
    const ratio = contrast(hex(vars[name]), paper);
    if (!low[name] || ratio < low[name].ratio) low[name] = { ratio, alt };
  }
}

// The drawn app's tokens, light (:root) and dark (:root[data-theme="dark"]), from the stylesheet.
const css = readFileSync(new URL("../src/styles/drafting.css", import.meta.url), "utf8");
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start));
};
const oklch = (text) => {
  const [L, C, H] = text
    .match(/oklch\(([^)]+)\)/)[1]
    .split(/\s+/)
    .map(Number);
  const a = C * Math.cos((H * Math.PI) / 180) || 0;
  const b = C * Math.sin((H * Math.PI) / 180) || 0;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, gam(v))));
};
const token = (source, name) =>
  oklch(source.match(new RegExp(`--app-${name}: (oklch\\([^)]+\\))`))[1]);
const APP = [
  ["text", "surface"],
  ["text", "sidebar"],
  ["muted", "surface"],
  ["muted", "sidebar"],
  ["muted", "canvas"],
  ["info", "surface"],
  ["warn", "warn-bg"],
  ["info", "info-bg"],
  ["add", "add-bg"],
  ["accent-fg", "accent"],
];

const fmt = (r) => r.toFixed(2).padStart(5);
console.log(`Page text on paper, every 0.25° from +2° to −20° (flip at ${FLIP}°):`);
for (const [name, { ratio, alt }] of Object.entries(low))
  console.log(`  ${name.padEnd(12)} min ${fmt(ratio)} at ${alt}°`);
console.log(`  on-rust      ${fmt(contrast(...ON_RUST))}`);
for (const [theme, source] of [
  ["light", block(":root")],
  ["dark", block(':root[data-theme="dark"]')],
]) {
  console.log(`The drawn app, ${theme}:`);
  for (const [fg, bg] of APP)
    console.log(
      `  ${`${fg} / ${bg}`.padEnd(22)} ${fmt(contrast(token(source, fg), token(source, bg)))}`,
    );
}
