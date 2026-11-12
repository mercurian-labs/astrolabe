import { CANVAS_MAX_DRAWINGS, type CanvasHandEdit } from "@mercurian/wiki/canvas-edits";
import {
  canvasArrowSides,
  canvasCardName,
  canvasInkBounds,
  type CanvasBounds,
  type CanvasData,
  type CanvasEdge,
  type CanvasFileNode,
  type CanvasGroupNode,
  type CanvasLinkNode,
  type CanvasNode,
  type CanvasShape,
} from "@mercurian/wiki/canvas";

import {
  arrangeEdits,
  arrowBetween,
  canvasClip,
  clipText,
  fileCard,
  filesOfDrop,
  groupCard,
  lineDirectionEdit,
  linkCard,
  parseClip,
  pastedCard,
  pasteClip,
  placeClip,
  replaceCard,
  textCard,
  type CanvasClip,
} from "./canvasActions";
import {
  boundsOfRects,
  cardAtConnectionDrop,
  CANVAS_GAP,
  CANVAS_GRID,
  CANVAS_MIN_SIZE,
  CANVAS_NUDGE,
  CANVAS_NUDGE_LARGE,
  centeredOn,
  FILE_CARD_SIZE,
  fitToContent,
  groupAround,
  movedWith,
  OPPOSITE_SIDE,
  ratioHeight,
  roomNear,
  TEXT_CARD_SIZE,
  type CanvasArrangement,
  type CanvasHandle,
  type CanvasLineDirection,
  type CanvasPoint,
} from "./canvasArrange";
import type { CanvasDocument } from "./canvasDocument";
import { canvasFileKind, cardFileName, overlaps } from "./canvasGeometry";
import { selectedDrawings, type CanvasLooseEnd, type CanvasSelection } from "./canvasGestures";
import { canvasStroke } from "./canvasInk";
import { baseViewNames, noteBlocks, noteHeadings, noteWithBlockId } from "./canvasNote";
import type { CanvasView } from "./canvasView";

/** Smaller than this, a drawn box was meant as a click with a wobble. */
const DRAWN_CARD_LEAST = { width: 100, height: 50 };
const DRAWN_SECTION_LEAST = { width: 160, height: 100 };

type Size = { readonly width: number; readonly height: number };

const drawnBox = (box: CanvasBounds | null, at: CanvasPoint, size: Size, least: Size) =>
  box === null
    ? { ...centeredOn(at, size), ...size }
    : {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(Math.max(least.width, box.width)),
        height: Math.round(Math.max(least.height, box.height)),
      };

/** A board's clipboard for what a system clipboard won't carry, as on a phone's page. */
let lastClip: { readonly clip: CanvasClip; readonly text: string } | null = null;

export type CanvasEditing =
  | { readonly kind: "card"; readonly id: string }
  | { readonly kind: "note"; readonly id: string; readonly file: string }
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "arrow"; readonly id: string }
  /** A drawn arrow's label. */
  | { readonly kind: "drawing"; readonly id: string };

export interface CanvasPickerRequest {
  readonly title: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  /** ⇧↵ makes a new one by the name typed. */
  readonly allowNew?: boolean;
}

export type CanvasPicked =
  | { readonly kind: "existing"; readonly value: string }
  | { readonly kind: "new"; readonly name: string };

export interface CanvasPromptRequest {
  readonly title: string;
  readonly label: string;
  readonly initial?: string;
  readonly submit: string;
}

/** The app around a board, for what a board can't reach by itself. Each is optional. */
export interface CanvasEditHost {
  /** Every file in the wiki, by path. */
  readonly listFiles?: () => Promise<ReadonlyArray<string>>;
  /** Whole text for a note. Resolves with why it failed, or null. */
  readonly writeNote?: (file: string, text: string, readAt?: string) => Promise<string | null>;
  /** Bytes saved beside the wiki's documents; resolves with the name it holds them by. */
  readonly attachFile?: (name: string, base64: string) => Promise<string | null>;
  /** Where a new note named `name` goes; null when that name can't make one. */
  readonly placeNote?: (name: string) => string | null | Promise<string | null>;
  readonly assetUrl?: (path: string) => Promise<string | null>;
  readonly renameDocument?: (file: string, to: string) => Promise<string | null>;
  readonly openInNewTab?: (file: string) => void;
  readonly copyText?: (text: string) => void;
  readonly readFileText?: (path: string) => Promise<string | null>;
  readonly onOpenUrl?: ((href: string) => void) | undefined;
}

