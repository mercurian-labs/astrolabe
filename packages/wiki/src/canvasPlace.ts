/**
 * Where cards go on a board, for agents that say what is on it and never where. Pure and
 * deterministic, and clients run it too: no array methods newer than the phone's engine has.
 */
import type {
  CanvasBounds,
  CanvasData,
  CanvasEdge,
  CanvasNode,
  CanvasSide,
  CanvasStory,
} from "./canvas.ts";

/** A group's cards are those wholly inside it, its edge included. Membership is never stored. */
export const insideGroup = (group: CanvasBounds, card: CanvasBounds): boolean =>
  card.x >= group.x &&
  card.y >= group.y &&
  card.x + card.width <= group.x + group.width &&
  card.y + card.height <= group.y + group.height;

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
  /** Ways to tell the board, each walked a step at a time. A card can be in several steps. */
  readonly stories?:
    | ReadonlyArray<{
        readonly title: string;
        readonly steps: ReadonlyArray<{
          readonly label?: string | undefined;
          readonly note: string;
          readonly cards: ReadonlyArray<string>;
        }>;
      }>
    | undefined;
}

export const CANVAS_PRESETS: Readonly<Record<string, string>> = {
  red: "1",
  orange: "2",
  yellow: "3",
  green: "4",
  cyan: "5",
  purple: "6",
};

const GRID = 20;
const RANK_GAP = 100;
const CROSS_GAP = 32;
const GROUP_PADDING = 24;
const GROUP_LABEL = 28;
/** Boards are read in a chat column, so the layout that lands nearest this shape wins. */
const TARGET_ASPECT = 1.6;
/** Text longer than this gets Obsidian's wider card. */
const WIDE_TEXT = 240;
/** What stays open around anything placed on a board. */
const CLEARANCE = 20;
/** Obsidian's padding when it draws a group around a selection. */
const AROUND_PADDING = 20;
const EMPTY_GROUP = 400;
/** How far from a `near` card to look before giving up and going off the board. */
const NEAR_RINGS = 8;
/** Past this many cards in a group, a new one goes along its edge without looking for a gap. */
const GROUP_SCAN_LIMIT = 64;

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
    const width = 280;
    return { id: card.id, width, height: snap(60 + (text ? textHeight(text, width) : 0)) };
  }
  const width = text.length <= 40 ? 180 : text.length <= 200 ? 240 : 320;
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
    // Not toSorted or toReversed: this runs on the phone, and Hermes has neither.
    const order = sweep % 2 === 0 ? dense : [...dense].reverse();
    for (const column of order) {
      // A stable sort: boxes that tie keep the order the agent wrote them in.
      const sorted = column
        .map((box) => ({ box, at: centre(box) }))
        .sort((a, b) => a.at - b.at)
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

export const canvasArrowSides = (
  from: CanvasBounds,
  to: CanvasBounds,
): readonly [CanvasSide, CanvasSide] => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
};

/** Why a drawing can't be drawn, each said so its author can fix it; empty when it can. */
export function canvasDrawingProblems(drawing: CanvasDrawing): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const unique = (id: string) => {
    if (seen.has(id)) problems.push(`The id "${id}" is used twice.`);
    seen.add(id);
  };
  for (const group of drawing.groups ?? []) unique(group.id);
  for (const card of drawing.cards) unique(card.id);
  const groups = new Set((drawing.groups ?? []).map((group) => group.id));
  const cardIds = new Set(drawing.cards.map((card) => card.id));
  for (const story of drawing.stories ?? []) {
    if (story.steps.length === 0) problems.push(`Story "${story.title}" needs a step.`);
    story.steps.forEach((step, index) => {
      const named = `Step ${index + 1} of "${story.title}"`;
      if (step.cards.length === 0) problems.push(`${named} needs a card.`);
      for (const id of step.cards) {
        if (!cardIds.has(id)) problems.push(`${named} names a card that isn't here: "${id}".`);
      }
    });
  }
  for (const card of drawing.cards) {
    if (card.text === undefined && card.url === undefined && card.path === undefined) {
      problems.push(`Card "${card.id}" needs text, url or path.`);
    }
    if (card.url !== undefined && card.path !== undefined) {
      problems.push(`Card "${card.id}" has both url and path; it can only be one.`);
    }
    if (card.group !== undefined && !groups.has(card.group)) {
      problems.push(`Card "${card.id}" names a group that isn't in \`groups\`: "${card.group}".`);
    }
    if (
      card.path !== undefined &&
      (/^([/\\]|[a-z]:)/i.test(card.path) || /(^|[/\\])\.\.([/\\]|$)/.test(card.path))
    ) {
      problems.push(`Card "${card.id}" needs a path relative to the repository root.`);
    }
    if (card.line === undefined && card.endLine !== undefined) {
      problems.push(`Card "${card.id}" has endLine without line.`);
    }
    if (card.line !== undefined && card.line < 1) {
      problems.push(`Card "${card.id}" has a line before the first.`);
    }
    if (card.line !== undefined && card.endLine !== undefined && card.endLine < card.line) {
      problems.push(`Card "${card.id}" ends before it starts.`);
    }
  }
  for (const { from, to } of drawing.arrows ?? []) {
    for (const id of [from, to]) {
      if (!seen.has(id)) problems.push(`An arrow names a card or group that isn't here: "${id}".`);
    }
  }
  return problems;
}

