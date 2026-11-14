import type { CanvasHandEdit } from "@mercurian/wiki/canvas-edits";
import {
  canvasInkBounds,
  type CanvasBounds,
  type CanvasInk,
  type CanvasInkEnd,
  type CanvasNode,
} from "@mercurian/wiki/canvas";

import {
  boundsOfRects,
  CANVAS_MIN_SIZE,
  type CanvasHandle,
  type CanvasPoint,
} from "./canvasArrange";
import type { CanvasInkShape } from "./canvasInk";
import { canvasPaint } from "./canvasPaint";

type Rects = Pick<ReadonlyMap<string, CanvasBounds>, "get">;

/** A scale about `anchor`: a point `p` goes to `anchor + (p - anchor) * s`. */
export interface CanvasScale {
  readonly anchor: CanvasPoint;
  readonly sx: number;
  readonly sy: number;
}

/** A selection of only drawings shrinks no smaller than this on a side that has any length. */
const LEAST_BOX = 8;

/** What the box round a selection holds: its cards' boxes and its drawings' points. */
export function canvasSelectionBounds(
  nodes: ReadonlyArray<CanvasBounds>,
  drawings: ReadonlyArray<CanvasInk>,
  rects: Rects,
): CanvasBounds | undefined {
  const parts = [...nodes, ...drawings.flatMap((ink) => canvasInkBounds(ink, rects) ?? [])];
  return parts.length === 0 ? undefined : boundsOfRects(parts);
}

/** The least each axis may scale by, so no card goes under its least size, nor the box under its. */
export function canvasScaleLeast(
  box: CanvasBounds,
  nodes: ReadonlyArray<CanvasBounds>,
): CanvasPoint {
  // Already under it, a side can't shrink further, and it isn't made to grow.
  const least = (size: number, floor: number) => (size > 0 ? Math.min(1, floor / size) : 0);
  let x = least(box.width, LEAST_BOX);
  let y = least(box.height, LEAST_BOX);
  for (const node of nodes) {
    x = Math.max(x, least(node.width, CANVAS_MIN_SIZE));
    y = Math.max(y, least(node.height, CANVAS_MIN_SIZE));
  }
  return { x, y };
}

export interface CanvasScaleOptions {
  /** Shift: both axes by one factor. */
  readonly keepAspect: boolean;
  /** Alt: about the box's middle, both sides moving. */
  readonly fromCentre: boolean;
  readonly least: CanvasPoint;
}

/**
 * The scale dragging `handle` of `box` by (dx, dy) makes, as Excalidraw's multiple-element resize
 * works it: about the opposite corner or edge, or the middle. The handle never crosses its anchor:
 * past the least size it stops, rather than flipping what it holds.
 */
export function canvasScaleFor(
  box: CanvasBounds,
  handle: CanvasHandle,
  dx: number,
  dy: number,
  { keepAspect, fromCentre, least }: CanvasScaleOptions,
): CanvasScale {
  const east = handle.includes("e");
  const west = handle.includes("w");
  const south = handle.includes("s");
  const north = handle.includes("n");
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const anchor = {
    x: fromCentre || !(east || west) ? middle.x : east ? box.x : box.x + box.width,
    y: fromCentre || !(north || south) ? middle.y : south ? box.y : box.y + box.height,
  };
  const both = fromCentre ? 2 : 1;
  let sx = (east || west) && box.width > 0 ? 1 + ((east ? dx : -dx) * both) / box.width : 1;
  let sy = (north || south) && box.height > 0 ? 1 + ((south ? dy : -dy) * both) / box.height : 1;
  if (keepAspect) {
    const corner = (east || west) && (north || south);
    const s = Math.max(
      corner ? Math.max(sx, sy) : east || west ? sx : sy,
      box.width > 0 ? least.x : 0,
      box.height > 0 ? least.y : 0,
    );
    return { anchor, sx: s, sy: s };
  }
  sx = Math.max(sx, least.x);
  sy = Math.max(sy, least.y);
  return { anchor, sx, sy };
}

