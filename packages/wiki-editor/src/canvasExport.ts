import {
  canvasBounds,
  type CanvasBounds,
  type CanvasData,
  type CanvasNode,
} from "@mercurian/wiki/canvas";

import { canvasEdgeShapes, canvasFileKind, cardFileName } from "./canvasGeometry";
import { canvasInkShapes } from "./canvasInk";
import {
  canvasLineScale,
  canvasOutline,
  canvasPaint,
  type CanvasPaint,
  type CanvasPaintFill,
} from "./canvasPaint";

const PADDING = 40;
/** Browsers stop drawing past this on a side. */
const MAX_SIDE = 16_384;

export interface CanvasExportOptions {
  readonly area: "full" | "viewport";
  /** A power of two, -1 to 1: 0 is actual size. */
  readonly zoom: number;
  readonly showLogo: boolean;
  /** Text is replaced by bars, so a board can be shown without what it says. */
  readonly privacy: boolean;
}

export interface CanvasExportColors {
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly border: string;
  readonly line: string;
}

export function canvasExportArea(
  data: CanvasData,
  viewport: CanvasBounds,
  options: Pick<CanvasExportOptions, "area">,
): CanvasBounds {
  if (options.area === "viewport") return viewport;
  const { x, y, width, height } = canvasBounds(data);
  return {
    x: x - PADDING,
    y: y - PADDING,
    width: width + PADDING * 2,
    height: height + PADDING * 2,
  };
}

/** The image's pixels: a board's units scaled, and held to what a browser can draw. */
export function canvasExportSize(area: CanvasBounds, zoom: number) {
  const wanted = 2 ** zoom;
  const scale = Math.min(wanted, MAX_SIDE / Math.max(area.width, area.height, 1));
  return {
    scale,
    width: Math.max(1, Math.round(area.width * scale)),
    height: Math.max(1, Math.round(area.height * scale)),
  };
}

