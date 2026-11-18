// Astrolabe · drafting · the page's two themes: light while the instrument's sun is up, dark once it
// has set, as macOS's Auto appearance turns. drafting.css holds both palettes under data-theme; this
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

  // Crossing the horizon turns `twilight-ease` on for a moment (drafting.css crossfades the palette
  // under it, with motion allowed). Returns the theme shown.
  let shown = null;
  let easing = 0;
  function page(alt, root = document.documentElement) {
    const state = at(alt);
    if (state === shown) return state;
    if (shown && root.classList.contains("motion")) {
      root.classList.add("twilight-ease");
      clearTimeout(easing);
      easing = setTimeout(() => root.classList.remove("twilight-ease"), 420);
    }
    root.dataset.theme = state.theme;
    root.style.colorScheme = state.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.paperHex);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", state.theme);
    shown = state;
    return state;
  }

  return { at, page, current: () => shown };
})();

export default Twilight;
