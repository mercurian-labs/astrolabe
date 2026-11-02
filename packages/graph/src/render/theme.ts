/**
 * Colors come from CSS custom properties on the container, so the host's theme owns the palette
 * (`--atlas-paper`, `--atlas-ink`, `--atlas-accent`, …), read as `#rrggbb` by painting them.
 */
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
 * `lab()` (Tailwind v4 is), which a plain hex parser does not read.
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

/** A custom property as `#rrggbb`, or `fallback` when it is unset or cannot be painted. */
export function cssHex(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  const context = paintContext();
  return (value.length > 0 && context !== null ? cssToHex(value, context) : null) ?? fallback;
}
