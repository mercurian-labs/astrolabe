import type { CanvasHandEdit } from "@mercurian/wiki/canvas-edits";
import {
  canvasBounds,
  canvasData,
  canvasDrawingEntries,
  canvasEntries,
  canvasInkEnd,
  type CanvasBounds,
  type CanvasData,
  type CanvasEdge,
  type CanvasInkEnd,
  type CanvasNode,
  type CanvasSide,
} from "@mercurian/wiki/canvas";

import {
  arrange,
  boundsOfRects,
  CANVAS_GRID,
  centeredOn,
  FILE_CARD_SIZE,
  lineDirectionKeys,
  movedWith,
  TEXT_CARD_SIZE,
  type CanvasArrangement,
  type CanvasLineDirection,
  type CanvasPoint,
} from "./canvasArrange";
import { inkMovedWith } from "./canvasInk";

/** What a person's commands do to a board, as edits, from what's selected. */

type Raw = Readonly<Record<string, unknown>>;

export const textCard = (
  id: string,
  { x, y }: CanvasPoint,
  text = "",
): Readonly<Record<string, unknown>> => ({
  id,
  x,
  y,
  ...TEXT_CARD_SIZE,
  type: "text",
  text,
});

export const fileCard = (
  id: string,
  { x, y }: CanvasPoint,
  file: string,
  size: { readonly width: number; readonly height: number } = FILE_CARD_SIZE,
): Readonly<Record<string, unknown>> => ({ id, x, y, ...size, type: "file", file });

export const linkCard = (
  id: string,
  { x, y }: CanvasPoint,
  url: string,
): Readonly<Record<string, unknown>> => ({ id, x, y, ...FILE_CARD_SIZE, type: "link", url });

export const UNTITLED_GROUP = "Untitled section";

export const groupCard = (id: string, rect: CanvasBounds): Readonly<Record<string, unknown>> => ({
  id,
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
  type: "group",
  label: UNTITLED_GROUP,
});

export const arrowBetween = (
  id: string,
  from: { readonly node: string; readonly side: CanvasSide },
  to: { readonly node: string; readonly side: CanvasSide },
): Readonly<Record<string, unknown>> => ({
  id,
  fromNode: from.node,
  fromSide: from.side,
  toNode: to.node,
  toSide: to.side,
});

/** A text pasted on a board: a lone address is a link card, anything else a text card. */
export function pastedCard(id: string, at: CanvasPoint, text: string) {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed)
    ? linkCard(id, centeredOn(at, FILE_CARD_SIZE), trimmed)
    : textCard(id, centeredOn(at, TEXT_CARD_SIZE), text);
}

export function arrangeEdits(
  kind: CanvasArrangement,
  nodes: ReadonlyArray<CanvasNode>,
): ReadonlyArray<CanvasHandEdit> {
  if (nodes.length < 2) return [];
  const before = new Map(nodes.map((node) => [node.id, node]));
  return arrange(
    kind,
    nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
  ).flatMap((rect) => {
    const node = before.get(rect.id);
    if (node === undefined) return [];
    const same =
      node.x === rect.x &&
      node.y === rect.y &&
      node.width === rect.width &&
      node.height === rect.height;
    return same ? [] : [{ op: "resize" as const, card: rect.id, ...rectOf(rect) }];
  });
}

const rectOf = ({ x, y, width, height }: CanvasBounds) => ({ x, y, width, height });

export const lineDirectionEdit = (
  arrow: string,
  direction: CanvasLineDirection,
): CanvasHandEdit => ({
  op: "set-arrow",
  arrow,
  keys: lineDirectionKeys(direction),
});

/** A card turned into another with a new id, keeping its place in the file and its arrows. */
export function replaceCard(
  raw: Raw,
  replacement: Raw,
  edges: ReadonlyArray<CanvasEdge>,
): ReadonlyArray<CanvasHandEdit> {
  const id = raw.id as string;
  const next = replacement.id as string;
  return [
    { op: "put-card", node: replacement },
    ...edges.flatMap((edge): CanvasHandEdit[] =>
      edge.fromNode === id || edge.toNode === id
        ? [
            {
              op: "set-arrow",
              arrow: edge.id,
              keys: {
                ...(edge.fromNode === id ? { fromNode: next } : {}),
                ...(edge.toNode === id ? { toNode: next } : {}),
              },
            },
          ]
        : [],
    ),
    { op: "remove-card", card: id },
  ];
}