export interface CanvasCommandAccess {
  readonly view: CanvasView;
  readonly document: () => CanvasDocument | null;
  readonly data: () => CanvasData;
  readonly selection: () => CanvasSelection;
  readonly select: (selection: CanvasSelection) => void;
  readonly host: () => CanvasEditHost;
  readonly edit: (editing: CanvasEditing | null) => void;
  readonly pick: (request: CanvasPickerRequest) => Promise<CanvasPicked | null>;
  readonly prompt: (request: CanvasPromptRequest) => Promise<string | null>;
  readonly notify: (message: string) => void;
  /** A file changed without the board's own commit moving. */
  readonly reread: (file: string) => void;
  readonly element: (id: string) => HTMLElement | null;
  readonly openExport: () => void;
}

const NOTE_FILE = /\.(md|canvas|base)$/i;
const MEDIA_KINDS = new Set(["image", "pdf", "audio", "video"]);

const measureImage = (url: string) =>
  new Promise<{ readonly width: number; readonly height: number } | null>((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve(
        image.naturalHeight > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null,
      );
    image.onerror = () => resolve(null);
    image.src = url;
  });

/** Everything a person can do to a board, from any toolbar, menu, key or palette entry. */
export class CanvasCommands {
  readonly #board: CanvasCommandAccess;

  constructor(board: CanvasCommandAccess) {
    this.#board = board;
  }

