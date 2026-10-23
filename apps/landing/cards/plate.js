// Astrolabe · share cards · the plate (see plate.html for the query).

import { caption, done, fit, fonts, frame, params } from "./frame.js";
import { loadImage, print } from "./print.js";

const ink = params.get("ink") === "day" ? "day" : "night";
const layout = params.get("layout") ?? "main";
const W = innerWidth;
const H = innerHeight;
document.documentElement.dataset.ink = ink;

// Per layout: the plate's width (or the monogram's height), the line and the room it may take, the
// gap between them, and how far the ground is zoomed past covering the card.
const LAYOUTS = {
  main: { mark: 600, line: params.get("line"), max: 40, room: 560, gap: 46, zoom: 1 },
  github: { mark: 640, line: params.get("line"), max: 42, room: 600, gap: 48, zoom: 1 },
  page: { mark: 330, line: params.get("title"), max: 92, room: 600, gap: 30, zoom: 1 },
  header: { mark: 880, line: params.get("line"), max: 34, room: 860, gap: 40, zoom: 1 },
  avatar: { monogram: 250, zoom: 1.6 },
};
const spec = LAYOUTS[layout];
const card = document.querySelector(".card");
const canvas = card.querySelector("canvas");

done(
  (async () => {
    await fonts();
    const core = document.createElement("div");
    core.className = "core";
    const src = spec.monogram ? "/assets/brand/symbol-dark.svg" : "/assets/brand/wordmark-dark.svg";
    const img = new Image();
    img.className = "mark";
    img.alt = "";
    img.src = src;
    await img.decode();
    if (spec.monogram) img.style.height = `${spec.monogram}px`;
    else img.style.width = `${spec.mark}px`;
    core.append(img);
    if (spec.line) {
      const line = document.createElement("p");
      line.className = "line";
      line.textContent = spec.line;
      line.style.marginTop = `${spec.gap}px`;
      core.append(line);
      fit(line, spec.room, spec.max);
    }
    card.append(core);
    // The plate's optical centre sits on the card's: the line pulls the core down by its own height.
    if (!spec.monogram) frame(card);

    const r = img.getBoundingClientRect();
    const image = await loadImage(src);
    const terrain = await fetch("/assets/footer/terrain.json").then((res) => res.json());
    const [tw, th] = terrain.size;
    const scale = Math.max(W / tw, H / th) * Number(params.get("zoom") ?? spec.zoom);
    const focus = (params.get("focus") ?? `${tw / 2},${th / 2}`).split(",").map(Number);
    const ground = { scale, offset: [W / 2 - focus[0] * scale, H / 2 - focus[1] * scale] };
    const sun =
      ink === "day" ? { alt: Number(params.get("alt") ?? 30), az: 292 } : { alt: 16, az: 292 };
    const gain = Number(params.get("gain") ?? 1);
    const rise = params.get("rise") ? Number(params.get("rise")) : null;
    await print(canvas, {
      ink,
      mark: { image, rect: [r.left, r.top, r.width, r.height] },
      sun,
      ground,
      gain,
      rise,
    });

    if (spec.monogram) return;
    const km = terrain.metresPerPixel / 1000 / scale; // kilometres per CSS px
    caption(card, "tl", params.get("caption") ?? "Fig. 0 · astrolabe.sh");
    caption(card, "tr", "Beethoven basin · 20.9° S 124.2° W");
    const bar = caption(card, "br", "");
    bar.classList.add("scale");
    bar.innerHTML = `<i style="width:${(200 / km).toFixed(1)}px"></i><span>200 km</span>`;
  })(),
);
