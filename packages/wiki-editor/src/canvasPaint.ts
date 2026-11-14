/**
 * How each thing on a board is painted, from its `color` and `astrolabe.style`: the one answer
 * the web board, the image export and the phone's preview all draw from, so a line's width and
 * dashes mean the same in each. Pure, with no DOM, so the phone can import it.
 */
import type {
  CanvasDash,
  CanvasEdge,
  CanvasInk,
  CanvasNode,
  CanvasSloppiness,
  CanvasStyle,
} from "@mercurian/wiki/canvas";
import rough from "roughjs";

import { canvasColor } from "./canvasGeometry";

/** The spec's presets, as `canvasBoard.css` draws them. */
export const CANVAS_PRESET_COLORS: Readonly<Record<string, string>> = {
  "1": "#e5484d",
  "2": "#f76b15",
  "3": "#d6a100",
  "4": "#30a46c",
  "5": "#00a2c7",
  "6": "#8e4ec6",
};

/** A preset's or hex colour's value; none for anything else. */
export const canvasTint = (color: string | undefined): string | undefined => {
  const { preset, hex } = canvasColor(color);
  return hex ?? (preset === undefined ? undefined : CANVAS_PRESET_COLORS[preset]);
};

/** A box is a rectangular card or a section; a shape, an ellipse or diamond card; a line, the rest. */
export type CanvasPaintKind = "card" | "shape" | "section" | "arrow" | "stroke";

export type CanvasWidthStep = "thin" | "medium" | "bold";

/** Board units, by kind. Each kind's default is the width it has always drawn at. */
export const CANVAS_WIDTH_STEPS: Readonly<
  Record<CanvasPaintKind, Readonly<Record<CanvasWidthStep, number>>>
> = {
  card: { thin: 1, medium: 2, bold: 4 },
  shape: { thin: 1, medium: 2, bold: 4 },
  section: { thin: 1, medium: 2, bold: 4 },
  arrow: { thin: 1, medium: 1.5, bold: 3 },
  stroke: { thin: 1.5, medium: 2.5, bold: 5 },
};

export const CANVAS_DEFAULT_WIDTH: Readonly<Record<CanvasPaintKind, number>> = {
  card: 1,
  shape: 1,
  section: 1,
  arrow: 1.5,
  stroke: 2.5,
};

/** The step a width is, if it is one. */
export const canvasWidthStep = (kind: CanvasPaintKind, width: number) =>
  (Object.entries(CANVAS_WIDTH_STEPS[kind]) as Array<[CanvasWidthStep, number]>).find(
    ([, value]) => value === width,
  )?.[0];

export const CANVAS_CORNER_RADIUS = 8;

/**
 * Below this zoom a line stops thinning with the board: on screen it is never under this share of
 * its width at 100%, so an agent's diagram read at 20% keeps its lines and their weights.
 */
export const CANVAS_LINE_FLOOR_ZOOM = 0.5;

/** What a line's board width is multiplied by at `zoom` to keep to the floor. */
export const canvasLineScale = (zoom: number): number =>
  zoom > 0 ? Math.max(1, CANVAS_LINE_FLOOR_ZOOM / zoom) : 1;

/** Dash lengths for a line `width` wide, in the same units. Dotted is round dots: draw it round. */
export function canvasDashArray(
  dash: CanvasDash | undefined,
  width: number,
): readonly [number, number] | null {
  if (dash === "dashed") return [width * 4, width * 3];
  if (dash === "dotted") return [0, width * 2];
  return null;
}

export type CanvasPaintFill =
  | { readonly kind: "none" }
  /** The board's own background. */
  | { readonly kind: "surface" }
  /**
   * `color` at `amount`, over the board's background or over nothing. A null colour is the
   * theme's muted one.
   */
  | {
      readonly kind: "tint";
      readonly color: string | null;
      readonly amount: number;
      readonly over: "surface" | "clear";
    };

export type CanvasOutline =
  | {
      readonly kind: "box";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly radius: number;
    }
  | { readonly kind: "path"; readonly d: string };