/** What a selection puts on the clipboard, as the file holds it. */
export interface CanvasClip {
  readonly nodes: ReadonlyArray<Raw>;
  readonly edges: ReadonlyArray<Raw>;
  /** Each drawn arrow's ends are on the clip's own cards, or free. */
  readonly drawings: ReadonlyArray<Raw>;
}

/**
 * The selection, a group's contents and drawings, and the arrows that join only those. A drawn
 * arrow's end on a card left behind is free where it was.
 */
export function canvasClip(
  document: unknown,
  data: Pick<CanvasData, "nodes" | "drawings">,
  ids: Iterable<string>,
  drawingIds: Iterable<string> = [],
): CanvasClip {
  const taken = movedWith(data.nodes, ids);
  const inked = new Set([...drawingIds, ...inkMovedWith(data.nodes, data.drawings ?? [], taken)]);
  const { nodes: rawNodes, edges: rawEdges } = (document ?? {}) as Record<string, unknown>;
  const rects = new Map(data.nodes.map((node) => [node.id, node]));
  const drawn = new Map((data.drawings ?? []).map((ink) => [ink.id, ink]));
  const loose = (raw: unknown, end: CanvasInkEnd) =>
    "node" in end && !taken.has(end.node) ? canvasInkEnd(end, rects) : raw;
  return {
    nodes: canvasEntries(rawNodes, "node").flatMap(({ id, raw }) =>
      taken.has(id) ? [{ ...raw, id }] : [],
    ),
    edges: canvasEntries(rawEdges, "edge").flatMap(({ raw }) =>
      taken.has(String(raw.fromNode)) && taken.has(String(raw.toNode)) ? [raw] : [],
    ),
    drawings: canvasDrawingEntries(document).flatMap(({ id, raw }) => {
      if (!inked.has(id)) return [];
      const ink = drawn.get(id);
      if (ink?.type !== "arrow") return [{ ...raw, id }];
      const [from, to] = [loose(raw.from, ink.from), loose(raw.to, ink.to)];
      return from === undefined || to === undefined ? [] : [{ ...raw, id, from, to }];
    }),
  };
}

/** A board stays usable when a folder that's really a code repository lands on it. */
const FOLDER_CARDS_MAX = 200;

/**
 * What a drop puts on a board: a path ending in `/` is a folder, for every file under it among
 * `listed`, up to a limit. `left` counts those it had no room for.
 */
export function filesOfDrop(
  dropped: ReadonlyArray<string>,
  listed: ReadonlyArray<string>,
): { readonly files: ReadonlyArray<string>; readonly left: number } {
  const files = dropped.flatMap((path) =>
    path.endsWith("/") ? listed.filter((file) => file.startsWith(path)) : [path],
  );
  return {
    files: files.slice(0, FOLDER_CARDS_MAX),
    left: Math.max(files.length - FOLDER_CARDS_MAX, 0),
  };
}

export const CANVAS_CLIP_TYPE = "application/x-astrolabe-canvas";

/** As a file holds it, so a board's own text pastes as a clip too. */
export const serializeClip = ({ nodes, edges, drawings }: CanvasClip): string =>
  JSON.stringify({ nodes, edges, ...(drawings.length === 0 ? {} : { astrolabe: { drawings } }) });

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A clip from text, which may be a JSON Canvas from anywhere; null for ordinary text. */
export function parseClip(text: string): CanvasClip | null {
  if (!text.trimStart().startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !Array.isArray(value.nodes)) return null;
    const drawings = isRecord(value.astrolabe) ? value.astrolabe.drawings : undefined;
    return {
      nodes: value.nodes.filter(isRecord),
      edges: Array.isArray(value.edges) ? value.edges.filter(isRecord) : [],
      drawings: Array.isArray(drawings) ? drawings.filter(isRecord) : [],
    };
  } catch {
    return null;
  }
}

