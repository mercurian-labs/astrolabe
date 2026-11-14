import type { CanvasGroupNode, CanvasMarks, CanvasNode } from "@mercurian/wiki/canvas";

import { canvasColor, type CanvasCamera, type CanvasEdgeShape } from "./canvasGeometry";
import type { CanvasInkShape } from "./canvasInk";
import { CANVAS_PRESET_COLORS as PRESETS, canvasLineScale, canvasPaint } from "./canvasPaint";

/** A canvas can't read the theme's tokens: what a review marks, at this distance. */
const MARKS: Readonly<Record<string, string>> = {
  added: "#30a46c",
  removed: "#e5484d",
  text: "#d6a100",
  restyled: "#00a2c7",
};

/** One of what stacks above the sections, as a board draws it. */
export type CanvasBoardLayer =
  | { readonly kind: "card"; readonly node: Exclude<CanvasNode, CanvasGroupNode> }
  | { readonly kind: "arrow"; readonly shape: CanvasEdgeShape }
  | { readonly kind: "drawing"; readonly shape: CanvasInkShape };

interface OverviewItems {
  readonly groups: ReadonlyArray<CanvasGroupNode>;
  /** Bottom first. */
  readonly layers: ReadonlyArray<CanvasBoardLayer>;
}

const paths = new WeakMap<object, Path2D>();

function pathOf(shape: object, d: string) {
  let path = paths.get(shape);
  if (path === undefined) {
    path = new Path2D(d);
    paths.set(shape, path);
  }
  return path;
}

const heads = new WeakMap<CanvasInkShape, ReadonlyArray<Path2D>>();

function headsOf(shape: CanvasInkShape) {
  let paths = heads.get(shape);
  if (paths === undefined) {
    paths = shape.heads.map((d) => new Path2D(d));
    heads.set(shape, paths);
  }
  return paths;
}

const tintOf = (color: string | undefined, base: string) => {
  const { preset, hex } = canvasColor(color);
  return hex ?? (preset === undefined ? base : (PRESETS[preset] ?? base));
};

function fillRects(
  context: CanvasRenderingContext2D,
  nodes: ReadonlyArray<CanvasNode>,
  base: string,
) {
  const byTint = new Map<string, Array<CanvasNode>>();
  for (const node of nodes) {
    const tint = tintOf(node.color, base);
    const same = byTint.get(tint);
    if (same === undefined) byTint.set(tint, [node]);
    else same.push(node);
  }
  for (const [tint, same] of byTint) {
    context.fillStyle = tint;
    for (const { x, y, width, height } of same) context.fillRect(x, y, width, height);
  }
}

/**
 * Too many cards for the DOM to follow a pan: all of them as filled rectangles on one canvas.
 * The board calls this only when the camera moves, so nothing draws at rest.
 */
export function drawCanvasOverview(
  canvas: HTMLCanvasElement,
  camera: CanvasCamera,
  width: number,
  height: number,
  items: OverviewItems,
  marks: CanvasMarks,
) {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const scale = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  context.setTransform(
    scale * camera.zoom,
    0,
    0,
    scale * camera.zoom,
    scale * camera.x,
    scale * camera.y,
  );

  const base = getComputedStyle(canvas).color;
  context.globalAlpha = 0.12;
  fillRects(context, items.groups, base);
  const lines = canvasLineScale(camera.zoom);
  context.lineCap = "round";
  context.lineJoin = "round";
  // One pass in the order the board stacks them, so what covers what is the same at any zoom.
  for (const layer of items.layers) {
    if (layer.kind === "card") {
      const { id, x, y, width, height, color } = layer.node;
      const mark = MARKS[marks.cards[id] ?? ""];
      context.globalAlpha = mark === undefined ? 0.55 : 1;
      context.fillStyle = mark ?? tintOf(color, base);
      context.fillRect(x, y, width, height);
    } else if (layer.kind === "arrow") {
      const { shape } = layer;
      context.globalAlpha = 0.3;
      context.strokeStyle = base;
      context.lineWidth = canvasPaint(shape.edge).width * lines;
      context.stroke(pathOf(shape, shape.path));
    } else {
      const { shape } = layer;
      const { ink, path } = shape;
      const tint = MARKS[marks.drawings?.[ink.id] ?? ""] ?? tintOf(ink.color, base);
      context.globalAlpha = 1;
      context.strokeStyle = tint;
      context.fillStyle = tint;
      context.lineWidth = canvasPaint(ink).width * lines;
      context.stroke(pathOf(shape, path));
      for (const head of headsOf(shape)) context.fill(head);
    }
  }
  context.globalAlpha = 1;
}
