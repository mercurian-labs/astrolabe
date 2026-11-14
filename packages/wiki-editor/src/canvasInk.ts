import {
  canvasInkBounds,
  canvasInkEnd,
  CANVAS_MAX_STROKE_POINTS,
  type CanvasBounds,
  type CanvasData,
  type CanvasInk,
  type CanvasInkArrow,
  type CanvasInkEnd,
  type CanvasInkStroke,
  type CanvasNode,
  type CanvasSide,
} from "@mercurian/wiki/canvas";
import { getStroke } from "perfect-freehand";

import { containsFully, type CanvasPoint } from "./canvasArrange";
import { canvasPaint } from "./canvasPaint";

/** What the board draws for a drawing, worked out once per change to it. */
export interface CanvasInkShape {
  readonly ink: CanvasInk;
  /** The line through its points, which takes a press. */
  readonly path: string;
  /** A stroke with pressure: its outline, filled in place of the line. */
  readonly fill?: string;
  /** An arrow's head, at its `to` end. */
  readonly head?: string;
  readonly labelAt: CanvasPoint;
  readonly bounds: CanvasBounds;
}

type Rects = Pick<ReadonlyMap<string, CanvasBounds>, "get">;

/** Board units: well under a pixel off at 100%, once points are rounded to whole ones. */
const SIMPLIFY_TOLERANCE = 1;
const HEAD_LENGTH = 12;
const HEAD_WIDTH = 5;
/** Room for a line's width and a head around what a drawing's points reach. */
const MARGIN = HEAD_LENGTH;

const NORMAL: Readonly<Record<CanvasSide, CanvasPoint>> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** A point a pen went through, with its pressure as a third axis so a change of it is kept. */
interface Inked extends CanvasPoint {
  readonly z: number;
}

/** Board units a change of pressure from none to full counts as, beside a point off the line. */
const PRESSURE_REACH = 10;

const distanceToSegment = (p: Inked, a: Inked, b: Inked) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const length = dx * dx + dy * dy + dz * dz;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy), p.z - (a.z + t * dz));
};

const pointsOf = (flat: ReadonlyArray<number>) => {
  const points: CanvasPoint[] = [];
  for (let at = 0; at + 1 < flat.length; at += 2) points.push({ x: flat[at]!, y: flat[at + 1]! });
  return points;
};

/** Ramer–Douglas–Peucker, without recursion: a long scribble shouldn't reach the stack's end. */
function simplified(points: ReadonlyArray<Inked>, tolerance: number): ReadonlyArray<Inked> {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const spans: Array<readonly [number, number]> = [[0, points.length - 1]];
  while (spans.length > 0) {
    const [first, last] = spans.pop()!;
    let farthest = -1;
    let distance = tolerance;
    for (let at = first + 1; at < last; at++) {
      const off = distanceToSegment(points[at]!, points[first]!, points[last]!);
      if (off > distance) {
        distance = off;
        farthest = at;
      }
    }
    if (farthest === -1) continue;
    keep[farthest] = 1;
    spans.push([first, farthest], [farthest, last]);
  }
  return points.filter((_, at) => keep[at] === 1);
}

/** Every so many points, ends kept, when there are more than `most`: simplifying can't be quick. */
function thinned<Point>(points: ReadonlyArray<Point>, most: number): ReadonlyArray<Point> {
  if (points.length <= most) return points;
  const every = Math.ceil(points.length / (most - 1));
  const kept = points.filter((_, at) => at % every === 0);
  return (points.length - 1) % every === 0 ? kept : [...kept, points.at(-1)!];
}

/**
 * A stroke's file entry from the board points a pen went through, and its pressure at each:
 * simplified, in whole board units, from its first point, and never more points than a stroke
 * may have. Pressure is kept to hundredths.
 */