/**
 * Lays a drawing out as a canvas. Pure and deterministic: every client draws the same board from
 * the same drawing. Groups are laid out first, then placed with the loose cards as single boxes.
 * Grouped cards and groups must name ids the drawing holds; arrows that don't are left out.
 */
export function placeCanvas(drawing: CanvasDrawing): CanvasData {
  const stories: CanvasStory[] = (drawing.stories ?? []).map((story) => ({
    title: story.title,
    steps: story.steps.map((step) => ({
      ...(step.label === undefined ? {} : { label: step.label }),
      note: step.note,
      cards: step.cards,
    })),
  }));
  const first = stories[0];
  const board =
    (drawing.groups ?? []).length === 0 && first !== undefined
      ? placeStory(drawing, first)
      : placeMap(drawing);
  return stories.length === 0 ? board : { ...board, stories };
}

/** A board laid out by its arrows, with its groups as regions. */
function placeMap(drawing: CanvasDrawing): CanvasData {
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
  // Blocks keep the order the agent wrote their cards in: a cycle starts where it started.
  const blockIds = [...new Set([...cards.map((card) => blockOf(card.id)), ...groupIds])];
  const blocks = blockIds.flatMap((id): Box[] => {
    const layout = inner.get(id);
    if (layout === undefined) {
      const box = boxOf.get(id);
      return box === undefined ? [] : [box];
    }
    return [
      {
        id,
        width: snap(layout.width + GROUP_PADDING * 2),
        height: snap(layout.height + GROUP_PADDING * 2 + GROUP_LABEL),
      },
    ];
  });
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

  const groupNodes = groups.flatMap((group): CanvasNode[] => {
    const rect = rects.get(group.id);
    if (rect === undefined) return [];
    return [
      {
        type: "group",
        id: group.id,
        ...rect,
        ...(group.label === undefined ? {} : { label: group.label }),
        ...presetColor(group.color),
      },
    ];
  });
  return {
    nodes: [...groupNodes, ...cardNodesAt(cards, rects)],
    edges: edgesAt(arrows, rects),
  };
}

const presetColor = (name: string | undefined) =>
  name === undefined ? {} : { color: CANVAS_PRESETS[name] ?? name };

function cardNodesAt(
  cards: CanvasDrawing["cards"],
  rects: ReadonlyMap<string, CanvasBounds>,
): CanvasNode[] {
  return cards.flatMap((card): CanvasNode[] => {
    const rect = rects.get(card.id);
    if (rect === undefined) return [];
    const base = { id: card.id, ...rect, ...presetColor(card.color) };
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
}

function edgesAt(
  arrows: NonNullable<CanvasDrawing["arrows"]>,
  rects: ReadonlyMap<string, CanvasBounds>,
): CanvasEdge[] {
  return arrows.flatMap((arrow, index): CanvasEdge[] => {
    const from = rects.get(arrow.from);
    const to = rects.get(arrow.to);
    if (from === undefined || to === undefined) return [];
    const [fromSide, toSide] = canvasArrowSides(from, to);
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
        ...presetColor(arrow.color),
      },
    ];
  });
}

