import type { CSSProperties } from "react";

/** The Atlas Graph's `--atlas-*` colors from the app's theme, set on an ancestor of a graph. */
export const ATLAS_COLORS = {
  "--atlas-paper": "var(--background)",
  "--atlas-ink": "var(--foreground)",
  "--atlas-accent": "var(--primary)",
  "--atlas-warning": "var(--color-amber-600)",
  "--atlas-rule": "var(--border)",
  "--atlas-muted": "var(--muted-foreground)",
  "--atlas-lens-1": "var(--color-teal-600)",
  "--atlas-lens-2": "var(--color-yellow-600)",
  "--atlas-lens-3": "var(--color-violet-600)",
  "--atlas-lens-4": "var(--color-green-600)",
  "--atlas-lens-5": "var(--color-pink-600)",
  "--atlas-lens-6": "var(--color-sky-600)",
  "--atlas-font": "var(--font-mono)",
} as CSSProperties;