export function canvasStroke(
  id: string,
  drawn: ReadonlyArray<number>,
  pressure?: ReadonlyArray<number>,
): Readonly<Record<string, unknown>> {
  const points = pointsOf(drawn).map((point, at) => ({
    ...point,
    z: (pressure?.[at] ?? 0) * PRESSURE_REACH,
  }));
  const kept = thinned(
    simplified(thinned(points, CANVAS_MAX_STROKE_POINTS * 8), SIMPLIFY_TOLERANCE),
    CANVAS_MAX_STROKE_POINTS,
  );
  const origin = kept[0] ?? { x: 0, y: 0 };
  const x = Math.round(origin.x);
  const y = Math.round(origin.y);
  const flat = kept.flatMap((point) => [Math.round(point.x) - x, Math.round(point.y) - y]);
  const pressed =
    pressure === undefined
      ? undefined
      : kept.map((point) => Math.round((point.z / PRESSURE_REACH) * 100) / 100);
  // A click is a dot: a line to where it starts, which a round cap draws.
  if (flat.length === 2) {
    flat.push(0, 0);
    pressed?.push(pressed[0] ?? 0.5);
  }
  return { id, type: "stroke", x, y, points: flat, ...(pressed ? { pressure: pressed } : {}) };
}

/** A pressure stroke's diameter at middling pressure, over its width. */
const INK_SIZE = 1.75;
const INK_OPTIONS = { thinning: 0.6, smoothing: 0.5, streamline: 0.2, last: true } as const;

/**
 * The pressure a mouse or a finger without force presses with, from how far it moved since the
 * last point: slower is heavier. perfect-freehand's own simulation (MIT), run as the points come.
 */
export function canvasSimulatedPressure(previous: number, distance: number, width: number) {
  const speed = Math.min(1, distance / (width * INK_SIZE * 2));
  const rest = Math.min(1, 1 - speed);
  return Math.min(1, previous + (rest - previous) * (speed * 0.275));
}

/** A closed outline as a path, its corners smoothed by curves through their middles. */
function outlinePath(outline: ReadonlyArray<ReadonlyArray<number>>): string {
  const first = outline[0];
  if (first === undefined) return "";
  let path = `M${round(first[0]!)} ${round(first[1]!)}`;
  for (let at = 0; at < outline.length; at++) {
    const [x0, y0] = outline[at]!;
    const [x1, y1] = outline[(at + 1) % outline.length]!;
    path += `Q${round(x0!)} ${round(y0!)} ${round((x0! + x1!) / 2)} ${round((y0! + y1!) / 2)}`;
  }
  return `${path}Z`;
}

/** The outline of ink through board points, each with its pressure, `width` its base size. */
export function canvasInkPath(
  x: number,
  y: number,
  flat: ReadonlyArray<number>,
  pressure: ReadonlyArray<number>,
  width: number,
): string {
  const points: number[][] = [];
  for (let at = 0; at + 1 < flat.length; at += 2) {
    points.push([flat[at]! + x, flat[at + 1]! + y, pressure[at / 2] ?? 0.5]);
  }
  return outlinePath(
    getStroke(points, { ...INK_OPTIONS, size: width * INK_SIZE, simulatePressure: false }),
  );
}

/** By its pressure, which a stroke keeps the same object for until it's drawn again. */
const inkPaths = new WeakMap<
  ReadonlyArray<number>,
  { readonly key: string; readonly path: string }
>();

