import type { CanvasBounds, CanvasEdge, CanvasNode, CanvasSide } from "@mercurian/wiki/canvas";

/**
 * Where hands put things on a board, as pure geometry: snapping, resizing, group membership and the
 * arrange commands. The numbers are Obsidian's, as measured on 1.15; a board works in its own units.
 */

export const CANVAS_GRID = 20;
export const CANVAS_NUDGE = 20;
export const CANVAS_NUDGE_LARGE = 100;
/** Around a selection when a group is made, and between arranged cards. */
export const CANVAS_GAP = 20;
export const CANVAS_MIN_SIZE = 50;
/** Measured between 12 and 16 at zoom 1; how it changes with zoom wasn't, so it holds on screen. */
export const CANVAS_SNAP_TOLERANCE = 14;

export const TEXT_CARD_SIZE = { width: 250, height: 60 };
export const FILE_CARD_SIZE = { width: 400, height: 400 };

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasRect extends CanvasBounds {
  readonly id: string;
}

export type CanvasHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export const snapToGrid = (value: number, grid = CANVAS_GRID): number =>
  Math.round(value / grid) * grid;

export const boundsOfRects = (rects: ReadonlyArray<CanvasBounds>): CanvasBounds => {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** Start to start, end to end, centre to centre, and either side touching. */
function closestAlignment(
  start: number,
  size: number,
  otherStart: number,
  otherSize: number,
): number {
  const end = start + size;
  const otherEnd = otherStart + otherSize;
  const pairs = [
    otherStart - start,
    otherEnd - end,
    otherStart + otherSize / 2 - (start + size / 2),
    otherStart - end,
    otherEnd - start,
  ];
  return pairs.reduce((best, each) => (Math.abs(each) < Math.abs(best) ? each : best));
}

function snapAxis(
  start: number,
  size: number,
  others: ReadonlyArray<readonly [number, number]>,
  options: CanvasSnapOptions,
): number {
  let best: number | null = null;
  if (options.objects) {
    for (const [otherStart, otherSize] of others) {
      const each = closestAlignment(start, size, otherStart, otherSize);
      if (Math.abs(each) <= options.tolerance && (best === null || Math.abs(each) < Math.abs(best)))
        best = each;
    }
  }
  if (best !== null) return best;
  return options.grid ? snapToGrid(start) - start : 0;
}

export interface CanvasSnapOptions {
  readonly grid: boolean;
  readonly objects: boolean;
  /** In board units. */
  readonly tolerance: number;
}

/** How far to carry a dragged box from `moved`, so it lands snapped: objects beat the grid. */
export function snapDrag(
  moved: CanvasBounds,
  others: ReadonlyArray<CanvasBounds>,
  options: CanvasSnapOptions,
): CanvasPoint {
  return {
    x: snapAxis(
      moved.x,
      moved.width,
      others.map((other) => [other.x, other.width]),
      options,
    ),
    y: snapAxis(
      moved.y,
      moved.height,
      others.map((other) => [other.y, other.height]),
      options,
    ),
  };
}

/** A drag held to the axis it moved further along. */
export const lockedToAxis = (dx: number, dy: number): CanvasPoint =>
  Math.abs(dx) >= Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy };

export interface CanvasResizeOptions {
  readonly grid: boolean;
  /** Width over height, held on a corner: an image's. */
  readonly aspect?: number | undefined;
}

/** A box after dragging `handle` by (dx, dy): the far edge stays, and sizes snap. */
export function resizeRect(
  start: CanvasBounds,
  handle: CanvasHandle,
  dx: number,
  dy: number,
  options: CanvasResizeOptions,
): CanvasBounds {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const snap = (value: number) => (options.grid ? snapToGrid(value) : Math.round(value));
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  let width = east ? snap(right + dx) - start.x : west ? right - snap(start.x + dx) : start.width;
  let height = south
    ? snap(bottom + dy) - start.y
    : north
      ? bottom - snap(start.y + dy)
      : start.height;
  const { aspect } = options;
  const corner = (west || east) && (north || south);
  if (aspect !== undefined && corner) {
    const wider = Math.abs(width - start.width) / start.width;
    const taller = Math.abs(height - start.height) / start.height;
    width = Math.max(CANVAS_MIN_SIZE, width);
    height = Math.max(CANVAS_MIN_SIZE, height);
    if (wider >= taller) height = width / aspect;
    else width = height * aspect;
    if (height < CANVAS_MIN_SIZE) {
      height = CANVAS_MIN_SIZE;
      width = height * aspect;
    }
    if (width < CANVAS_MIN_SIZE) {
      width = CANVAS_MIN_SIZE;
      height = width / aspect;
    }
    width = Math.round(width);
    height = Math.round(height);
  } else {
    width = Math.max(CANVAS_MIN_SIZE, width);
    height = Math.max(CANVAS_MIN_SIZE, height);
  }
  return {
    x: west ? right - width : start.x,
    y: north ? bottom - height : start.y,
    width,
    height,
  };
}

