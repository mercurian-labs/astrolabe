import type {
  CanvasBounds,
  CanvasData,
  CanvasEdge,
  CanvasNode,
  CanvasSide,
} from "@mercurian/wiki/canvas";

/** What the board's view is looking at: screen = world * zoom + offset. */
export interface CanvasCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;
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

const sideMiddle = (node: CanvasNode, side: CanvasSide): Point => {
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
function facingSides(from: CanvasNode, to: CanvasNode): readonly [CanvasSide, CanvasSide] {
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

const cubicAt = (a: Point, b: Point, c: Point, d: Point, t: number): Point => {
  const u = 1 - t;
  const at = (axis: "x" | "y") =>
    u * u * u * a[axis] + 3 * u * u * t * b[axis] + 3 * u * t * t * c[axis] + t * t * t * d[axis];
  return { x: at("x"), y: at("y") };
};

/** Each edge's curve, leaving each card square to its side. Edges to missing cards are skipped. */
export function canvasEdgeShapes(data: CanvasData): CanvasEdgeShape[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  return data.edges.flatMap((edge) => {
    const from = nodes.get(edge.fromNode);
    const to = nodes.get(edge.toNode);
    if (from === undefined || to === undefined) return [];
    const [facingFrom, facingTo] = facingSides(from, to);
    const fromSide = edge.fromSide ?? facingFrom;
    const toSide = edge.toSide ?? facingTo;
    const start = sideMiddle(from, fromSide);
    const end = sideMiddle(to, toSide);
    const reach = Math.min(160, Math.max(40, Math.hypot(end.x - start.x, end.y - start.y) / 2));
    const startNormal = NORMAL[fromSide];
    const endNormal = NORMAL[toSide];
    const control1 = { x: start.x + startNormal.x * reach, y: start.y + startNormal.y * reach };
    const control2 = { x: end.x + endNormal.x * reach, y: end.y + endNormal.y * reach };
    const heads = [
      ...((edge.toEnd ?? "arrow") === "arrow" ? [head(end, endNormal)] : []),
      ...((edge.fromEnd ?? "none") === "arrow" ? [head(start, startNormal)] : []),
    ];
    return [
      {
        edge,
        path: `M${start.x} ${start.y}C${control1.x} ${control1.y} ${control2.x} ${control2.y} ${end.x} ${end.y}`,
        heads,
        labelAt: cubicAt(start, control1, control2, end, 0.5),
      },
    ];
  });
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