function inkPathOf(ink: CanvasInkStroke & { readonly pressure: ReadonlyArray<number> }) {
  const { width } = canvasPaint(ink);
  const key = `${ink.x} ${ink.y} ${width} ${ink.points.length}`;
  const held = inkPaths.get(ink.pressure);
  if (held?.key === key) return held.path;
  const path = canvasInkPath(ink.x, ink.y, ink.points, ink.pressure, width);
  inkPaths.set(ink.pressure, { key, path });
  return path;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** A smooth line through a stroke's points: each bend is a curve through the middles around it. */
export function canvasStrokePath(x: number, y: number, flat: ReadonlyArray<number>): string {
  const points = pointsOf(flat).map((point) => ({ x: point.x + x, y: point.y + y }));
  const [first, ...rest] = points;
  if (first === undefined) return "";
  let path = `M${round(first.x)} ${round(first.y)}`;
  if (rest.length <= 1) {
    const end = rest[0] ?? first;
    return `${path}L${round(end.x)} ${round(end.y)}`;
  }
  for (let at = 0; at < rest.length - 1; at++) {
    const point = rest[at]!;
    const next = rest[at + 1]!;
    path += `Q${round(point.x)} ${round(point.y)} ${round((point.x + next.x) / 2)} ${round((point.y + next.y) / 2)}`;
  }
  const last = rest.at(-1)!;
  return `${path}L${round(last.x)} ${round(last.y)}`;
}

function arrowHead(tip: CanvasPoint, back: CanvasPoint) {
  const length = Math.hypot(back.x - tip.x, back.y - tip.y);
  if (length === 0) return undefined;
  const normal = { x: (back.x - tip.x) / length, y: (back.y - tip.y) / length };
  const baseX = tip.x + normal.x * HEAD_LENGTH;
  const baseY = tip.y + normal.y * HEAD_LENGTH;
  const across = { x: -normal.y * HEAD_WIDTH, y: normal.x * HEAD_WIDTH };
  return `M${tip.x} ${tip.y}L${baseX + across.x} ${baseY + across.y}L${baseX - across.x} ${baseY - across.y}Z`;
}

const cubicAt = (a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint, t: number) => {
  const u = 1 - t;
  const at = (axis: "x" | "y") =>
    u * u * u * a[axis] + 3 * u * u * t * b[axis] + 3 * u * t * t * c[axis] + t * t * t * d[axis];
  return { x: at("x"), y: at("y") };
};

/** Where an arrow's end leaves from: a node's side bends the line square to it, a point doesn't. */
const controlOf = (end: CanvasInkEnd, at: CanvasPoint, reach: number) =>
  "node" in end
    ? { x: at.x + NORMAL[end.side].x * reach, y: at.y + NORMAL[end.side].y * reach }
    : at;

/** An arrow between two points, either of which may leave a node's side. */
export function canvasInkArrowPath(
  from: CanvasPoint,
  to: CanvasPoint,
  ends: { readonly from: CanvasInkEnd; readonly to: CanvasInkEnd },
) {
  const reach = Math.min(160, Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) / 2));
  const control1 = controlOf(ends.from, from, reach);
  const control2 = controlOf(ends.to, to, reach);
  const back = control2 !== to ? control2 : control1 !== from ? control1 : from;
  return {
    path: `M${from.x} ${from.y}C${control1.x} ${control1.y} ${control2.x} ${control2.y} ${to.x} ${to.y}`,
    head: arrowHead(to, back),
    controls: [control1, control2] as const,
    labelAt: cubicAt(from, control1, control2, to, 0.5),
  };
}

const boundsOf = (points: ReadonlyArray<CanvasPoint>): CanvasBounds => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return {
    x: left - MARGIN,
    y: top - MARGIN,
    width: right - left + MARGIN * 2,
    height: bottom - top + MARGIN * 2,
  };
};

/** What a drawing draws as; none for an arrow whose node is gone. */
export function canvasInkShape(ink: CanvasInk, rects: Rects): CanvasInkShape | undefined {
  if (ink.type === "stroke") {
    const points = pointsOf(ink.points).map((point) => ({
      x: point.x + ink.x,
      y: point.y + ink.y,
    }));
    const { pressure } = ink;
    return {
      ink,
      path: canvasStrokePath(ink.x, ink.y, ink.points),
      ...(pressure === undefined ? {} : { fill: inkPathOf({ ...ink, pressure }) }),
      labelAt: points[0] ?? { x: ink.x, y: ink.y },
      bounds: boundsOf(points),
    };
  }
  const from = canvasInkEnd(ink.from, rects);
  const to = canvasInkEnd(ink.to, rects);
  if (from === undefined || to === undefined) return undefined;
  const arrow = canvasInkArrowPath(from, to, ink);
  return {
    ink,
    path: arrow.path,
    ...(arrow.head === undefined ? {} : { head: arrow.head }),
    labelAt: arrow.labelAt,
    bounds: boundsOf([from, to, ...arrow.controls]),
  };
}