const scaled = ({ x, y }: CanvasPoint, { anchor, sx, sy }: CanvasScale): CanvasPoint => ({
  x: anchor.x + (x - anchor.x) * sx,
  y: anchor.y + (y - anchor.y) * sy,
});

/** A box scaled, in whole board units and never under a card's least size. */
export function canvasScaledBox(box: CanvasBounds, scale: CanvasScale): CanvasBounds {
  const { x, y } = scaled(box, scale);
  const at = { x: Math.round(x), y: Math.round(y) };
  const size = (value: number) =>
    value < CANVAS_MIN_SIZE ? Math.round(value) : Math.max(CANVAS_MIN_SIZE, Math.round(value));
  return { ...at, width: size(box.width * scale.sx), height: size(box.height * scale.sy) };
}

const tenth = (value: number) => Math.round(value * 10) / 10;

/**
 * A drawing's changed keys once scaled: a stroke's origin and points, its pressure as it was; an
 * arrow's free ends and bends. An end on a card stays there and goes where the card goes.
 */
export function canvasScaledInk(
  ink: CanvasInk,
  scale: CanvasScale,
): Readonly<Record<string, unknown>> {
  if (ink.type === "stroke") {
    const origin = scaled(ink, scale);
    const x = Math.round(origin.x);
    const y = Math.round(origin.y);
    const points = ink.points.map((value, at) =>
      at % 2 === 0
        ? tenth(origin.x - x + value * scale.sx)
        : tenth(origin.y - y + value * scale.sy),
    );
    return { x, y, points };
  }
  const end = (each: CanvasInkEnd): CanvasInkEnd => {
    if ("node" in each) return each;
    const { x, y } = scaled(each, scale);
    return { x: Math.round(x), y: Math.round(y) };
  };
  const bends = ink.bends?.flatMap((x, at, all) => {
    if (at % 2 === 1) return [];
    const point = scaled({ x, y: all[at + 1]! }, scale);
    return [Math.round(point.x), Math.round(point.y)];
  });
  return {
    ...("node" in ink.from ? {} : { from: end(ink.from) }),
    ...("node" in ink.to ? {} : { to: end(ink.to) }),
    ...(bends === undefined ? {} : { bends }),
  };
}

const sameKeys = (ink: CanvasInk, keys: Readonly<Record<string, unknown>>) =>
  Object.entries(keys).every(
    ([key, value]) => JSON.stringify(ink[key as keyof CanvasInk]) === JSON.stringify(value),
  );

/** One scale's edits: each card's new box and each drawing's new keys, unchanged ones left out. */
export function canvasScaleEdits(
  nodes: ReadonlyArray<CanvasNode>,
  drawings: ReadonlyArray<CanvasInk>,
  scale: CanvasScale,
): CanvasHandEdit[] {
  const edits: CanvasHandEdit[] = [];
  for (const node of nodes) {
    const box = canvasScaledBox(node, scale);
    if (
      box.x === node.x &&
      box.y === node.y &&
      box.width === node.width &&
      box.height === node.height
    ) {
      continue;
    }
    edits.push({ op: "resize", card: node.id, ...box });
  }
  for (const ink of drawings) {
    const keys = canvasScaledInk(ink, scale);
    if (Object.keys(keys).length === 0 || sameKeys(ink, keys)) continue;
    edits.push({ op: "set-drawing", drawing: ink.id, keys });
  }
  return edits;
}