/** Room between blocks in a row of frames: past both frames' padding, so a block is in its own. */
const FRAME_GAP = GROUP_PADDING * 2 + CROSS_GAP;
/** How far apart a step's cards can be and still share its frame: past a rank's gap, short of a row's. */
const STEP_REACH = RANK_GAP + GRID;

/**
 * A step's frame: the padded box around its biggest run of cards that sit together, the earliest
 * on a tie. Its other cards are away from it, and a walk brings them beside it.
 */
export function canvasStepFrame(cards: ReadonlyArray<CanvasNode>): {
  readonly frame: CanvasBounds | undefined;
  readonly inside: ReadonlySet<string>;
} {
  const runs: CanvasNode[][] = [];
  for (const card of cards) {
    const near = runs.filter((run) => run.some((each) => touching(each, card, STEP_REACH)));
    const joined = [...near.flat(), card];
    for (const run of near) runs.splice(runs.indexOf(run), 1);
    runs.push(joined);
  }
  const order = new Map(cards.map((card, index) => [card.id, index]));
  const earliest = (run: ReadonlyArray<CanvasNode>) =>
    Math.min(...run.map((card) => order.get(card.id) ?? 0));
  let biggest: CanvasNode[] | undefined;
  for (const run of runs) {
    if (
      biggest === undefined ||
      run.length > biggest.length ||
      (run.length === biggest.length && earliest(run) < earliest(biggest))
    ) {
      biggest = run;
    }
  }
  const [first, ...rest] = biggest ?? [];
  if (first === undefined) return { frame: undefined, inside: new Set() };
  return {
    frame: padded(rest.reduce<CanvasBounds>(union, first)),
    inside: new Set((biggest ?? []).map((card) => card.id)),
  };
}

/**
 * Lays a board out for its first story: its steps in reading order, in rows. A card goes in the
 * first step that names it. When its first two steps sit side by side in a row, it goes between
 * them, so both frames stretch over it and overlap. Cards no step names go in a grid below.
 */
function placeStory(drawing: CanvasDrawing, story: CanvasStory): CanvasData {
  const steps = story.steps;
  const cards = drawing.cards;
  const boxOf = new Map(cards.map((card) => [card.id, cardBox(card)]));
  const stepsOf = new Map<string, number[]>();
  steps.forEach((step, index) => {
    for (const id of step.cards) {
      const list = stepsOf.get(id) ?? [];
      if (!boxOf.has(id) || list.includes(index)) continue;
      list.push(index);
      stepsOf.set(id, list);
    }
  });
  const arrows = (drawing.arrows ?? []).filter(
    (arrow) => boxOf.has(arrow.from) && boxOf.has(arrow.to),
  );
  const arrangeIds = (ids: ReadonlyArray<string>) => {
    const held = new Set(ids);
    return arrange(
      ids.flatMap((id) => boxOf.get(id) ?? []),
      arrows.filter(
        (arrow) => held.has(arrow.from) && held.has(arrow.to) && arrow.from !== arrow.to,
      ),
    );
  };

  const rowsOf = (perRow: number) => {
    const sharesRow = (a: number, b: number | undefined) =>
      b === a + 1 && Math.floor(a / perRow) === Math.floor(b / perRow);
    const own: string[][] = steps.map(() => []);
    const between: string[][] = steps.map(() => []);
    for (const card of cards) {
      const [first, second] = stepsOf.get(card.id) ?? [];
      if (first === undefined) continue;
      (sharesRow(first, second) ? between : own)[first]?.push(card.id);
    }
    const rects = new Map<string, CanvasBounds>();
    let y = 0;
    for (let start = 0; start < steps.length; start += perRow) {
      const top = y + GROUP_LABEL + GROUP_PADDING;
      let x = 0;
      let tallest = 0;
      const block = (ids: ReadonlyArray<string>) => {
        if (ids.length === 0) return;
        const laid = arrangeIds(ids);
        for (const id of ids) {
          const at = laid.placed.get(id) ?? { x: 0, y: 0 };
          const box = boxOf.get(id);
          if (box === undefined) continue;
          rects.set(id, { x: x + at.x, y: top + at.y, width: box.width, height: box.height });
        }
        x += laid.width + FRAME_GAP;
        tallest = Math.max(tallest, laid.height);
      };
      for (let index = start; index < Math.min(start + perRow, steps.length); index++) {
        block(own[index] ?? []);
        block(between[index] ?? []);
      }
      if (tallest > 0) y = top + tallest + GROUP_PADDING + RANK_GAP;
    }
    const loose = cards.flatMap((card) => (stepsOf.has(card.id) ? [] : (boxOf.get(card.id) ?? [])));
    const spots = new Map<string, Placed>();
    if (loose.length > 0) grid(loose, y, spots);
    for (const box of loose) {
      const at = spots.get(box.id) ?? { x: 0, y };
      rects.set(box.id, { ...at, width: box.width, height: box.height });
    }
    return rects;
  };

  const miss = (rects: ReadonlyMap<string, CanvasBounds>) => {
    const all = [...rects.values()];
    const first = all[0];
    if (first === undefined) return 0;
    const whole = all.reduce(union, first);
    return Math.abs(Math.log(whole.width / Math.max(1, whole.height) / TARGET_ASPECT));
  };
  let rects = rowsOf(1);
  for (let perRow = 2; perRow <= steps.length; perRow++) {
    const next = rowsOf(perRow);
    if (miss(next) < miss(rects)) rects = next;
  }
  return { nodes: cardNodesAt(cards, rects), edges: edgesAt(arrows, rects) };
}

