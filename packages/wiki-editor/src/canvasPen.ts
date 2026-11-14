/**
 * What the style panel reads and sets: a selection's style part by part, and the style the next
 * thing drawn takes. Widths go by step, so "bold" is each kind's own bold.
 */
import { canvasStyleKeys, type CanvasStylePatch } from "@mercurian/wiki/canvas-edits";
import type {
  CanvasCorners,
  CanvasDash,
  CanvasEdge,
  CanvasInk,
  CanvasNode,
  CanvasRoute,
  CanvasSloppiness,
} from "@mercurian/wiki/canvas";

import {
  CANVAS_DEFAULT_WIDTH,
  CANVAS_WIDTH_STEPS,
  canvasIsPressed,
  canvasPaint,
  canvasPaintKind,
  canvasWidthStep,
  type CanvasPaintKind,
  type CanvasWidthStep,
} from "./canvasPaint";

/** Each part's choice; null is the kind's default. */
export interface CanvasPen {
  readonly color: string | null;
  /** A colour, or "none". Null tints a card from its colour, as it always has. */
  readonly fill: string | null;
  readonly width: CanvasWidthStep | null;
  readonly dash: CanvasDash | null;
  readonly corners: CanvasCorners | null;
  readonly opacity: number | null;
  readonly sloppiness: CanvasSloppiness | null;
  /** Arrows only, as the next three. */
  readonly route: CanvasRoute | null;
  readonly startHead: CanvasHead | null;
  readonly endHead: CanvasHead | null;
}

export type CanvasHead = "none" | "arrow";

export type CanvasPenPart = keyof CanvasPen;

export const CANVAS_DEFAULT_PEN: CanvasPen = {
  color: null,
  fill: null,
  width: null,
  dash: null,
  corners: null,
  opacity: null,
  sloppiness: null,
  route: null,
  startHead: null,
  endHead: null,
};

/** A part the selection doesn't agree on. */
export const MIXED = Symbol("mixed");

/** What the panel shows: each part's value, a mix, or none for a part nothing shown has. */
export type CanvasPenShown = {
  readonly [Part in CanvasPenPart]?: NonNullable<CanvasPen[Part]> | null | typeof MIXED;
};

type Item = CanvasNode | CanvasEdge | CanvasInk;

const ARROW_PARTS: ReadonlySet<CanvasPenPart> = new Set(["route", "startHead", "endHead"]);

/**
 * Whether a part means anything for a kind: lines have no fill, only boxes have corners, and only
 * arrows have a route and heads.
 */
export const canvasPenApplies = (kind: CanvasPaintKind, part: CanvasPenPart): boolean =>
  part === "fill"
    ? kind !== "arrow" && kind !== "stroke"
    : part === "corners"
      ? kind === "card" || kind === "section"
      : ARROW_PARTS.has(part)
        ? kind === "arrow"
        : true;

/** A stroke drawn with pressure is hand-drawn already, so sloppiness isn't one of its parts. */
const penAppliesTo = (item: Item, part: CanvasPenPart) =>
  canvasPenApplies(canvasPaintKind(item), part) &&
  !(part === "sloppiness" && canvasIsPressed(item));

/** How `item` stands, part by part, with its defaults read as the values they draw as. */
function penOf(item: Item): Required<{ readonly [Part in CanvasPenPart]: unknown }> {
  const paint = canvasPaint(item);
  const style = item.astrolabe?.style;
  return {
    color: item.color ?? null,
    fill: style?.fill ?? null,
    // A width no step names is pressed by none of them.
    width: canvasWidthStep(paint.kind, paint.width) ?? MIXED,
    dash: paint.dash,
    corners: style?.corners ?? "round",
    opacity: paint.opacity,
    sloppiness: paint.sloppiness,
    route: style?.route ?? "curved",
    startHead: ("fromEnd" in item ? item.fromEnd : undefined) ?? "none",
    endHead: ("toEnd" in item ? item.toEnd : undefined) ?? "arrow",
  };
}

const PARTS: ReadonlyArray<CanvasPenPart> = [
  "color",
  "fill",
  "width",
  "dash",
  "corners",
  "opacity",
  "sloppiness",
  "route",
  "startHead",
  "endHead",
];

