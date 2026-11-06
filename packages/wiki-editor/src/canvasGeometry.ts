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
        bounds: boundsOf([start, control1, control2, end]),
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
