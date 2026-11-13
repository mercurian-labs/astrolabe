/**
 * JSON Canvas (https://jsoncanvas.org/spec/1.0/): reading one, writing it back as Obsidian writes
 * it, and comparing two versions. This file is what clients import, the
 * phone's engine included: it must stay free of the wiki's parsers.
 */

export * from "./canvasPlace.ts";
import { canvasArrowSides, canvasStepFrame, insideGroup } from "./canvasPlace.ts";

export type CanvasSide = "top" | "right" | "bottom" | "left";

interface CanvasNodeBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** A preset, "1" to "6", or a hex colour. */
  readonly color?: string;
}

/** A text card's outline other than the rectangle, which other apps draw it as. */
export type CanvasShape = "ellipse" | "diamond";

export type CanvasDash = "solid" | "dashed" | "dotted";
export type CanvasCorners = "round" | "sharp";

/**
 * How a card, section, arrow or drawing is drawn beyond its `color`, which stays the stroke's so
 * other apps still show it. Kept under `astrolabe.style`; what's left out draws as it always has.
 */
export interface CanvasStyle {
  /** A preset, a hex colour, or "none". Left out, a card's fill is tinted from its `color`. */
  readonly fill?: string;
  /** The line's width in board units. */
  readonly width?: number;
  readonly dash?: CanvasDash;
  /** Boxes only: cards drawn as rectangles, and sections. */
  readonly corners?: CanvasCorners;
  /** 0 to 1. */
  readonly opacity?: number;
}

/** Wider than this reads as a fill, not a line. */
export const CANVAS_MAX_STYLE_WIDTH = 64;

interface Styled {
  readonly astrolabe?: { readonly style?: CanvasStyle };
}

export interface CanvasTextNode extends CanvasNodeBase {
  readonly type: "text";
  readonly text: string;
  readonly astrolabe?: { readonly shape?: CanvasShape; readonly style?: CanvasStyle };
}

/** Code a link card cites. Kept beside `url` so the card still works away from the product. */
export interface CanvasCodeReference {
  readonly path: string;
  readonly lines?: readonly [number, number];
  readonly repository?: string;
  readonly commit?: string;
}

export interface CanvasLinkNode extends CanvasNodeBase {
  readonly type: "link";
  /** Empty only on a code card in a thread, which has no link until it is saved to a wiki. */
  readonly url: string;
  readonly astrolabe?: {
    readonly caption?: string;
    readonly code?: CanvasCodeReference;
    readonly style?: CanvasStyle;
  };
}

export interface CanvasFileNode extends CanvasNodeBase, Styled {
  readonly type: "file";
  /** Its path from the wiki's root, any depth, extension included. */
  readonly file: string;
  /** A note's `#Heading` or `#^block`, or a base's `#View`. */
  readonly subpath?: string;
}

export interface CanvasGroupNode extends CanvasNodeBase, Styled {
  readonly type: "group";
  readonly label?: string;
  /** An image's path from the wiki's root. */
  readonly background?: string;
  /** `ratio` or `repeat`; a group with none covers, as Obsidian writes it. */
  readonly backgroundStyle?: string;
}

/** One step of a story: what the reader sees, and the cards it shows, or the group that is it. */
export interface CanvasStoryStep {
  readonly label?: string;
  readonly note: string;
  /** Empty for a step that names its group. */
  readonly cards: ReadonlyArray<string>;
  /** A group the step is: its cards are the group's, its frame the group's outline. */
  readonly group?: string;
  /** Where a lanes board names the step, above its column. */
  readonly heading?: CanvasBounds;
}

/** One way of telling a board, walked a step at a time. The cards stay where the board has them. */
export interface CanvasStory {
  readonly title: string;
  readonly steps: ReadonlyArray<CanvasStoryStep>;
}

export type CanvasNode = CanvasTextNode | CanvasLinkNode | CanvasFileNode | CanvasGroupNode;

export interface CanvasEdge extends Styled {
  readonly id: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly fromSide?: CanvasSide;
  readonly toSide?: CanvasSide;
  readonly fromEnd?: "none" | "arrow";
  readonly toEnd?: "none" | "arrow";
  readonly color?: string;
  readonly label?: string;
}

/** One end of a hand-drawn arrow: a point on the board, or a node's side, which it follows. */
export type CanvasInkEnd =
  | { readonly x: number; readonly y: number }
  | { readonly node: string; readonly side: CanvasSide };

/** A long scribble simplifies to a few hundred; the board simplifies harder past this. */
export const CANVAS_MAX_STROKE_POINTS = 1_000;

/** A freehand line. `points` are x, y pairs from `x`, `y`, so moving it moves only those two. */
export interface CanvasInkStroke extends Styled {
  readonly id: string;
  readonly type: "stroke";
  readonly x: number;
  readonly y: number;
  readonly points: ReadonlyArray<number>;
  readonly color?: string;
}

/** An arrow with an end that isn't on a node; one with both on nodes is an edge. */
export interface CanvasInkArrow extends Styled {
  readonly id: string;
  readonly type: "arrow";
  readonly from: CanvasInkEnd;
  readonly to: CanvasInkEnd;
  readonly color?: string;
  readonly label?: string;
}

/** What a person drew by hand, which JSON Canvas has no node for. */
export type CanvasInk = CanvasInkStroke | CanvasInkArrow;

