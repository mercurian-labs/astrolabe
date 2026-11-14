import type { CanvasBounds, CanvasData, CanvasEdge, CanvasSide } from "@mercurian/wiki/canvas";

import { canvasArrowLine, type CanvasRouteBox } from "./canvasRoute";

/** What the board's view is looking at: screen = world * zoom + offset. */
export interface CanvasCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const MIN_ZOOM = 0.0625;
const MAX_ZOOM = 2;
/** What a button's press zooms by, as in Obsidian. */
export const ZOOM_STEP = Math.SQRT2;
/** Below this zoom a card's content is too small to read, so it draws in its simple form. */
export const SIMPLE_ZOOM = 0.3;
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The whole board in view and centred, never enlarged past its own size. */
export function fitCamera(
  bounds: CanvasBounds,
  width: number,
  height: number,
  padding: number,
): CanvasCamera {
  const zoom = clampZoom(
    Math.min(
      (width - padding * 2) / Math.max(1, bounds.width),
      (height - padding * 2) / Math.max(1, bounds.height),
      1,
    ),
  );
  return {
    x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (height - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  };
}

/** The world a frame of this size shows, with `margin` screen pixels to spare on each side. */
export function cameraWindow(
  camera: CanvasCamera,
  width: number,
  height: number,
  margin: number,
): CanvasBounds {
  return {
    x: (-margin - camera.x) / camera.zoom,
    y: (-margin - camera.y) / camera.zoom,
    width: (width + margin * 2) / camera.zoom,
    height: (height + margin * 2) / camera.zoom,
  };
}

export const overlaps = (a: CanvasBounds, b: CanvasBounds): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Zooms by `factor`, keeping what is under the screen point `(x, y)` under it. */
export function zoomAt(camera: CanvasCamera, x: number, y: number, factor: number): CanvasCamera {
  const zoom = clampZoom(camera.zoom * factor);
  const scale = zoom / camera.zoom;
  return { x: x - (x - camera.x) * scale, y: y - (y - camera.y) * scale, zoom };
}

export interface CanvasEdgeShape {
  readonly edge: CanvasEdge;
  /** The line, as an SVG path in world coordinates. */
  readonly path: string;
  readonly heads: ReadonlyArray<string>;
  readonly labelAt: { readonly x: number; readonly y: number };
  /** What the curve and its arrowheads can reach, for culling. */
  readonly bounds: CanvasBounds;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const NORMAL: Readonly<Record<CanvasSide, Point>> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const sideMiddle = (node: CanvasBounds, side: CanvasSide): Point => {
  switch (side) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "right":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
  }
};

/** The sides facing each other: the spec leaves `fromSide` and `toSide` optional. */
function facingSides(from: CanvasBounds, to: CanvasBounds): readonly [CanvasSide, CanvasSide] {
  if (from === to) return ["right", "right"];
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

const HEAD_LENGTH = 12;
const HEAD_WIDTH = 5;

/** An arrowhead with its tip at `tip`, pointing into the node, against the side's normal. */
function head(tip: Point, normal: Point): string {
  const baseX = tip.x + normal.x * HEAD_LENGTH;
  const baseY = tip.y + normal.y * HEAD_LENGTH;
  const across = { x: -normal.y * HEAD_WIDTH, y: normal.x * HEAD_WIDTH };
  return `M${tip.x} ${tip.y}L${baseX + across.x} ${baseY + across.y}L${baseX - across.x} ${baseY - across.y}Z`;
}

function boundsOf(points: ReadonlyArray<Point>): CanvasBounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs) - HEAD_LENGTH;
  const y = Math.min(...ys) - HEAD_LENGTH;
  return {
    x,
    y,
    width: Math.max(...xs) + HEAD_LENGTH - x,
    height: Math.max(...ys) + HEAD_LENGTH - y,
  };
}

const cubicAt = (a: Point, b: Point, c: Point, d: Point, t: number): Point => {
  const u = 1 - t;
  const at = (axis: "x" | "y") =>
    u * u * u * a[axis] + 3 * u * u * t * b[axis] + 3 * u * t * t * c[axis] + t * t * t * d[axis];
  return { x: at("x"), y: at("y") };
};

/** An arrowhead with its tip at `tip`, pointing away from `back`. */
function headFrom(tip: Point, back: Point): string {
  const length = Math.hypot(back.x - tip.x, back.y - tip.y);
  return length === 0
    ? head(tip, { x: 0, y: 0 })
    : head(tip, { x: (back.x - tip.x) / length, y: (back.y - tip.y) / length });
}

const NO_BOXES = () => [];

/**
 * An edge's line between two boxes, leaving each square to its side: a curve, unless its style
 * routes it straight or as an elbow round `boxes`, the board's other cards. Each end stays on its
 * side's middle, where other apps draw it too.
 */