export function canvasInkShapes(data: CanvasData): CanvasInkShape[] {
  if (data.drawings === undefined) return [];
  const rects = new Map(data.nodes.map((node) => [node.id, node]));
  return data.drawings.flatMap((ink) => canvasInkShape(ink, rects) ?? []);
}

/** Whether a marquee takes a drawing: a stroke's point, or a point along an arrow, inside it. */
export function canvasInkTouches(shape: CanvasInkShape, area: CanvasBounds, rects: Rects) {
  const inside = ({ x, y }: CanvasPoint) =>
    x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
  const { ink } = shape;
  if (ink.type === "stroke") {
    return pointsOf(ink.points).some((point) => inside({ x: point.x + ink.x, y: point.y + ink.y }));
  }
  const from = canvasInkEnd(ink.from, rects);
  const to = canvasInkEnd(ink.to, rects);
  if (from === undefined || to === undefined) return false;
  const [control1, control2] = canvasInkArrowPath(from, to, ink).controls;
  for (let step = 0; step <= 16; step++) {
    if (inside(cubicAt(from, control1, control2, to, step / 16))) return true;
  }
  return false;
}

/** A drawing moved by a drag: a stroke's origin, an arrow's free ends. Ends on nodes stay. */
export function movedInk(
  ink: CanvasInk,
  dx: number,
  dy: number,
): Readonly<Record<string, unknown>> {
  if (ink.type === "stroke") return { x: ink.x + dx, y: ink.y + dy };
  const shifted = (end: CanvasInkEnd) => ("node" in end ? end : { x: end.x + dx, y: end.y + dy });
  return {
    ...("node" in ink.from ? {} : { from: shifted(ink.from) }),
    ...("node" in ink.to ? {} : { to: shifted(ink.to) }),
  };
}

const NO_RECTS: Rects = new Map();

/**
 * The drawings the moved groups carry, by the rule their cards follow: wholly inside. A drawn
 * arrow counts by its free ends alone, since an end on a card goes where the card goes.
 */
export function inkMovedWith(
  nodes: ReadonlyArray<CanvasNode>,
  drawings: ReadonlyArray<CanvasInk>,
  moved: ReadonlySet<string>,
): ReadonlySet<string> {
  const groups = nodes.filter((node) => node.type === "group" && moved.has(node.id));
  if (groups.length === 0) return new Set();
  const carried = new Set<string>();
  for (const ink of drawings) {
    const parts =
      ink.type === "stroke"
        ? [canvasInkBounds(ink, NO_RECTS)]
        : [ink.from, ink.to].flatMap((end) =>
            "node" in end ? [] : [{ x: end.x, y: end.y, width: 0, height: 0 }],
          );
    const inside = (part: CanvasBounds | undefined) =>
      part !== undefined && groups.some((group) => containsFully(group, part));
    if (parts.length > 0 && parts.every(inside)) carried.add(ink.id);
  }
  return carried;
}

/** The end of an arrow a press is on, if it's near one. */
export function inkArrowEndAt(
  ink: CanvasInkArrow,
  point: CanvasPoint,
  rects: Rects,
  reach: number,
): "from" | "to" | null {
  const from = canvasInkEnd(ink.from, rects);
  const to = canvasInkEnd(ink.to, rects);
  if (from === undefined || to === undefined) return null;
  const toFrom = Math.hypot(point.x - from.x, point.y - from.y);
  const toTo = Math.hypot(point.x - to.x, point.y - to.y);
  if (Math.min(toFrom, toTo) > reach) return null;
  return toFrom < toTo ? "from" : "to";
}
