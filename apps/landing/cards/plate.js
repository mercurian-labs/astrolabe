// Astrolabe · share cards · the plate (see plate.html for the query).

import { caption, done, fit, fonts, frame, params } from "./frame.js";
import { inkPlate } from "./ink.js";
import { print } from "./print.js";

const ink = params.get("ink") === "day" ? "day" : "night";
const layout = params.get("layout") ?? "main";
const W = innerWidth;
const H = innerHeight;
document.documentElement.dataset.ink = ink;

// Beethoven basin's centre in the terrain's texels: its smooth floor sits behind what the card says,
// its rim and the cratered ground round it fill the wings.
const BASIN = [750, 610];

// Per layout: the wordmark's width (or the monogram's height), the line and the room it may take,
// the gap between them, and how far the ground is zoomed past covering the card.
const LAYOUTS = {
  main: { mark: 600, line: params.get("line"), max: 40, room: 560, gap: 46, zoom: 2 },
  github: { mark: 640, line: params.get("line"), max: 42, room: 600, gap: 48, zoom: 2 },
  page: { mark: 300, line: params.get("title"), max: 92, room: 600, gap: 34, zoom: 2 },
  header: { mark: 860, line: params.get("line"), max: 34, room: 840, gap: 40, zoom: 2.2 },
  avatar: { monogram: 250, zoom: 2.4 },
};
const spec = LAYOUTS[layout];
const card = document.querySelector(".card");
const canvas = card.querySelector("canvas");

done(
  (async () => {
    await fonts();
    const core = document.createElement("div");
    core.className = "core";
    const img = new Image();
    img.className = "mark";
    img.alt = "";
    img.src = spec.monogram ? "/assets/brand/symbol-dark.svg" : "/assets/brand/wordmark-dark.svg";
    await img.decode();
    if (spec.monogram) img.style.height = `${spec.monogram}px`;
    else img.style.width = `${spec.mark}px`;
    core.append(img);
    const inked = [img];
    if (spec.line) {
      const line = document.createElement("p");
      line.className = "line";
      line.textContent = spec.line;
      line.style.marginTop = `${spec.gap}px`;
      core.append(line);
      fit(line, spec.room, spec.max);
      inked.push(line);
    }
    card.append(core);
    if (!spec.monogram) frame(card);

    const terrain = await fetch("/assets/footer/terrain.json").then((res) => res.json());
    const [tw, th] = terrain.size;
    const scale = Math.max(W / tw, H / th) * Number(params.get("zoom") ?? spec.zoom);
    const ground = { scale, offset: [W / 2 - BASIN[0] * scale, H / 2 - BASIN[1] * scale] };
    const sun = ink === "day" ? { alt: 40, az: 292 } : { alt: 16, az: 292 };
    const gain = Number(params.get("gain") ?? (ink === "day" ? 1 : 0.65));
    const density = Number(params.get("density") ?? 0.82);
    await print(canvas, { ink, plate: await inkPlate(inked), sun, ground, gain, density });

    if (spec.monogram) return;
    const km = terrain.metresPerPixel / 1000 / scale; // kilometres per CSS px
    caption(card, "tl", params.get("caption") ?? "Fig. 0 · astrolabe.sh");
    caption(card, "tr", "Beethoven basin · 20.9° S 124.2° W");
    const bar = caption(card, "br", "");
    bar.classList.add("scale");
    bar.innerHTML = `<i style="width:${(200 / km).toFixed(1)}px"></i><span>200 km</span>`;
  })(),
);