export function canvasEdgeShape(
  edge: CanvasEdge,
  from: CanvasBounds,
  to: CanvasBounds,
  boxes: () => ReadonlyArray<CanvasRouteBox> = NO_BOXES,
): CanvasEdgeShape {
  const [facingFrom, facingTo] = facingSides(from, to);
  const fromSide = edge.fromSide ?? facingFrom;
  const toSide = edge.toSide ?? facingTo;
  const start = sideMiddle(from, fromSide);
  const end = sideMiddle(to, toSide);
  const route = edge.astrolabe?.style?.route;
  if (route === "straight" || route === "elbow") {
    const line = canvasArrowLine(
      `edge:${edge.id}`,
      route,
      { ...start, box: from, side: fromSide, head: (edge.fromEnd ?? "none") === "arrow" },
      { ...end, box: to, side: toSide, head: (edge.toEnd ?? "arrow") === "arrow" },
      [],
      boxes,
      [edge.fromNode, edge.toNode],
    );
    return {
      edge,
      path: line.path,
      heads: line.tips.map(({ tip, back }) => headFrom(tip, back)),
      labelAt: line.labelAt,
      bounds: boundsOf([...line.along, ...line.reach]),
    };
  }
  const startNormal = NORMAL[fromSide];
  const endNormal = NORMAL[toSide];
  const [control1, control2] = curveControls(start, startNormal, end, endNormal);
  const heads = [
    ...((edge.toEnd ?? "arrow") === "arrow" ? [head(end, endNormal)] : []),
    ...((edge.fromEnd ?? "none") === "arrow" ? [head(start, startNormal)] : []),
  ];
  return {
    edge,
    path: curvePath(start, control1, control2, end),
    heads,
    labelAt: cubicAt(start, control1, control2, end, 0.5),
    bounds: boundsOf([start, control1, control2, end]),
  };
}

const curveControls = (start: Point, startNormal: Point, end: Point, endNormal: Point) => {
  const reach = Math.min(160, Math.max(40, Math.hypot(end.x - start.x, end.y - start.y) / 2));
  return [
    { x: start.x + startNormal.x * reach, y: start.y + startNormal.y * reach },
    { x: end.x + endNormal.x * reach, y: end.y + endNormal.y * reach },
  ] as const;
};

const curvePath = (start: Point, control1: Point, control2: Point, end: Point) =>
  `M${start.x} ${start.y}C${control1.x} ${control1.y} ${control2.x} ${control2.y} ${end.x} ${end.y}`;

/** A line being drawn from a card's side to the pointer, before it has a far end. */
export function canvasDraftPath(from: CanvasBounds, side: CanvasSide, to: Point): string {
  const start = sideMiddle(from, side);
  const [control1] = curveControls(start, NORMAL[side], to, { x: 0, y: 0 });
  return curvePath(start, control1, to, to);
}

/** Each edge's curve. Edges to missing cards are skipped. */
export function canvasEdgeShapes(data: CanvasData): CanvasEdgeShape[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const boxes = () => data.nodes;
  return data.edges.flatMap((edge) => {
    const from = nodes.get(edge.fromNode);
    const to = nodes.get(edge.toNode);
    return from === undefined || to === undefined ? [] : [canvasEdgeShape(edge, from, to, boxes)];
  });
}

/** The two ends of an edge as drawn, for working out which one a press is nearer. */
export function canvasEdgeEnds(
  edge: CanvasEdge,
  from: CanvasBounds,
  to: CanvasBounds,
): readonly [Point, Point] {
  const [facingFrom, facingTo] = facingSides(from, to);
  return [sideMiddle(from, edge.fromSide ?? facingFrom), sideMiddle(to, edge.toSide ?? facingTo)];
}

/** A colour for CSS: a spec preset by its name in the stylesheet, or a hex value. Else none. */
export function canvasColor(color: string | undefined): {
  readonly preset?: string;
  readonly hex?: string;
} {
  if (color === undefined) return {};
  if (/^[1-6]$/.test(color)) return { preset: color };
  return /^#[0-9a-f]{3,8}$/i.test(color) ? { hex: color } : {};
}

/** Whether a link is safe to open: card text and URLs come from a model or a file. */
export const isOpenableUrl = (href: string): boolean => /^(https?:|mailto:)/i.test(href.trim());

export type CanvasFileKind =
  | "note"
  | "canvas"
  | "base"
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "other";

const FILE_KINDS: ReadonlyArray<readonly [RegExp, CanvasFileKind]> = [
  [/\.md$/i, "note"],
  [/\.canvas$/i, "canvas"],
  [/\.base$/i, "base"],
  [/\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i, "image"],
  [/\.pdf$/i, "pdf"],
  [/\.(3gp|flac|m4a|mp3|oga|ogg|opus|wav)$/i, "audio"],
  [/\.(mkv|mov|mp4|ogv|webm)$/i, "video"],
];

/** What a file card shows, by the file's extension, as Obsidian decides it. */
export function canvasFileKind(file: string): CanvasFileKind {
  return FILE_KINDS.find(([pattern]) => pattern.test(file))?.[1] ?? "other";
}

/** A card's name: its file without folders, and a note's without `.md`. */
export const cardFileName = (file: string): string =>
  (file.split("/").pop() ?? file).replace(/\.md$/i, "");
