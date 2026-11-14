/**
 * The line an arrow draws between its ends: curved, straight, or an elbow round the cards in its
 * way. Card arrows and drawn arrows both take it, on the board, in its image and on the phone.
 * Pure, with no DOM.
 */
import type { CanvasBounds, CanvasRoute, CanvasSide } from "@mercurian/wiki/canvas";

import { CANVAS_ELBOW_CORNER_RADIUS, canvasElbowPath, canvasElbowRoute } from "./canvasElbow";

interface Point {
  readonly x: number;
  readonly y: number;
}

/** One end of a line: where it is, and the card and side it leaves from, if it's on one. */
export interface CanvasLineEnd extends Point {
  readonly box?: CanvasBounds;
  readonly side?: CanvasSide;
  /** Whether an arrowhead is drawn here. */
  readonly head: boolean;
}

/** A card the route may step round. */
export interface CanvasRouteBox extends CanvasBounds {
  readonly id: string;
  readonly type?: string;
}

export interface CanvasLine {
  /** SVG path data, in board units. */
  readonly path: string;
  /** Each arrowhead's tip and a point behind it on the line, the way it points. */
  readonly tips: ReadonlyArray<{ readonly tip: Point; readonly back: Point }>;
  readonly labelAt: Point;
  /** Points along it, close enough to hit, select and bound it by. */
  readonly along: ReadonlyArray<Point>;
  /** What else it can reach: a curve's control points. */
  readonly reach: ReadonlyArray<Point>;
  /** Halfway along each stretch between its points, where a new bend can be pulled out. */
  readonly mids: ReadonlyArray<Point>;
}

export const CANVAS_SIDE_NORMAL: Readonly<Record<CanvasSide, Point>> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** How far a curve leaves square to its side, as the board has always drawn it. */
export const canvasCurveReach = (from: Point, to: Point) =>
  Math.min(160, Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) / 2));

const cubicAt = (a: Point, b: Point, c: Point, d: Point, t: number): Point => {
  const u = 1 - t;
  const at = (axis: "x" | "y") =>
    u * u * u * a[axis] + 3 * u * u * t * b[axis] + 3 * u * t * t * c[axis] + t * t * t * d[axis];
  return { x: at("x"), y: at("y") };
};

const CURVE_STEPS = 24;