/** A selection as the panel shows it: only the parts something in it has. */
export function canvasPenOfItems(items: ReadonlyArray<Item>): CanvasPenShown {
  const shown: Record<string, unknown> = {};
  for (const part of PARTS) {
    const values = items
      .filter((item) => penAppliesTo(item, part))
      .map((item) => penOf(item)[part]);
    if (values.length === 0) continue;
    const [first] = values;
    shown[part] = values.every((value) => value === first) ? first : MIXED;
  }
  return shown as CanvasPenShown;
}

/** The next thing a tool draws, as the panel shows it. */
export function canvasPenOfTool(kind: CanvasPaintKind, pen: CanvasPen): CanvasPenShown {
  const shown: Record<string, unknown> = {
    color: pen.color,
    width: pen.width ?? canvasWidthStep(kind, CANVAS_DEFAULT_WIDTH[kind]) ?? null,
    dash: pen.dash ?? "solid",
    opacity: pen.opacity ?? 1,
  };
  if (canvasPenApplies(kind, "fill")) shown.fill = pen.fill;
  if (canvasPenApplies(kind, "corners")) shown.corners = pen.corners ?? "round";
  // The Pen draws with pressure.
  if (kind !== "stroke") shown.sloppiness = pen.sloppiness ?? 0;
  if (kind === "arrow") {
    shown.route = pen.route ?? "curved";
    shown.startHead = pen.startHead ?? "none";
    shown.endHead = pen.endHead ?? "arrow";
  }
  return shown as CanvasPenShown;
}

/**
 * The keys that set `patch` on an item of `kind` the file holds as `raw`: its colour and an
 * arrow's heads at the top, as JSON Canvas has them, the rest in its style, and a part at its
 * default cleared rather than written.
 */
export function canvasPenKeys(
  kind: CanvasPaintKind,
  raw: Readonly<Record<string, unknown>>,
  patch: Partial<CanvasPen>,
): Record<string, unknown> {
  const style: { -readonly [Key in keyof CanvasStylePatch]: CanvasStylePatch[Key] } = {};
  if (patch.fill !== undefined && canvasPenApplies(kind, "fill")) style.fill = patch.fill;
  if (patch.width !== undefined) {
    const width = patch.width === null ? null : CANVAS_WIDTH_STEPS[kind][patch.width];
    style.width = width === CANVAS_DEFAULT_WIDTH[kind] ? null : width;
  }
  if (patch.dash !== undefined) style.dash = patch.dash === "solid" ? null : patch.dash;
  if (patch.corners !== undefined && canvasPenApplies(kind, "corners")) {
    style.corners = patch.corners === "round" ? null : patch.corners;
  }
  if (patch.opacity !== undefined) style.opacity = patch.opacity === 1 ? null : patch.opacity;
  if (patch.sloppiness !== undefined && !(kind === "stroke" && Array.isArray(raw.pressure))) {
    style.sloppiness = patch.sloppiness === 0 ? null : patch.sloppiness;
  }
  const arrow = kind === "arrow";
  if (patch.route !== undefined && arrow) {
    style.route = patch.route === "curved" ? null : patch.route;
  }
  return {
    ...(patch.color === undefined ? {} : { color: patch.color }),
    ...(patch.startHead === undefined || !arrow
      ? {}
      : { fromEnd: patch.startHead === "none" ? null : patch.startHead }),
    ...(patch.endHead === undefined || !arrow
      ? {}
      : { toEnd: patch.endHead === "arrow" ? null : patch.endHead }),
    ...(Object.keys(style).length === 0 ? {} : canvasStyleKeys(raw, style)),
  };
}

/** A new item's JSON with the pen's style on it. */
export function canvasWithPen<Raw extends Readonly<Record<string, unknown>>>(
  kind: CanvasPaintKind,
  raw: Raw,
  pen: CanvasPen,
): Raw {
  const keys = canvasPenKeys(kind, raw, pen);
  const next: Record<string, unknown> = { ...raw };
  for (const [key, value] of Object.entries(keys)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as Raw;
}