/** A box's far edge pulled in to its content, by a double click on that handle. */
export function fitToContent(
  rect: CanvasBounds,
  handle: CanvasHandle,
  content: { readonly width: number; readonly height: number },
): CanvasBounds {
  return {
    ...rect,
    ...(handle.includes("e") || handle.includes("w")
      ? { width: Math.min(rect.width, Math.ceil(content.width)) }
      : {}),
    ...(handle.includes("s") || handle.includes("n") ? { height: Math.ceil(content.height) } : {}),
  };
}

export const containsFully = (outer: CanvasBounds, inner: CanvasBounds): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/**
 * Everything that moves when `ids` do. Membership is geometry and never stored: a group takes
 * whatever sits fully inside it at this moment, and a nested group's contents are inside it too.
 */
export function movedWith(
  nodes: ReadonlyArray<CanvasNode>,
  ids: Iterable<string>,
): ReadonlySet<string> {
  const moved = new Set(ids);
  const groups = nodes.filter((node) => node.type === "group" && moved.has(node.id));
  for (const group of groups) {
    for (const node of nodes) {
      if (node !== group && containsFully(group, node)) moved.add(node.id);
    }
  }
  return moved;
}

export const groupAround = (rects: ReadonlyArray<CanvasBounds>): CanvasBounds => {
  const bounds = boundsOfRects(rects);
  return {
    x: bounds.x - CANVAS_GAP,
    y: bounds.y - CANVAS_GAP,
    width: bounds.width + CANVAS_GAP * 2,
    height: bounds.height + CANVAS_GAP * 2,
  };
};

/** "Keep aspect ratio" keeps a group's width and sets its height from the image. */
export const ratioHeight = (
  width: number,
  image: { readonly width: number; readonly height: number },
): number => Math.round((width * image.height) / image.width);

export type CanvasArrangement =
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-top"
  | "align-middle"
  | "align-bottom"
  | "row"
  | "column"
  | "grid"
  | "distribute-horizontal"
  | "distribute-vertical"
  | "justify-horizontal"
  | "justify-vertical";

const byX = (a: CanvasBounds, b: CanvasBounds) => a.x - b.x;
const byY = (a: CanvasBounds, b: CanvasBounds) => a.y - b.y;

function inGrid(rects: ReadonlyArray<CanvasRect>, bounds: CanvasBounds): ReadonlyArray<CanvasRect> {
  const columns = Math.ceil(Math.sqrt(rects.length));
  const reading = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const columnWidth: number[] = [];
  const rowHeight: number[] = [];
  reading.forEach((rect, position) => {
    const column = position % columns;
    const row = Math.floor(position / columns);
    columnWidth[column] = Math.max(columnWidth[column] ?? 0, rect.width);
    rowHeight[row] = Math.max(rowHeight[row] ?? 0, rect.height);
  });
  const sum = (sizes: ReadonlyArray<number>, count: number) =>
    sizes.slice(0, count).reduce((total, size) => total + size + CANVAS_GAP, 0);
  return reading.map((rect, position) => ({
    ...rect,
    x: bounds.x + sum(columnWidth, position % columns),
    y: bounds.y + sum(rowHeight, Math.floor(position / columns)),
  }));
}

function inLine(
  rects: ReadonlyArray<CanvasRect>,
  start: number,
  axis: "x" | "y",
  gap: number,
): ReadonlyArray<CanvasRect> {
  const size = axis === "x" ? "width" : "height";
  let at = start;
  return [...rects].sort(axis === "x" ? byX : byY).map((rect) => {
    const placed = { ...rect, [axis]: at };
    at += rect[size] + gap;
    return placed;
  });
}

/** Evenly spaced between the two end cards, which stay where they are. */
function distributed(
  rects: ReadonlyArray<CanvasRect>,
  bounds: CanvasBounds,
  axis: "x" | "y",
): ReadonlyArray<CanvasRect> {
  const size = axis === "x" ? "width" : "height";
  const sum = rects.reduce((total, rect) => total + rect[size], 0);
  const gap = (bounds[size] - sum) / Math.max(1, rects.length - 1);
  return inLine(rects, bounds[axis], axis, gap).map((rect) => ({
    ...rect,
    [axis]: Math.round(rect[axis]),
  }));
}