/** Whether `point` is inside `loop`, a closed polygon, by the non-zero winding rule. */
export function insideLoop(point: CanvasPoint, loop: ReadonlyArray<CanvasPoint>): boolean {
  let winding = 0;
  for (let at = 0; at < loop.length; at++) {
    const a = loop[at]!;
    const b = loop[(at + 1) % loop.length]!;
    const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y) {
      if (b.y > point.y && side > 0) winding += 1;
    } else if (b.y <= point.y && side < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}

const crosses = (a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint) => {
  const turn = (p: CanvasPoint, q: CanvasPoint, r: CanvasPoint) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
};

const cornersOf = ({ x, y, width, height }: CanvasBounds): CanvasPoint[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

const within = (outer: CanvasBounds, inner: CanvasBounds) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/** Whether a box is wholly inside the loop: its corners are, and no side of the loop crosses it. */
function boxInside(box: CanvasBounds, loop: ReadonlyArray<CanvasPoint>) {
  const corners = cornersOf(box);
  if (!corners.every((corner) => insideLoop(corner, loop))) return false;
  for (let at = 0; at < loop.length; at++) {
    const a = loop[at]!;
    const b = loop[(at + 1) % loop.length]!;
    for (let side = 0; side < 4; side++) {
      if (crosses(a, b, corners[side]!, corners[(side + 1) % 4]!)) return false;
    }
  }
  return true;
}

export interface CanvasLassoPick {
  readonly cards: ReadonlyArray<string>;
  readonly drawings: ReadonlyArray<string>;
}

/**
 * What a lasso's loop takes, by Excalidraw's "contain" rule: what lies wholly inside it. A card,
 * section or shape by its box; a drawing by every point of its line. A card's arrow isn't taken:
 * it goes with its cards.
 */
export function canvasLassoPick(
  loop: ReadonlyArray<CanvasPoint>,
  nodes: ReadonlyArray<CanvasNode>,
  inks: ReadonlyArray<CanvasInkShape>,
  rects: Rects,
): CanvasLassoPick {
  if (loop.length < 3) return { cards: [], drawings: [] };
  const area = boundsOfRects(loop.map(({ x, y }) => ({ x, y, width: 0, height: 0 })));
  const cards = nodes.filter((node) => within(area, node) && boxInside(node, loop));
  const drawings = inks.filter(({ ink, along }) => {
    const box = canvasInkBounds(ink, rects);
    if (box === undefined || !within(area, box)) return false;
    // A box wholly inside holds every point in it; only a box the loop cuts needs each point.
    if (boxInside(box, loop)) return true;
    return along.length > 0 && along.every((point) => insideLoop(point, loop));
  });
  return {
    cards: cards.map((node) => node.id),
    drawings: drawings.map((shape) => shape.ink.id),
  };
}

const toSegment = (p: CanvasPoint, a: CanvasPoint, b: CanvasPoint) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const segmentsApart = (a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint) =>
  crosses(a, b, c, d)
    ? 0
    : Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));

/** perfect-freehand's radius at a pressure, for the board's ink: see `canvasInkPath`. */
const inkRadius = (width: number, pressure: number) => width * 1.75 * (0.2 + 0.6 * pressure);

/**
 * Whether the eraser, moving from `a` to `b`, touches a drawing: within `reach` of its line's
 * edge. A pressure stroke's edge is its outline at each point's pressure; a hand-drawn one's
 * wanders, so it reaches further by its sloppiness.
 */
export function canvasEraserTouches(
  shape: CanvasInkShape,
  a: CanvasPoint,
  b: CanvasPoint,
  reach: number,
): boolean {
  const { bounds, ink, along: line } = shape;
  const paint = canvasPaint(ink);
  const pressure = ink.type === "stroke" ? ink.pressure : undefined;
  const widest =
    (pressure === undefined ? paint.width / 2 : inkRadius(paint.width, 1)) +
    paint.sloppiness * 2 +
    reach;
  if (
    Math.max(a.x, b.x) < bounds.x - widest ||
    Math.min(a.x, b.x) > bounds.x + bounds.width + widest ||
    Math.max(a.y, b.y) < bounds.y - widest ||
    Math.min(a.y, b.y) > bounds.y + bounds.height + widest
  ) {
    return false;
  }
  const edge = (at: number) =>
    (pressure === undefined
      ? paint.width / 2
      : inkRadius(paint.width, Math.max(pressure[at] ?? 0.5, pressure[at + 1] ?? 0.5))) +
    paint.sloppiness * 2 +
    reach;
  if (line.length === 1) return toSegment(line[0]!, a, b) <= edge(0);
  for (let at = 0; at + 1 < line.length; at++) {
    if (segmentsApart(a, b, line[at]!, line[at + 1]!) <= edge(at)) return true;
  }
  return false;
}