/** How `canvasPlace` measures what it can't: the sizes Obsidian gives a new card. */
export function canvasCardSize(card: {
  readonly text?: string | undefined;
}): Pick<CanvasBounds, "width" | "height"> {
  if (card.text === undefined) return { width: 400, height: 400 };
  const width = card.text.length > WIDE_TEXT ? 400 : 250;
  return { width, height: snap(38 + textHeight(card.text, width)) };
}

/** A card on its way onto a board. */
export interface CanvasNewCard extends Pick<CanvasBounds, "width" | "height"> {
  readonly id: string;
  /** The group it goes in, on the board or among the new ones. */
  readonly in?: string | undefined;
  readonly near?: string | undefined;
}

export interface CanvasNewGroup {
  readonly id: string;
  readonly near?: string | undefined;
  /** Cards it is drawn around, where they stand. Without any, it is sized to what goes in it. */
  readonly around?: ReadonlyArray<string> | undefined;
}

export interface CanvasPlacement {
  /** Where each new card and group goes. */
  readonly placed: Readonly<Record<string, CanvasBounds>>;
  /** The groups already on the board that grew, at their new size. */
  readonly grown: Readonly<Record<string, CanvasBounds>>;
  /** New cards left beside their group, because everything around it is taken. */
  readonly outside: ReadonlyArray<string>;
}

interface Block extends Box {
  readonly near?: string | undefined;
  /** A new group's cards, relative to it. */
  readonly inner?: ReadonlyMap<string, CanvasBounds>;
}

interface Cluster {
  readonly blocks: ReadonlyArray<Block>;
  readonly links: ReadonlyArray<Link>;
  readonly anchor?: string | undefined;
}

const touching = (a: CanvasBounds, b: CanvasBounds, margin: number) =>
  a.x < b.x + b.width + margin &&
  b.x < a.x + a.width + margin &&
  a.y < b.y + b.height + margin &&
  b.y < a.y + a.height + margin;

const union = (a: CanvasBounds, b: CanvasBounds): CanvasBounds => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

/** A group's room around a rectangle of what it holds, as `placeCanvas` leaves it. */
const padded = (rect: CanvasBounds): CanvasBounds => ({
  x: rect.x - GROUP_PADDING,
  y: rect.y - GROUP_PADDING - GROUP_LABEL,
  width: rect.width + GROUP_PADDING * 2,
  height: rect.height + GROUP_PADDING * 2 + GROUP_LABEL,
});