/** What a selection reads as outside a board: its cards' text, its files' names, its links. */
export function clipText(clip: CanvasClip): string {
  return clip.nodes
    .flatMap((node) => {
      const said = node.text ?? node.url ?? node.file ?? node.label;
      return typeof said === "string" && said !== "" ? [said] : [];
    })
    .join("\n\n");
}

const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" ? value : fallback;

const boundsOfRaw = (nodes: ReadonlyArray<Raw>) =>
  boundsOfRects(
    nodes.map((node) => ({
      x: numberOr(node.x, 0),
      y: numberOr(node.y, 0),
      width: numberOr(node.width, 0),
      height: numberOr(node.height, 0),
    })),
  );

export interface PlacedClip {
  readonly edits: ReadonlyArray<CanvasHandEdit>;
  /** The new cards' ids. */
  readonly cards: ReadonlyArray<string>;
  readonly drawings: ReadonlyArray<string>;
}

/**
 * A clip's cards with new ids, moved by (dx, dy). An arrow comes along only with both its ends, and
 * an arrow's colour, label and unknown keys come with it, as do a card's.
 */
export function placeClip(
  clip: CanvasClip,
  dx: number,
  dy: number,
  mint: () => string,
): PlacedClip {
  const ids = new Map(clip.nodes.map((node) => [node.id, mint()]));
  const nodes = clip.nodes.map((node) => ({
    ...node,
    id: ids.get(node.id),
    x: numberOr(node.x, 0) + dx,
    y: numberOr(node.y, 0) + dy,
  }));
  const edges = clip.edges.flatMap((edge) => {
    const fromNode = ids.get(edge.fromNode);
    const toNode = ids.get(edge.toNode);
    return fromNode === undefined || toNode === undefined
      ? []
      : [{ ...edge, id: mint(), fromNode, toNode }];
  });
  /** A free end moves with the rest; one on a card the clip doesn't hold can't be placed. */
  const placedEnd = (end: unknown) => {
    if (!isRecord(end)) return undefined;
    if (typeof end.node === "string") {
      const node = ids.get(end.node);
      return node === undefined ? undefined : { ...end, node };
    }
    return { ...end, x: numberOr(end.x, 0) + dx, y: numberOr(end.y, 0) + dy };
  };
  const drawings = clip.drawings.flatMap((ink): Raw[] => {
    if (ink.type !== "arrow") {
      return [{ ...ink, id: mint(), x: numberOr(ink.x, 0) + dx, y: numberOr(ink.y, 0) + dy }];
    }
    const [from, to] = [placedEnd(ink.from), placedEnd(ink.to)];
    return from === undefined || to === undefined ? [] : [{ ...ink, id: mint(), from, to }];
  });
  return {
    edits: [
      ...nodes.map((node): CanvasHandEdit => ({ op: "put-card", node })),
      ...edges.map((edge): CanvasHandEdit => ({ op: "put-arrow", edge })),
      ...drawings.map((drawing): CanvasHandEdit => ({ op: "put-drawing", drawing })),
    ],
    cards: nodes.map((node) => node.id as string),
    drawings: drawings.map((drawing) => drawing.id as string),
  };
}

/** A clip pasted around `at`, on the grid, so what it holds keeps its arrangement. */
export function pasteClip(clip: CanvasClip, at: CanvasPoint, mint: () => string): PlacedClip {
  const inked = canvasData({ nodes: clip.nodes, astrolabe: { drawings: clip.drawings } });
  const drawn = inked.drawings === undefined ? [] : [canvasBounds(inked)];
  const bounds = boundsOfRects([
    ...(clip.nodes.length === 0 ? [] : [boundsOfRaw(clip.nodes)]),
    ...drawn,
  ]);
  const { x, y } = centeredOn(at, bounds);
  const snapped = (value: number) => Math.round(value / CANVAS_GRID) * CANVAS_GRID;
  return placeClip(clip, snapped(x) - bounds.x, snapped(y) - bounds.y, mint);
}
