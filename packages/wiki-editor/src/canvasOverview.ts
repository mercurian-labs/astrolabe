import type { CanvasGroupNode, CanvasNode } from "@mercurian/wiki/canvas";

import { canvasColor, type CanvasCamera, type CanvasEdgeShape } from "./canvasGeometry";

const PRESETS: Readonly<Record<string, string>> = {
  "1": "#e5484d",
  "2": "#f76b15",
  "3": "#d6a100",
  "4": "#30a46c",
  "5": "#00a2c7",
  "6": "#8e4ec6",
};

interface OverviewItems {
  readonly groups: ReadonlyArray<CanvasGroupNode>;
  readonly cards: ReadonlyArray<CanvasNode>;
  readonly shapes: ReadonlyArray<CanvasEdgeShape>;
}

const paths = new WeakMap<CanvasEdgeShape, Path2D>();

function pathOf(shape: CanvasEdgeShape) {
  let path = paths.get(shape);
  if (path === undefined) {
    path = new Path2D(shape.path);
    paths.set(shape, path);
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
  for (const shape of items.shapes) context.stroke(pathOf(shape));
  context.globalAlpha = 0.55;
  fillRects(context, items.cards, base);
  context.globalAlpha = 1;
}