/** What a board draws. A file's exact contents live in the document `parseCanvas` returns. */
export interface CanvasData {
  /** Earlier nodes draw beneath later ones. */
  readonly nodes: ReadonlyArray<CanvasNode>;
  readonly edges: ReadonlyArray<CanvasEdge>;
  /** Kept at the file's top level, under `astrolabe`, which Obsidian writes back untouched. */
  readonly stories?: ReadonlyArray<CanvasStory>;
  /** Under `astrolabe` too, as `drawings`; above the cards, in the file's order. */
  readonly drawings?: ReadonlyArray<CanvasInk>;
}

export interface CanvasBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a board covers: its cards and groups, its drawings, and its lanes' step names. */
export function canvasBounds(
  data: Pick<CanvasData, "nodes"> & Pick<Partial<CanvasData>, "stories" | "drawings">,
): CanvasBounds {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const drawn = (data.drawings ?? []).flatMap((ink) => canvasInkBounds(ink, nodes) ?? []);
  if (data.nodes.length === 0 && drawn.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const headings = (data.stories ?? []).flatMap((story) =>
    story.steps.flatMap((step) => (step.heading === undefined ? [] : [step.heading])),
  );
  for (const node of [...data.nodes, ...headings, ...drawn]) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const sideMiddle = (node: CanvasBounds, side: CanvasSide) => {
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

/** Where an arrow's end is now; none when the node it was on is gone. */
export function canvasInkEnd(
  end: CanvasInkEnd,
  nodes: Pick<ReadonlyMap<string, CanvasBounds>, "get">,
): { readonly x: number; readonly y: number } | undefined {
  if (!("node" in end)) return end;
  const node = nodes.get(end.node);
  return node === undefined ? undefined : sideMiddle(node, end.side);
}

/** What a drawing covers; none for an arrow whose node is gone, which isn't drawn. */
export function canvasInkBounds(
  ink: CanvasInk,
  nodes: Pick<ReadonlyMap<string, CanvasBounds>, "get">,
): CanvasBounds | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  if (ink.type === "stroke") {
    for (let at = 0; at + 1 < ink.points.length; at += 2) {
      xs.push(ink.x + ink.points[at]!);
      ys.push(ink.y + ink.points[at + 1]!);
    }
  } else {
    const from = canvasInkEnd(ink.from, nodes);
    const to = canvasInkEnd(ink.to, nodes);
    if (from === undefined || to === undefined) return undefined;
    xs.push(from.x, to.x);
    ys.push(from.y, to.y);
  }
  if (xs.length === 0) return undefined;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export const isCanvasFile = (file: string): boolean => /\.canvas$/i.test(file);

/** The groups a reader can jump to: those with a label, in the file's order. */
export const canvasGroups = (
  data: Pick<CanvasData, "nodes">,
): ReadonlyArray<{ readonly id: string; readonly label: string }> =>
  data.nodes.flatMap((node) =>
    node.type === "group" && node.label !== undefined ? [{ id: node.id, label: node.label }] : [],
  );

/** One step of a story as the board shows it: its frame, and every card and arrow it lights. */
export interface CanvasStep {
  /** Its own label, else its group's. */
  readonly label?: string;
  readonly note: string;
  /** The group the step is, which the board draws as its frame. */
  readonly group?: string;
  /** Where its name stands above its column, on a lanes board; it draws no frame there. */
  readonly heading?: CanvasBounds;
  /** The box around the step's cards that sit together, or its group's outline. */
  readonly frame: CanvasBounds;
  /** All the step's cards, docked ones included. */
  readonly cards: ReadonlySet<string>;
  readonly arrows: ReadonlySet<string>;
  /**
   * The step's cards that sit away from the rest, and where the step shows them: beside the frame,
   * on the side they really are, so the camera stays close. With where they come from: the step
   * whose frame holds them, counting from 0, else the labelled group they sit in.
   */
  readonly docked: ReadonlyMap<string, CanvasDocked>;
  /** What the camera shows: the frame and the cards docked beside it. */
  readonly bounds: CanvasBounds;
}

export interface CanvasDocked extends CanvasBounds {
  readonly from: number | undefined;
  readonly group: string | undefined;
}

/** Room between a frame and a card docked beside it: clear of the frame's label. */
const DOCK_GAP = 60;
const DOCK_SPACING = 24;

const unionBounds = (a: CanvasBounds, b: CanvasBounds): CanvasBounds => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

/** A story's steps as the board shows them. Empty for a board without that story. */
export function canvasSteps(data: CanvasData, story = 0): ReadonlyArray<CanvasStep> {
  const steps = data.stories?.[story]?.steps ?? [];
  const byId = new Map<string, CanvasNode>();
  for (const node of data.nodes) if (node.type !== "group") byId.set(node.id, node);
  const allGroups = data.nodes.filter((node): node is CanvasGroupNode => node.type === "group");
  const held = new Map<string, ReadonlySet<string>>();
  const heldBy = (group: CanvasGroupNode) => {
    let cards = held.get(group.id);
    if (cards === undefined) {
      cards = new Set(
        [...byId.values()].filter((card) => insideGroup(group, card)).map((card) => card.id),
      );
      held.set(group.id, cards);
    }
    return cards;
  };
  // The group a step is: the one it names, else the smallest holding exactly its cards.
  const groupFor = (step: CanvasStoryStep, nodes: ReadonlyArray<CanvasNode>) => {
    if (step.group !== undefined) return allGroups.find((group) => group.id === step.group);
    if (nodes.length === 0) return undefined;
    let found: CanvasGroupNode | undefined;
    for (const group of allGroups) {
      const cards = heldBy(group);
      if (cards.size !== nodes.length || !nodes.every((node) => cards.has(node.id))) continue;
      if (found === undefined || group.width * group.height < found.width * found.height) {
        found = group;
      }
    }
    return found;
  };
  const framed = steps.map((step) => {
    const named = [...new Set(step.cards)].flatMap((id) => byId.get(id) ?? []);
    const group = groupFor(step, named);
    if (group === undefined) return { step, nodes: named, group, ...canvasStepFrame(named) };
    const inside = heldBy(group);
    const nodes = [...inside].flatMap((id) => byId.get(id) ?? []);
    const { x, y, width, height } = group;
    return { step, nodes, group, frame: { x, y, width, height }, inside };
  });
  const home = (id: string) => {
    const at = framed.findIndex((each) => each.inside.has(id));
    return at === -1 ? undefined : at;
  };
  const groups = data.nodes.filter(
    (node): node is CanvasGroupNode => node.type === "group" && node.label !== undefined,
  );
  // The innermost labelled group a card sits in.
  const groupOf = (card: CanvasNode) => {
    let found: CanvasGroupNode | undefined;
    for (const group of groups) {
      if (!insideGroup(group, card)) continue;
      if (found === undefined || group.width * group.height < found.width * found.height) {
        found = group;
      }
    }
    return found?.label;
  };
  return framed.flatMap(({ step, nodes, group, frame, inside }): CanvasStep[] => {
    if (frame === undefined) return [];
    const { heading } = step;
    let bounds = heading === undefined ? frame : unionBounds(frame, heading);
    const docked = new Map<string, CanvasDocked>();
    const along = { top: frame.x, bottom: frame.x, left: frame.y, right: frame.y };
    // Cards docked on one side keep the order they stand in on the board.
    const away = nodes
      .filter((node) => !inside.has(node.id))
      .map((node) => ({ node, side: canvasArrowSides(frame, node)[0] }))
      .sort((a, b) =>
        a.side === "top" || a.side === "bottom" ? a.node.x - b.node.x : a.node.y - b.node.y,
      );
    for (const { node, side } of away) {
      const { width, height } = node;
      const spot =
        side === "top" || side === "bottom"
          ? {
              x: along[side],
              y: side === "top" ? frame.y - DOCK_GAP - height : frame.y + frame.height + DOCK_GAP,
            }
          : {
              x: side === "left" ? frame.x - DOCK_GAP - width : frame.x + frame.width + DOCK_GAP,
              y: along[side],
            };
      along[side] += (side === "top" || side === "bottom" ? width : height) + DOCK_SPACING;
      const rect = { ...spot, width, height };
      docked.set(node.id, { ...rect, from: home(node.id), group: groupOf(node) });
      bounds = unionBounds(bounds, rect);
    }
    const lit = new Set(nodes.map((node) => node.id));
    const arrows = new Set(
      data.edges
        .filter((edge) => lit.has(edge.fromNode) && lit.has(edge.toNode))
        .map((edge) => edge.id),
    );
    const label = step.label ?? group?.label;
    return [
      {
        ...(label === undefined ? {} : { label }),
        note: step.note,
        ...(group === undefined ? {} : { group: group.id }),
        ...(heading === undefined ? {} : { heading }),
        frame,
        cards: lit,
        arrows,
        docked,
        bounds,
      },
    ];
  });
}

/**
 * The board as a step shows it: its recalled cards moved beside the frame, and the arrows that
 * touch them leaving from the sides that now face each other.
 */
export function canvasStepData(data: CanvasData, step: CanvasStep): CanvasData {
  if (step.docked.size === 0) return data;
  const nodes = data.nodes.map((node) => {
    const spot = step.docked.get(node.id);
    return spot === undefined ? node : { ...node, x: spot.x, y: spot.y };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    ...data,
    nodes,
    edges: data.edges.map((edge) => {
      if (!step.docked.has(edge.fromNode) && !step.docked.has(edge.toNode)) return edge;
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (from === undefined || to === undefined) return edge;
      const [fromSide, toSide] = canvasArrowSides(from, to);
      return { ...edge, fromSide, toSide };
    }),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const number = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const side = (value: unknown) =>
  value === "top" || value === "right" || value === "bottom" || value === "left"
    ? value
    : undefined;
const end = (value: unknown) => (value === "none" || value === "arrow" ? value : undefined);

/** A kept card holds its code on `astrolabe` itself; a thread's board nests it under `code`. */
function codeReference(astrolabe: unknown): CanvasCodeReference | undefined {
  if (!isRecord(astrolabe)) return undefined;
  const value = isRecord(astrolabe.code) ? astrolabe.code : astrolabe;
  if (typeof value.path !== "string") return undefined;
  const { lines } = value;
  const repository = text(value.repository);
  const commit = text(value.commit);
  return {
    path: value.path,
    ...(Array.isArray(lines) && typeof lines[0] === "number" && typeof lines[1] === "number"
      ? { lines: [lines[0], lines[1]] as const }
      : {}),
    ...(repository === undefined ? {} : { repository }),
    ...(commit === undefined ? {} : { commit }),
  };
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const bounds = (value: unknown): CanvasBounds | undefined =>
  isRecord(value) &&
  finite(value.x) &&
  finite(value.y) &&
  finite(value.width) &&
  finite(value.height)
    ? { x: value.x, y: value.y, width: value.width, height: value.height }
    : undefined;

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** A file's stories, each step with a note and a card; whatever else they hold is left out. */
function canvasStories(astrolabe: unknown): ReadonlyArray<CanvasStory> {
  if (!isRecord(astrolabe) || !Array.isArray(astrolabe.stories)) return [];
  return astrolabe.stories.flatMap((story: unknown): CanvasStory[] => {
    if (!isRecord(story) || !Array.isArray(story.steps)) return [];
    const steps = story.steps.flatMap((step: unknown): CanvasStoryStep[] => {
      if (!isRecord(step) || typeof step.note !== "string") return [];
      const cards = strings(step.cards);
      const label = text(step.label);
      const group = text(step.group);
      const heading = bounds(step.heading);
      if (cards.length === 0 && group === undefined) return [];
      return [
        {
          ...(label === undefined ? {} : { label }),
          note: step.note,
          cards,
          ...(group === undefined ? {} : { group }),
          ...(heading === undefined ? {} : { heading }),
        },
      ];
    });
    return steps.length === 0 ? [] : [{ title: text(story.title) ?? "Story", steps }];
  });
}

/** A style as drawn: what it holds that this version can't use is left for the file to keep. */
export function canvasStyle(astrolabe: unknown): CanvasStyle | undefined {
  if (!isRecord(astrolabe) || !isRecord(astrolabe.style)) return undefined;
  const { fill, width, dash, corners, opacity } = astrolabe.style;
  const style: CanvasStyle = {
    ...(typeof fill === "string" && fill !== "" ? { fill } : {}),
    ...(finite(width) && width > 0 && width <= CANVAS_MAX_STYLE_WIDTH ? { width } : {}),
    ...(dash === "solid" || dash === "dashed" || dash === "dotted" ? { dash } : {}),
    ...(corners === "round" || corners === "sharp" ? { corners } : {}),
    ...(finite(opacity) && opacity >= 0 && opacity <= 1 ? { opacity } : {}),
  };
  return Object.keys(style).length === 0 ? undefined : style;
}

const styled = (raw: Record<string, unknown>) => {
  const style = canvasStyle(raw.astrolabe);
  return style === undefined ? {} : { astrolabe: { style } };
};

const shapeOf = (astrolabe: unknown): CanvasShape | undefined =>
  isRecord(astrolabe) && (astrolabe.shape === "ellipse" || astrolabe.shape === "diamond")
    ? astrolabe.shape
    : undefined;

function inkEnd(value: unknown): CanvasInkEnd | undefined {
  if (!isRecord(value)) return undefined;
  const at = side(value.side);
  if (typeof value.node === "string" && at !== undefined) return { node: value.node, side: at };
  return finite(value.x) && finite(value.y) ? { x: value.x, y: value.y } : undefined;
}

/** A drawing as drawn; none for a kind this version doesn't know, which the file keeps. */
function canvasInk(raw: Record<string, unknown>, id: string): CanvasInk | undefined {
  const color = text(raw.color);
  const colored = color === undefined ? {} : { color };
  if (raw.type === "stroke") {
    const { points } = raw;
    if (!finite(raw.x) || !finite(raw.y) || !Array.isArray(points)) return undefined;
    if (points.length < 2 || points.length % 2 !== 0 || !points.every(finite)) return undefined;
    return {
      id,
      type: "stroke",
      x: raw.x,
      y: raw.y,
      points: points as number[],
      ...colored,
      ...styled(raw),
    };
  }
  if (raw.type === "arrow") {
    const from = inkEnd(raw.from);
    const to = inkEnd(raw.to);
    if (from === undefined || to === undefined) return undefined;
    const label = text(raw.label);
    return {
      id,
      type: "arrow",
      from,
      to,
      ...colored,
      ...(label === undefined ? {} : { label }),
      ...styled(raw),
    };
  }
  return undefined;
}

/** The card a node draws as; none for a type this version doesn't know, which Obsidian skips too. */
function canvasNode(raw: Record<string, unknown>, id: string): CanvasNode | undefined {
  const color = text(raw.color);
  const base = {
    id,
    x: number(raw.x, 0),
    y: number(raw.y, 0),
    width: number(raw.width, 100),
    height: number(raw.height, 100),
    ...(color === undefined ? {} : { color }),
  };
  switch (raw.type) {
    case "text": {
      const shape = shapeOf(raw.astrolabe);
      const style = canvasStyle(raw.astrolabe);
      return {
        ...base,
        type: "text",
        text: text(raw.text) ?? "",
        ...(shape === undefined && style === undefined
          ? {}
          : {
              astrolabe: {
                ...(shape === undefined ? {} : { shape }),
                ...(style === undefined ? {} : { style }),
              },
            }),
      };
    }
    case "file": {
      const subpath = text(raw.subpath);
      return {
        ...base,
        type: "file",
        file: text(raw.file) ?? "",
        ...(subpath === undefined ? {} : { subpath }),
        ...styled(raw),
      };
    }
    case "link": {
      const astrolabe = isRecord(raw.astrolabe) ? raw.astrolabe : undefined;
      const caption = text(astrolabe?.caption);
      const code = codeReference(astrolabe);
      const style = canvasStyle(astrolabe);
      return {
        ...base,
        type: "link",
        url: text(raw.url) ?? "",
        ...(caption === undefined && code === undefined && style === undefined
          ? {}
          : {
              astrolabe: {
                ...(caption === undefined ? {} : { caption }),
                ...(code === undefined ? {} : { code }),
                ...(style === undefined ? {} : { style }),
              },
            }),
      };
    }
    case "group": {
      const label = text(raw.label);
      const background = text(raw.background);
      const backgroundStyle = text(raw.backgroundStyle);
      return {
        ...base,
        type: "group",
        ...(label === undefined ? {} : { label }),
        ...(background === undefined ? {} : { background }),
        ...(backgroundStyle === undefined ? {} : { backgroundStyle }),
        ...styled(raw),
      };
    }
    default:
      return undefined;
  }
}

function canvasEdge(raw: Record<string, unknown>, id: string): CanvasEdge | undefined {
  const { fromNode, toNode } = raw;
  if (typeof fromNode !== "string" || typeof toNode !== "string") return undefined;
  const fromSide = side(raw.fromSide);
  const toSide = side(raw.toSide);
  const fromEnd = end(raw.fromEnd);
  const toEnd = end(raw.toEnd);
  const color = text(raw.color);
  const label = text(raw.label);
  return {
    id,
    fromNode,
    toNode,
    ...(fromSide === undefined ? {} : { fromSide }),
    ...(toSide === undefined ? {} : { toSide }),
    ...(fromEnd === undefined ? {} : { fromEnd }),
    ...(toEnd === undefined ? {} : { toEnd }),
    ...(color === undefined ? {} : { color }),
    ...(label === undefined ? {} : { label }),
    ...styled(raw),
  };
}

/** A list's entries by the ids they draw under, unique though a file's may repeat or be missing. */
export function canvasEntries(
  list: unknown,
  prefix: string,
): ReadonlyArray<{ readonly id: string; readonly raw: Record<string, unknown> }> {
  const seen = new Set<string>();
  return (Array.isArray(list) ? list : []).flatMap((raw: unknown, position) => {
    if (!isRecord(raw)) return [];
    const named = typeof raw.id === "string" && raw.id !== "" ? raw.id : `${prefix}-${position}`;
    const id = seen.has(named) ? `${named}~${position}` : named;
    seen.add(id);
    return [{ id, raw }];
  });
}

const drawn = <A>(
  list: unknown,
  prefix: string,
  read: (raw: Record<string, unknown>, id: string) => A | undefined,
): A[] =>
  canvasEntries(list, prefix).flatMap(({ id, raw }) => {
    const item = read(raw, id);
    return item === undefined ? [] : [item];
  });

/** A file's JSON as drawn: every card with what it needs, whatever the file left out. */
export function canvasData(document: unknown): CanvasData {
  if (!isRecord(document)) return { nodes: [], edges: [] };
  const stories = canvasStories(document.astrolabe);
  const nodes = drawn(document.nodes, "node", canvasNode);
  // A drawn arrow on a node that's gone draws nothing and can't be picked, so it isn't the board's.
  const ids = new Set(nodes.map((node) => node.id));
  const onBoard = (end: CanvasInkEnd) => !("node" in end) || ids.has(end.node);
  const drawings = (
    isRecord(document.astrolabe) ? drawn(document.astrolabe.drawings, "drawing", canvasInk) : []
  ).filter((ink) => ink.type !== "arrow" || (onBoard(ink.from) && onBoard(ink.to)));
  return {
    nodes,
    edges: drawn(document.edges, "edge", canvasEdge),
    ...(stories.length === 0 ? {} : { stories }),
    ...(drawings.length === 0 ? {} : { drawings }),
  };
}

/** A board as a file holds it, which `canvasData` reads back. */
export const canvasDocument = (data: CanvasData) => {
  const astrolabe = {
    ...(data.stories === undefined || data.stories.length === 0 ? {} : { stories: data.stories }),
    ...(data.drawings === undefined || data.drawings.length === 0
      ? {}
      : { drawings: data.drawings }),
  };
  return {
    nodes: data.nodes,
    edges: data.edges,
    ...(Object.keys(astrolabe).length === 0 ? {} : { astrolabe }),
  };
};

export type ParsedCanvas =
  | {
      readonly ok: true;
      /** The file as read. It alone is what writes back: `data` drops what doesn't draw. */
      readonly document: unknown;
      readonly data: CanvasData;
    }
  | { readonly ok: false; readonly error: string };

/** Reads a canvas as Obsidian opens one: only text that isn't JSON at all is refused. */
export function parseCanvas(source: string): ParsedCanvas {
  if (source.trim() === "") return { ok: true, document: {}, data: { nodes: [], edges: [] } };
  try {
    const document: unknown = JSON.parse(source);
    return { ok: true, document, data: canvasData(document) };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

const isContainer = (value: unknown) => typeof value === "object" && value !== null;

function written(value: unknown, depth: number): string {
  if (!isContainer(value)) return JSON.stringify(value) ?? "null";
  const entries: ReadonlyArray<readonly [string | null, unknown]> = Array.isArray(value)
    ? value.map((item: unknown) => [null, item] as const)
    : Object.entries(value as object).filter(([, item]) => item !== undefined);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (!entries.some(([, item]) => isContainer(item))) return JSON.stringify(value);
  const indent = "\t".repeat(depth + 1);
  const lines = entries.map(
    ([name, item]) =>
      `${indent}${name === null ? "" : `${JSON.stringify(name)}:`}${written(item, depth + 1)}`,
  );
  return `${open}\n${lines.join(",\n")}\n${"\t".repeat(depth)}${close}`;
}

/**
 * The bytes Obsidian writes for a canvas: tabs, LF, no spaces, no final newline. A container sits
 * on one line only when everything in it is a scalar; an empty `{}` or `[]` counts as a container.
 */
export const serializeCanvas = (document: unknown): string => written(document, 0);

/** How looks name a card's, arrow's or drawing's `astrolabe.style`. */
export const STYLE_KEY = "astrolabe.style";

/** What a look's keys do to a card or arrow: anything not named here is what it says. */
export interface CanvasLook {
  /** As a merge's preview names it, such as "position". */
  readonly name: string;
  readonly keys: ReadonlyArray<string>;
  readonly mark: "moved" | "restyled";
}

export const CANVAS_CARD_LOOKS: ReadonlyArray<CanvasLook> = [
  { name: "position", keys: ["x", "y"], mark: "moved" },
  { name: "size", keys: ["width", "height"], mark: "moved" },
  { name: "colour", keys: ["color"], mark: "restyled" },
  { name: "background", keys: ["background", "backgroundStyle"], mark: "restyled" },
  { name: "style", keys: [STYLE_KEY], mark: "restyled" },
];

export const CANVAS_ARROW_LOOKS: ReadonlyArray<CanvasLook> = [
  { name: "sides", keys: ["fromSide", "toSide"], mark: "moved" },
  { name: "colour", keys: ["color"], mark: "restyled" },
  { name: "ends", keys: ["fromEnd", "toEnd"], mark: "restyled" },
  { name: "style", keys: [STYLE_KEY], mark: "restyled" },
];

/** A stroke's points and a drawn arrow's label are what it says; the rest is where and how. */
export const CANVAS_DRAWING_LOOKS: ReadonlyArray<CanvasLook> = [
  { name: "position", keys: ["x", "y"], mark: "moved" },
  { name: "ends", keys: ["from", "to"], mark: "moved" },
  { name: "colour", keys: ["color"], mark: "restyled" },
  { name: "style", keys: [STYLE_KEY], mark: "restyled" },
];

/**
 * `raw` with `astrolabe.style` as a key of its own, as looks name it, so a style that changed
 * reads as restyled while the rest of `astrolabe` (a shape, a code card's code) still says.
 */
export function canvasLookKeys(raw: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(raw.astrolabe) || !("style" in raw.astrolabe)) return raw;
  const { style, ...astrolabe } = raw.astrolabe;
  return {
    ...raw,
    astrolabe: Object.keys(astrolabe).length === 0 ? undefined : astrolabe,
    [STYLE_KEY]: style,
  };
}

/** What `canvasLookKeys` lifted, back where the file keeps it. */
export function canvasLookRaw(raw: Record<string, unknown>): Record<string, unknown> {
  if (!(STYLE_KEY in raw)) return raw;
  const { [STYLE_KEY]: style, ...rest } = raw;
  if (style === undefined) return rest;
  const astrolabe = isRecord(rest.astrolabe) ? rest.astrolabe : {};
  return { ...rest, astrolabe: { ...astrolabe, style } };
}

/** A file's drawings, the same way `canvasData` reads them. */
export const canvasDrawingEntries = (document: unknown) =>
  canvasEntries(
    isRecord(document) && isRecord(document.astrolabe) ? document.astrolabe.drawings : undefined,
    "drawing",
  );

/** Same JSON, whatever order its keys were written in. */
const sorted = (_key: string, value: unknown) =>
  isRecord(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : value;
export const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a, sorted) === JSON.stringify(b, sorted);

/** What a change does, strongest first. A moved or resized card alone is `moved`. */
export type CanvasMark = "added" | "removed" | "text" | "restyled" | "moved";

export interface CanvasChange {
  readonly id: string;
  readonly item: "card" | "arrow" | "drawing";
  /** The strongest thing that happened to it. */
  readonly mark: CanvasMark;
  /** What else did, so a card can read as changed and moved. */
  readonly also: ReadonlyArray<"restyled" | "moved">;
  /** How a person would name it. */
  readonly name: string;
  /** What it said before, when that's what changed. */
  readonly was: string | null;
}

export interface CanvasDiff {
  readonly changes: ReadonlyArray<CanvasChange>;
  /** Something outside the cards, arrows and drawings changed, which only the file's JSON shows. */
  readonly rest: boolean;
}

const NAME_CHARS = 60;

/** A line as it reads, without the marks that format it. */
const plainLine = (line: string): string =>
  line
    .replace(
      /!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g,
      (_, target: string, alias?: string) => alias ?? target,
    )
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==|`)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?![\w*])/g, "$1$2");

function brief(text: string): string {
  const line = plainLine(
    text
      .trim()
      .split("\n", 1)[0]
      ?.replace(/^#+\s*/, "")
      .trim() ?? "",
  );
  return line.length > NAME_CHARS ? `${line.slice(0, NAME_CHARS - 1)}…` : line;
}

const lastPart = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A card as a person would name it, for a change list or a merge's preview. */
export function canvasCardName(card: Readonly<Record<string, unknown>>): string {
  const code = codeReference(card.astrolabe);
  const named =
    card.type === "text"
      ? brief(text(card.text) ?? "")
      : card.type === "file"
        ? `${lastPart(text(card.file) ?? "")}${text(card.subpath) ?? ""}`
        : card.type === "link"
          ? (code?.path ?? text(card.url) ?? "")
          : card.type === "group"
            ? (text(card.label) ?? "")
            : "";
  if (named !== "") return named;
  if (card.type === "group") return "Unlabelled group";
  return card.type === "text" ? "Empty card" : `${text(card.type) ?? "Unknown"} card`;
}

/** The name of an arrow, from cards read from any version that held them. */
export function canvasArrowName(
  arrow: Readonly<Record<string, unknown>>,
  cardName: (id: unknown) => string,
): string {
  const label = text(arrow.label);
  const line = `${cardName(arrow.fromNode)} → ${cardName(arrow.toNode)}`;
  return label === undefined || label === "" ? line : `${line}: ${label}`;
}

/** A drawing as a person would name it: a drawn arrow by the cards it touches. */
export function canvasDrawingName(
  drawing: Readonly<Record<string, unknown>>,
  cardName: (id: unknown) => string,
): string {
  if (drawing.type !== "arrow") {
    return drawing.type === "stroke" ? "Drawing" : `${text(drawing.type) ?? "Unknown"} drawing`;
  }
  const end = (value: unknown) =>
    isRecord(value) && typeof value.node === "string" ? cardName(value.node) : undefined;
  const from = end(drawing.from);
  const to = end(drawing.to);
  const line =
    from === undefined && to === undefined
      ? "Drawn arrow"
      : `${from ?? "A point"} → ${to ?? "a point"}`;
  const label = text(drawing.label);
  return label === undefined || label === "" ? line : `${line}: ${label}`;
}

/** The first line that differs, as it read before. */
function wasLine(before: string, after: string) {
  const lines = after.split("\n");
  return before.split("\n").find((line, position) => line !== lines[position]) ?? before;
}

function wasText(before: Record<string, unknown>, after: Record<string, unknown>) {
  for (const key of ["text", "file", "url", "label"]) {
    const was = before[key];
    if (sameJson(was, after[key])) continue;
    if (typeof was !== "string") return "empty";
    return brief(typeof after[key] === "string" ? wasLine(was, after[key]) : was) || "empty";
  }
  return null;
}

function changeOf(
  beforeRaw: Record<string, unknown>,
  afterRaw: Record<string, unknown>,
  looks: ReadonlyArray<CanvasLook>,
): Pick<CanvasChange, "mark" | "also"> | null {
  const before = canvasLookKeys(beforeRaw);
  const after = canvasLookKeys(afterRaw);
  const differs = (key: string) => !sameJson(before[key], after[key]);
  const looked = new Set(looks.flatMap((look) => look.keys));
  const said = [...new Set([...Object.keys(before), ...Object.keys(after)])].some(
    (key) => !looked.has(key) && differs(key),
  );
  const marks = looks.filter((look) => look.keys.some(differs)).map((look) => look.mark);
  const restyled = marks.includes("restyled");
  const moved = marks.includes("moved");
  if (said) {
    return {
      mark: "text",
      also: [...(restyled ? (["restyled"] as const) : []), ...(moved ? (["moved"] as const) : [])],
    };
  }
  if (restyled) return { mark: "restyled", also: moved ? ["moved"] : [] };
  return moved ? { mark: "moved", also: [] } : null;
}

/**
 * Two versions of a file's document, compared card by card and arrow by arrow. It reads the JSON
 * and not what draws, so a key or card type this version can't show still counts as a change.
 */
export function diffCanvas(before: unknown, after: unknown): CanvasDiff {
  const was = isRecord(before) ? before : {};
  const now = isRecord(after) ? after : {};
  const cards = [canvasEntries(was.nodes, "node"), canvasEntries(now.nodes, "node")] as const;
  const arrows = [canvasEntries(was.edges, "edge"), canvasEntries(now.edges, "edge")] as const;
  const drawings = [canvasDrawingEntries(was), canvasDrawingEntries(now)] as const;
  const names = new Map([...cards[0], ...cards[1]].map(({ id, raw }) => [id, raw]));
  const cardName = (id: unknown) => {
    const card = typeof id === "string" ? names.get(id) : undefined;
    return card === undefined ? "A missing card" : canvasCardName(card);
  };
  const compare = (
    item: CanvasChange["item"],
    [from, to]: readonly [ReturnType<typeof canvasEntries>, ReturnType<typeof canvasEntries>],
    looks: ReadonlyArray<CanvasLook>,
  ): CanvasChange[] => {
    const name = (raw: Record<string, unknown>) =>
      item === "card"
        ? canvasCardName(raw)
        : item === "arrow"
          ? canvasArrowName(raw, cardName)
          : canvasDrawingName(raw, cardName);
    const earlier = new Map(from.map(({ id, raw }) => [id, raw]));
    const later = new Set(to.map(({ id }) => id));
    return [
      ...to.flatMap(({ id, raw }): CanvasChange[] => {
        const old = earlier.get(id);
        if (old === undefined) {
          return [{ id, item, mark: "added", also: [], name: name(raw), was: null }];
        }
        const change = changeOf(old, raw, looks);
        if (change === null) return [];
        const said = change.mark === "text" ? wasText(old, raw) : null;
        return [{ id, item, ...change, name: name(raw), was: said }];
      }),
      ...from.flatMap(({ id, raw }): CanvasChange[] =>
        later.has(id) ? [] : [{ id, item, mark: "removed", also: [], name: name(raw), was: null }],
      ),
    ];
  };
  const outside = (document: Record<string, unknown>) => {
    const { drawings: _drawings, ...astrolabe } = isRecord(document.astrolabe)
      ? document.astrolabe
      : {};
    return {
      ...document,
      nodes: undefined,
      edges: undefined,
      astrolabe:
        isRecord(document.astrolabe) && Object.keys(astrolabe).length === 0
          ? undefined
          : isRecord(document.astrolabe)
            ? astrolabe
            : document.astrolabe,
    };
  };
  return {
    changes: [
      ...compare("card", cards, CANVAS_CARD_LOOKS),
      ...compare("arrow", arrows, CANVAS_ARROW_LOOKS),
      ...compare("drawing", drawings, CANVAS_DRAWING_LOOKS),
    ],
    rest: !sameJson(outside(was), outside(now)),
  };
}

/** The cards still on the board that changed between two versions: what to catch the eye. */
export const canvasChangedCards = (before: CanvasData, after: CanvasData): ReadonlySet<string> =>
  new Set(
    diffCanvas(before, after)
      .changes.filter((change) => change.item === "card" && change.mark !== "removed")
      .map((change) => change.id),
  );

/** Which cards, arrows and drawings a board marks, by id: kinds may share an id. */
export interface CanvasMarks {
  readonly cards: Readonly<Record<string, CanvasMark>>;
  readonly arrows: Readonly<Record<string, CanvasMark>>;
  readonly drawings?: Readonly<Record<string, CanvasMark>>;
}

/** A board for reviewing a change: the new version, with what it removed still drawn. */
export interface CanvasReview {
  readonly data: CanvasData;
  readonly marks: CanvasMarks;
  /** `drawn` is false for what the board can't show, such as a card type it doesn't know. */
  readonly changes: ReadonlyArray<CanvasChange & { readonly drawn: boolean }>;
  readonly rest: boolean;
}

/** Two versions of a file's document as one board to review. */
export function reviewCanvas(before: unknown, after: unknown): CanvasReview {
  const { changes, rest } = diffCanvas(before, after);
  const was = canvasData(before);
  const now = canvasData(after);
  const marked = (item: CanvasChange["item"]) =>
    Object.fromEntries(
      changes.filter((change) => change.item === item).map(({ id, mark }) => [id, mark]),
    );
  const marks = { cards: marked("card"), arrows: marked("arrow"), drawings: marked("drawing") };
  // Beneath the rest: what replaced a removed card stays on top until the removed one is picked.
  const nodes = [...was.nodes.filter((node) => marks.cards[node.id] === "removed"), ...now.nodes];
  const edges = [...now.edges, ...was.edges.filter((edge) => marks.arrows[edge.id] === "removed")];
  const drawings = [
    ...(now.drawings ?? []),
    ...(was.drawings ?? []).filter((ink) => marks.drawings[ink.id] === "removed"),
  ];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const drawnArrows = new Set(
    edges.filter((edge) => byId.has(edge.fromNode) && byId.has(edge.toNode)).map((edge) => edge.id),
  );
  const drawnInks = new Set(
    drawings.filter((ink) => canvasInkBounds(ink, byId) !== undefined).map((ink) => ink.id),
  );
  const drawn = { card: byId, arrow: drawnArrows, drawing: drawnInks };
  return {
    data: {
      nodes,
      edges,
      ...(drawings.length === 0 ? {} : { drawings }),
    },
    marks,
    changes: changes.map((change) => ({ ...change, drawn: drawn[change.item].has(change.id) })),
    rest,
  };
}

/** A change request's two versions of a file to review; either is null when it isn't there. */
export function reviewCanvasFiles(
  before: string | null,
  after: string | null,
): CanvasReview | { readonly invalid: string } {
  const was = parseCanvas(before ?? "");
  if (!was.ok) return { invalid: `The version before this change isn't valid JSON: ${was.error}` };
  const now = parseCanvas(after ?? "");
  if (!now.ok) return { invalid: `This change's version isn't valid JSON: ${now.error}` };
  return reviewCanvas(was.document, now.document);
}

const MARK_ORDER: ReadonlyArray<CanvasMark> = ["added", "removed", "text", "restyled", "moved"];

const MARK_WORDS: Readonly<Record<CanvasMark, string>> = {
  added: "added",
  removed: "removed",
  text: "changed",
  restyled: "restyled",
  moved: "moved",
};

/** A change's mark in a list or on a card, capitalised for a label. */
export const CANVAS_MARK_LABELS: Readonly<Record<CanvasMark, string>> = {
  added: "Added",
  removed: "Removed",
  text: "Text",
  restyled: "Style",
  moved: "Moved",
};

/** A change list's rows: what to read first, and the moves, folded until asked for. */
export function canvasChangeSections<A extends Pick<CanvasChange, "mark">>(
  changes: ReadonlyArray<A>,
): { readonly changed: ReadonlyArray<A>; readonly moved: ReadonlyArray<A> } {
  return {
    changed: MARK_ORDER.flatMap((mark) =>
      mark === "moved" ? [] : changes.filter((change) => change.mark === mark),
    ),
    moved: changes.filter((change) => change.mark === "moved"),
  };
}

/** A change list in one line, such as "2 added, 1 changed, 4 moved". */
export function canvasChangeSummary(changes: ReadonlyArray<Pick<CanvasChange, "mark">>): string {
  const counts = MARK_ORDER.flatMap((mark) => {
    const count = changes.filter((change) => change.mark === mark).length;
    return count === 0 ? [] : [`${count} ${MARK_WORDS[mark]}`];
  });
  return counts.length > 0 ? counts.join(", ") : "No changes to its cards, arrows or drawings";
}
