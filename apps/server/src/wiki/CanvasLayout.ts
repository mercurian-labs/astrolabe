/**
 * Astrolabe: where a drawn canvas's cards go, decided once on the server when the agent draws it.
 * Flows, trees, radial boards and maps are laid out by ELK (Eclipse Layout Kernel, used under
 * EPL-2.0, unmodified); lanes and story boards by `placeCanvas`, which needs no engine.
 */
import {
  CANVAS_GROUP_INSET,
  canvasCardBox,
  canvasFromRects,
  canvasLayoutKind,
  canvasStoryOrder,
  placeCanvas,
  type CanvasBounds,
  type CanvasData,
  type CanvasDrawing,
} from "@mercurian/wiki/canvas";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  ELK,
  ELKConstructorArguments,
  ElkExtendedEdge,
  ElkNode,
  LayoutOptions,
} from "elkjs/lib/elk-api.js";

/** The engine's graph around the board: named so no card's id can be it. */
const ROOT = "\u0000board";

/** Boards are read in a chat column: a flow runs whichever way lands nearest this shape. */
const TARGET_ASPECT = 1.6;

const SPACING: LayoutOptions = {
  "elk.spacing.nodeNode": "32",
  "elk.layered.spacing.nodeNodeBetweenLayers": "100",
  "elk.spacing.edgeLabel": "8",
};

const GROUP_PADDING = `[top=${CANVAS_GROUP_INSET.top},left=${CANVAS_GROUP_INSET.side},bottom=${CANVAS_GROUP_INSET.side},right=${CANVAS_GROUP_INSET.side}]`;

type ElkConstructor = new (args?: ELKConstructorArguments) => ELK;

// The engine is a large script: loaded the first time a board needs it, then kept. It's a
// CommonJS module, whose class Node hands over as the default and some bundlers nest once more.
let engine: Promise<ELK> | undefined;
const loadEngine = () =>
  (engine ??= import("elkjs/lib/elk.bundled.js").then((module) => {
    const exported: unknown = module.default;
    const Elk = (
      typeof exported === "function" ? exported : (exported as { default: unknown }).default
    ) as ElkConstructor;
    return new Elk();
  }));

type Card = CanvasDrawing["cards"][number];

const node = (card: Card): ElkNode => {
  const { width, height } = canvasCardBox(card);
  return { id: card.id, width, height };
};

/** An arrow's label takes room between the cards it joins, so the engine leaves that room. */
const edge = (arrow: NonNullable<CanvasDrawing["arrows"]>[number], index: number) => ({
  id: `arrow-${index}`,
  sources: [arrow.from],
  targets: [arrow.to],
  ...(arrow.label === undefined
    ? {}
    : { labels: [{ text: arrow.label, width: arrow.label.length * 7 + 16, height: 20 }] }),
});

/** Where everything landed, children placed relative to their parents. */
function rectsOf(root: ElkNode): Map<string, CanvasBounds> {
  const rects = new Map<string, CanvasBounds>();
  const visit = (each: ElkNode, offsetX: number, offsetY: number) => {
    const x = offsetX + (each.x ?? 0);
    const y = offsetY + (each.y ?? 0);
    if (each.id !== ROOT) {
      rects.set(each.id, {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(each.width ?? 0),
        height: Math.round(each.height ?? 0),
      });
    }
    for (const child of each.children ?? []) visit(child, x, y);
  };
  visit(root, 0, 0);
  return rects;
}

const shapeMiss = (rects: ReadonlyMap<string, CanvasBounds>) => {
  let right = 0;
  let bottom = 0;
  for (const rect of rects.values()) {
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return Math.abs(Math.log(right / Math.max(1, bottom) / TARGET_ASPECT));
};

/** A flow: ranked along its arrows, groups drawn around their cards, crossings kept few. */
function flowGraph(drawing: CanvasDrawing, direction: "RIGHT" | "DOWN"): ElkNode {
  const grouped = new Set((drawing.groups ?? []).map((group) => group.id));
  return {
    id: ROOT,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.edgeLabels.placement": "CENTER",
      ...SPACING,
    },
    children: [
      ...(drawing.groups ?? []).map((group): ElkNode => ({
        id: group.id,
        layoutOptions: { "elk.padding": GROUP_PADDING },
        children: drawing.cards.filter((card) => card.group === group.id).map(node),
      })),
      ...drawing.cards
        .filter((card) => card.group === undefined || !grouped.has(card.group))
        .map(node),
    ],
    edges: (drawing.arrows ?? []).map(edge),
  };
}

/** A map: each group laid out on its own, then the groups and loose cards packed side by side. */
function mapGraph(drawing: CanvasDrawing): ElkNode {
  const groupOf = new Map(drawing.cards.map((card) => [card.id, card.group]));
  const grouped = new Set((drawing.groups ?? []).map((group) => group.id));
  const arrows = (drawing.arrows ?? []).map(edge);
  const within = (group: string) =>
    arrows.filter(
      (each) =>
        groupOf.get(each.sources[0] ?? "") === group &&
        groupOf.get(each.targets[0] ?? "") === group,
    );
  return {
    id: ROOT,
    layoutOptions: {
      "elk.algorithm": "rectpacking",
      "elk.aspectRatio": String(TARGET_ASPECT),
      "elk.spacing.nodeNode": "48",
    },
    children: [
      ...(drawing.groups ?? []).map((group): ElkNode => ({
        id: group.id,
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "DOWN",
          "elk.padding": GROUP_PADDING,
          ...SPACING,
        },
        children: drawing.cards.filter((card) => card.group === group.id).map(node),
        edges: within(group.id),
      })),
      ...drawing.cards
        .filter((card) => card.group === undefined || !grouped.has(card.group))
        .map(node),
    ],
  };
}

