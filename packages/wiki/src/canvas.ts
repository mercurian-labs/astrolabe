/**
 * JSON Canvas (https://jsoncanvas.org/spec/1.0/), and how a drawing with no coordinates becomes
 * one. This file is what clients import: it must stay free of the wiki's parsers.
 */

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

export interface CanvasTextNode extends CanvasNodeBase {
  readonly type: "text";
  readonly text: string;
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
  readonly astrolabe?: { readonly caption?: string; readonly code?: CanvasCodeReference };
}

export interface CanvasGroupNode extends CanvasNodeBase {
  readonly type: "group";
  readonly label?: string;
}

export type CanvasNode = CanvasTextNode | CanvasLinkNode | CanvasGroupNode;

export interface CanvasEdge {
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

export interface CanvasData {
  /** Earlier nodes draw beneath later ones. */
  readonly nodes: ReadonlyArray<CanvasNode>;
  readonly edges: ReadonlyArray<CanvasEdge>;
}

export interface CanvasBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function canvasBounds(data: Pick<CanvasData, "nodes">): CanvasBounds {
  if (data.nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...data.nodes.map((node) => node.x));
  const top = Math.min(...data.nodes.map((node) => node.y));
  const right = Math.max(...data.nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...data.nodes.map((node) => node.y + node.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A diagram as an agent describes it: what is on it, never where. */
export interface CanvasDrawing {
  readonly cards: ReadonlyArray<{
    readonly id: string;
    readonly text?: string | undefined;
    readonly url?: string | undefined;
    readonly path?: string | undefined;
    readonly line?: number | undefined;
    readonly endLine?: number | undefined;
    readonly group?: string | undefined;
    readonly color?: string | undefined;
  }>;
  readonly arrows?:
    | ReadonlyArray<{
        readonly from: string;
        readonly to: string;
        readonly label?: string | undefined;
        readonly ends?: "end" | "both" | "none" | undefined;
        readonly color?: string | undefined;
      }>
    | undefined;
  readonly groups?:
    | ReadonlyArray<{
        readonly id: string;
        readonly label?: string | undefined;
        readonly color?: string | undefined;
      }>
    | undefined;
}

const PRESETS: Readonly<Record<string, string>> = {
  red: "1",
  orange: "2",
  yellow: "3",
  green: "4",
  cyan: "5",
  purple: "6",
};

const GRID = 20;
const RANK_GAP = 140;
const CROSS_GAP = 40;
const GROUP_PADDING = 40;
const GROUP_LABEL = 40;
/** Boards are read in a chat column, so the layout that lands nearest this shape wins. */
const TARGET_ASPECT = 1.6;

const snap = (value: number) => Math.ceil(value / GRID) * GRID;

interface Box {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

interface Link {
  readonly from: string;
  readonly to: string;
}

interface Placed {
  readonly x: number;
  readonly y: number;
}

/** Wrapped lines by character count: this runs where no text can be measured. */
function textHeight(text: string, width: number): number {
  const perLine = Math.max(1, Math.floor((width - 32) / 7.5));
  let height = 0;
  for (const line of text.split("\n")) {
    height += Math.max(1, Math.ceil(line.length / perLine)) * 22;
    if (/^#{1,6} /.test(line)) height += 10;
  }
  return height;
}

function cardBox(card: CanvasDrawing["cards"][number]): Box {
  const text = card.text ?? "";
  if (card.path !== undefined || card.url !== undefined) {
    const width = 300;
    return { id: card.id, width, height: snap(60 + (text ? textHeight(text, width) : 0)) };
  }
  const width = text.length <= 40 ? 200 : text.length <= 160 ? 280 : 360;
  return { id: card.id, width, height: snap(40 + textHeight(text, width)) };
}

/** Which links run forward: a depth-first walk drops the ones that would close a cycle. */
function acyclic(boxes: ReadonlyArray<Box>, links: ReadonlyArray<Link>): Link[] {
  const outgoing = new Map<string, Link[]>();
  for (const link of links) {
    outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link]);
  }
  const state = new Map<string, "open" | "done">();
  const kept: Link[] = [];
  const visit = (id: string) => {
    state.set(id, "open");
    for (const link of outgoing.get(id) ?? []) {
      const seen = state.get(link.to);
      if (seen === "open") continue;
      kept.push(link);
      if (seen === undefined) visit(link.to);
    }
    state.set(id, "done");
  };
  for (const box of boxes) if (!state.has(box.id)) visit(box.id);
  return kept;
}

/** Boxes in columns by longest path, each column ordered by where its neighbours sit. */
function ranks(boxes: ReadonlyArray<Box>, links: ReadonlyArray<Link>): Box[][] {
  const forward = acyclic(boxes, links);
  const rank = new Map(boxes.map((box) => [box.id, 0]));
  for (let pass = 0; pass < boxes.length; pass++) {
    let moved = false;
    for (const { from, to } of forward) {
      const next = (rank.get(from) ?? 0) + 1;
      if (next > (rank.get(to) ?? 0)) {
        rank.set(to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const columns: Box[][] = [];
  for (const box of boxes) {
    const column = rank.get(box.id) ?? 0;
    (columns[column] ??= []).push(box);
  }
  const dense = columns.filter((column) => column.length > 0);
  const position = new Map<string, number>();
  const record = () => {
    for (const column of dense) column.forEach((box, index) => position.set(box.id, index));
  };
  record();
  const neighbours = (id: string) =>
    forward.flatMap((link) => (link.from === id ? [link.to] : link.to === id ? [link.from] : []));
  const centre = (box: Box) => {
    const around = neighbours(box.id).flatMap((id) => {
      const at = position.get(id);
      return at === undefined ? [] : [at];
    });
    return around.length === 0
      ? (position.get(box.id) ?? 0)
      : around.reduce((sum, at) => sum + at, 0) / around.length;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = sweep % 2 === 0 ? dense : dense.toReversed();
    for (const column of order) {
      // toSorted is stable: boxes that tie keep the order the agent wrote them in.
      const sorted = column
        .map((box) => ({ box, at: centre(box) }))
        .toSorted((a, b) => a.at - b.at)
        .map(({ box }) => box);
      column.splice(0, column.length, ...sorted);
      record();
    }
  }
  return dense;
}

function stacked(columns: ReadonlyArray<ReadonlyArray<Box>>, across: boolean) {
  const main = (box: Box) => (across ? box.width : box.height);
  const cross = (box: Box) => (across ? box.height : box.width);
  const length = (column: ReadonlyArray<Box>) =>
    column.reduce((sum, box) => sum + cross(box), 0) + CROSS_GAP * (column.length - 1);
  const longest = Math.max(...columns.map(length));
  const placed = new Map<string, Placed>();
  let along = 0;
  for (const column of columns) {
    let offset = snap((longest - length(column)) / 2);
    for (const box of column) {
      placed.set(box.id, across ? { x: along, y: offset } : { x: offset, y: along });
      offset += cross(box) + CROSS_GAP;
    }
    along += Math.max(...column.map(main)) + RANK_GAP;
  }
  return { placed, main: along - RANK_GAP, cross: longest };
}

function grid(boxes: ReadonlyArray<Box>, top: number, placed: Map<string, Placed>) {
  const columns = Math.ceil(Math.sqrt(boxes.length * TARGET_ASPECT));
  let x = 0;
  let y = top;
  let rowHeight = 0;
  boxes.forEach((box, index) => {
    if (index > 0 && index % columns === 0) {
      x = 0;
      y += rowHeight + CROSS_GAP;
      rowHeight = 0;
    }
    placed.set(box.id, { x, y });
    x += box.width + CROSS_GAP;
    rowHeight = Math.max(rowHeight, box.height);
  });
  return y + rowHeight;
}

/** The size and positions of boxes laid out together, top-left at the origin. */
function arrange(boxes: ReadonlyArray<Box>, links: ReadonlyArray<Link>) {
  const linked = new Set(links.flatMap((link) => [link.from, link.to]));
  const flowing = boxes.filter((box) => linked.has(box.id));
  const loose = boxes.filter((box) => !linked.has(box.id));
  const columns = ranks(flowing, links);
  const across = columns.length > 0 ? stacked(columns, true) : null;
  const down = columns.length > 0 ? stacked(columns, false) : null;
  const miss = (width: number, height: number) =>
    Math.abs(Math.log(width / height / TARGET_ASPECT));
  const chosen =
    across === null || down === null
      ? null
      : miss(down.cross, down.main) < miss(across.main, across.cross)
        ? { placed: down.placed, width: down.cross, height: down.main }
        : { placed: across.placed, width: across.main, height: across.cross };
  const placed = new Map(chosen?.placed ?? []);
  const top = chosen === null ? 0 : chosen.height + CROSS_GAP * 2;
  const bottom = loose.length > 0 ? grid(loose, top, placed) : (chosen?.height ?? 0);
  const right = Math.max(
    ...boxes.map((box) => (placed.get(box.id)?.x ?? 0) + box.width),
    chosen?.width ?? 0,
  );
  return { placed, width: right, height: bottom };
}

const sides = (from: CanvasBounds, to: CanvasBounds): readonly [CanvasSide, CanvasSide] => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
};

/**
 * Lays a drawing out as a canvas. Pure and deterministic: every client draws the same board from
 * the same drawing. Groups are laid out first, then placed with the loose cards as single boxes.
 * Grouped cards and groups must name ids the drawing holds; arrows that don't are left out.
 */
export function placeCanvas(drawing: CanvasDrawing): CanvasData {
  const groups = drawing.groups ?? [];
  const groupIds = new Set(groups.map((group) => group.id));
  const cards = drawing.cards;
  const boxOf = new Map(cards.map((card) => [card.id, cardBox(card)]));
  const groupOf = new Map(
    cards.flatMap((card) =>
      card.group !== undefined && groupIds.has(card.group) ? [[card.id, card.group] as const] : [],
    ),
  );
  const known = (id: string) => boxOf.has(id) || groupIds.has(id);
  const arrows = (drawing.arrows ?? []).filter((arrow) => known(arrow.from) && known(arrow.to));
  const blockOf = (id: string) => groupOf.get(id) ?? id;

  const inner = new Map(
    groups.map((group) => {
      const members = cards.filter((card) => groupOf.get(card.id) === group.id);
      const boxes = members.flatMap((card) => boxOf.get(card.id) ?? []);
      const memberIds = new Set(boxes.map((box) => box.id));
      const links = arrows.filter(
        (arrow) => memberIds.has(arrow.from) && memberIds.has(arrow.to) && arrow.from !== arrow.to,
      );
      return [group.id, arrange(boxes, links)] as const;
    }),
  );
  const blocks: Box[] = [
    ...groups.map((group) => {
      const layout = inner.get(group.id);
      return {
        id: group.id,
        width: snap((layout?.width ?? 0) + GROUP_PADDING * 2),
        height: snap((layout?.height ?? 0) + GROUP_PADDING * 2 + GROUP_LABEL),
      };
    }),
    ...cards.flatMap((card) => (groupOf.has(card.id) ? [] : (boxOf.get(card.id) ?? []))),
  ];
  const blockLinks = arrows.flatMap((arrow) => {
    const from = blockOf(arrow.from);
    const to = blockOf(arrow.to);
    return from === to ? [] : [{ from, to }];
  });
  const outer = arrange(blocks, blockLinks);

  const rects = new Map<string, CanvasBounds>();
  for (const block of blocks) {
    const at = outer.placed.get(block.id) ?? { x: 0, y: 0 };
    rects.set(block.id, { x: at.x, y: at.y, width: block.width, height: block.height });
  }
  for (const card of cards) {
    const group = groupOf.get(card.id);
    if (group === undefined) continue;
    const box = boxOf.get(card.id);
    const origin = rects.get(group);
    const at = inner.get(group)?.placed.get(card.id);
    if (box === undefined || origin === undefined || at === undefined) continue;
    rects.set(card.id, {
      x: origin.x + GROUP_PADDING + at.x,
      y: origin.y + GROUP_PADDING + GROUP_LABEL + at.y,
      width: box.width,
      height: box.height,
    });
  }

  const color = (name: string | undefined) =>
    name === undefined ? {} : { color: PRESETS[name] ?? name };
  const groupNodes = groups.flatMap((group): CanvasNode[] => {
    const rect = rects.get(group.id);
    if (rect === undefined) return [];
    return [
      {
        type: "group",
        id: group.id,
        ...rect,
        ...(group.label === undefined ? {} : { label: group.label }),
        ...color(group.color),
      },
    ];
  });
  const cardNodes = cards.flatMap((card): CanvasNode[] => {
    const rect = rects.get(card.id);
    if (rect === undefined) return [];
    const base = { id: card.id, ...rect, ...color(card.color) };
    if (card.path === undefined && card.url === undefined) {
      return [{ ...base, type: "text", text: card.text ?? "" }];
    }
    const lines =
      card.line === undefined ? undefined : ([card.line, card.endLine ?? card.line] as const);
    return [
      {
        ...base,
        type: "link",
        url: card.url ?? "",
        astrolabe: {
          ...(card.text === undefined ? {} : { caption: card.text }),
          ...(card.path === undefined
            ? {}
            : { code: { path: card.path, ...(lines === undefined ? {} : { lines }) } }),
        },
      },
    ];
  });
  const edges = arrows.flatMap((arrow, index): CanvasEdge[] => {
    const from = rects.get(arrow.from);
    const to = rects.get(arrow.to);
    if (from === undefined || to === undefined) return [];
    const [fromSide, toSide] = sides(from, to);
    return [
      {
        id: `arrow-${index}`,
        fromNode: arrow.from,
        fromSide,
        toNode: arrow.to,
        toSide,
        ...(arrow.ends === "both" ? { fromEnd: "arrow" as const } : {}),
        ...(arrow.ends === "none" ? { toEnd: "none" as const } : {}),
        ...(arrow.label === undefined ? {} : { label: arrow.label }),
        ...color(arrow.color),
      },
    ];
  });
  return { nodes: [...groupNodes, ...cardNodes], edges };
}
