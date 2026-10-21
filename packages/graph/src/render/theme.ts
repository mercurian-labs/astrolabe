/**
 * The graph's colors come from CSS custom properties on its container, so a
 * dark theme is a variable swap and the host's theme owns the palette:
 *
 *   --atlas-paper   the ground, and what receded and far things fade toward
 *   --atlas-ink     notes, lines, and labels
 *   --atlas-accent  the one accent: the turn's worked notes, new and broken marks
 *   --atlas-warning a muted amber for design warnings: failure flow, crossed boundaries
 *   --atlas-lens-1 … --atlas-lens-6  one tint per skill map, by the map's position
 */
import { Color } from "three";

export const LENS_SLOTS = 6;

export interface GraphTheme {
  readonly paper: Color;
  readonly ink: Color;
  readonly accent: Color;
  readonly warning: Color;
  readonly lenses: ReadonlyArray<Color>;
}

const FALLBACK = {
  paper: "#f7f6f2",
  ink: "#23211d",
  accent: "#b4532a",
  warning: "#b08a2e",
  lenses: ["#2f6b73", "#8a6d1f", "#5b4a86", "#3f7a45", "#8c3f5d", "#4b6584"],
};

/** A 2D context that can paint, used to turn any CSS color into sRGB bytes; null where none. */
let painter: CanvasRenderingContext2D | null | undefined;
function paintContext(): CanvasRenderingContext2D | null {
  if (painter !== undefined) return painter;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    painter = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    painter = null;
  }
  return painter ?? null;
}

/**
 * `value` as `#rrggbb`, by painting it: a host's tokens may be `oklch()`, `color-mix()`, or
 * `lab()` (Tailwind v4 is), which three's `Color.setStyle` does not read and would leave white.
 * Null when the context cannot paint it or there is no context (a test, a server).
 */
export function cssToHex(
  value: string,
  context: Pick<CanvasRenderingContext2D, "fillStyle" | "clearRect" | "fillRect" | "getImageData">,
): string | null {
  context.fillStyle = "#000";
  context.fillStyle = value;
  // An unparsable value leaves the previous fillStyle; painting black twice is the signal.
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  if (a === 0 || r === undefined || g === undefined || b === undefined) return null;
  const hex = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function read(style: CSSStyleDeclaration, name: string, fallback: string): Color {
  const value = style.getPropertyValue(name).trim();
  const color = new Color();
  const context = paintContext();
  const painted = value.length > 0 && context !== null ? cssToHex(value, context) : null;
  try {
    color.setStyle(painted ?? (value.length > 0 ? value : fallback));
  } catch {
    color.setStyle(fallback);
  }
  return color;
}

export function readTheme(element: Element): GraphTheme {
  const style = getComputedStyle(element);
  return {
    paper: read(style, "--atlas-paper", FALLBACK.paper),
    ink: read(style, "--atlas-ink", FALLBACK.ink),
    accent: read(style, "--atlas-accent", FALLBACK.accent),
    warning: read(style, "--atlas-warning", FALLBACK.warning),
    lenses: FALLBACK.lenses.map((fallback, slot) =>
      read(style, `--atlas-lens-${slot + 1}`, fallback),
    ),
  };
}
