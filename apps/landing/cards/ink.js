// Astrolabe · share cards · the plate: what a card says, as one canvas for print.js to ink.
// Marks (the brand SVGs) are drawn where their <img> sits; type goes through an SVG foreignObject
// carrying Fraunces inline, the one font an SVG image can load. Red is the ivory (or ink) cover,
// green the rust. The elements stay in the page, hidden, for layout.

import { loadImage } from "./print.js";

let fraunces;
async function fontFace() {
  if (!fraunces) {
    const bytes = new Uint8Array(
      await fetch("/assets/fonts/fraunces.woff2").then((r) => r.arrayBuffer()),
    );
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    fraunces = btoa(binary);
  }
  return `@font-face { font-family: "Fraunces"; src: url(data:font/woff2;base64,${fraunces}) format("woff2"); font-weight: 100 900; }`;
}

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const STYLE = [
  "font-family",
  "font-weight",
  "font-size",
  "line-height",
  "letter-spacing",
  "font-variation-settings",
];

async function typeImage(el, W, H) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const style = STYLE.map((p) => `${p}: ${cs.getPropertyValue(p)}`).join("; ");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<style>${await fontFace()}</style>` +
    `<foreignObject x="${r.left}" y="${r.top}" width="${r.width + 8}" height="${r.height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${xml(style)}; margin: 0; white-space: nowrap; color: #fff">${xml(el.textContent)}</div>` +
    `</foreignObject></svg>`;
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

// items: <img> marks and type elements, in the card's CSS px. Returns a canvas at device px.
export async function inkPlate(items) {
  const W = innerWidth;
  const H = innerHeight;
  const dpr = devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.scale(dpr, dpr);
  for (const el of items) {
    if (el instanceof HTMLImageElement) {
      const r = el.getBoundingClientRect();
      ctx.drawImage(await loadImage(el.currentSrc || el.src), r.left, r.top, r.width, r.height);
    } else {
      ctx.drawImage(await typeImage(el, W, H), 0, 0, W, H);
    }
  }
  // As drawn to cover: rust where red outruns green (the brand's #a0492a against ivory #eaddc7).
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    const rust = a > 40 && px[i] - px[i + 1] > 48;
    px[i] = rust ? 0 : a;
    px[i + 1] = rust ? a : 0;
    px[i + 2] = 0;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