/**
 * The arrows a tree keeps: each card reached once, from its parents, in the drawing's order. A
 * card nothing points at starts a tree of its own; the other arrows still draw.
 */
function spanningEdges(
  drawing: CanvasDrawing,
  roots: ReadonlyArray<string>,
  undirected: boolean,
): ElkExtendedEdge[] {
  const arrows = drawing.arrows ?? [];
  const cards = new Set(drawing.cards.map((card) => card.id));
  const reached = new Set<string>();
  const edges: ElkExtendedEdge[] = [];
  const grow = (start: string) => {
    if (reached.has(start)) return;
    reached.add(start);
    const queue = [start];
    while (queue.length > 0) {
      const from = queue.shift()!;
      for (const arrow of arrows) {
        const to =
          arrow.from === from ? arrow.to : undirected && arrow.to === from ? arrow.from : null;
        if (to === null || !cards.has(to) || reached.has(to)) continue;
        reached.add(to);
        edges.push({ id: `tree-${edges.length}`, sources: [from], targets: [to] });
        queue.push(to);
      }
    }
  };
  for (const root of roots) grow(root);
  for (const card of drawing.cards) grow(card.id);
  return edges;
}

function treeGraph(drawing: CanvasDrawing, direction: "RIGHT" | "DOWN"): ElkNode {
  const pointedAt = new Set((drawing.arrows ?? []).map((arrow) => arrow.to));
  const roots = drawing.cards.filter((card) => !pointedAt.has(card.id)).map((card) => card.id);
  return {
    id: ROOT,
    layoutOptions: {
      "elk.algorithm": "mrtree",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "40",
    },
    children: drawing.cards.map(node),
    edges: spanningEdges(drawing, roots, false),
  };
}

/** A radial board circles its center: the card it names, or the one with the most arrows. */
function radialGraph(drawing: CanvasDrawing): ElkNode {
  const degree = new Map<string, number>();
  for (const arrow of drawing.arrows ?? []) {
    for (const id of [arrow.from, arrow.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  }
  const busiest = drawing.cards.reduce<Card | undefined>(
    (best, card) =>
      best === undefined || (degree.get(card.id) ?? 0) > (degree.get(best.id) ?? 0) ? card : best,
    undefined,
  );
  const center = drawing.layout?.center ?? busiest?.id;
  const edges = spanningEdges(drawing, center === undefined ? [] : [center], true);
  // Cards the center can't reach hang off it, so the radial engine sees one tree.
  const reached = new Set([center, ...edges.map((each) => each.targets[0])]);
  for (const card of drawing.cards) {
    if (center === undefined || reached.has(card.id)) continue;
    const startsTree = !edges.some((each) => each.targets[0] === card.id);
    if (startsTree)
      edges.push({ id: `tree-${edges.length}`, sources: [center], targets: [card.id] });
  }
  return {
    id: ROOT,
    layoutOptions: { "elk.algorithm": "radial", "elk.spacing.nodeNode": "40" },
    children: drawing.cards.map(node),
    edges,
  };
}

class CanvasLayoutError extends Schema.TaggedError<CanvasLayoutError>()("CanvasLayoutError", {
  message: Schema.String,
}) {}

const run = (graph: ElkNode) =>
  Effect.tryPromise({
    try: () => loadEngine().then((elk) => elk.layout(graph)),
    catch: (cause) => new CanvasLayoutError({ message: String(cause) }),
  }).pipe(Effect.map(rectsOf));

/**
 * Lays a drawing out as its layout kind asks, or as its contents suggest. A layout the engine
 * can't do falls back to `placeCanvas`, so a board always draws.
 */
export const layoutCanvas = Effect.fn("CanvasLayout.layout")(function* (
  drawn: CanvasDrawing,
): Effect.fn.Return<CanvasData> {
  const drawing = canvasStoryOrder(drawn);
  const kind = canvasLayoutKind(drawing);
  const asked = drawing.layout?.direction;
  const direction = asked === "down" ? "DOWN" : "RIGHT";
  const rects =
    kind === "flow"
      ? asked !== undefined
        ? run(flowGraph(drawing, direction))
        : Effect.all([run(flowGraph(drawing, "RIGHT")), run(flowGraph(drawing, "DOWN"))]).pipe(
            Effect.map(([across, down]) => (shapeMiss(down) < shapeMiss(across) ? down : across)),
          )
      : kind === "map"
        ? run(mapGraph(drawing))
        : kind === "tree"
          ? run(treeGraph(drawing, asked === "right" ? "RIGHT" : "DOWN"))
          : kind === "radial"
            ? run(radialGraph(drawing))
            : undefined;
  if (rects === undefined) return placeCanvas(drawing);
  return yield* rects.pipe(
    Effect.map((placed) => canvasFromRects(drawing, placed)),
    Effect.catch((error) =>
      Effect.logWarning("ELK couldn't lay out a canvas; placing it without the engine", {
        kind,
        error: error.message,
      }).pipe(Effect.as(placeCanvas(drawing))),
    ),
  );
});