export interface CanvasPaint {
  readonly kind: CanvasPaintKind;
  readonly fill: CanvasPaintFill;
  /** The line's colour; null is the theme's for its kind. */
  readonly stroke: string | null;
  /** Board units, before `canvasLineScale`. */
  readonly width: number;
  readonly dash: CanvasDash;
  /** Board units, before `canvasLineScale`; null is solid. */
  readonly dashArray: readonly [number, number] | null;
  readonly cap: "round" | "butt";
  readonly radius: number;
  readonly opacity: number;
  /** 0 draws clean lines; 1 and 2 draw them by hand, from `canvasSketch`. */
  readonly sloppiness: CanvasSloppiness;
}

/** How soft a preset's fill is; a hex fill is what it says. */
const SOFT_FILL = { box: 0.22, section: 0.14 } as const;

const styleOf = (item: { readonly astrolabe?: { readonly style?: CanvasStyle } }) =>
  item.astrolabe?.style ?? {};

/** Ink drawn with a pen's pressure is hand-drawn already: sloppiness leaves it as it is. */
export const canvasIsPressed = (item: CanvasNode | CanvasEdge | CanvasInk): boolean =>
  !("fromNode" in item) && item.type === "stroke" && item.pressure !== undefined;

export function canvasPaintKind(item: CanvasNode | CanvasEdge | CanvasInk): CanvasPaintKind {
  if ("fromNode" in item) return "arrow";
  if (item.type === "stroke") return "stroke";
  if (item.type === "arrow") return "arrow";
  if (item.type === "group") return "section";
  return item.type === "text" && item.astrolabe?.shape !== undefined ? "shape" : "card";
}

function fillOf(kind: CanvasPaintKind, color: string | undefined, fill: string | undefined) {
  if (kind === "arrow" || kind === "stroke") return { kind: "none" } as const;
  const over = kind === "section" ? "clear" : "surface";
  if (fill === "none") return { kind: "none" } as const;
  const { preset, hex } = canvasColor(fill);
  if (hex !== undefined) return { kind: "tint", color: hex, amount: 1, over } as const;
  if (preset !== undefined) {
    const amount = kind === "section" ? SOFT_FILL.section : SOFT_FILL.box;
    return { kind: "tint", color: CANVAS_PRESET_COLORS[preset] ?? null, amount, over } as const;
  }
  const tint = canvasTint(color);
  if (kind === "section") return { kind: "tint", color: tint ?? null, amount: 0.06, over } as const;
  return tint === undefined
    ? ({ kind: "surface" } as const)
    : ({ kind: "tint", color: tint, amount: 0.1, over } as const);
}

/** How `item` paints, its style read over its kind's defaults. */
export function canvasPaint(item: CanvasNode | CanvasEdge | CanvasInk): CanvasPaint {
  const kind = canvasPaintKind(item);
  const style = styleOf(item);
  const width = style.width ?? CANVAS_DEFAULT_WIDTH[kind];
  const dash = style.dash ?? "solid";
  const box = kind === "card" || kind === "section";
  return {
    kind,
    fill: fillOf(kind, item.color, style.fill),
    stroke: canvasTint(item.color) ?? null,
    width,
    dash,
    dashArray: canvasDashArray(dash, width),
    cap: dash === "dotted" || kind === "stroke" ? "round" : "butt",
    radius: box && style.corners === "sharp" ? 0 : box ? CANVAS_CORNER_RADIUS : 0,
    opacity: style.opacity ?? 1,
    sloppiness: canvasIsPressed(item) ? 0 : (style.sloppiness ?? 0),
  };
}

/** A card's or section's outline: its box, or a shaped card's ellipse or diamond as a path. */
export function canvasOutline(node: CanvasNode, paint: CanvasPaint): CanvasOutline {
  const { x, y, width, height } = node;
  const shape = node.type === "text" ? node.astrolabe?.shape : undefined;
  if (shape === "ellipse") {
    const rx = width / 2;
    const ry = height / 2;
    return {
      kind: "path",
      d: `M${x} ${y + ry}A${rx} ${ry} 0 1 0 ${x + width} ${y + ry}A${rx} ${ry} 0 1 0 ${x} ${y + ry}Z`,
    };
  }
  if (shape === "diamond") {
    return {
      kind: "path",
      d: `M${x + width / 2} ${y}L${x + width} ${y + height / 2}L${x + width / 2} ${y + height}L${x} ${y + height / 2}Z`,
    };
  }
  return { kind: "box", x, y, width, height, radius: paint.radius };
}

/** What a hand-drawn item draws: lines to stroke, and the inside to fill, as SVG path data. */
export interface CanvasSketch {
  readonly line: string;
  readonly fill?: string;
}