/** Halfway along a line through `points`. */
function middleOf(points: ReadonlyArray<Point>): Point {
  let total = 0;
  for (let at = 1; at < points.length; at++) {
    total += Math.hypot(points[at]!.x - points[at - 1]!.x, points[at]!.y - points[at - 1]!.y);
  }
  let left = total / 2;
  for (let at = 1; at < points.length; at++) {
    const a = points[at - 1]!;
    const b = points[at]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length >= left && length > 0) {
      const t = left / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}

const control = (end: CanvasLineEnd, reach: number): Point | null =>
  end.side === undefined
    ? null
    : {
        x: end.x + CANVAS_SIDE_NORMAL[end.side].x * reach,
        y: end.y + CANVAS_SIDE_NORMAL[end.side].y * reach,
      };

/** Without bends: a curve leaving each side square to it, and straight from a free point. */
function curve(from: CanvasLineEnd, to: CanvasLineEnd): CanvasLine {
  const reach = canvasCurveReach(from, to);
  const control1 = control(from, reach) ?? from;
  const control2 = control(to, reach) ?? to;
  const along: Point[] = [];
  for (let step = 0; step <= CURVE_STEPS; step++) {
    along.push(cubicAt(from, control1, control2, to, step / CURVE_STEPS));
  }
  const backOf = (tip: Point, near: Point, far: Point) =>
    near.x !== tip.x || near.y !== tip.y ? near : far;
  return {
    path: `M${from.x} ${from.y}C${control1.x} ${control1.y} ${control2.x} ${control2.y} ${to.x} ${to.y}`,
    tips: [
      ...(to.head ? [{ tip: to, back: backOf(to, control2, backOf(to, control1, from)) }] : []),
      ...(from.head
        ? [{ tip: from, back: backOf(from, control1, backOf(from, control2, to)) }]
        : []),
    ],
    labelAt: cubicAt(from, control1, control2, to, 0.5),
    along,
    reach: [control1, control2],
    mids: [cubicAt(from, control1, control2, to, 0.5)],
  };
}

/** Through its bends, smoothly: each one's tangent runs from the point before it to the next. */
function bentCurve(from: CanvasLineEnd, bends: ReadonlyArray<Point>, to: CanvasLineEnd) {
  const points: Point[] = [from, ...bends, to];
  const last = points.length - 1;
  const tangent = (at: number): Point => {
    const point = points[at]!;
    if (at === 0) {
      const next = points[1]!;
      const leave = control(from, canvasCurveReach(from, next));
      return leave === null
        ? { x: next.x - point.x, y: next.y - point.y }
        : { x: (leave.x - point.x) * 3, y: (leave.y - point.y) * 3 };
    }
    if (at === last) {
      const before = points[last - 1]!;
      const enter = control(to, canvasCurveReach(before, to));
      return enter === null
        ? { x: point.x - before.x, y: point.y - before.y }
        : { x: (point.x - enter.x) * 3, y: (point.y - enter.y) * 3 };
    }
    const before = points[at - 1]!;
    const next = points[at + 1]!;
    return { x: (next.x - before.x) / 2, y: (next.y - before.y) / 2 };
  };
  let path = `M${from.x} ${from.y}`;
  const along: Point[] = [];
  const reach: Point[] = [];
  const mids: Point[] = [];
  let firstControl: Point = from;
  let lastControl: Point = to;
  for (let at = 0; at < last; at++) {
    const a = points[at]!;
    const b = points[at + 1]!;
    const ta = tangent(at);
    const tb = tangent(at + 1);
    const c1 = { x: a.x + ta.x / 3, y: a.y + ta.y / 3 };
    const c2 = { x: b.x - tb.x / 3, y: b.y - tb.y / 3 };
    if (at === 0) firstControl = c1;
    if (at === last - 1) lastControl = c2;
    path += `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
    for (let step = at === 0 ? 0 : 1; step <= CURVE_STEPS; step++) {
      along.push(cubicAt(a, c1, c2, b, step / CURVE_STEPS));
    }
    reach.push(c1, c2);
    mids.push(cubicAt(a, c1, c2, b, 0.5));
  }
  return { path, along, reach, mids, firstControl, lastControl };
}

function polyline(points: ReadonlyArray<Point>, path: string) {
  const mids = points
    .slice(1)
    .map((point, at) => ({ x: (points[at]!.x + point.x) / 2, y: (points[at]!.y + point.y) / 2 }));
  return { path, along: points, reach: [], labelAt: middleOf(points), mids };
}

const NO_BENDS: ReadonlyArray<Point> = [];

/** An elbow takes no bends: it keeps its own route, round `obstacles`. */
export function canvasLine(
  route: CanvasRoute | undefined,
  from: CanvasLineEnd,
  to: CanvasLineEnd,
  bends: ReadonlyArray<Point> = NO_BENDS,
  obstacles: ReadonlyArray<CanvasBounds> = [],
): CanvasLine {
  if (route === "elbow") {
    const corners = canvasElbowRoute(from, to, obstacles);
    const line = polyline(corners, canvasElbowPath(corners, CANVAS_ELBOW_CORNER_RADIUS));
    return { ...line, mids: [], tips: tipsOf(corners, from, to) };
  }
  if (route === "straight") {
    const points = [from, ...bends, to];
    const path = points.map((point, at) => `${at === 0 ? "M" : "L"}${point.x} ${point.y}`).join("");
    return { ...polyline(points, path), tips: tipsOf(points, from, to) };
  }
  if (bends.length === 0) return curve(from, to);
  const bent = bentCurve(from, bends, to);
  return {
    path: bent.path,
    along: bent.along,
    reach: bent.reach,
    mids: bent.mids,
    labelAt: middleOf(bent.along),
    tips: [
      ...(to.head ? [{ tip: to, back: bent.lastControl }] : []),
      ...(from.head ? [{ tip: from, back: bent.firstControl }] : []),
    ],
  };
}

function tipsOf(points: ReadonlyArray<Point>, from: CanvasLineEnd, to: CanvasLineEnd) {
  const back = (tip: Point, order: ReadonlyArray<Point>) =>
    order.find((point) => point.x !== tip.x || point.y !== tip.y) ?? tip;
  return [
    ...(to.head ? [{ tip: to, back: back(to, [...points].reverse()) }] : []),
    ...(from.head ? [{ tip: from, back: back(from, points) }] : []),
  ];
}

/** Within this of the box its ends make, a card may be in an elbow's way. */
const ROUTE_MARGIN = 80;
/** The nearest this many: past them, a route's grid grows faster than it helps. */
const MOST_OBSTACLES = 12;

/**
 * The cards an elbow between `from` and `to` steps round: what's near the box its ends make, other
 * than the cards they're on. Sections hold cards rather than stand in the way.
 */
export function canvasRouteObstacles(
  boxes: Iterable<CanvasRouteBox>,
  from: CanvasLineEnd,
  to: CanvasLineEnd,
  skip: ReadonlyArray<string>,
): CanvasBounds[] {
  const ends = [
    from.box ?? { ...from, width: 0, height: 0 },
    to.box ?? { ...to, width: 0, height: 0 },
  ];
  const left = Math.min(...ends.map((box) => box.x)) - ROUTE_MARGIN;
  const top = Math.min(...ends.map((box) => box.y)) - ROUTE_MARGIN;
  const right = Math.max(...ends.map((box) => box.x + box.width)) + ROUTE_MARGIN;
  const bottom = Math.max(...ends.map((box) => box.y + box.height)) + ROUTE_MARGIN;
  const near: Array<{ readonly box: CanvasBounds; readonly distance: number }> = [];
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  for (const box of boxes) {
    if (box.type === "group" || skip.includes(box.id)) continue;
    if (
      box.x >= right ||
      box.x + box.width <= left ||
      box.y >= bottom ||
      box.y + box.height <= top
    ) {
      continue;
    }
    // A card the end is inside isn't in its way, as with an end free in a card.
    const holds = (end: Point) =>
      end.x >= box.x && end.x <= box.x + box.width && end.y >= box.y && end.y <= box.y + box.height;
    if (holds(from) || holds(to)) continue;
    const distance = Math.hypot(
      box.x + box.width / 2 - middle.x,
      box.y + box.height / 2 - middle.y,
    );
    near.push({ box: { x: box.x, y: box.y, width: box.width, height: box.height }, distance });
  }
  near.sort((a, b) => a.distance - b.distance);
  return near.slice(0, MOST_OBSTACLES).map(({ box }) => box);
}

/** Past this many, the earliest held is forgotten: enough for every elbow on a big board. */
const MOST_ROUTES = 6_000;
const routes = new Map<string, { readonly key: string; readonly line: CanvasLine }>();

const endKey = (end: CanvasLineEnd) =>
  `${end.x},${end.y},${end.side ?? ""},${end.head ? 1 : 0},${end.box === undefined ? "" : `${end.box.x},${end.box.y},${end.box.width},${end.box.height}`}`;

/**
 * An arrow's line. An elbow's is held for each arrow by what it was worked out from: its ends,
 * the cards they're on and the cards in its way, so a card dragged reroutes only what it touches.
 * `boxes` are the board's cards, read only for an elbow; `skip` are the ones its ends are on.
 */
export function canvasArrowLine(
  arrow: string,
  route: CanvasRoute | undefined,
  from: CanvasLineEnd,
  to: CanvasLineEnd,
  bends: ReadonlyArray<Point>,
  boxes: () => Iterable<CanvasRouteBox>,
  skip: ReadonlyArray<string>,
): CanvasLine {
  if (route !== "elbow") return canvasLine(route, from, to, bends);
  const obstacles = canvasRouteObstacles(boxes(), from, to, skip);
  let key = `${endKey(from)}|${endKey(to)}`;
  for (const box of obstacles) key += `|${box.x},${box.y},${box.width},${box.height}`;
  const held = routes.get(arrow);
  if (held?.key === key) return held.line;
  const line = canvasLine("elbow", from, to, NO_BENDS, obstacles);
  routes.delete(arrow);
  if (routes.size >= MOST_ROUTES) routes.delete(routes.keys().next().value!);
  routes.set(arrow, { key, line });
  return line;
}