/** A card's Markdown as lines to draw: its markers gone, with a heading's level kept. */
export function canvasPlainLines(text: string): ReadonlyArray<{
  readonly text: string;
  readonly heading: boolean;
}> {
  return text.split("\n").map((line) => {
    const heading = /^#{1,6}\s/.test(line);
    return {
      heading,
      text: line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+\[[ x]\]\s+/i, "• ")
        .replace(/^\s*[-*+]\s+/, "• ")
        .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, name, shown) => shown ?? name)
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|~~|==|`)/g, ""),
    };
  });
}

function roundedRect(rect: CanvasBounds, radius: number) {
  const path = new Path2D();
  path.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  return path;
}

/** A card's outline as its paint has it, and the box its text goes in. */
function outline(node: CanvasNode, paint: CanvasPaint) {
  const shape = canvasOutline(node, paint);
  if (shape.kind === "box") return { path: roundedRect(shape, shape.radius), inside: node };
  const { x, y, width, height } = node;
  // Where its text goes: the box inside the shape.
  const inset = node.type === "text" && node.astrolabe?.shape === "ellipse" ? 0.146 : 0.25;
  return {
    path: new Path2D(shape.d),
    inside: {
      ...node,
      x: x + width * inset,
      y: y + height * inset,
      width: width * (1 - inset * 2),
      height: height * (1 - inset * 2),
    },
  };
}

function wrapped(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line === "" ? word : `${line} ${word}`;
    if (context.measureText(next).width > width && line !== "") {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines;
}

function drawBars(context: CanvasRenderingContext2D, rect: CanvasBounds, color: string) {
  context.fillStyle = color;
  context.globalAlpha = 0.35;
  const rows = Math.max(1, Math.min(6, Math.floor((rect.height - 20) / 20)));
  for (let row = 0; row < rows; row++) {
    const width = (rect.width - 24) * (row === rows - 1 ? 0.6 : 1);
    context.fillRect(rect.x + 12, rect.y + 14 + row * 20, width, 8);
  }
  context.globalAlpha = 1;
}

function drawText(
  context: CanvasRenderingContext2D,
  node: CanvasNode,
  source: string,
  colors: CanvasExportColors,
) {
  context.save();
  context.beginPath();
  context.rect(node.x, node.y, node.width, node.height);
  context.clip();
  let y = node.y + 8;
  for (const { text, heading } of canvasPlainLines(source)) {
    context.font = heading ? "600 16px sans-serif" : "14px sans-serif";
    context.fillStyle = colors.foreground;
    for (const line of wrapped(context, text, node.width - 24)) {
      y += 20;
      if (y > node.y + node.height) break;
      context.fillText(line, node.x + 12, y - 4);
    }
  }
  context.restore();
}

function paintFill(
  context: CanvasRenderingContext2D,
  path: Path2D,
  fill: CanvasPaintFill,
  colors: CanvasExportColors,
) {
  if (fill.kind === "none") return;
  if (fill.kind === "surface" || fill.over === "surface") {
    context.fillStyle = colors.background;
    context.fill(path);
  }
  if (fill.kind === "tint") {
    const alpha = context.globalAlpha;
    context.globalAlpha = alpha * fill.amount;
    context.fillStyle = fill.color ?? colors.muted;
    context.fill(path);
    context.globalAlpha = alpha;
  }
}

/** A line as its paint has it, at `lines` times its width to keep to the zoom's floor. */
function strokeStyle(
  context: CanvasRenderingContext2D,
  paint: CanvasPaint,
  color: string,
  lines: number,
) {
  context.strokeStyle = color;
  context.lineWidth = paint.width * lines;
  context.lineCap = paint.cap;
  context.lineJoin = "round";
  context.setLineDash(paint.dashArray?.map((length) => length * lines) ?? []);
}

export const cardCaption = (node: CanvasNode): string =>
  node.type === "file"
    ? cardFileName(node.file)
    : node.type === "link"
      ? node.url
      : node.type === "group"
        ? (node.label ?? "")
        : node.text;

/**
 * Draws a board from its data on one canvas, with no DOM to photograph and nothing to depend on.
 * Text cards draw as plain wrapped text; what only a live card can show (Mermaid, math, a note's
 * body, a web page, a base's view, a PDF) draws as its name.
 */
export function drawCanvasExport(
  canvas: HTMLCanvasElement,
  data: CanvasData,
  area: CanvasBounds,
  options: CanvasExportOptions,
  colors: CanvasExportColors,
  images: ReadonlyMap<string, CanvasImageSource>,
) {
  const { scale, width, height } = canvasExportSize(area, options.zoom);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.scale(scale, scale);
  context.translate(-area.x, -area.y);
  context.fillStyle = colors.background;
  context.fillRect(area.x, area.y, area.width, area.height);

  const area2 = (node: CanvasNode) => node.width * node.height;
  const groups = data.nodes
    .filter((node) => node.type === "group")
    .sort((a, b) => area2(b) - area2(a));
  const lines = canvasLineScale(scale);
  for (const group of groups) {
    if (group.type !== "group") continue;
    const paint = canvasPaint(group);
    context.globalAlpha = paint.opacity;
    const tint = paint.stroke ?? colors.muted;
    const path = roundedRect(group, paint.radius);
    paintFill(context, path, paint.fill, colors);
    const background = group.background === undefined ? undefined : images.get(group.background);
    if (background !== undefined) {
      context.save();
      context.clip(path);
      context.globalAlpha = paint.opacity * 0.8;
      context.drawImage(background, group.x, group.y, group.width, group.height);
      context.restore();
    }
    strokeStyle(context, paint, tint, lines);
    context.stroke(path);
    context.setLineDash([]);
    if (group.label !== undefined && !options.privacy) {
      context.fillStyle = colors.muted;
      context.font = "600 16px sans-serif";
      context.fillText(group.label, group.x, group.y - 6);
    }
    context.globalAlpha = 1;
  }

  for (const shape of canvasEdgeShapes(data)) {
    const paint = canvasPaint(shape.edge);
    const tint = paint.stroke ?? colors.line;
    context.globalAlpha = paint.opacity;
    strokeStyle(context, paint, tint, lines);
    context.fillStyle = tint;
    context.stroke(new Path2D(shape.path));
    context.setLineDash([]);
    for (const head of shape.heads) {
      const tip = new Path2D(head);
      context.fill(tip);
    }
    if (shape.edge.label !== undefined && !options.privacy) {
      context.font = "12px sans-serif";
      context.fillStyle = colors.muted;
      context.textAlign = "center";
      context.fillText(shape.edge.label, shape.labelAt.x, shape.labelAt.y);
      context.textAlign = "start";
    }
    context.globalAlpha = 1;
  }

  for (const node of data.nodes) {
    if (node.type === "group") continue;
    const paint = canvasPaint(node);
    context.globalAlpha = paint.opacity;
    const { path, inside } = outline(node, paint);
    paintFill(context, path, paint.fill, colors);
    strokeStyle(context, paint, paint.stroke ?? colors.border, lines);
    context.stroke(path);
    context.setLineDash([]);
    const image = node.type === "file" ? images.get(node.file) : undefined;
    if (image !== undefined) {
      context.save();
      context.clip(roundedRect(node, paint.radius));
      context.drawImage(image, node.x, node.y, node.width, node.height);
      context.restore();
    } else if (options.privacy) {
      drawBars(context, inside, colors.muted);
    } else if (node.type === "text") {
      drawText(context, inside, node.text, colors);
    } else {
      context.fillStyle = colors.foreground;
      context.font = "600 14px sans-serif";
      for (const [row, line] of wrapped(context, cardCaption(node), node.width - 24)
        .slice(0, 3)
        .entries()) {
        context.fillText(line, node.x + 12, node.y + 24 + row * 20);
      }
    }
    context.globalAlpha = 1;
  }

  for (const shape of canvasInkShapes(data)) {
    const { ink } = shape;
    const paint = canvasPaint(ink);
    const tint = paint.stroke ?? (ink.type === "stroke" ? colors.foreground : colors.line);
    context.globalAlpha = paint.opacity;
    strokeStyle(context, paint, tint, lines);
    context.fillStyle = tint;
    context.stroke(new Path2D(shape.path));
    context.setLineDash([]);
    if (shape.head !== undefined) context.fill(new Path2D(shape.head));
    if (ink.type === "arrow" && ink.label !== undefined && !options.privacy) {
      context.font = "12px sans-serif";
      context.fillStyle = colors.muted;
      context.textAlign = "center";
      context.fillText(ink.label, shape.labelAt.x, shape.labelAt.y);
      context.textAlign = "start";
    }
    context.globalAlpha = 1;
  }
  context.lineCap = "butt";

  if (options.showLogo) {
    context.fillStyle = colors.muted;
    context.font = "12px sans-serif";
    context.textAlign = "end";
    context.fillText("Astrolabe", area.x + area.width - 12, area.y + area.height - 12);
    context.textAlign = "start";
  }
}

/** The images a board shows, by path, as far as their addresses can be read into a canvas. */
export async function loadExportImages(
  data: CanvasData,
  assetUrl: ((path: string) => Promise<string | null>) | undefined,
): Promise<ReadonlyMap<string, CanvasImageSource>> {
  if (assetUrl === undefined) return new Map();
  const paths = new Set(
    data.nodes.flatMap((node) =>
      node.type === "file" && canvasFileKind(node.file) === "image"
        ? [node.file]
        : node.type === "group" && node.background !== undefined
          ? [node.background]
          : [],
    ),
  );
  const loaded = await Promise.all(
    [...paths].map(async (path) => {
      try {
        const url = await assetUrl(path);
        if (url === null) return null;
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        return [path, bitmap] as const;
      } catch {
        return null;
      }
    }),
  );
  return new Map(loaded.filter((entry) => entry !== null));
}