/** New boxes for `rects`, acting on their bounding box. Rows and grids run in reading order. */
export function arrange(
  kind: CanvasArrangement,
  rects: ReadonlyArray<CanvasRect>,
): ReadonlyArray<CanvasRect> {
  const bounds = boundsOfRects(rects);
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  switch (kind) {
    case "align-left":
      return rects.map((rect) => ({ ...rect, x: bounds.x }));
    case "align-center":
      return rects.map((rect) => ({ ...rect, x: bounds.x + (bounds.width - rect.width) / 2 }));
    case "align-right":
      return rects.map((rect) => ({ ...rect, x: right - rect.width }));
    case "align-top":
      return rects.map((rect) => ({ ...rect, y: bounds.y }));
    case "align-middle":
      return rects.map((rect) => ({ ...rect, y: bounds.y + (bounds.height - rect.height) / 2 }));
    case "align-bottom":
      return rects.map((rect) => ({ ...rect, y: bottom - rect.height }));
    case "row":
      return inLine(rects, bounds.x, "x", CANVAS_GAP).map((rect) => ({ ...rect, y: bounds.y }));
    case "column":
      return inLine(rects, bounds.y, "y", CANVAS_GAP).map((rect) => ({ ...rect, x: bounds.x }));
    case "grid":
      return inGrid(rects, bounds);
    case "distribute-horizontal":
      return distributed(rects, bounds, "x");
    case "distribute-vertical":
      return distributed(rects, bounds, "y");
    case "justify-horizontal":
      return rects.map((rect) => ({ ...rect, x: bounds.x, width: bounds.width }));
    case "justify-vertical":
      return rects.map((rect) => ({ ...rect, y: bounds.y, height: bounds.height }));
  }
}

function distanceToSide(rect: CanvasBounds, side: CanvasSide, point: CanvasPoint) {
  const horizontal = side === "top" || side === "bottom";
  const [fromX, toX] = horizontal
    ? [rect.x, rect.x + rect.width]
    : side === "left"
      ? [rect.x, rect.x]
      : [rect.x + rect.width, rect.x + rect.width];
  const [fromY, toY] = !horizontal
    ? [rect.y, rect.y + rect.height]
    : side === "top"
      ? [rect.y, rect.y]
      : [rect.y + rect.height, rect.y + rect.height];
  const x = Math.min(toX, Math.max(fromX, point.x));
  const y = Math.min(toY, Math.max(fromY, point.y));
  return Math.hypot(point.x - x, point.y - y);
}

const SIDES: ReadonlyArray<CanvasSide> = ["top", "right", "bottom", "left"];

/** The side of `rect` a drop lands nearest: the target's geometry doesn't enter into it. */
export const nearestSide = (rect: CanvasBounds, point: CanvasPoint): CanvasSide =>
  SIDES.reduce((best, side) =>
    distanceToSide(rect, side, point) < distanceToSide(rect, best, point) ? side : best,
  );

export const OPPOSITE_SIDE: Readonly<Record<CanvasSide, CanvasSide>> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};

/** A new card off a connection dropped in space: near edge at the drop, centred across it. */
export function cardAtConnectionDrop(
  from: CanvasSide,
  drop: CanvasPoint,
  size: { readonly width: number; readonly height: number },
): CanvasPoint {
  switch (from) {
    case "right":
      return { x: drop.x, y: drop.y - size.height / 2 };
    case "left":
      return { x: drop.x - size.width, y: drop.y - size.height / 2 };
    case "bottom":
      return { x: drop.x - size.width / 2, y: drop.y };
    case "top":
      return { x: drop.x - size.width / 2, y: drop.y - size.height };
  }
}

export const centeredOn = (
  point: CanvasPoint,
  size: { readonly width: number; readonly height: number },
): CanvasPoint => ({
  x: Math.round(point.x - size.width / 2),
  y: Math.round(point.y - size.height / 2),
});

export type CanvasLineDirection = "none" | "end" | "both";

/** The keys an arrow's ends take: Obsidian writes only what isn't the default. */
export const lineDirectionKeys = (
  direction: CanvasLineDirection,
): { readonly fromEnd: string | null; readonly toEnd: string | null } => ({
  fromEnd: direction === "both" ? "arrow" : null,
  toEnd: direction === "none" ? "none" : null,
});

export const lineDirectionOf = (edge: CanvasEdge): CanvasLineDirection =>
  (edge.fromEnd ?? "none") === "arrow"
    ? "both"
    : (edge.toEnd ?? "arrow") === "none"
      ? "none"
      : "end";
