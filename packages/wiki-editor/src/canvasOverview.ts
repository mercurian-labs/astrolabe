import type { CanvasGroupNode, CanvasMarks, CanvasNode } from "@mercurian/wiki/canvas";

import { canvasColor, type CanvasCamera, type CanvasEdgeShape } from "./canvasGeometry";
import type { CanvasInkShape } from "./canvasInk";

const PRESETS: Readonly<Record<string, string>> = {
  "1": "#e5484d",
  "2": "#f76b15",
  "3": "#d6a100",
  "4": "#30a46c",
  "5": "#00a2c7",
  "6": "#8e4ec6",
};

/** A canvas can't read the theme's tokens: what a review marks, at this distance. */
const MARKS: Readonly<Record<string, string>> = {
  added: "#30a46c",
  removed: "#e5484d",
  text: "#d6a100",
  restyled: "#00a2c7",
};

interface OverviewItems {
  readonly groups: ReadonlyArray<CanvasGroupNode>;
  readonly cards: ReadonlyArray<CanvasNode>;
  readonly shapes: ReadonlyArray<CanvasEdgeShape>;
  readonly inks: ReadonlyArray<CanvasInkShape>;
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

const heads = new WeakMap<CanvasInkShape, Path2D>();

function headOf(shape: CanvasInkShape, d: string) {
  let path = heads.get(shape);
  if (path === undefined) {
    path = new Path2D(d);
    heads.set(shape, path);
  }
  return path;
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
  context.globalAlpha = 0.3;
  context.strokeStyle = base;
  context.lineWidth = 1 / camera.zoom;
  for (const shape of items.shapes) context.stroke(pathOf(shape, shape.path));
  context.globalAlpha = 0.55;
  fillRects(context, items.cards, base);
  context.globalAlpha = 1;
  for (const { id, x, y, width, height } of items.cards) {
    const tint = MARKS[marks.cards[id] ?? ""];
    if (tint === undefined) continue;
    context.fillStyle = tint;
    context.fillRect(x, y, width, height);
  }
  // Drawings sit above the cards, as the board draws them.
  context.lineWidth = 2 / camera.zoom;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const shape of items.inks) {
    const { ink, path, head } = shape;
    const tint = MARKS[marks.drawings?.[ink.id] ?? ""] ?? tintOf(ink.color, base);
    context.strokeStyle = tint;
    context.fillStyle = tint;
    context.stroke(pathOf(shape, path));
    if (head !== undefined) context.fill(headOf(shape, head));
  }
}
