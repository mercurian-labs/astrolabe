// Astrolabe · drafting · the page's two themes: light while the instrument's sun is up, dark once it
// has set, as macOS's Auto appearance turns, unless the visitor has picked one with the header's
// switch, which is remembered in this browser. drafting.css holds both palettes under data-theme; this
// picks one, crossfades at the flip, and hands the prints (relight.js, plate.js) the inks they print in.

const Twilight = (() => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = (c) => {
    const [r, g, b] = c.map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const dark = hex("#292724");
  const ivory = hex("#eaddc7");

  // drafting.css's paper, olive and rust as text, in each theme.
  const theme = (name, paper, olive, rust) => ({
    theme: name,
    inverted: name === "dark",
    night: name === "dark" ? 1 : 0,
    paperHex: paper,
    paper: hex(paper),
    olive: hex(olive),
    rust: hex(rust),
    dark,
    ivory,
    paperY: luminance(hex(paper)),
    darkY: luminance(dark),
    ivoryY: luminance(ivory),
  });
  const LIGHT = theme("light", "#fbf9f4", "#807948", "#a0492a");
  const DARK = theme("dark", "#24211e", "#8d8455", "#bb7a5d");
  const at = (alt) => (alt > 0 ? LIGHT : DARK);

  // The header's switch: "light" or "dark" outranks the sky until the visitor turns the instrument.
  // Kept per browser; storage can be missing (private windows), and then the choice lasts the visit.
  const KEY = "astrolabe:theme";
  let choice = null;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") choice = saved;
  } catch {}

  // Crossing the horizon, or the switch, turns `twilight-ease` on for a moment (drafting.css
  // crossfades the palette under it, with motion allowed). `twilight:change` tells the prints.
  let shown = null;
  let sky = null; // the theme the sky alone would show
  let easing = 0;
  function apply(state, root = document.documentElement) {
    if (state === shown) return state;
    const was = root.dataset.theme;
    if (was && was !== state.theme && root.classList.contains("motion")) {
      root.classList.add("twilight-ease");
      clearTimeout(easing);
      easing = setTimeout(() => root.classList.remove("twilight-ease"), 420);
    }
    root.dataset.theme = state.theme;
    root.style.colorScheme = state.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.paperHex);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", state.theme);
    shown = state;
    document.dispatchEvent(new CustomEvent("twilight:change", { detail: state }));
    return state;
  }
  const byName = (name) => (name === "dark" ? DARK : LIGHT);

  // The sun's altitude decides the theme unless the visitor has chosen one. Returns the theme shown.
  function page(alt) {
    sky = at(alt);
    return apply(choice ? byName(choice) : sky);
  }

  // The switch: a theme, or null to follow the sky again (the instrument calls that when turned).
  function choose(name) {
    choice = name === "light" || name === "dark" ? name : null;
    try {
      if (choice) localStorage.setItem(KEY, choice);
      else localStorage.removeItem(KEY);
    } catch {}
    const root = document.documentElement;
    return apply(choice ? byName(choice) : sky || byName(root.dataset.theme));
  }

  // The sun the prints are lit by, [alt, az]: the instrument's own, or, when the chosen theme disagrees
  // with the sky, a mid-morning sun in front of the view (south-east, or north-east under a southern
  // sky) or a deep night, so the inks and the light tell the same story.
  function lit(alt, az, south) {
    if (!choice || at(alt).theme === choice) return [alt, az];
    return choice === "dark" ? [-20, az] : [30, south ? 45 : 135];
  }

  return { at, page, choose, lit, current: () => shown, chosen: () => choice };
})();

export default Twilight;
