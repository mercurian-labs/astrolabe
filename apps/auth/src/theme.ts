import { MERCURIAN_THEME } from "@t3tools/shared/themePalettes";

/**
 * The pages wear Astrolabe's Mercurian palette, read from the app's own theme
 * so the two never drift. Light or dark follows the system.
 */
export function applyTheme(): void {
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const colors = dark.matches
      ? { ...MERCURIAN_THEME.colors, ...MERCURIAN_THEME.variants?.dark }
      : MERCURIAN_THEME.colors;
    const root = document.documentElement;
    root.dataset.appearance = dark.matches ? "dark" : "light";
    for (const [role, value] of Object.entries(colors)) {
      if (typeof value === "string") root.style.setProperty(`--m-${role}`, value);
    }
  };
  apply();
  dark.addEventListener("change", apply);
}
