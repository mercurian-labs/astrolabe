import type { CSSProperties } from "react";

/** The lens colours, by slot: the Atlas Graph's skill maps, and a local graph's groups. */
export const LENS_COLORS = [
  { name: "Teal", css: "var(--color-teal-600)" },
  { name: "Yellow", css: "var(--color-yellow-600)" },
  { name: "Violet", css: "var(--color-violet-600)" },
  { name: "Green", css: "var(--color-green-600)" },
  { name: "Pink", css: "var(--color-pink-600)" },
  { name: "Sky", css: "var(--color-sky-600)" },
] as const;

/** The Atlas Graph's `--atlas-*` colors from the app's theme, set on an ancestor of a graph. */
export const ATLAS_COLORS = {
  "--atlas-paper": "var(--background)",
  "--atlas-ink": "var(--foreground)",
  "--atlas-accent": "var(--primary)",
  "--atlas-warning": "var(--color-amber-600)",
  "--atlas-rule": "var(--border)",
  "--atlas-muted": "var(--muted-foreground)",
  ...Object.fromEntries(LENS_COLORS.map((color, slot) => [`--atlas-lens-${slot + 1}`, color.css])),
  "--atlas-font": "var(--font-mono)",
} as CSSProperties;
