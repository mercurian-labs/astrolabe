/**
 * JSON Canvas (https://jsoncanvas.org/spec/1.0/): reading one, writing it back as Obsidian writes
 * it, and how a drawing with no coordinates becomes one. This file is what clients import, the
 * phone's engine included: it must stay free of the wiki's parsers.
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

export interface CanvasFileNode extends CanvasNodeBase {
  readonly type: "file";
  /** Its path from the wiki's root, any depth, extension included. */
  readonly file: string;
  /** A note's `#Heading` or `#^block`, or a base's `#View`. */
  readonly subpath?: string;
}

export interface CanvasGroupNode extends CanvasNodeBase {
  readonly type: "group";
  readonly label?: string;
  /** An image's path from the wiki's root. */
  readonly background?: string;
  /** `ratio` or `repeat`; a group with none covers, as Obsidian writes it. */
  readonly backgroundStyle?: string;
}

export type CanvasNode = CanvasTextNode | CanvasLinkNode | CanvasFileNode | CanvasGroupNode;

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

/** What a board draws. A file's exact contents live in the document `parseCanvas` returns. */
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
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of data.nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export const isCanvasFile = (file: string): boolean => /\.canvas$/i.test(file);

/** The groups a reader can jump to: those with a label, in the file's order. */
export const canvasGroups = (
  data: Pick<CanvasData, "nodes">,
): ReadonlyArray<{ readonly id: string; readonly label: string }> =>
  data.nodes.flatMap((node) =>
    node.type === "group" && node.label !== undefined ? [{ id: node.id, label: node.label }] : [],
  );

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

function codeReference(value: unknown): CanvasCodeReference | undefined {
  if (!isRecord(value) || typeof value.path !== "string") return undefined;
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
    case "text":
      return { ...base, type: "text", text: text(raw.text) ?? "" };
    case "file": {
      const subpath = text(raw.subpath);
      return {
        ...base,
        type: "file",
        file: text(raw.file) ?? "",
        ...(subpath === undefined ? {} : { subpath }),
      };
    }
    case "link": {
      const astrolabe = isRecord(raw.astrolabe) ? raw.astrolabe : undefined;
      const caption = text(astrolabe?.caption);
      const code = codeReference(astrolabe?.code);
      return {
        ...base,
        type: "link",
        url: text(raw.url) ?? "",
        ...(caption === undefined && code === undefined
          ? {}
          : {
              astrolabe: {
                ...(caption === undefined ? {} : { caption }),
                ...(code === undefined ? {} : { code }),
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
  };
}

/** A list's entries by the ids they draw under, unique though a file's may repeat or be missing. */
function entries(
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
  entries(list, prefix).flatMap(({ id, raw }) => {
    const item = read(raw, id);
    return item === undefined ? [] : [item];
  });

/** A file's JSON as drawn: every card with what it needs, whatever the file left out. */
export function canvasData(document: unknown): CanvasData {
  if (!isRecord(document)) return { nodes: [], edges: [] };
  return {
    nodes: drawn(document.nodes, "node", canvasNode),
    edges: drawn(document.edges, "edge", canvasEdge),
  };
}

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
];

export const CANVAS_ARROW_LOOKS: ReadonlyArray<CanvasLook> = [
  { name: "sides", keys: ["fromSide", "toSide"], mark: "moved" },
  { name: "colour", keys: ["color"], mark: "restyled" },
  { name: "ends", keys: ["fromEnd", "toEnd"], mark: "restyled" },
];

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
  readonly item: "card" | "arrow";
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
  /** Something outside the cards and arrows changed, which only the file's JSON shows. */
  readonly rest: boolean;
}

const NAME_CHARS = 60;

function brief(text: string): string {
  const line =
    text
      .trim()
      .split("\n", 1)[0]
      ?.replace(/^#+\s*/, "")
      .trim() ?? "";
  return line.length > NAME_CHARS ? `${line.slice(0, NAME_CHARS - 1)}…` : line;
}

const lastPart = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A card as a person would name it, for a change list or a merge's preview. */
export function canvasCardName(card: Readonly<Record<string, unknown>>): string {
  const code = isRecord(card.astrolabe) ? codeReference(card.astrolabe.code) : undefined;
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
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  looks: ReadonlyArray<CanvasLook>,
): Pick<CanvasChange, "mark" | "also"> | null {
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
  const cards = [entries(was.nodes, "node"), entries(now.nodes, "node")] as const;
  const arrows = [entries(was.edges, "edge"), entries(now.edges, "edge")] as const;
  const names = new Map([...cards[0], ...cards[1]].map(({ id, raw }) => [id, raw]));
  const cardName = (id: unknown) => {
    const card = typeof id === "string" ? names.get(id) : undefined;
    return card === undefined ? "A missing card" : canvasCardName(card);
  };
  const compare = (
    item: CanvasChange["item"],
    [from, to]: readonly [ReturnType<typeof entries>, ReturnType<typeof entries>],
    looks: ReadonlyArray<CanvasLook>,
  ): CanvasChange[] => {
    const name = (raw: Record<string, unknown>) =>
      item === "card" ? canvasCardName(raw) : canvasArrowName(raw, cardName);
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
  const outside = (document: Record<string, unknown>) => ({
    ...document,
    nodes: undefined,
    edges: undefined,
  });
  return {
    changes: [
      ...compare("card", cards, CANVAS_CARD_LOOKS),
      ...compare("arrow", arrows, CANVAS_ARROW_LOOKS),
    ],
    rest: !sameJson(outside(was), outside(now)),
  };
}

/** Which cards and arrows a board marks, by id: a card and an arrow may share one. */
export interface CanvasMarks {
  readonly cards: Readonly<Record<string, CanvasMark>>;
  readonly arrows: Readonly<Record<string, CanvasMark>>;
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
  const marks = { cards: marked("card"), arrows: marked("arrow") };
  // Beneath the rest: what replaced a removed card stays on top until the removed one is picked.
  const nodes = [...was.nodes.filter((node) => marks.cards[node.id] === "removed"), ...now.nodes];
  const edges = [...now.edges, ...was.edges.filter((edge) => marks.arrows[edge.id] === "removed")];
  const onBoard = new Set(nodes.map((node) => node.id));
  const drawnArrows = new Set(
    edges
      .filter((edge) => onBoard.has(edge.fromNode) && onBoard.has(edge.toNode))
      .map((edge) => edge.id),
  );
  return {
    data: { nodes, edges },
    marks,
    changes: changes.map((change) => ({
      ...change,
      drawn: change.item === "card" ? onBoard.has(change.id) : drawnArrows.has(change.id),
    })),
    rest,
  };
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
  return counts.length > 0 ? counts.join(", ") : "No changes to its cards or arrows";
}

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
const RANK_GAP = 100;
const CROSS_GAP = 32;
const GROUP_PADDING = 24;
const GROUP_LABEL = 28;
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

const sides = (from: CanvasBounds, to: CanvasBounds): readonly [CanvasSide, CanvasSide] => {
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