  get #document() {
    return this.#board.document();
  }

  readonly select = (selection: CanvasSelection) => this.#board.select(selection);

  readonly element = (id: string) => this.#board.element(id);

  #node(id: string) {
    return this.#board.data().nodes.find((node) => node.id === id);
  }

  #edge(id: string) {
    return this.#board.data().edges.find((edge) => edge.id === id);
  }

  /** The drawings selected, as the board draws them. */
  get selectedDrawings() {
    const drawings = selectedDrawings(this.#board.selection());
    return (this.#board.data().drawings ?? []).filter((ink) => drawings.has(ink.id));
  }

  get selected(): ReadonlyArray<CanvasNode> {
    const { cards } = this.#board.selection();
    return this.#board.data().nodes.filter((node) => cards.has(node.id));
  }

  get centre(): CanvasPoint {
    const { x, y, width, height } = this.#board.view.window();
    return { x: x + width / 2, y: y + height / 2 };
  }

  #selectOne(id: string) {
    this.#board.select({ cards: new Set([id]), arrow: null });
  }

  /** Where a card asked for without a point goes: the view's middle, or room near it. */
  #room(size: { readonly width: number; readonly height: number }): CanvasPoint {
    const cards = this.#board.data().nodes.filter((node) => node.type !== "group");
    return roomNear(
      { ...centeredOn(this.centre, size), ...size },
      cards,
      this.#board.view.window(),
    );
  }

  /** On `point`, or with none, wherever there's room. */
  addTextAt(point: CanvasPoint | null) {
    const document = this.#document;
    if (document === null) return;
    const id = document.mint();
    const at = point === null ? this.#room(TEXT_CARD_SIZE) : centeredOn(point, TEXT_CARD_SIZE);
    document.commit([{ op: "put-card", node: textCard(id, at) }]);
    this.#selectOne(id);
    this.editCard(id);
  }

  /** Drawn with the Card tool; a click drops one of the usual size centred on `at`. */
  drawCard(box: CanvasBounds | null, at: CanvasPoint) {
    const document = this.#document;
    if (document === null) return;
    const id = document.mint();
    const rect = drawnBox(box, at, TEXT_CARD_SIZE, DRAWN_CARD_LEAST);
    document.commit([{ op: "put-card", node: { ...textCard(id, rect), ...rect } }]);
    this.#selectOne(id);
    this.editCard(id);
  }

  /** Drawn with the Section tool: what's wholly inside it is in it, as for any group. */
  drawSection(box: CanvasBounds | null, at: CanvasPoint) {
    const document = this.#document;
    if (document === null) return;
    const id = document.mint();
    document.commit([
      {
        op: "put-card",
        node: groupCard(id, drawnBox(box, at, FILE_CARD_SIZE, DRAWN_SECTION_LEAST)),
      },
    ]);
    this.#selectOne(id);
    this.#board.edit({ kind: "group", id });
  }

  /** Drawn with the Shape tool: a text card with an outline, typed in once it's there. */
  drawShape(shape: CanvasShape, box: CanvasBounds | null, at: CanvasPoint) {
    const document = this.#document;
    if (document === null) return;
    const id = document.mint();
    const rect = drawnBox(box, at, TEXT_CARD_SIZE, DRAWN_CARD_LEAST);
    document.commit([
      { op: "put-card", node: { ...textCard(id, rect), ...rect, astrolabe: { shape } } },
    ]);
    this.#selectOne(id);
    this.editCard(id);
  }

  /** A Pen stroke as it lifted. The Pen stays in hand, so nothing is selected. */
  addStroke(points: ReadonlyArray<number>) {
    const document = this.#document;
    if (document === null) return;
    if ((this.#board.data().drawings?.length ?? 0) >= CANVAS_MAX_DRAWINGS) {
      this.#board.notify(`A board holds at most ${CANVAS_MAX_DRAWINGS} drawings.`);
      return;
    }
    document.commit([{ op: "put-drawing", drawing: canvasStroke(document.mint(), points) }]);
  }

  /** From a menu: its top-left at the click. */
  addCardFromMenu(at: CanvasPoint) {
    const document = this.#document;
    if (document === null) return;
    const id = document.mint();
    document.commit([
      { op: "put-card", node: textCard(id, { x: Math.round(at.x), y: Math.round(at.y) }) },
    ]);
    this.#selectOne(id);
    this.editCard(id);
  }

  async #filesMatching(match: (file: string) => boolean) {
    const files = (await this.#board.host().listFiles?.()) ?? [];
    return files.filter(match).map((value) => ({ value, label: value }));
  }

  /** A file picked, with a new note made first when that's what was asked for. */
  async #pickFile(title: string, match: (file: string) => boolean, allowNew: boolean) {
    const picked = await this.#board.pick({
      title,
      options: await this.#filesMatching(match),
      allowNew,
    });
    if (picked === null) return null;
    if (picked.kind === "existing") return picked.value;
    const file = await this.#placed(picked.name);
    if (file === null) return null;
    const failure = await this.#board.host().writeNote?.(file, "");
    if (failure) {
      this.#board.notify(failure);
      return null;
    }
    return file;
  }

  /** A new note's file, wherever the host puts it. A folder in `name` overrides that. */
  async #placed(name: string) {
    const place = this.#board.host().placeNote;
    if (place === undefined) return /\.md$/i.test(name) ? name : `${name}.md`;
    const file = await place(name);
    if (file === null) this.#board.notify(`A note can't be made from ${name}.`);
    return file;
  }

  /** How big a card for `file` comes: an image keeps its shape at 400 wide. */
  async #sizeFor(file: string) {
    if (canvasFileKind(file) !== "image") return FILE_CARD_SIZE;
    const url = await this.#board.host().assetUrl?.(file);
    const image = url ? await measureImage(url) : null;
    return image === null
      ? FILE_CARD_SIZE
      : {
          width: FILE_CARD_SIZE.width,
          height: Math.max(CANVAS_MIN_SIZE, ratioHeight(FILE_CARD_SIZE.width, image)),
        };
  }

  async addFile(kind: "note" | "media", at: CanvasPoint | null) {
    const file = await this.pickFile(kind);
    if (file === null) return;
    await this.placeFile(file, at);
  }

  pickFile(kind: "note" | "media") {
    return kind === "note"
      ? this.#pickFile("Add a note from this wiki", (file) => NOTE_FILE.test(file), true)
      : this.#pickFile(
          "Add media from this wiki",
          (file) => MEDIA_KINDS.has(canvasFileKind(file)),
          false,
        );
  }

  async placeFile(file: string, point: CanvasPoint | null) {
    const document = this.#document;
    if (document === null) return;
    const size = await this.#sizeFor(file);
    const at = point ?? this.#room(size);
    const id = document.mint();
    document.commit([
      {
        op: "put-card",
        node: fileCard(id, { x: Math.round(at.x), y: Math.round(at.y) }, file, size),
      },
    ]);
    this.#selectOne(id);
  }

  /** A drag from a wiki's tree, whose folders stand for all they hold (see `filesOfDrop`). */
  async placeDropped(dropped: ReadonlyArray<string>, at: CanvasPoint) {
    const folders = dropped.some((path) => path.endsWith("/"));
    const listed = folders ? ((await this.#board.host().listFiles?.()) ?? []) : [];
    const { files, left } = filesOfDrop(dropped, listed);
    if (folders && files.length === 0) this.#board.notify("That folder has no files to add here.");
    if (left > 0) this.#board.notify(`Added ${files.length} cards. ${left} more didn't fit.`);
    this.placeFiles(files, at);
  }

  /** Files dropped or dragged in: one card each, in a row from the drop that wraps. */
  placeFiles(files: ReadonlyArray<string>, at: CanvasPoint) {
    const document = this.#document;
    if (document === null || files.length === 0) return;
    const columns = Math.ceil(Math.sqrt(files.length));
    const step = FILE_CARD_SIZE.width + CANVAS_GAP;
    const cards = files.map((file, position) => {
      const x = Math.round(at.x) + (position % columns) * step;
      const y = Math.round(at.y) + Math.floor(position / columns) * step;
      return fileCard(document.mint(), { x, y }, file);
    });
    document.commit(cards.map((node) => ({ op: "put-card", node })));
    this.#board.select({ cards: new Set(cards.map((card) => card.id as string)), arrow: null });
  }

  async addWebPage(point: CanvasPoint | null) {
    const document = this.#document;
    if (document === null) return;
    const url = await this.#board.prompt({
      title: "Add web page",
      label: "Address",
      submit: "Add",
    });
    if (url === null || url.trim() === "") return;
    const at = point ?? this.#room(FILE_CARD_SIZE);
    const id = document.mint();
    document.commit([
      {
        op: "put-card",
        node: linkCard(id, { x: Math.round(at.x), y: Math.round(at.y) }, url.trim()),
      },
    ]);
    this.#selectOne(id);
  }

  /** Around what's selected, or an empty one at `at`; its label is ready to edit either way. */
  createGroup(point: CanvasPoint | null) {
    const document = this.#document;
    if (document === null) return;
    const { selected } = this;
    const at = point ?? this.#room(FILE_CARD_SIZE);
    const rect =
      selected.length > 0
        ? groupAround(selected)
        : { x: Math.round(at.x), y: Math.round(at.y), ...FILE_CARD_SIZE };
    const id = document.mint();
    document.commit([{ op: "put-card", node: groupCard(id, rect) }]);
    this.#selectOne(id);
    this.#board.edit({ kind: "group", id });
  }

  remove() {
    const document = this.#document;
    if (document === null) return;
    const { arrow } = this.#board.selection();
    if (arrow !== null) {
      document.commit([{ op: "remove-arrow", arrow }]);
    } else {
      // A group goes alone: what's in it stays on the board.
      document.commit([
        ...this.selectedDrawings.map((ink): CanvasHandEdit => ({
          op: "remove-drawing",
          drawing: ink.id,
        })),
        ...this.selected.map((node): CanvasHandEdit => ({ op: "remove-card", card: node.id })),
      ]);
    }
    this.#board.select({ cards: new Set(), arrow: null });
  }

  setColor(color: string | null) {
    const document = this.#document;
    if (document === null) return;
    const { arrow } = this.#board.selection();
    const keys = { color };
    document.commit(
      arrow !== null
        ? [{ op: "set-arrow", arrow, keys }]
        : [
            ...this.selected.map((node): CanvasHandEdit => ({
              op: "set-card",
              card: node.id,
              keys,
            })),
            ...this.selectedDrawings.map((ink): CanvasHandEdit => ({
              op: "set-drawing",
              drawing: ink.id,
              keys,
            })),
          ],
    );
  }

  zoomToSelection() {
    const { arrow } = this.#board.selection();
    const { view } = this.#board;
    const { selected } = this;
    const rects = new Map(this.#board.data().nodes.map((node) => [node.id, node]));
    const drawn = this.selectedDrawings.flatMap((ink) => canvasInkBounds(ink, rects) ?? []);
    if (selected.length > 0 || drawn.length > 0) {
      view.focus(boundsOfRects([...selected, ...drawn]));
      return;
    }
    const edge = arrow === null ? undefined : this.#edge(arrow);
    if (edge === undefined) return;
    const ends = [this.#node(edge.fromNode), this.#node(edge.toNode)].filter(
      (node): node is CanvasNode => node !== undefined,
    );
    if (ends.length > 0) view.focus(boundsOfRects(ends));
  }

  editCard(id: string) {
    const node = this.#node(id);
    const document = this.#document;
    if (node === undefined || document === null) return;
    if (node.type === "text") {
      document.startTyping(id);
      this.#board.edit({ kind: "card", id });
    } else if (node.type === "file" && canvasFileKind(node.file) === "note") {
      if (this.#board.host().writeNote !== undefined) {
        this.#board.edit({ kind: "note", id, file: node.file });
      }
    }
  }

  editSelected() {
    const [only, more] = this.selected;
    const { arrow } = this.#board.selection();
    const [drawn, another] = this.selectedDrawings;
    if (arrow !== null) {
      this.#board.edit({ kind: "arrow", id: arrow });
    } else if (only === undefined && drawn?.type === "arrow" && another === undefined) {
      this.#board.edit({ kind: "drawing", id: drawn.id });
    } else if (only !== undefined && more === undefined) {
      if (only.type === "group") this.#board.edit({ kind: "group", id: only.id });
      else this.editCard(only.id);
    }
  }

  /** What Align acts on: a selection, or what's inside a lone group. */
  #arranged(): ReadonlyArray<CanvasNode> {
    const { selected } = this;
    const [only, more] = selected;
    if (only?.type !== "group" || more !== undefined) return selected;
    const inside = movedWith(this.#board.data().nodes, [only.id]);
    return this.#board.data().nodes.filter((node) => node !== only && inside.has(node.id));
  }

  arrange(kind: CanvasArrangement) {
    this.#document?.commit(arrangeEdits(kind, this.#arranged()));
  }

  nudge(dx: number, dy: number, large: boolean) {
    const document = this.#document;
    const { cards } = this.#board.selection();
    if (document === null || cards.size === 0) return;
    const step = large ? CANVAS_NUDGE_LARGE : CANVAS_NUDGE;
    const { nodes } = this.#board.data();
    const moved = movedWith(nodes, cards);
    document.commit(
      nodes.flatMap((node): CanvasHandEdit[] =>
        moved.has(node.id)
          ? [{ op: "move", card: node.id, x: node.x + dx * step, y: node.y + dy * step }]
          : [],
      ),
      { merge: `nudge:${[...cards].join(",")}` },
    );
  }

  /** The keyboard's way to resize: the far edge stays, as a handle's does. */
  grow(dx: number, dy: number, large: boolean) {
    const [only, more] = this.selected;
    if (only === undefined || more !== undefined) return;
    const step = large ? CANVAS_NUDGE_LARGE : CANVAS_GRID;
    this.#document?.commit([
      {
        op: "resize",
        card: only.id,
        x: only.x,
        y: only.y,
        width: Math.max(CANVAS_MIN_SIZE, only.width + dx * step),
        height: Math.max(CANVAS_MIN_SIZE, only.height + dy * step),
      },
    ]);
  }

  /** The nearest card that way, for reaching cards from the keyboard. */
  selectToward(dx: number, dy: number) {
    const { nodes } = this.#board.data();
    const from = this.selected[0];
    const origin = from ? { x: from.x + from.width / 2, y: from.y + from.height / 2 } : this.centre;
    const inView = this.#board.view.window(400);
    let best: CanvasNode | undefined;
    let bestScore = Infinity;
    for (const node of nodes) {
      if (node === from || node.type === "group" || !overlaps(node, inView)) continue;
      const x = node.x + node.width / 2 - origin.x;
      const y = node.y + node.height / 2 - origin.y;
      const along = x * dx + y * dy;
      if (from !== undefined && along <= 0) continue;
      const score = Math.hypot(x, y) + Math.abs(x * dy) + Math.abs(y * dx);
      if (score < bestScore) {
        best = node;
        bestScore = score;
      }
    }
    if (best !== undefined) this.#selectOne(best.id);
  }

  selectAll() {
    const { nodes, drawings = [] } = this.#board.data();
    this.#board.select({
      cards: new Set(nodes.map((node) => node.id)),
      arrow: null,
      drawings: new Set(drawings.map((ink) => ink.id)),
    });
  }

  clip(): { readonly clip: CanvasClip; readonly text: string } | null {
    const { cards } = this.#board.selection();
    const document = this.#document;
    if (cards.size === 0 || document === null) return null;
    const clip = canvasClip(document.document, this.#board.data().nodes, cards);
    const copied = { clip, text: clipText(clip) };
    lastClip = copied;
    return copied;
  }

  /** Copied from a menu, where there's no clipboard event to write to. */
  copy() {
    const copied = this.clip();
    if (copied !== null) this.#board.host().copyText?.(copied.text);
  }

  cut() {
    if (this.clip() !== null) this.remove();
  }

  pasteClip(clip: CanvasClip, at: CanvasPoint) {
    const document = this.#document;
    if (document === null) return;
    const { edits, cards } = pasteClip(clip, at, document.mint);
    document.commit(edits);
    this.#board.select({ cards: new Set(cards), arrow: null });
  }

  /** Whatever was copied, from a menu. */
  async pasteFromMenu(at: CanvasPoint) {
    const text = await navigator.clipboard?.readText?.().catch(() => null);
    const held = lastClip;
    if (held !== null && (text === undefined || text === null || text === held.text)) {
      this.pasteClip(held.clip, at);
    } else if (typeof text === "string" && text !== "") {
      this.pasteText(text, at);
    }
  }

  pasteText(text: string, at: CanvasPoint) {
    const document = this.#document;
    if (document === null) return;
    const clip = parseClip(text);
    if (clip !== null) {
      this.pasteClip(clip, at);
      return;
    }
    const node = pastedCard(document.mint(), at, text);
    document.commit([{ op: "put-card", node }]);
    this.#selectOne(node.id as string);
    if (node.type === "text") this.editCard(node.id as string);
  }

  /** The cards a duplicate gives: as Alt-drag does, 20 down and across, for a finger or a menu. */
  duplicate() {
    const document = this.#document;
    const { cards } = this.#board.selection();
    if (document === null || cards.size === 0) return;
    const placed = placeClip(
      canvasClip(document.document, this.#board.data().nodes, cards),
      CANVAS_GAP,
      CANVAS_GAP,
      document.mint,
    );
    document.commit(placed.edits);
    this.#board.select({ cards: new Set(placed.cards), arrow: null });
  }

  /** A text card as a note: the same place and size, under a new id, arrows kept. */
  async convertToFile(id: string) {
    const document = this.#document;
    const raw = document?.raw(id);
    const host = this.#board.host();
    if (document === null || raw === undefined || raw.type !== "text") return;
    const name = await this.#board.prompt({
      title: "Convert to file",
      label: "File name",
      initial: "Untitled",
      submit: "Convert",
    });
    if (name === null || name.trim() === "") return;
    const placed = await this.#placed(name.trim());
    if (placed === null) return;
    const file = await this.#freeName(placed);
    const failure = await host.writeNote?.(file, String(raw.text ?? ""));
    if (failure) {
      this.#board.notify(failure);
      return;
    }
    const { text: _text, ...rest } = raw;
    const next = { ...rest, id: document.mint(), type: "file", file };
    document.commit(replaceCard(raw, next, this.#board.data().edges));
    this.#selectOne(next.id);
  }

  /** `name.md`, or `name 1.md`, as the first the wiki doesn't hold. */
  async #freeName(name: string) {
    const files = new Set(
      ((await this.#board.host().listFiles?.()) ?? []).map((file) => file.toLowerCase()),
    );
    const bare = name.replace(/\.md$/i, "");
    let candidate = `${bare}.md`;
    for (let count = 1; files.has(candidate.toLowerCase()); count++) {
      candidate = `${bare} ${count}.md`;
    }
    return candidate;
  }

  async swapFile(id: string) {
    const file = await this.#pickFile(
      "Swap file",
      (each) => canvasFileKind(each) !== "other",
      false,
    );
    if (file === null) return;
    this.#document?.commit([{ op: "set-card", card: id, keys: { file, subpath: null } }]);
  }

  /** Makes the note a missing card names, and the card follows it there. */
  async newNote(node: CanvasFileNode) {
    const file = await this.#placed(node.file);
    if (file === null) return;
    const failure = await this.#board.host().writeNote?.(file, "");
    if (failure) {
      this.#board.notify(failure);
      return;
    }
    if (file !== node.file) {
      this.#document?.commit([{ op: "set-card", card: node.id, keys: { file } }]);
    }
    this.#board.reread(file);
  }

  async #fileText(file: string) {
    return (await this.#board.host().readFileText?.(file)) ?? null;
  }

  async narrowToHeading(node: CanvasFileNode) {
    const text = await this.#fileText(node.file);
    if (text === null) return;
    const headings = noteHeadings(text);
    if (headings.length === 0) {
      this.#board.notify(`${cardFileName(node.file)} has no headings.`);
      return;
    }
    const picked = await this.#board.pick({
      title: "Narrow to heading",
      options: headings.map((heading) => ({ value: heading, label: heading })),
    });
    if (picked?.kind !== "existing") return;
    this.#document?.commit([
      { op: "set-card", card: node.id, keys: { subpath: `#${picked.value}` } },
    ]);
  }

  async narrowToBlock(node: CanvasFileNode) {
    const text = await this.#fileText(node.file);
    if (text === null) return;
    const blocks = noteBlocks(text);
    if (blocks.length === 0) {
      this.#board.notify(`${cardFileName(node.file)} has no blocks.`);
      return;
    }
    const picked = await this.#board.pick({
      title: "Narrow to block",
      options: blocks.map((block, position) => ({ value: String(position), label: block.text })),
    });
    if (picked?.kind !== "existing") return;
    const block = blocks[Number(picked.value)];
    if (block === undefined) return;
    let { id } = block;
    if (id === null) {
      id = this.#document?.mint().slice(0, 6) ?? "";
      const failure = await this.#board
        .host()
        .writeNote?.(node.file, noteWithBlockId(text, block.line, id));
      if (failure) {
        this.#board.notify(failure);
        return;
      }
    }
    this.#document?.commit([{ op: "set-card", card: node.id, keys: { subpath: `#^${id}` } }]);
  }

  clearSubpath(id: string) {
    this.#document?.commit([{ op: "set-card", card: id, keys: { subpath: null } }]);
  }

  async pinView(node: CanvasFileNode) {
    const text = await this.#fileText(node.file);
    const views = text === null ? [] : baseViewNames(text);
    if (views.length === 0) {
      this.#board.notify(`${cardFileName(node.file)} has no named views.`);
      return;
    }
    const picked = await this.#board.pick({
      title: "Pin view",
      options: views.map((view) => ({ value: view, label: view })),
    });
    if (picked?.kind !== "existing") return;
    this.#document?.commit([
      { op: "set-card", card: node.id, keys: { subpath: `#${picked.value}` } },
    ]);
  }

  async changeUrl(node: CanvasLinkNode) {
    const url = await this.#board.prompt({
      title: "Change URL",
      label: "Address",
      initial: node.url,
      submit: "Change",
    });
    if (url === null || url.trim() === "") return;
    this.#document?.commit([{ op: "set-card", card: node.id, keys: { url: url.trim() } }]);
  }

  async rename(node: CanvasFileNode) {
    const name = cardFileName(node.file).replace(/\.(canvas|base)$/i, "");
    const to = await this.#board.prompt({
      title: "Rename",
      label: "New name",
      initial: name,
      submit: "Rename",
    });
    if (to === null || to.trim() === "" || to.trim() === name) return;
    const failure = await this.#board.host().renameDocument?.(node.file, to.trim());
    if (failure) this.#board.notify(failure);
  }

  reloadPage(id: string) {
    const frame = this.#board.element(id)?.querySelector("iframe");
    frame?.setAttribute("src", frame.src);
  }

  setLineDirection(arrow: string, direction: CanvasLineDirection) {
    this.#document?.commit([lineDirectionEdit(arrow, direction)]);
  }

  followConnection(arrow: string, from: CanvasPoint) {
    const edge = this.#edge(arrow);
    if (edge === undefined) return;
    const start = this.#node(edge.fromNode);
    const end = this.#node(edge.toNode);
    if (start === undefined || end === undefined) return;
    const distance = (node: CanvasNode) =>
      Math.hypot(node.x + node.width / 2 - from.x, node.y + node.height / 2 - from.y);
    this.#board.view.center(distance(start) > distance(end) ? start : end);
    this.#board.select({ cards: new Set(), arrow: null });
  }

  async setBackground(group: CanvasGroupNode) {
    const file = await this.#pickFile(
      "Set background",
      (each) => canvasFileKind(each) === "image",
      false,
    );
    if (file === null) return;
    this.#document?.commit([{ op: "set-card", card: group.id, keys: { background: file } }]);
  }

  removeBackground(group: CanvasGroupNode) {
    this.#document?.commit([{ op: "set-card", card: group.id, keys: { background: null } }]);
  }

  /** "ratio" sets the group's shape from the image, as it does in Obsidian. */
  async setBackgroundStyle(group: CanvasGroupNode, style: "cover" | "ratio" | "repeat") {
    const document = this.#document;
    if (document === null) return;
    if (style !== "ratio" || group.background === undefined) {
      document.commit([
        {
          op: "set-card",
          card: group.id,
          keys: { backgroundStyle: style === "cover" ? null : style },
        },
      ]);
      return;
    }
    const url = await this.#board.host().assetUrl?.(group.background);
    const image = url ? await measureImage(url) : null;
    document.commit([
      {
        op: "set-card",
        card: group.id,
        keys: {
          backgroundStyle: "ratio",
          ...(image === null ? {} : { height: ratioHeight(group.width, image) }),
        },
      },
    ]);
  }

  #cardOptions(except: string) {
    return this.#board
      .data()
      .nodes.filter((node) => node.id !== except)
      .map((node) => ({ value: node.id, label: canvasCardName({ ...node }) }));
  }

  /** Dragging a dot, from the keyboard: the sides that face each other. */
  async connectTo(id: string) {
    const document = this.#document;
    const from = this.#node(id);
    if (document === null || from === undefined) return;
    const picked = await this.#board.pick({
      title: "Connect to",
      options: this.#cardOptions(id),
    });
    if (picked?.kind !== "existing") return;
    const to = this.#node(picked.value);
    if (to === undefined) return;
    const [fromSide, toSide] = canvasArrowSides(from, to);
    document.commit([
      {
        op: "put-arrow",
        edge: arrowBetween(
          document.mint(),
          { node: id, side: fromSide },
          { node: to.id, side: toSide },
        ),
      },
    ]);
  }

  /** The keyboard's way to reach an arrow. */
  async selectConnection(id: string) {
    const name = (end: string) => {
      const node = this.#node(end);
      return node === undefined ? "A missing card" : canvasCardName({ ...node });
    };
    const options = this.#board
      .data()
      .edges.filter((edge) => edge.fromNode === id || edge.toNode === id)
      .map((edge) => ({
        value: edge.id,
        label: `${name(edge.fromNode)} → ${name(edge.toNode)}`,
      }));
    const picked = await this.#board.pick({ title: "Select connection", options });
    if (picked?.kind === "existing") this.select({ cards: new Set(), arrow: picked.value });
  }

  /** Dragging an arrow's end, from the keyboard. */
  async moveEnd(arrow: string, end: "from" | "to") {
    const edge = this.#edge(arrow);
    if (edge === undefined) return;
    const fixed = end === "from" ? edge.toNode : edge.fromNode;
    const picked = await this.#board.pick({
      title: end === "from" ? "Move the start to" : "Move the end to",
      options: this.#cardOptions(fixed),
    });
    if (picked?.kind !== "existing") return;
    const keep = this.#node(fixed);
    const next = this.#node(picked.value);
    if (keep === undefined || next === undefined) return;
    const [keptSide, nextSide] = canvasArrowSides(keep, next);
    this.#document?.commit([
      {
        op: "set-arrow",
        arrow,
        keys:
          end === "from"
            ? { fromNode: next.id, fromSide: nextSide, toSide: keptSide }
            : { toNode: next.id, toSide: nextSide, fromSide: keptSide },
      },
    ]);
  }

  /** A line ending in nothing, given a new text card to end on. */
  addCardToLooseEnd(end: CanvasLooseEnd, at: CanvasPoint) {
    const document = this.#document;
    if (document === null) return;
    const id = document.mint();
    const side = end.kind === "new" ? end.from.side : end.fixed.side;
    const place = cardAtConnectionDrop(side, at, TEXT_CARD_SIZE);
    const node = textCard(id, { x: Math.round(place.x), y: Math.round(place.y) });
    document.commit([{ op: "put-card", node }, this.#loosened(end, id, OPPOSITE_SIDE[side])]);
    this.#selectOne(id);
    this.editCard(id);
  }

  async addNoteToLooseEnd(end: CanvasLooseEnd, at: CanvasPoint) {
    const document = this.#document;
    if (document === null) return;
    const file = await this.pickFile("note");
    if (file === null) return;
    const id = document.mint();
    const side = end.kind === "new" ? end.from.side : end.fixed.side;
    const place = cardAtConnectionDrop(side, at, FILE_CARD_SIZE);
    const node = fileCard(id, { x: Math.round(place.x), y: Math.round(place.y) }, file);
    document.commit([{ op: "put-card", node }, this.#loosened(end, id, OPPOSITE_SIDE[side])]);
    this.#selectOne(id);
  }

  #loosened(end: CanvasLooseEnd, node: string, side: CanvasEdge["toSide"]): CanvasHandEdit {
    const document = this.#document;
    if (end.kind === "new") {
      return {
        op: "put-arrow",
        edge: arrowBetween(document?.mint() ?? "", end.from, { node, side: side ?? "left" }),
      };
    }
    return {
      op: "set-arrow",
      arrow: end.arrow.id,
      keys:
        end.end === "from" ? { fromNode: node, fromSide: side } : { toNode: node, toSide: side },
    };
  }

  fitToContent(id: string, handle: CanvasHandle) {
    const node = this.#node(id);
    const body = this.#board.element(id)?.querySelector<HTMLElement>(".cv-card-body");
    const document = this.#document;
    if (node === undefined || body === undefined || body === null || document === null) return;
    const content = measureContent(body, node);
    const { x, y, width, height } = fitToContent(node, handle, content);
    document.commit([{ op: "resize", card: id, x, y, width, height }]);
  }

  openExport() {
    this.#board.openExport();
  }

  /** The arrangement of a whole selection's bounding box, for the menu's way into Align. */
  get canArrange() {
    return this.#arranged().length > 1;
  }

  boundsOfSelection(): CanvasBounds | null {
    const { selected } = this;
    return selected.length === 0 ? null : boundsOfRects(selected);
  }

  get document() {
    return this.#document;
  }

  get host() {
    return this.#board.host();
  }
}

/** A card's text laid out at its width, and again as wide as it wants, off screen. */
function measureContent(body: HTMLElement, node: CanvasNode) {
  const clone = body.cloneNode(true) as HTMLElement;
  clone.style.cssText =
    "position:absolute;visibility:hidden;left:0;top:0;min-height:0;height:auto;width:max-content;max-width:none";
  body.parentElement?.append(clone);
  const width = clone.offsetWidth;
  clone.style.width = `${node.width}px`;
  const height = clone.offsetHeight;
  clone.remove();
  return { width, height };
}