/** Blocks joined by links, each set in the order its first block came. */
function connected(blocks: ReadonlyArray<Block>, links: ReadonlyArray<Link>): Block[][] {
  const parent = new Map(blocks.map((block) => [block.id, block.id]));
  const root = (id: string): string => {
    const up = parent.get(id) ?? id;
    return up === id ? id : root(up);
  };
  for (const { from, to } of links) {
    if (parent.has(from) && parent.has(to)) parent.set(root(from), root(to));
  }
  const sets = new Map<string, Block[]>();
  for (const block of blocks) {
    const set = sets.get(root(block.id));
    if (set === undefined) sets.set(root(block.id), [block]);
    else set.push(block);
  }
  return [...sets.values()];
}

/**
 * Finds room on a board for new cards and groups. Nothing on the board moves, except that a group
 * may grow, leaving its cards where they are, and its groups with it. Cards linked to each other
 * land laid out together. Without a hint they land off the board's short side.
 */
export function canvasPlace(
  board: ReadonlyArray<CanvasBounds & { readonly id: string; readonly type?: string }>,
  batch: {
    readonly cards: ReadonlyArray<CanvasNewCard>;
    readonly groups?: ReadonlyArray<CanvasNewGroup> | undefined;
    readonly links?: ReadonlyArray<Link> | undefined;
  },
): CanvasPlacement {
  const rects = new Map<string, CanvasBounds>(
    board.map(({ id, x, y, width, height }) => [id, { x, y, width, height }]),
  );
  const groupIds = new Set(board.filter((node) => node.type === "group").map((node) => node.id));
  const placed: Record<string, CanvasBounds> = {};
  const grown: Record<string, CanvasBounds> = {};
  const outside: string[] = [];
  const newGroups = batch.groups ?? [];
  const links = batch.links ?? [];
  const put = (id: string, rect: CanvasBounds) => {
    const isNew = id in placed || !rects.has(id);
    rects.set(id, rect);
    if (isNew) placed[id] = rect;
    else grown[id] = rect;
  };

  const isClear = (rect: CanvasBounds, ignore: (id: string) => boolean = () => false) => {
    for (const [id, other] of rects) {
      if (!ignore(id) && touching(rect, other, CLEARANCE)) return false;
    }
    return true;
  };

  const freeSpot = (width: number, height: number, anchor: CanvasBounds | undefined): Placed => {
    const all = [...rects.values()];
    const first = all[0];
    if (first === undefined) return { x: 0, y: 0 };
    const whole = all.reduce(union, first);
    const offBoard: Placed =
      whole.width / Math.max(1, whole.height) > TARGET_ASPECT
        ? { x: snap(whole.x), y: snap(whole.y + whole.height + RANK_GAP) }
        : { x: snap(whole.x + whole.width + RANK_GAP), y: snap(whole.y) };
    if (anchor === undefined) return offBoard;
    const fits = (x: number, y: number) => isClear({ x: snap(x), y: snap(y), width, height });
    const stepX = width + CROSS_GAP;
    const stepY = height + CROSS_GAP;
    for (let ring = 0; ring <= NEAR_RINGS; ring++) {
      for (let out = 0; out <= ring; out++) {
        for (let along = 0; along <= ring; along++) {
          if (out !== ring && along !== ring) continue;
          for (const shift of along === 0 ? [0] : [along, -along]) {
            const right = anchor.x + anchor.width + RANK_GAP + out * stepX;
            const below = anchor.y + anchor.height + RANK_GAP + out * stepY;
            const left = anchor.x - RANK_GAP - width - out * stepX;
            const above = anchor.y - RANK_GAP - height - out * stepY;
            const spots: ReadonlyArray<Placed> = [
              { x: right, y: anchor.y + shift * stepY },
              { x: anchor.x + shift * stepX, y: below },
              { x: left, y: anchor.y + shift * stepY },
              { x: anchor.x + shift * stepX, y: above },
            ];
            for (const spot of spots) {
              if (fits(spot.x, spot.y)) return { x: snap(spot.x), y: snap(spot.y) };
            }
          }
        }
      }
    }
    return offBoard;
  };

  /** What growing a group to `wanted` asks of it and the groups holding it; null if it hits something. */
  const growth = (id: string, wanted: CanvasBounds) => {
    const was = rects.get(id);
    if (was === undefined) return null;
    const holders = [...rects]
      .filter(([each, rect]) => each !== id && groupIds.has(each) && insideGroup(rect, was))
      .sort(([, a], [, b]) => a.width * a.height - b.width * b.height);
    const chain = new Map([[id, wanted]]);
    let current = wanted;
    for (const [holder, rect] of holders) {
      const room = padded(current);
      if (insideGroup(rect, room)) continue;
      const next = union(rect, room);
      chain.set(holder, next);
      current = next;
    }
    for (const [group, rect] of chain) {
      const before = rects.get(group) ?? rect;
      for (const [each, other] of rects) {
        if (chain.has(each) || insideGroup(before, other) || insideGroup(other, before)) continue;
        if (touching(rect, other, CLEARANCE)) return null;
      }
    }
    return chain;
  };

  const putInGroup = (card: CanvasNewCard, groupId: string): void => {
    const group = rects.get(groupId);
    if (group === undefined) return;
    const { width, height } = card;
    const members = [...rects]
      .filter(([each, rect]) => each !== groupId && insideGroup(group, rect))
      .map(([, rect]) => rect);
    const left = group.x + GROUP_PADDING;
    const top = group.y + GROUP_PADDING + GROUP_LABEL;
    const right = group.x + group.width - GROUP_PADDING;
    const bottom = group.y + group.height - GROUP_PADDING;
    const holds = (each: string) => {
      const rect = rects.get(each);
      return each === groupId || (rect !== undefined && insideGroup(rect, group));
    };
    if (members.length <= GROUP_SCAN_LIMIT) {
      const xs = [left, ...members.map((rect) => rect.x + rect.width + CROSS_GAP)];
      const ys = [top, ...members.map((rect) => rect.y + rect.height + CROSS_GAP)];
      const anchor = card.near === undefined ? undefined : rects.get(card.near);
      const reach = (rect: CanvasBounds) =>
        anchor === undefined ? 0 : Math.abs(rect.x - anchor.x) + Math.abs(rect.y - anchor.y);
      // Nearest `near` first, then in reading order.
      const spots = ys
        .flatMap((y) => xs.map((x) => ({ x: snap(x), y: snap(y), width, height })))
        .sort((a, b) => reach(a) - reach(b) || a.y - b.y || a.x - b.x);
      for (const rect of spots) {
        if (rect.x + width <= right && rect.y + height <= bottom && isClear(rect, holds)) {
          put(card.id, rect);
          return;
        }
      }
    }
    const lowest = Math.max(top - CROSS_GAP, ...members.map((rect) => rect.y + rect.height));
    const rightmost = Math.max(left - CROSS_GAP, ...members.map((rect) => rect.x + rect.width));
    const leftmost = Math.min(right + CROSS_GAP, ...members.map((rect) => rect.x));
    const highest = Math.min(bottom + CROSS_GAP, ...members.map((rect) => rect.y));
    const down: Placed = { x: snap(left), y: snap(lowest + CROSS_GAP) };
    const across: Placed = { x: snap(rightmost + CROSS_GAP), y: snap(top) };
    const back: Placed = { x: snap(leftmost - CROSS_GAP - width), y: snap(top) };
    const up: Placed = { x: snap(left), y: snap(highest - CROSS_GAP - height) };
    const wide = group.width / Math.max(1, group.height) > TARGET_ASPECT;
    for (const spot of wide ? [down, across, back, up] : [across, down, back, up]) {
      const rect = { ...spot, width, height };
      const chain = growth(groupId, union(group, padded(rect)));
      if (chain === null) continue;
      for (const [id, next] of chain) put(id, next);
      put(card.id, rect);
      return;
    }
    outside.push(card.id);
    const beside = freeSpot(width, height, group);
    put(card.id, { ...beside, width, height });
  };

  const placeCluster = ({ blocks, links: inner, anchor }: Cluster) => {
    const layout = arrange(blocks, inner);
    const at = freeSpot(
      layout.width,
      layout.height,
      anchor === undefined ? undefined : rects.get(anchor),
    );
    for (const block of blocks) {
      const spot = layout.placed.get(block.id) ?? { x: 0, y: 0 };
      const rect = {
        x: at.x + spot.x,
        y: at.y + spot.y,
        width: block.width,
        height: block.height,
      };
      put(block.id, rect);
      for (const [id, member] of block.inner ?? []) {
        put(id, { ...member, x: rect.x + member.x, y: rect.y + member.y });
      }
    }
  };

  for (const group of newGroups) {
    const around = (group.around ?? []).flatMap((id) => rects.get(id) ?? []);
    const [first, ...others] = around;
    if (first === undefined) continue;
    const box = others.reduce(union, first);
    put(group.id, {
      x: box.x - AROUND_PADDING,
      y: box.y - AROUND_PADDING,
      width: box.width + AROUND_PADDING * 2,
      height: box.height + AROUND_PADDING * 2,
    });
    groupIds.add(group.id);
  }

  for (const card of batch.cards) {
    if (card.in !== undefined && rects.has(card.in)) putInGroup(card, card.in);
  }

  const groupBlocks = newGroups.flatMap((group): Block[] => {
    if (rects.has(group.id)) return [];
    groupIds.add(group.id);
    const near = group.near === undefined ? {} : { near: group.near };
    const members = batch.cards.filter((card) => card.in === group.id);
    if (members.length === 0) {
      return [{ id: group.id, width: EMPTY_GROUP, height: EMPTY_GROUP, ...near }];
    }
    const held = new Set(members.map((card) => card.id));
    const layout = arrange(
      members,
      links.filter((link) => held.has(link.from) && held.has(link.to) && link.from !== link.to),
    );
    const inner = new Map(
      members.map((card) => {
        const spot = layout.placed.get(card.id) ?? { x: 0, y: 0 };
        return [
          card.id,
          {
            x: GROUP_PADDING + spot.x,
            y: GROUP_PADDING + GROUP_LABEL + spot.y,
            width: card.width,
            height: card.height,
          },
        ] as const;
      }),
    );
    return [
      {
        id: group.id,
        width: snap(layout.width + GROUP_PADDING * 2),
        height: snap(layout.height + GROUP_PADDING * 2 + GROUP_LABEL),
        ...near,
        inner,
      },
    ];
  });
  const newGroupIds = new Set(groupBlocks.map((block) => block.id));
  const blocks: Block[] = [...batch.cards.filter((card) => card.in === undefined), ...groupBlocks];

  const held = new Map(
    batch.cards.flatMap((card) =>
      card.in !== undefined && newGroupIds.has(card.in) ? [[card.id, card.in] as const] : [],
    ),
  );
  const blockOf = (id: string) => held.get(id) ?? id;
  const blockLinks = links.flatMap((link) => {
    const from = blockOf(link.from);
    const to = blockOf(link.to);
    return from === to ? [] : [{ from, to }];
  });
  const hinted = blocks.filter((block) => block.near !== undefined);
  const free = blocks.filter((block) => block.near === undefined);
  const anchored: Cluster[] = [];
  const loose: Block[][] = [];
  for (const set of connected(free, blockLinks)) {
    const members = new Set(set.map((block) => block.id));
    const leaving = blockLinks.find(({ from, to }) => members.has(from) !== members.has(to));
    if (leaving === undefined) {
      loose.push(set);
      continue;
    }
    anchored.push({
      blocks: set,
      links: blockLinks.filter(({ from, to }) => members.has(from) && members.has(to)),
      anchor: members.has(leaving.from) ? leaving.to : leaving.from,
    });
  }
  const unhinted = loose.flat();
  const unhintedIds = new Set(unhinted.map((block) => block.id));
  const waiting: Cluster[] = [
    ...hinted.map((block) => ({ blocks: [block], links: [], anchor: block.near })),
    ...anchored,
    ...(unhinted.length === 0
      ? []
      : [
          {
            blocks: unhinted,
            links: blockLinks.filter(
              ({ from, to }) => unhintedIds.has(from) && unhintedIds.has(to),
            ),
          },
        ]),
  ];
  while (waiting.length > 0) {
    const ready = waiting.findIndex(({ anchor }) => anchor === undefined || rects.has(anchor));
    const [cluster] = waiting.splice(Math.max(ready, 0), 1);
    if (cluster !== undefined) placeCluster(cluster);
  }

  return { placed, grown, outside };
}
