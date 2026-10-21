// Astrolabe · drafting · the closing instrument
//
// A working astrolabe set to the visitor's sky now. The plate is engraved here for the latitude the
// time zone suggests (places.js); the rete turns to local sidereal time, the sun sits on the ecliptic
// at today's longitude, and the rule lies across the sun to read local apparent time on the limb.
// The maths is in sky.js.
//
// Motion: one sweep of the rete into place on arrival, then a redraw at most once a minute and none
// while the tab is hidden. Dragging the rete, the arrow keys and "Now" wind time; the pointer sights
// true altitude and azimuth through the inverse projection. Parts turn as transforms on SVG groups;
// nothing repaints in a loop. With reduced motion it arrives set; without JavaScript the static
// drawing in the page shows instead.

import Places from "./places.js";
import Sky from "./sky.js";

(() => {
  const host = document.querySelector("[data-model]");
  if (!host || typeof Sky === "undefined" || typeof Places === "undefined") return;
  const field = host.closest("[data-sight]");
  const art = host.closest(".sky__art");
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const { sin, cos, wrap360, wrap180 } = Sky;
  const f = (v) => (Math.round(v * 10) / 10).toString();

  /* ─────────── Where and when. `?t=2026-10-21T21:30` (a wall time in the zone) and `&tz=Area/City`
     fix both for testing; then "now" is that moment and the clock does not advance. */

  const params = new URLSearchParams(location.search);
  const place = Places.guess(params.get("tz") || undefined);
  const zone = place.zone && !/^(UTC|GMT|Etc\/)/.test(place.zone) ? place.zone : "UTC";
  const fixed = params.get("t") ? Places.wallToDate(params.get("t"), zone) : null;
  const clock = () => (fixed ? fixed.getTime() : Date.now());
  const lat = place.lat;
  const hemi = lat < 0 ? -1 : 1;

  /* ─────────── Geometry, in the drawing's 1600 × 1800 units around the centre pin. */

  const W = 1600;
  const H = 1800;
  const CX = 800;
  const CY = 1040;
  const PLATE = 540; // the plate's edge, the tropic farthest from the pole
  const R_OUT = 712; // the limb's outer edge
  const EPS = 23.44;
  const SCALE = PLATE / Sky.decRadius(-EPS * hemi, hemi); // plate units per projection unit (equator = 1)
  const DEG_BAND = 584; // degree scale 540–584, hours 584–712
  const RIM = 524; // the rete's rim, inner edge

  const polar = (deg, r) => [r * sin(deg), -r * cos(deg)];
  const pt = ([x, y]) => `${f(x)} ${f(y)}`;
  const circlePath = (cx, cy, r) =>
    `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
  const ring = (cx, cy, r0, r1) => circlePath(cx, cy, r1) + circlePath(cx, cy, r0);

  // A point on the rete before it turns: right ascension runs counterclockwise from the top in the
  // north (the rete is then turned clockwise by sidereal time). The south's mirror image comes from a
  // scale(-1 1) on the whole rete, so here the "north" frame holds for both, with declinations flipped.
  const onRete = (ra, dec) => polar(-ra, Sky.decRadius(dec, hemi) * SCALE);

  /* ─────────── Stars: J2000 places, precessed to now. The rete carries those its plate can hold. */

  const CATALOGUE = [
    // name, RA°, Dec°, magnitude
    ["Sirius", 101.287, -16.716, -1.46],
    ["Canopus", 95.988, -52.696, -0.74],
    ["Rigil Kent", 219.9, -60.834, -0.27],
    ["Arcturus", 213.915, 19.182, -0.05],
    ["Vega", 279.235, 38.784, 0.03],
    ["Capella", 79.172, 45.998, 0.08],
    ["Rigel", 78.634, -8.202, 0.13],
    ["Procyon", 114.825, 5.225, 0.34],
    ["Achernar", 24.429, -57.237, 0.46],
    ["Betelgeuse", 88.793, 7.407, 0.5],
    ["Hadar", 210.956, -60.373, 0.61],
    ["Altair", 297.696, 8.868, 0.76],
    ["Acrux", 186.65, -63.099, 0.77],
    ["Aldebaran", 68.98, 16.509, 0.86],
    ["Antares", 247.352, -26.432, 0.96],
    ["Spica", 201.298, -11.161, 0.97],
    ["Pollux", 116.329, 28.026, 1.14],
    ["Fomalhaut", 344.413, -29.622, 1.16],
    ["Deneb", 310.358, 45.28, 1.25],
    ["Regulus", 152.093, 11.967, 1.35],
    ["Dubhe", 165.932, 61.751, 1.79],
    ["Alpheratz", 2.097, 29.091, 2.06],
  ];
  const epoch = new Date(clock());
  const STARS = CATALOGUE.map(([name, ra, dec, mag]) => {
    const [r, d] = Sky.precess([ra, dec], epoch);
    return { name, ra: r, dec: d, mag };
  })
    // On the plate (inside the far tropic, with room for the rim) and clear of the pole.
    .filter((s) => hemi * s.dec > -EPS + 4 && hemi * s.dec < 80)
    .slice(0, 16)
    .sort((a, b) => a.ra - b.ra);

  /* ─────────── The drawing. */

  const ns = "http://www.w3.org/2000/svg";
  const ROMAN = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];

  function throne() {
    const base = -Math.sqrt(R_OUT ** 2 - 236 ** 2);
    const top = -R_OUT - 128;
    const d =
      `M-236 ${f(base + 26)}C-216 ${f(base - 64)} -112 ${f(top + 112)} -64 ${f(top + 64)}` +
      `C-36 ${f(top + 26)} -28 ${f(top)} 0 ${f(top)}C28 ${f(top)} 36 ${f(top + 26)} 64 ${f(top + 64)}` +
      `C112 ${f(top + 112)} 216 ${f(base - 64)} 236 ${f(base + 26)}Z`;
    const arch = `M-168 ${f(base - 4)}C-100 ${f(top + 138)} 100 ${f(top + 138)} 168 ${f(base - 4)}`;
    return (
      `<path class="m-solid" d="${d}"/><path class="m-hair" d="${arch}"/>` +
      `<circle class="m-mid" cx="0" cy="${f(top + 62)}" r="22"/>` +
      `<circle class="m-solid" cx="0" cy="${f(top - 26)}" r="26"/><circle class="m-hair" cx="0" cy="${f(top - 26)}" r="11"/>` +
      `<circle class="m-ring" cx="0" cy="${f(top - 98)}" r="52"/>`
    );
  }

  function limb() {
    let out = `<path class="m-paper" fill-rule="evenodd" d="${ring(0, 0, PLATE, R_OUT)}"/>`;
    const ticks = (r0, every, lengths) => {
      let d = "";
      for (let a = 0; a < 360 - 1e-9; a += every) {
        let len = lengths[0][1];
        for (const [step, l] of lengths)
          if (Math.abs(a / step - Math.round(a / step)) < 1e-6) len = l;
        d += `M${pt(polar(a, r0))}L${pt(polar(a, r0 + len))}`;
      }
      return d;
    };
    out += `<path class="m-tick" d="${ticks(PLATE, 1, [
      [1, 9],
      [5, 17],
      [10, 27],
    ])}"/>`;
    out += `<path class="m-tick" d="${ticks(DEG_BAND, 2.5, [
      [2.5, 10],
      [7.5, 18],
      [15, 34],
    ])}"/>`;
    for (const r of [PLATE, DEG_BAND, 700]) out += `<circle class="m-line" r="${r}"/>`;
    out += `<circle class="m-rim" r="${R_OUT}"/>`;
    // Hours: noon at the top and midnight at the foot; the rule reads the hour where it crosses.
    for (let t = 0; t < 24; t++) {
      const a = hemi * (t - 12) * 15;
      const [x, y] = polar(a, 652);
      const turn = wrap360(a);
      const rot = turn > 90 && turn < 270 ? turn + 180 : turn;
      out += `<text class="m-hour" x="${f(x)}" y="${f(y)}" transform="rotate(${f(rot)} ${f(x)} ${f(y)})">${ROMAN[t % 12]}</text>`;
    }
    return out;
  }

  function plate() {
    const s = (v) => v * SCALE;
    let out = "";
    // Tropic and equator, then the meridian and the six o'clock line.
    for (const dec of [EPS, 0])
      out += `<circle class="p-line" r="${f(s(Sky.decRadius(dec, 1)))}"/>`;
    out += `<path class="p-hair" d="M0 ${-PLATE}V${PLATE}M${-PLATE} 0H${PLATE}"/>`;
    // Almucantars every 6°, the twilight line at -18°, the horizon.
    for (let alt = 6; alt < 90; alt += 6) {
      const c = Sky.almucantar(alt, lat);
      out += `<circle class="p-hair" cy="${f(s(c.cy))}" r="${f(s(c.r))}"/>`;
    }
    const twi = Sky.almucantar(-18, lat);
    out += `<circle class="p-twilight" cy="${f(s(twi.cy))}" r="${f(s(twi.r))}"/>`;
    // Azimuths every 15°, from the horizon to the last almucantar.
    let d = "";
    for (let az = 0; az < 360; az += 15) {
      if (az % 180 === 0) continue; // the meridian is already drawn
      for (let i = 0; i <= 56; i++) {
        const alt = (84 * i) / 56;
        const q = Sky.equatorial(alt, az, Math.abs(lat));
        const p = Sky.toPlate(q.ha, q.dec, 1);
        d += `${i ? "L" : "M"}${f(s(p.x))} ${f(s(p.y))}`;
      }
    }
    out += `<path class="p-hair" d="${d}"/>`;
    const hz = Sky.almucantar(0, lat);
    out += `<circle class="p-horizon" cy="${f(s(hz.cy))}" r="${f(s(hz.r))}"/>`;
    const zen = Sky.toPlate(0, Math.abs(lat), 1);
    out += `<path class="p-line" d="M-9 ${f(s(zen.y))}h18M0 ${f(s(zen.y) - 9)}v18"/>`;
    return out;
  }

  // The rete as solid openwork. `shadow` drops the knockouts and the hit areas.
  function rete(shadow) {
    let out = `<path fill-rule="evenodd" d="${ring(0, 0, RIM, PLATE)}"/>`;
    // The ecliptic, tangent to both tropics.
    const p90 = onRete(90, EPS);
    const p270 = onRete(270, -EPS);
    const ex = (p90[0] + p270[0]) / 2;
    const er = Math.abs(p270[0] - p90[0]) / 2;
    const BAND = 22;
    const eq = SCALE; // the equator's radius
    const away = -Math.sign(ex); // the side where the ecliptic leaves room for the equator
    // The thumb, a knob on the rim at the first point of Aries, by which the rete is turned.
    out += `<path d="M-15 ${-RIM + 4}V${-PLATE - 16}A15 15 0 0 1 15 ${-PLATE - 16}V${-RIM + 4}Z"/>`;
    if (!shadow) out += `<circle class="r-knock" cy="${-PLATE - 15}" r="4.2"/>`;
    // Bars: the equinoctial colure top to bottom, the solstitial stub, and the half equator.
    out += `<path class="r-bar" d="M0 ${-RIM - 4}V${RIM + 4}"/>`;
    out += `<path class="r-bar r-bar--thin" d="M${f(away * (RIM + 4))} 0H${f(away * (Math.min(Math.abs(p90[0]), Math.abs(p270[0])) - 6))}"/>`;
    out += `<path class="r-bar r-bar--thin" d="M0 ${f(-eq)}A${f(eq)} ${f(eq)} 0 0 ${away < 0 ? 0 : 1} 0 ${f(eq)}"/>`;
    // Pointers: each grows from the nearest structure, a curved strut swelling into a flame whose
    // tip is the star. One filled outline, sampled along a bowed centreline; the swell leans to the
    // outside of the curve, as engraved flames do.
    const flame = (rx, ry, sx, sy, side) => {
      const len0 = Math.hypot(sx - rx, sy - ry);
      const ax = rx - ((sx - rx) / len0) * 6; // root sunk into the structure
      const ay = ry - ((sy - ry) / len0) * 6;
      const d = Math.hypot(sx - ax, sy - ay);
      const vx = (sx - ax) / d;
      const vy = (sy - ay) / d;
      const cx = ax + vx * d * 0.5 - vy * side * d * 0.14;
      const cy = ay + vy * d * 0.5 + vx * side * d * 0.14;
      const flameLen = Math.max(34, Math.min(86, d * 0.8));
      const left = [];
      const right = [];
      const N = 36;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const mt = 1 - t;
        const px = mt * mt * ax + 2 * mt * t * cx + t * t * sx;
        const py = mt * mt * ay + 2 * mt * t * cy + t * t * sy;
        let tx = 2 * mt * (cx - ax) + 2 * t * (sx - cx);
        let ty = 2 * mt * (cy - ay) + 2 * t * (sy - cy);
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const along = t * d;
        const u = Math.max(0, (along - (d - flameLen)) / flameLen);
        let hw =
          u > 0
            ? 3.3 * (1 - u) + 12 * Math.sin(Math.PI * Math.pow(u, 0.72)) * Math.pow(1 - u, 0.3)
            : 3.3;
        hw += 3.4 * Math.max(0, 1 - along / 26) ** 2; // the root flares into the structure
        const out = u > 0 ? 1.18 : 1;
        const inn = u > 0 ? 0.78 : 1;
        left.push(`${f(px - ty * side * hw * out)} ${f(py + tx * side * hw * out)}`);
        right.push(`${f(px + ty * side * hw * inn)} ${f(py - tx * side * hw * inn)}`);
      }
      return `M${left.join("L")}L${right.reverse().join("L")}Z`;
    };
    const anchors = (x, y) => {
      const r = Math.hypot(x, y);
      const de = Math.hypot(x - ex, y);
      const list = [[(x * RIM) / r, (y * RIM) / r]];
      list.push([ex + ((x - ex) * er) / de, (y * er) / de]);
      list.push([ex + ((x - ex) * (er - BAND)) / de, (y * (er - BAND)) / de]);
      if (Math.abs(y) < RIM) list.push([0, y]);
      if (x * away > 0 && r > 1) list.push([(x * eq) / r, (y * eq) / r]);
      return list;
    };
    let pointers = "";
    let knock = "";
    let hits = "";
    let halos = "";
    STARS.forEach((star, index) => {
      const [sx, sy] = onRete(star.ra, star.dec);
      const de = Math.hypot(sx - ex, sy);
      // A star on the band itself is pierced through it, as makers did, rather than given a flame.
      const tag = shadow ? "" : ` data-p="${index}"`;
      if (de > er - BAND - 6 && de < er + 6) {
        knock += `<circle class="r-knock"${tag} cx="${f(sx)}" cy="${f(sy)}" r="5.5"/>`;
      } else {
        let best = null;
        for (const [ax, ay] of anchors(sx, sy)) {
          const d = Math.hypot(ax - sx, ay - sy);
          if (!best || d < best.d) best = { d, ax, ay };
        }
        pointers += `<path${tag} d="${flame(best.ax, best.ay, sx, sy, index % 2 ? 1 : -1)}"/>`;
      }
      if (!shadow)
        halos += `<circle class="r-halo" data-p="${index}" cx="${f(sx)}" cy="${f(sy)}" r="17"/>`;
      hits += `<circle class="m-star" data-star="${index}" cx="${f(sx)}" cy="${f(sy)}" r="26" tabindex="${index ? -1 : 0}" role="img"/>`;
    });
    out += pointers;
    out += `<path fill-rule="evenodd" d="${ring(ex, 0, er - BAND, er)}"/>`;
    if (!shadow) {
      // The ecliptic's divisions, every 5° and every sign, cut through the band toward its centre.
      let d = "";
      const eps = Sky.obliquity(epoch);
      for (let lon = 0; lon < 360; lon += 5) {
        const ra = wrap360((Math.atan2(cos(eps) * sin(lon), cos(lon)) * 180) / Math.PI);
        const dec = (Math.asin(sin(eps) * sin(lon)) * 180) / Math.PI;
        const [x, y] = onRete(ra, dec);
        const k = Math.hypot(x - ex, y);
        const len = lon % 30 === 0 ? BAND - 2 : 9;
        d += `M${f(x)} ${f(y)}L${f(x - ((x - ex) / k) * len)} ${f(y - (y / k) * len)}`;
      }
      out += `<path class="r-cut" d="${d}"/>`;
      out += knock + halos;
    }
    return { markup: out, hits };
  }

  function rule() {
    const w = 13;
    const tip = 616;
    const shoulder = 560;
    return {
      body: `<path d="M0 ${-tip}L${w} ${-shoulder}V${shoulder}L0 ${tip}L${-w} ${shoulder}V${-shoulder}Z"/>`,
      index: `<path class="m-now" d="M0 ${-tip}L${w} ${-shoulder}H${-w}Z"/>`,
      fiducial: `<path class="m-fiducial" d="M0 ${-shoulder + 8}V${shoulder - 8}"/>`,
    };
  }

  const sunMark = () => {
    let rays = "";
    for (let a = 0; a < 360; a += 45) rays += `M${pt(polar(a, 17))}L${pt(polar(a, 25))}`;
    return `<circle class="m-sun-disc" r="11"/><circle class="m-sun-dot" r="3.6"/><path class="m-sun-rays" d="${rays}"/>`;
  };

  const reteParts = rete(false);
  const reteShadow = rete(true).markup;
  const ruleParts = rule();
  const mirror = hemi < 0 ? ' transform="scale(-1 1)"' : "";
  const latLabel = `${Math.round(Math.abs(lat))}° ${lat < 0 ? "S" : "N"}`;

  host.innerHTML =
    `<svg class="model" viewBox="0 0 ${W} ${H}" role="group" aria-label="An astrolabe with a plate for ${latLabel}, ${place.city}, set to the time shown below it">` +
    `<defs><clipPath id="m-plate-clip"><circle r="${PLATE}"/></clipPath></defs>` +
    `<g transform="translate(${CX} ${CY})">` +
    `<g aria-hidden="true">${throne()}${limb()}<g clip-path="url(#m-plate-clip)" class="m-plate">${plate()}</g></g>` +
    `<g class="m-shadow m-shadow--rete" aria-hidden="true" transform="translate(8 12)"><g data-turn="rete"><g${mirror}>${reteShadow}</g></g></g>` +
    `<g class="m-rete" aria-hidden="true"><g data-turn="rete"><g${mirror}>${reteParts.markup}</g></g></g>` +
    `<g class="m-shadow m-shadow--rule" aria-hidden="true" transform="translate(13 20)"><g data-turn="rule">${ruleParts.body}</g></g>` +
    `<g class="m-rule" aria-hidden="true"><g data-turn="rule">${ruleParts.body}${ruleParts.index}${ruleParts.fiducial}</g></g>` +
    `<g class="m-sun" aria-hidden="true"><g data-turn="rete"><g${mirror}><g data-sun>${sunMark()}</g></g></g></g>` +
    `<g class="m-pin" aria-hidden="true"><circle class="m-solid" r="24"/><circle class="m-dot" r="7"/></g>` +
    `<circle class="m-handle" r="${PLATE}" tabindex="0" role="slider" aria-label="Rete. Turn it to wind time; arrow keys step ten minutes, with Shift an hour" aria-valuemin="0" aria-valuemax="1439"/>` +
    `<g data-turn="rete"><g${mirror}>${reteParts.hits}</g></g>` +
    `</g></svg>`;

  const svg = host.querySelector("svg");
  const turns = {
    rete: [...svg.querySelectorAll('[data-turn="rete"]')],
    rule: [...svg.querySelectorAll('[data-turn="rule"]')],
  };
  const sunEl = svg.querySelector("[data-sun]");
  const handle = svg.querySelector(".m-handle");
  const starEls = [...svg.querySelectorAll(".m-star")];
  // Each star's pointer, knock and halo, so the night can show which stars are up.
  const starParts = STARS.map((_, index) => [
    ...svg.querySelectorAll(`.m-rete [data-p="${index}"]`),
  ]);
  const starsUp = STARS.map(() => null);
  art.classList.add("has-model");

  /* ─────────── The page's readouts. */

  const $ = (sel) => field.querySelector(sel);
  const plateTag = document.querySelectorAll("[data-plate]");
  for (const el of plateTag) el.textContent = `Plate for ${latLabel} · ${place.city}`;
  const clockEl = $("[data-clock]");
  const dateEl = $("[data-date]");
  const skyEl = $("[data-sky]");
  const nowButton = $("[data-now]");
  const tip = $("[data-star-tip]");
  for (const el of field.querySelectorAll("[data-time]")) el.hidden = false;

  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  // The zone's abbreviation where some English locale has one (PDT, BST, AEDT), else its offset.
  const zoneFmts = ["en-US", "en-GB", "en-AU", "en-NZ", "en-IN"].map(
    (l) => new Intl.DateTimeFormat(l, { timeZone: zone, timeZoneName: "short" }),
  );
  const longFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const zoneName = (date) => {
    const names = zoneFmts.map(
      (fmt) => fmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value || "",
    );
    return names.find((n) => !/^(GMT|UTC)[+-]/.test(n)) || names[0];
  };

  const COMPASS = [
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest",
  ];
  const compass = (az) => COMPASS[Math.round(wrap360(az) / 45) % 8];

  function describe(state) {
    const { sunAlt, sunAz } = state;
    const where = (name, alt, az) => {
      const east = wrap360(az) < 180;
      if (alt < 10) return `${name} ${east ? "rising" : "setting"} in the ${compass(az)}`;
      if (alt >= 62) return `${name} high in the ${compass(az)}, ${Math.round(alt)}° up`;
      return `${name} ${Math.round(alt)}° up in the ${compass(az)}`;
    };
    if (sunAlt > 0) return where("Sun", sunAlt, sunAz);
    if (sunAlt > -6)
      return `Twilight · the sun ${Math.round(-sunAlt)}° below the ${compass(sunAz)} horizon`;
    let pick = null;
    for (const star of STARS) {
      const { alt, az } = Sky.altAz(state.lst - star.ra, star.dec, lat);
      if (alt < 15) continue;
      if (!pick || star.mag < pick.mag) pick = { ...star, alt, az };
    }
    return pick ? where(pick.name, pick.alt, pick.az) : "Night · no bright star high yet";
  }

  /* ─────────── State: the represented moment is the clock plus an offset the visitor winds. */

  let offset = 0;
  let current = null;

  function stateAt(ms) {
    const date = new Date(ms);
    const lst = Sky.lst(date, place.lon);
    const sun = Sky.sun(date);
    const sunHa = wrap360(lst - sun.ra);
    const { alt: sunAlt, az: sunAz } = Sky.altAz(sunHa, sun.dec, lat);
    return { ms, date, lst, sun, sunHa, sunAlt, sunAz, lat };
  }

  let lastMinute = "";
  function render() {
    const state = (current = stateAt(clock() + offset));
    const reteTurn = `rotate(${(hemi * state.lst).toFixed(3)})`;
    for (const g of turns.rete) g.setAttribute("transform", reteTurn);
    const ruleTurn = `rotate(${(hemi * state.sunHa).toFixed(3)})`;
    for (const g of turns.rule) g.setAttribute("transform", ruleTurn);
    const [sx, sy] = onRete(state.sun.ra, state.sun.dec);
    sunEl.setAttribute("transform", `translate(${f(sx)} ${f(sy)})`);
    // Text changes only when the minute does.
    const minute = timeFmt.format(state.date);
    const key = `${minute}|${dateFmt.format(state.date)}`;
    if (key !== lastMinute) {
      lastMinute = key;
      const sky = describe(state);
      if (clockEl) clockEl.textContent = minute;
      if (dateEl) dateEl.textContent = `${zoneName(state.date)} · ${dateFmt.format(state.date)}`;
      if (skyEl) skyEl.textContent = sky;
      const apparent = 12 + state.sunHa / 15;
      const hh = Math.floor(apparent % 24);
      const mm = Math.floor((apparent * 60) % 60);
      const [h, m] = minute.split(":").map(Number);
      handle.setAttribute("aria-valuenow", String(h * 60 + m));
      handle.setAttribute(
        "aria-valuetext",
        `${longFmt.format(state.date)}; the rule reads ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} sun time; ${sky}`,
      );
    }
    STARS.forEach((star, index) => {
      const up = Sky.altAz(state.lst - star.ra, star.dec, lat).alt > 0;
      if (starsUp[index] === up) return;
      starsUp[index] = up;
      for (const el of starParts[index]) el.classList.toggle("is-up", up);
    });
    // The represented moment, for anything on the page that follows this sky (relight.js).
    field.dispatchEvent(new CustomEvent("astrolabe:time", { bubbles: true, detail: state }));
    if (nowButton) nowButton.disabled = Math.abs(offset) < 30000;
    if (tipStar !== null) placeTip();
    updateCallouts();
  }

  let frame = 0;
  const requestRender = () => {
    if (!frame) frame = requestAnimationFrame(() => ((frame = 0), render()));
  };

  /* ─────────── Tweens: the opening sweep and the return to now. Finite, then nothing runs. */

  let tween = 0;
  function tweenOffset(to, duration) {
    cancelAnimationFrame(tween);
    tween = 0;
    if (reducedQuery.matches || duration <= 0) {
      offset = to;
      render();
      return;
    }
    const from = offset;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const k = 1 - Math.pow(1 - t, 3);
      offset = from + (to - from) * k;
      render();
      tween = t < 1 ? requestAnimationFrame(step) : 0;
    };
    tween = requestAnimationFrame(step);
  }

  function backToNow() {
    // Whole days first, in one step: a day turns the rete by under a degree, so only the rest moves.
    const day = 86400000;
    offset -= Math.trunc(offset / day) * day;
    tweenOffset(0, Math.min(1200, 360 + Math.abs(offset) / 30000));
  }

  /* ─────────── The minute: redraw on the next minute boundary, never while hidden. */

  let minuteTimer = 0;
  function scheduleMinute() {
    clearTimeout(minuteTimer);
    if (fixed || document.hidden) return;
    minuteTimer = setTimeout(
      () => {
        if (!tween && !dragging) render();
        scheduleMinute();
      },
      60000 - (Date.now() % 60000) + 40,
    );
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !tween) render();
    scheduleMinute();
  });

  /* ─────────── Dragging the rete. The angle swept around the centre winds sidereal time. */

  const toLocal = (event) => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(m.inverse());
    return { x: p.x - CX, y: p.y - CY };
  };
  const angleOf = (p) => (Math.atan2(p.x, -p.y) * 180) / Math.PI;
  let dragging = false;
  let lastAngle = 0;
  let dragId = null;

  function onDown(event) {
    if (event.button > 0) return;
    const p = toLocal(event);
    if (!p || Math.hypot(p.x, p.y) > PLATE + 4 || Math.hypot(p.x, p.y) < 10) return;
    cancelAnimationFrame(tween);
    tween = 0;
    dragging = true;
    dragId = event.pointerId;
    lastAngle = angleOf(p);
    svg.setPointerCapture(event.pointerId);
    field.classList.add("is-turning");
    event.preventDefault();
  }
  function onMove(event) {
    if (!dragging || event.pointerId !== dragId) return;
    const p = toLocal(event);
    if (!p || Math.hypot(p.x, p.y) < 10) return;
    const a = angleOf(p);
    const da = wrap180(a - lastAngle);
    lastAngle = a;
    // The rete turns by hemi × sidereal time, so a turn of da degrees is hemi × da of sidereal time.
    offset += hemi * da * Sky.msPerSiderealDegree;
    requestRender();
  }
  function onUp(event) {
    if (event.pointerId !== dragId) return;
    dragging = false;
    dragId = null;
    field.classList.remove("is-turning");
  }
  svg.addEventListener("pointerdown", onDown);
  // A touch that starts on the plate turns the rete instead of scrolling; anywhere else still scrolls.
  svg.addEventListener(
    "touchstart",
    (event) => {
      const p = toLocal(event.touches[0]);
      if (p && Math.hypot(p.x, p.y) <= PLATE + 4) event.preventDefault();
    },
    { passive: false },
  );
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);

  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 3600000 : 600000;
    const keys = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: 86400000,
      PageDown: -86400000,
    };
    if (event.key === "Home") {
      event.preventDefault();
      backToNow();
      return;
    }
    if (!(event.key in keys)) return;
    event.preventDefault();
    cancelAnimationFrame(tween);
    tween = 0;
    offset += keys[event.key];
    render();
  });
  nowButton?.addEventListener("click", backToNow);

  /* ─────────── Stars: hover or focus names one, with its altitude and azimuth at the moment shown. */

  let tipStar = null;
  function starInfo(star) {
    const { alt, az } = Sky.altAz(current.lst - star.ra, star.dec, lat);
    return {
      alt,
      az,
      text: `${star.name} · ALT ${alt.toFixed(1)}° · AZ ${az.toFixed(1)}°${alt < 0 ? " · below the horizon" : ""}`,
    };
  }
  function placeTip() {
    if (!tip || tipStar === null) return;
    const el = starEls[tipStar];
    const info = starInfo(STARS[tipStar]);
    if (tip.textContent !== info.text) tip.textContent = info.text;
    el.setAttribute("aria-label", info.text);
    const box = field.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2 - box.left;
    const y = r.top + r.height / 2 - box.top;
    const flipX = x > box.width - 260;
    tip.style.transform = `translate(${flipX ? x - 18 : x + 18}px, ${y - 30}px) translate(${flipX ? "-100%" : "0"}, -50%)`;
  }
  function showStar(index) {
    tipStar = index;
    field.classList.add("has-star");
    tip.hidden = false;
    placeTip();
  }
  function hideStar() {
    tipStar = null;
    field.classList.remove("has-star");
    if (tip) tip.hidden = true;
  }
  starEls.forEach((el, index) => {
    el.setAttribute("aria-label", STARS[index].name);
    el.addEventListener(
      "pointerenter",
      (event) => event.pointerType !== "touch" && !dragging && showStar(index),
    );
    el.addEventListener(
      "pointerleave",
      () => tipStar === index && document.activeElement !== el && hideStar(),
    );
    el.addEventListener("focus", () => showStar(index));
    el.addEventListener("blur", hideStar);
    // One tab stop for the stars; the arrow keys walk them in order of right ascension.
    el.addEventListener("keydown", (event) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!dir) return;
      event.preventDefault();
      const next = starEls[(index + dir + starEls.length) % starEls.length];
      el.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });
  });

  /* ─────────── Callouts: drafting leaders to each part. Two layouts: labels in the margins when the
     field has room beside the instrument, in the instrument's corners when it does not. The rule's
     leader follows the rule. */

  const callouts = document.createElementNS(ns, "svg");
  callouts.setAttribute("class", "callouts");
  callouts.setAttribute("viewBox", `0 0 ${W} ${H}`);
  callouts.setAttribute("aria-hidden", "true");
  art.append(callouts);
  const NAMES = ["Rete", "Plate", "Rule", "Limb", "Horizon"];
  const labels = NAMES.map((name) => {
    const el = document.createElement("span");
    el.className = "callout";
    el.textContent = name;
    el.setAttribute("aria-hidden", "true");
    art.append(el);
    return el;
  });
  const paths = NAMES.map(() => {
    const p = document.createElementNS(ns, "path");
    callouts.append(p);
    return p;
  });
  const dots = NAMES.map(() => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("class", "callout__dot");
    callouts.append(p);
    return p;
  });

  // Leaders run radially where they can, crossing the limb between two hour numerals. The horizon's
  // anchor is where a radial at `deg` meets it on the plate (the west point if it does not).
  const horizonAt = (deg) => {
    const hz = Sky.almucantar(0, lat);
    const cy = hz.cy * SCALE;
    const r = hz.r * SCALE;
    const [dx, dy] = polar(deg, 1);
    const b = dy * cy;
    const t = b + Math.sqrt(b * b - (cy * cy - r * r));
    if (t > 0 && t < PLATE - 20) return [dx * t, dy * t];
    const q = Sky.equatorial(0, hemi > 0 ? 270 : 90, lat);
    const p = Sky.toPlate(q.ha, q.dec, hemi);
    return [p.x * SCALE, p.y * SCALE];
  };
  const along = (deg, y) => polar(deg, Math.abs(y / cos(deg)));
  const LAYOUTS = {
    // name: [anchor, elbow, side]
    wide: {
      Rete: [polar(-52.5, RIM + 8), along(-52.5, -660), -1],
      Plate: [polar(-112.5, SCALE), along(-112.5, 330), -1],
      Limb: [polar(-142.5, 676), [-560 - 320, 640], -1],
      Rule: ["rule", along(52.5, -660), 1],
      Horizon: [horizonAt(112.5), along(112.5, 330), 1],
    },
    narrow: {
      Rete: [polar(-22.5, RIM + 8), along(-22.5, -810), -1],
      Plate: [polar(-37.5, SCALE), along(-37.5, -700), -1],
      Rule: ["rule", along(22.5, -810), 1],
      Limb: [polar(-142.5, 676), along(-142.5, 712), -1],
      Horizon: [horizonAt(142.5), along(142.5, 712), 1],
    },
  };
  let layout = "wide";
  function chooseLayout() {
    const box = field.getBoundingClientRect();
    const a = art.getBoundingClientRect();
    const margin = Math.min(a.left - box.left, box.right - a.right);
    layout = margin > 150 ? "wide" : "narrow";
    field.dataset.callouts = layout;
  }
  function updateCallouts() {
    if (!current) return;
    const set = LAYOUTS[layout];
    NAMES.forEach((name, i) => {
      let [anchor, elbow, side] = set[name];
      if (anchor === "rule") {
        // The point of the rule nearest the label, kept clear of the pin and short of the tips.
        const [dx, dy] = polar(hemi * current.sunHa, 1);
        const t = elbow[0] * dx + elbow[1] * dy;
        const r = Math.sign(t || 1) * Math.min(540, Math.max(240, Math.abs(t)));
        anchor = [dx * r, dy * r];
      }
      const ax = anchor[0] + CX;
      const ay = anchor[1] + CY;
      const ex = elbow[0] + CX;
      const ey = elbow[1] + CY;
      const shoulder = ex + side * 34;
      paths[i].setAttribute("d", `M${f(ax)} ${f(ay)}L${f(ex)} ${f(ey)}H${f(shoulder)}`);
      dots[i].setAttribute("d", `M${f(ax)} ${f(ay)}h0`);
      const el = labels[i];
      el.style.left = `${((shoulder + side * 10) / W) * 100}%`;
      el.style.top = `${(ey / H) * 100}%`;
      el.dataset.side = side < 0 ? "left" : "right";
    });
  }
  new ResizeObserver(() => {
    chooseLayout();
    updateCallouts();
  }).observe(field);

  /* ─────────── Sighting: the crosshair readout, through the inverse projection. */

  window.astrolabeSight = (clientX, clientY) => {
    if (tipStar !== null || !current) return null;
    const p = toLocal({ clientX, clientY });
    if (!p) return null;
    const r = Math.hypot(p.x, p.y);
    if (r <= PLATE) {
      const q = Sky.fromPlate(p.x / SCALE, p.y / SCALE, hemi);
      const { alt, az } = Sky.altAz(q.ha, q.dec, lat);
      return `ALT ${alt.toFixed(1)}° · AZ ${az.toFixed(1).padStart(5, "0")}°`;
    }
    if (r <= R_OUT) {
      // The limb: the sun time of the hour line under the pointer.
      const t = 12 + wrap360(hemi * angleOf(p)) / 15;
      const minutes = Math.round((t % 24) * 60) % 1440;
      return `Limb · ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} sun time`;
    }
    return "";
  };
  window.astrolabeCentre = () => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const c = new DOMPoint(CX, CY).matrixTransform(m);
    return { x: c.x, y: c.y };
  };

  /* ─────────── Arrival: set the instrument, and the first time it comes into view, sweep the rete
     in from three hours back. */

  chooseLayout();
  if (reducedQuery.matches || !("IntersectionObserver" in window)) {
    render();
  } else {
    offset = -3 * 3600000;
    render();
    const arrival = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        arrival.disconnect();
        if (!dragging && offset === -3 * 3600000) tweenOffset(0, 1400);
      },
      { threshold: 0.35 },
    );
    arrival.observe(art);
  }
  scheduleMinute();
  reducedQuery.addEventListener("change", () => {
    if (reducedQuery.matches && (tween || offset === -3 * 3600000)) tweenOffset(0, 0);
  });
})();
