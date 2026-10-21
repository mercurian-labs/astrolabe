// Astrolabe · drafting · twilight
//
// The closing section's palette as a function of the sun's altitude at the instrument's represented
// time. Above the horizon it is the page's paper and ink; through civil twilight (0° to −6°) the paper
// warms and dims; through nautical (−6° to −12°) it falls toward the night and the inks turn over to
// ivory; through astronomical (−12° to −18°) it deepens; below −18° it is the night band: ivory and
// olive on charcoal. Colours are mixed in OKLab. The text inks are chosen for contrast, not mixed:
// the ink is whichever of the two inks reads better on the paper, and the softer inks are that ink
// moved toward the paper only as far as their day contrast allows, so every state stays legible.
// `node` can import this file.

const Twilight = (() => {
  // alt° → paper. Day above the horizon, night below −18°.
  const PAPER = [
    [0, "#fbf9f4"],
    [-3, "#f4ead8"],
    [-6, "#e6d3b2"],
    [-8, "#c9b392"],
    [-9.5, "#a59176"],
    [-10.5, "#63574a"],
    [-12, "#4a4138"],
    [-15, "#2b2723"],
    [-18, "#1e1c1a"],
  ];
  const DARK = "#292724"; // the page's ink
  const IVORY = "#eaddc7"; // the night band's ink
  const OLIVE = [
    [-6, "#807948"],
    [-18, "#8d8455"],
  ];
  const RUST = "#a0492a";
  // Contrast each softer ink keeps against the paper by day, and holds where it can. At the ends the
  // page's own values take over: the paper's (DAY) above the horizon, the night band's (NIGHT) below
  // −18°.
  const SOFT = {
    "--ink-2": 7.4,
    "--ink-3": 4.5,
    "--ink-4": 1.85,
    "--rule": 1.6,
    "--rule-soft": 1.2,
  };
  const DAY = {
    "--ink-2": "#57514a",
    "--ink-3": "#7d766b",
    "--ink-4": "#c3baaa",
    "--rule": "#cfc4b1",
    "--rule-soft": "#e6dfd2",
  };
  const NIGHT = {
    "--ink-2": "#bdb29f",
    "--ink-3": "#958c7c",
    "--ink-4": "#5d574e",
    "--rule": "#45403a",
    "--rule-soft": "#2e2b27",
  };

  /* ─────────── Colour. */

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const toHex = (c) =>
    "#" +
    c
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055);
  function toLab(c) {
    const [r, g, b] = c.map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }
  function fromLab([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map(gam);
  }
  const mix = (a, b, t) => fromLab(toLab(a).map((v, i) => v + (toLab(b)[i] - v) * t));
  const luminance = (c) => {
    const [r, g, b] = c.map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  // Piecewise in altitude, held flat beyond the ends.
  function along(stops, alt) {
    if (alt >= stops[0][0]) return hex(stops[0][1]);
    for (let i = 1; i < stops.length; i++) {
      const [a1, c1] = stops[i];
      if (alt >= a1) {
        const [a0, c0] = stops[i - 1];
        return mix(hex(c0), hex(c1), (a0 - alt) / (a0 - a1));
      }
    }
    return hex(stops[stops.length - 1][1]);
  }

  // The farthest toward the paper an ink can move and keep `target` contrast (or the ink itself).
  function soften(ink, paper, target) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const t = (lo + hi) / 2;
      if (contrast(mix(ink, paper, t), paper) >= target) lo = t;
      else hi = t;
    }
    return mix(ink, paper, lo);
  }

  function rustText(ink, paper) {
    const rust = hex(RUST);
    if (contrast(rust, paper) >= 4.5) return rust;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const t = (lo + hi) / 2;
      if (contrast(mix(ink, rust, t), paper) >= 4.5) lo = t;
      else hi = t;
    }
    return mix(ink, rust, lo);
  }

  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  /* ─────────── The palette. `night` runs 0 → 1 from −6° to −18°, for what only shows after dark. */

  function at(alt) {
    const paper = along(PAPER, alt);
    const dark = hex(DARK);
    const ivory = hex(IVORY);
    const inverted = contrast(ivory, paper) > contrast(dark, paper);
    const ink = inverted ? ivory : dark;
    const vars = { "--paper": toHex(paper), "--ink": toHex(ink) };
    const day = smooth(-3, 0, alt);
    const late = smooth(-15, -18, alt);
    for (const [name, target] of Object.entries(SOFT)) {
      let c = soften(ink, paper, target);
      if (day > 0) c = mix(c, hex(DAY[name]), day);
      if (late > 0) c = mix(c, hex(NIGHT[name]), late);
      vars[name] = toHex(c);
    }
    vars["--olive"] = toHex(along(OLIVE, alt));
    // Rust stays rust where it fills (the button, the sun); as text it leans toward the ink as far as
    // it must to read.
    vars["--rust-text"] = toHex(rustText(ink, paper));
    const night = smooth(-6, -18, alt);
    vars["--night"] = night.toFixed(3);
    return {
      alt,
      vars,
      inverted,
      night,
      paper,
      ink,
      dark,
      ivory,
      olive: along(OLIVE, alt),
      paperY: luminance(paper),
      darkY: luminance(dark),
      ivoryY: luminance(ivory),
      contrast: contrast(ink, paper),
    };
  }

  // Sets the palette on an element, skipping the work when nothing visible changed.
  function apply(el, alt) {
    const key = Math.round(alt * 20);
    if (el._twilightKey === key) return el._twilight;
    const state = at(alt);
    for (const [name, value] of Object.entries(state.vars)) el.style.setProperty(name, value);
    el.dataset.twilight =
      alt > 0
        ? "day"
        : alt > -6
          ? "civil"
          : alt > -12
            ? "nautical"
            : alt > -18
              ? "astronomical"
              : "night";
    el._twilightKey = key;
    el._twilight = state;
    return state;
  }

  return { at, apply, contrast, luminance, hex, toHex, mix };
})();

export default Twilight;