const generator = rough.generator();

/** Rough's seed is a 31-bit number, and 0 is a random one: an id's hash, so it looks the same everywhere. */
function seedOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < id.length; at++) {
    hash ^= id.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 1 || 1;
}

/** Past this many, the earliest made is forgotten: enough for every item on a big board in view. */
const MOST_SKETCHES = 6_000;
const sketches = new Map<string, CanvasSketch>();

function remembered(key: string, make: () => CanvasSketch): CanvasSketch {
  const held = sketches.get(key);
  if (held !== undefined) return held;
  const made = make();
  if (sketches.size >= MOST_SKETCHES) sketches.delete(sketches.keys().next().value!);
  sketches.set(key, made);
  return made;
}

function roughOptions(id: string, paint: CanvasPaint, small: boolean) {
  return {
    seed: seedOf(id),
    // A small box at full roughness is a scribble: it takes half.
    roughness: small ? paint.sloppiness / 2 : paint.sloppiness,
    strokeWidth: paint.width,
    // A second pass would draw its dashes over each other.
    disableMultiStroke: paint.dash !== "solid",
    preserveVertices: paint.sloppiness < 2,
    fillStyle: "solid",
  };
}

const keyOf = (paint: CanvasPaint) =>
  `${paint.sloppiness}|${paint.dash}|${paint.width}|${paint.radius}|${paint.fill.kind}`;

function drawn(drawable: ReturnType<typeof generator.path>): CanvasSketch {
  let line = "";
  let fill: string | undefined;
  for (const set of drawable.sets) {
    const d = generator.opsToPath(set, 1);
    if (set.type === "path") line += d;
    else if (set.type === "fillPath") fill = (fill ?? "") + d;
  }
  return fill === undefined ? { line } : { line, fill };
}

function roundedBox(width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  return `M${r} 0L${width - r} 0Q${width} 0 ${width} ${r}L${width} ${height - r}Q${width} ${height} ${width - r} ${height}L${r} ${height}Q0 ${height} 0 ${height - r}L0 ${r}Q0 0 ${r} 0Z`;
}

/**
 * A card's or section's hand-drawn outline, from its top left: moving it draws nothing anew.
 * None for one drawn clean.
 */
export function canvasSketchBox(node: CanvasNode, paint: CanvasPaint): CanvasSketch | undefined {
  if (paint.sloppiness === 0) return undefined;
  const { width, height } = node;
  const shape = node.type === "text" ? node.astrolabe?.shape : undefined;
  const key = `box|${node.id}|${width}x${height}|${shape ?? ""}|${keyOf(paint)}`;
  return remembered(key, () => {
    const options = {
      ...roughOptions(node.id, paint, Math.min(width, height) < 20 || Math.max(width, height) < 50),
      ...(paint.fill.kind === "none" ? {} : { fill: "currentColor" }),
    };
    if (shape === "ellipse") {
      return drawn(
        generator.ellipse(width / 2, height / 2, width, height, { ...options, curveFitting: 1 }),
      );
    }
    if (shape === "diamond") {
      const corners: Array<[number, number]> = [
        [width / 2, 0],
        [width, height / 2],
        [width / 2, height],
        [0, height / 2],
      ];
      return drawn(generator.polygon(corners, options));
    }
    return drawn(
      paint.radius === 0
        ? generator.rectangle(0, 0, width, height, options)
        : generator.path(roundedBox(width, height, paint.radius), options),
    );
  });
}

/**
 * An arrow's or stroke's hand-drawn line, in board units, for `path`, the line it draws clean.
 * A stroke's goes through its points. None for one drawn clean.
 */
export function canvasSketchLine(item: CanvasEdge | CanvasInk, path: string): string | undefined {
  const paint = canvasPaint(item);
  if (paint.sloppiness === 0 || path === "") return undefined;
  const key = `line|${item.id}|${keyOf(paint)}|${path}`;
  return remembered(key, () => {
    const options = roughOptions(item.id, paint, false);
    if ("fromNode" in item || item.type !== "stroke" || item.points.length < 6) {
      return drawn(generator.path(path, options));
    }
    const points: Array<[number, number]> = [];
    for (let at = 0; at + 1 < item.points.length; at += 2) {
      points.push([item.x + item.points[at]!, item.y + item.points[at + 1]!]);
    }
    return drawn(generator.curve(points, options));
  }).line;
}
