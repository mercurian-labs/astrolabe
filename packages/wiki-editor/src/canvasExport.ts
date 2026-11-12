import {
  canvasBounds,
  type CanvasBounds,
  type CanvasData,
  type CanvasNode,
} from "@mercurian/wiki/canvas";

import { canvasColor, canvasEdgeShapes, canvasFileKind, cardFileName } from "./canvasGeometry";
import { canvasInkShapes } from "./canvasInk";

const PADDING = 40;
/** Browsers stop drawing past this on a side. */
const MAX_SIDE = 16_384;

const PRESET_TINTS: Readonly<Record<string, string>> = {
  "1": "#e5484d",
  "2": "#f76b15",
  "3": "#d6a100",
  "4": "#30a46c",
  "5": "#00a2c7",
  "6": "#8e4ec6",
};

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

function roundedRect(context: CanvasRenderingContext2D, rect: CanvasBounds, radius: number) {
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
}

/** A card's outline: a shaped card's ellipse or diamond, or the usual rounded box. */
function outline(context: CanvasRenderingContext2D, node: CanvasNode) {
  const shape = node.type === "text" ? node.astrolabe?.shape : undefined;
  const { x, y, width, height } = node;
  if (shape === undefined) {
    roundedRect(context, node, 8);
    return node;
  }
  context.beginPath();
  if (shape === "ellipse") {
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else {
    context.moveTo(x + width / 2, y);
    context.lineTo(x + width, y + height / 2);
    context.lineTo(x + width / 2, y + height);
    context.lineTo(x, y + height / 2);
    context.closePath();
  }
  // Where its text goes: the box inside the shape.
  const inset = shape === "ellipse" ? 0.146 : 0.25;
  return {
    ...node,
    x: x + width * inset,
    y: y + height * inset,
    width: width * (1 - inset * 2),
    height: height * (1 - inset * 2),
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

const tintOf = (color: string | undefined) => {
  const { preset, hex } = canvasColor(color);
  return hex ?? (preset === undefined ? undefined : PRESET_TINTS[preset]);
};

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
  for (const group of groups) {
    if (group.type !== "group") continue;
    const tint = tintOf(group.color) ?? colors.muted;
    roundedRect(context, group, 8);
    context.globalAlpha = 0.08;
    context.fillStyle = tint;
    context.fill();
    context.globalAlpha = 1;
    const background = group.background === undefined ? undefined : images.get(group.background);
    if (background !== undefined) {
      context.save();
      context.clip();
      context.globalAlpha = 0.8;
      context.drawImage(background, group.x, group.y, group.width, group.height);
      context.restore();
    }
    context.strokeStyle = tint;
    context.lineWidth = 1;
    roundedRect(context, group, 8);
    context.stroke();
    if (group.label !== undefined && !options.privacy) {
      context.fillStyle = colors.muted;
      context.font = "600 16px sans-serif";
      context.fillText(group.label, group.x, group.y - 6);
    }
  }

  context.lineWidth = 1.5;
  for (const shape of canvasEdgeShapes(data)) {
    const tint = tintOf(shape.edge.color) ?? colors.line;
    context.strokeStyle = tint;
    context.fillStyle = tint;
    context.stroke(new Path2D(shape.path));
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
  }

  for (const node of data.nodes) {
    if (node.type === "group") continue;
    const tint = tintOf(node.color);
    const inside = outline(context, node);
    context.fillStyle = colors.background;
    context.fill();
    if (tint !== undefined) {
      context.globalAlpha = 0.1;
      context.fillStyle = tint;
      context.fill();
      context.globalAlpha = 1;
    }
    context.strokeStyle = tint ?? colors.border;
    context.lineWidth = 1;
    context.stroke();
    const image = node.type === "file" ? images.get(node.file) : undefined;
    if (image !== undefined) {
      context.save();
      roundedRect(context, node, 8);
      context.clip();
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
  }

  context.lineCap = "round";
  context.lineJoin = "round";
  for (const shape of canvasInkShapes(data)) {
    const { ink } = shape;
    const tint = tintOf(ink.color) ?? (ink.type === "stroke" ? colors.foreground : colors.line);
    context.strokeStyle = tint;
    context.fillStyle = tint;
    context.lineWidth = ink.type === "stroke" ? 2.5 : 1.5;
    context.stroke(new Path2D(shape.path));
    if (shape.head !== undefined) context.fill(new Path2D(shape.head));
    if (ink.type === "arrow" && ink.label !== undefined && !options.privacy) {
      context.font = "12px sans-serif";
      context.fillStyle = colors.muted;
      context.textAlign = "center";
      context.fillText(ink.label, shape.labelAt.x, shape.labelAt.y);
      context.textAlign = "start";
    }
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
