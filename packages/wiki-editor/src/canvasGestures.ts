import type { CanvasHandEdit } from "@mercurian/wiki/canvas-edits";
import {
  canvasArrowSides,
  type CanvasBounds,
  type CanvasData,
  type CanvasEdge,
  type CanvasInk,
  type CanvasInkArrow,
  type CanvasInkEnd,
  type CanvasNode,
  type CanvasSide,
} from "@mercurian/wiki/canvas";

import { arrowBetween, canvasClip, placeClip } from "./canvasActions";
import {
  boundsOfRects,
  CANVAS_SNAP_TOLERANCE,
  lockedToAxis,
  movedWith,
  nearestSide,
  resizeRect,
  snapDrag,
  type CanvasHandle,
  type CanvasPoint,
} from "./canvasArrange";
import type { CanvasDocument } from "./canvasDocument";
import {
  canvasDraftPath,
  canvasEdgeEnds,
  canvasEdgeShape,
  canvasFileKind,
  overlaps,
  type CanvasEdgeShape,
} from "./canvasGeometry";
import {
  canvasInkShape,
  canvasEndOnCard,
  canvasInkIsEdge,
  canvasInkTouches,
  canvasInkPath,
  canvasSimplified,
  canvasSimulatedPressure,
  inkArrowEndAt,
  inkMovedWith,
  movedInk,
  type CanvasInkShape,
} from "./canvasInk";
import {
  canvasEraserTouches,
  canvasLassoPick,
  canvasScaledBox,
  canvasScaledInk,
  canvasScaleEdits,
  canvasScaleFor,
  canvasScaleLeast,
  canvasSelectionBounds,
  type CanvasScale,
} from "./canvasSelect";
import type { CanvasRouteBox } from "./canvasRoute";
import type { CanvasView } from "./canvasView";

/** Between 3 and 5 pixels in Obsidian. */
const DRAG_SLOP = 4;
const DOUBLE_MS = 350;
const DOUBLE_SLOP = 16;
const LONG_PRESS_MS = 500;
/** A left-edge touch belongs to the phone's back swipe, not the board. */
const BACK_SWIPE_EDGE = 24;
/** Inside a live card these are the content's own, whatever the board would do. */
const CONTENT = "a[href],button,input,textarea,select,summary,iframe,video,audio,label";

export interface CanvasSelection {
  readonly cards: ReadonlySet<string>;
  readonly arrow: string | null;
  /** Strokes and drawn arrows, which go with the cards: left out, none is selected. */
  readonly drawings?: ReadonlySet<string>;
}

export const NO_SELECTION: CanvasSelection = { cards: new Set(), arrow: null };

const NO_DRAWINGS: ReadonlySet<string> = new Set();
export const selectedDrawings = (selection: CanvasSelection): ReadonlySet<string> =>
  selection.drawings ?? NO_DRAWINGS;

/** What a plain drag on an editable board does. Space-drag pans in every one. */
export type CanvasTool =
  | "hand"
  | "select"
  | "lasso"
  | "card"
  | "section"
  | "arrow"
  | "pen"
  | "eraser"
  | "shape";

/** A press this near an arrow's end, on screen, takes that end. */
const END_REACH = 10;
/** An end dropped this near a card's outline, on screen, holds there; nearer a middle, there. */
const EDGE_REACH = 16;
const MIDDLE_SNAP = 10;
/** How near the eraser's path a line's edge must come, on screen: a finger is wider. */
const ERASER_REACH = 5;
const ERASER_REACH_TOUCH = 10;
/**
 * Past this many points in the strokes a scale holds, each frame stretches them rather than
 * drawing them again: their lines thicken with them until the scale lands.
 */
const SCALE_REDRAW_POINTS = 20_000;
/** The eraser's trail behind the pointer, in points. */
const ERASER_TRAIL = 12;

/** A line dropped where there's no card: the host asks what to do with it. */
export type CanvasLooseEnd =
  | {
      readonly kind: "new";
      readonly from: { readonly node: string; readonly side: CanvasSide };
    }
  | {
      readonly kind: "retarget";
      readonly arrow: CanvasEdge;
      /** The end being dragged. */
      readonly end: "from" | "to";
      readonly fixed: { readonly node: string; readonly side: CanvasSide };
    };

export interface CanvasGestureHost {
  readonly view: CanvasView;
  readonly board: () => HTMLElement | null;
  readonly world: () => HTMLElement | null;
  readonly data: () => CanvasData;
  readonly shapes: () => ReadonlyArray<CanvasEdgeShape>;
  readonly inks: () => ReadonlyArray<CanvasInkShape>;
  readonly selection: () => CanvasSelection;
  readonly select: (selection: CanvasSelection) => void;
  /** Edits land here; null keeps the board read only. */
  readonly document: () => CanvasDocument | null;
  /** A new arrow or drawing, in the style the next thing drawn takes. */
  readonly styled: <Raw extends Readonly<Record<string, unknown>>>(kind: "arrow", raw: Raw) => Raw;
  /** How the Pen's stroke draws as it's drawn: its width in board units, and its colour. */
  readonly pen: () => { readonly width: number; readonly color: string | undefined };
  readonly snap: () => { readonly grid: boolean; readonly objects: boolean };
  /** The tap that toggles, for a finger with no Shift. */
  readonly selectMode: () => boolean;
  /** Whether Space is down, which pans. */
  readonly spaceHeld: () => boolean;
  readonly openMenu: (clientX: number, clientY: number, target: Element) => void;
  readonly closeOverlays: () => void;
  readonly openFileCard: (id: string) => void;
  /** Follows a link card drawn too small to hold a link of its own. */
  readonly followSmallLink: (id: string) => boolean;
  readonly editCard: (id: string) => void;
  readonly editGroupLabel: (id: string) => void;
  readonly editArrowLabel: (id: string) => void;
  readonly addTextAt: (point: CanvasPoint) => void;
  readonly tool: () => CanvasTool;
  /** A box drawn with the Card, Section or Shape tool; null for a click, which drops one at `at`. */
  readonly drawn: (
    tool: "card" | "section" | "shape",
    box: CanvasBounds | null,
    at: CanvasPoint,
  ) => void;
  /** A stroke drawn with the Pen: x, y pairs on the board, as the pointer went, and its pressure at each. */
  readonly inked: (points: ReadonlyArray<number>, pressure: ReadonlyArray<number>) => void;
  readonly editInkLabel: (id: string) => void;
  /** A tool's one gesture is over: the pointer selects again. */
  readonly toolDone: () => void;
  readonly fitToContent: (id: string, handle: CanvasHandle) => void;
  /** Resolve with `done` once it's dealt with; the line is drawn until then. */
  readonly looseEnd: (
    end: CanvasLooseEnd,
    at: CanvasPoint,
    clientX: number,
    clientY: number,
    done: () => void,
  ) => void;
}

interface MovedElement {
  readonly element: HTMLElement;
  readonly node: CanvasNode;
}

/** A drawing's elements, redrawn as a gesture moves it or the cards it's on. */
interface InkElement {
  readonly shape: CanvasInkShape;
  readonly group: Element;
  readonly label: HTMLElement | null;
}

interface Followers {
  readonly arrows: ReadonlyArray<{
    readonly shape: CanvasEdgeShape;
    readonly group: Element;
    readonly label: HTMLElement | null;
  }>;
  /** Drawn arrows with an end on what moves. */
  readonly inks: ReadonlyArray<InkElement>;
}

const NO_FOLLOWERS: Followers = { arrows: [], inks: [] };

type Session =
  | { readonly kind: "pan" }
  | { readonly kind: "marquee"; element: HTMLElement | null; readonly additive: boolean }
  | {
      readonly kind: "draw";
      readonly tool: "card" | "section" | "shape";
      element: HTMLElement | null;
    }
  /** The Pen's line, one path updated as it goes; the board draws nothing new until it lifts. */
  | {
      readonly kind: "ink";
      readonly points: number[];
      readonly pressure: number[];
      /** The pointer says how hard it presses: a pen, or a finger on a screen that feels force. */
      readonly pressed: boolean;
      readonly width: number;
      draft: SVGPathElement | null;
    }
  /** The Arrow tool from where there's no card. */
  | { readonly kind: "free-arrow"; readonly from: CanvasPoint; draft: SVGPathElement | null }
  /** A drawn arrow's end, dragged: onto a card it holds there. */
  | {
      readonly kind: "ink-end";
      readonly ink: CanvasInkArrow;
      readonly end: "from" | "to";
      element: InkElement | null;
    }
  | {
      readonly kind: "drag";
      /** What was pressed: a card's id, or a drawing's. */
      readonly card: string;
      readonly ink: boolean;
      drawings: ReadonlySet<string>;
      inks: ReadonlyArray<InkElement>;
      started: boolean;
      moved: ReadonlySet<string>;
      elements: ReadonlyArray<MovedElement>;
      /** The selected card's frame, which moves with it unless Alt leaves it behind. */
      frames: ReadonlyArray<HTMLElement>;
      ghosts: ReadonlyArray<HTMLElement>;
      others: ReadonlyArray<CanvasBounds>;
      box: CanvasBounds;
      followers: Followers;
      /** Every card where it was, so a frame only works out what moved. */
      rects: ReadonlyMap<string, CanvasBounds>;
      delta: CanvasPoint;
    }
  | {
      readonly kind: "resize";
      readonly card: CanvasNode;
      readonly handle: CanvasHandle;
      readonly element: HTMLElement | null;
      readonly frame: HTMLElement | null;
      readonly aspect: number | undefined;
      readonly followers: Followers;
      rect: CanvasBounds;
    }
  | {
      readonly kind: "connect";
      readonly from: CanvasNode;
      readonly side: CanvasSide;
      /** Drawn with the Arrow tool from anywhere on the card: its sides face each other. */
      readonly tool: boolean;
      draft: SVGPathElement | null;
    }
  | {
      readonly kind: "retarget";
      readonly arrow: CanvasEdge;
      readonly end: "from" | "to";
      readonly fixed: CanvasNode;
      readonly fixedSide: CanvasSide;
      draft: SVGPathElement | null;
      hidden: HTMLElement | SVGElement | null;
    }
  /** The box round several things, or a drawing, dragged by a handle: all of it scales. */
  | {
      readonly kind: "scale";
      readonly handle: CanvasHandle;
      readonly box: CanvasBounds;
      readonly nodes: ReadonlyArray<CanvasNode>;
      readonly drawings: ReadonlyArray<CanvasInk>;
      readonly rects: ReadonlyMap<string, CanvasBounds>;
      readonly least: CanvasPoint;
      elements: ReadonlyArray<MovedElement>;
      inks: ReadonlyArray<InkElement>;
      followers: Followers;
      frame: HTMLElement | null;
      readonly stretch: boolean;
      /** What the gesture redraws, as it was: put back unless the document changes it. */
      restore: () => void;
      scale: CanvasScale | null;
    }
  /** A loop drawn with the Lasso: what it encloses is selected when it lifts. */
  | {
      readonly kind: "lasso";
      readonly points: number[];
      readonly additive: boolean;
      draft: SVGPathElement | null;
    }
  /** The Eraser's drag: what it touches fades, and goes when it lifts. */
  | {
      readonly kind: "erase";
      readonly marked: Set<string>;
      readonly rects: ReadonlyMap<string, CanvasBounds>;
      readonly reach: number;
      readonly trail: number[];
      last: CanvasPoint;
      draft: SVGPathElement | null;
    }
  | { readonly kind: "none" };

interface Press {
  readonly id: number;
  readonly touch: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly start: CanvasPoint;
  readonly target: Element;
  readonly shift: boolean;
  /** Shift-pressed on a selected card: a click takes it out; a drag doesn't. */
  readonly togglesOff: boolean;
  /** It was already selected when pressed, so a click means the second one. */
  readonly wasSelected: boolean;
  x: number;
  y: number;
  ctrl: boolean;
  alt: boolean;
  shifted: boolean;
  moved: boolean;
  session: Session;
}

/** The card a press is on, or whose selection frame it's on. */
const cardIdOf = (target: Element) => {
  const held = target.closest("[data-card-id], [data-frame-for]");
  return held?.getAttribute("data-card-id") ?? held?.getAttribute("data-frame-for") ?? null;
};

const arrowOf = (target: Element) => {
  const hit = target.closest("[data-edge-id], [data-edge-label]");
  return hit?.getAttribute("data-edge-id") ?? hit?.getAttribute("data-edge-label") ?? null;
};

const inkOf = (target: Element) => {
  const hit = target.closest("[data-drawing-id], [data-drawing-label]");
  return hit?.getAttribute("data-drawing-id") ?? hit?.getAttribute("data-drawing-label") ?? null;
};

const NO_DELTA = { x: 0, y: 0 };

const handleOf = (target: Element) =>
  (target.closest("[data-handle]")?.getAttribute("data-handle") ?? null) as CanvasHandle | null;

const sideOf = (target: Element) =>
  (target.closest("[data-side]")?.getAttribute("data-side") ?? null) as CanvasSide | null;

const offset = (rect: CanvasBounds, dx: number, dy: number): CanvasBounds => ({
  x: rect.x + dx,
  y: rect.y + dy,
  width: rect.width,
  height: rect.height,
});

/**
 * Every pointer gesture on a board, outside React: a drag moves transforms and redraws the arrows
 * on what it moves, once a frame, and writes to the document on release. So a gesture renders
 * nothing, however many cards the board holds.
 */
export class CanvasGestures {
  readonly #host: CanvasGestureHost;
  #press: Press | null = null;
  #frame: number | null = null;
  #longPress: ReturnType<typeof setTimeout> | undefined;
  #lastClick: {
    readonly at: number;
    readonly x: number;
    readonly y: number;
    readonly id: string | null;
  } | null = null;
  /** Pointers past the first: a second finger turns any gesture into a pinch. */
  readonly #touches = new Map<number, CanvasPoint>();
  /** iOS finds a tap's click after the tap selected its card: it would land on the live content. */
  #swallowClick = false;

  constructor(host: CanvasGestureHost) {
    this.#host = host;
  }

  /** Whether the click on its way came from a tap this already dealt with. */
  takeSwallowedClick() {
    const swallowed = this.#swallowClick;
    this.#swallowClick = false;
    return swallowed;
  }

  press(event: PointerEvent) {
    const host = this.#host;
    const target = event.target as Element;
    this.#swallowClick = false;
    if (target.closest(".cv-chrome, [data-card-editor]") !== null) return;
    host.closeOverlays();
    if (event.button === 2) return;
    const board = host.board();
    if (board === null) return;
    const touch = event.pointerType === "touch";
    if (touch) {
      this.#touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.#touches.size === 2) {
        this.#becomePinch(event);
        return;
      }
    }
    if (touch && event.clientX - board.getBoundingClientRect().left < BACK_SWIPE_EDGE) return;
    const live = target.closest("[data-live]");
    const document = host.document();
    if (live !== null && (document === null || target.closest(CONTENT) !== null)) return;
    // A board that only reads opens a card's link at once, selected or not.
    if (
      document === null &&
      target.closest(".cv-card-content")?.contains(target.closest(CONTENT))
    ) {
      return;
    }

    const start = host.view.toWorld(event.clientX, event.clientY);
    const selection = host.selection();
    // A group's body clicks through, unless it's selected: an unlabelled one has nothing else.
    const groupBody = target.closest(".cv-group");
    const card =
      groupBody !== null && selection.cards.has(cardIdOf(groupBody) ?? "")
        ? cardIdOf(groupBody)
        : cardIdOf(target.closest(".cv-card, .cv-group-label") ?? board);
    const drawing = inkOf(target);
    const wasSelected =
      (card !== null && selection.cards.has(card)) ||
      (drawing !== null && selectedDrawings(selection).has(drawing));
    const press: Press = {
      id: event.pointerId,
      touch,
      startX: event.clientX,
      startY: event.clientY,
      start,
      target,
      shift: event.shiftKey,
      togglesOff: event.shiftKey && wasSelected,
      wasSelected,
      x: event.clientX,
      y: event.clientY,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shifted: event.shiftKey,
      moved: false,
      session: this.#sessionFor(event, target, card, wasSelected),
    };
    this.#press = press;
    board.setPointerCapture(event.pointerId);
    if (press.session.kind === "pan") {
      host.view.press(event.pointerId, event.clientX, event.clientY);
    }
    const held = ["resize", "scale", "connect", "draw", "ink", "free-arrow", "lasso", "erase"];
    if (touch && !held.includes(press.session.kind)) {
      this.#longPress = setTimeout(() => this.#openMenuFromPress(), LONG_PRESS_MS);
    }
  }

  #sessionFor(
    event: PointerEvent,
    target: Element,
    card: string | null,
    wasSelected: boolean,
  ): Session {
    const host = this.#host;
    const document = host.document();
    const touch = event.pointerType === "touch";
    if (document === null) return { kind: "pan" };
    if (event.button === 1 || host.spaceHeld()) return { kind: "pan" };
    const tool = host.tool();
    if (tool === "hand") return { kind: "pan" };
    if (tool === "card" || tool === "section" || tool === "shape") {
      return { kind: "draw", tool, element: null };
    }
    const at = host.view.toWorld(event.clientX, event.clientY);
    if (tool === "pen") {
      // A pointer that can't feel force reports 0.5 while pressed, and a finger often 0.
      const pressed =
        event.pointerType === "pen" || (touch && event.pressure > 0 && event.pressure !== 0.5);
      return {
        kind: "ink",
        points: [at.x, at.y],
        pressure: [pressed ? event.pressure : 0.5],
        pressed,
        width: host.pen().width,
        draft: null,
      };
    }
    if (tool === "eraser") {
      const reach = (touch ? ERASER_REACH_TOUCH : ERASER_REACH) / host.view.camera.zoom;
      const session: Extract<Session, { kind: "erase" }> = {
        kind: "erase",
        marked: new Set(),
        rects: new Map(host.data().nodes.map((node) => [node.id, node])),
        reach,
        trail: [at.x, at.y],
        last: at,
        draft: null,
      };
      this.#erase(session, at, event.altKey);
      return session;
    }
    if (tool === "lasso" && !wasSelected && handleOf(target) === null) {
      return { kind: "lasso", points: [at.x, at.y], additive: event.shiftKey, draft: null };
    }
    if (tool === "arrow") {
      const from = this.#cardAt(at);
      return from === undefined
        ? { kind: "free-arrow", from: at, draft: null }
        : { kind: "connect", from, side: "right", tool: true, draft: null };
    }

    const handle = handleOf(target);
    if (handle !== null && target.closest("[data-selection-box]") !== null) {
      const session = this.#scaleSession(handle);
      if (session !== null) return session;
    }
    if (handle !== null) {
      const id = cardIdOf(target);
      const node = host.data().nodes.find((each) => each.id === id);
      if (node !== undefined) return this.#resizeSession(node, handle);
    }
    const side = sideOf(target);
    if (side !== null) {
      const id = cardIdOf(target);
      const node = host.data().nodes.find((each) => each.id === id);
      if (node !== undefined)
        return { kind: "connect", from: node, side, tool: false, draft: null };
    }
    const arrow = arrowOf(target);
    if (arrow !== null) {
      const session = this.#retargetSession(arrow, event);
      if (session !== null) return session;
    }
    const drawing = inkOf(target);
    const shape =
      drawing === null ? undefined : host.inks().find((each) => each.ink.id === drawing);
    if (shape !== undefined) {
      const { ink } = shape;
      if (ink.type === "arrow") {
        const rects = new Map(host.data().nodes.map((node) => [node.id, node]));
        const end = inkArrowEndAt(ink, at, rects, END_REACH / host.view.camera.zoom);
        if (end !== null) {
          host.select({ cards: new Set(), arrow: null, drawings: new Set([ink.id]) });
          return { kind: "ink-end", ink, end, element: null };
        }
      }
      const selection = host.selection();
      const drawings = selectedDrawings(selection);
      if (!drawings.has(ink.id)) {
        host.select(
          event.shiftKey
            ? { ...selection, arrow: null, drawings: new Set([...drawings, ink.id]) }
            : { cards: new Set(), arrow: null, drawings: new Set([ink.id]) },
        );
      }
      return this.#dragSession(ink.id, true);
    }
    if (card !== null) {
      if (touch && !wasSelected) return { kind: "pan" };
      if (!wasSelected && !event.shiftKey) {
        host.select({ cards: new Set([card]), arrow: null });
      } else if (!wasSelected) {
        const { cards } = host.selection();
        host.select({ cards: new Set([...cards, card]), arrow: null });
      }
      return this.#dragSession(card, false);
    }
    if (touch && !host.selectMode()) return { kind: "pan" };
    return { kind: "marquee", element: null, additive: event.shiftKey };
  }

  #dragSession(card: string, ink: boolean): Session {
    return {
      kind: "drag",
      card,
      ink,
      drawings: NO_DRAWINGS,
      inks: [],
      started: false,
      moved: new Set(),
      elements: [],
      frames: [],
      ghosts: [],
      others: [],
      box: { x: 0, y: 0, width: 0, height: 0 },
      followers: NO_FOLLOWERS,
      rects: new Map(),
      delta: { x: 0, y: 0 },
    };
  }

  #resizeSession(node: CanvasNode, handle: CanvasHandle): Session {
    const element = this.#elementOf(node.id);
    const image = element?.querySelector("img");
    const aspect =
      node.type === "file" && canvasFileKind(node.file) === "image"
        ? image && image.naturalHeight > 0
          ? image.naturalWidth / image.naturalHeight
          : node.width / node.height
        : undefined;
    return {
      kind: "resize",
      card: node,
      handle,
      element,
      frame: this.#frameOf(node.id),
      aspect,
      followers: this.#followers(new Set([node.id])),
      rect: node,
    };
  }

  #scaleSession(handle: CanvasHandle): Session | null {
    const host = this.#host;
    const { nodes, drawings = [] } = host.data();
    const selection = host.selection();
    const inkIds = selectedDrawings(selection);
    const rects = new Map(nodes.map((node) => [node.id, node]));
    const box = canvasSelectionBounds(
      nodes.filter((node) => selection.cards.has(node.id)),
      drawings.filter((ink) => inkIds.has(ink.id)),
      rects,
    );
    if (box === undefined) return null;
    // What a section holds scales with it, as it moves with it.
    const moved = movedWith(nodes, selection.cards);
    const carried = inkMovedWith(nodes, drawings, moved);
    const scaled = drawings.filter((ink) => inkIds.has(ink.id) || carried.has(ink.id));
    const scaledIds = new Set(scaled.map((ink) => ink.id));
    const moving = nodes.filter((node) => moved.has(node.id));
    let points = 0;
    for (const ink of scaled) points += ink.type === "stroke" ? ink.points.length / 2 : 0;
    return {
      kind: "scale",
      stretch: points > SCALE_REDRAW_POINTS,
      handle,
      box,
      nodes: moving,
      drawings: scaled,
      rects,
      least: canvasScaleLeast(box, moving),
      elements: [],
      inks: host
        .inks()
        .flatMap((shape) => (scaledIds.has(shape.ink.id) ? (this.#inkElement(shape) ?? []) : [])),
      followers: this.#followers(moved, scaledIds),
      frame: null,
      restore: () => {},
      scale: null,
    };
  }

  /** The eraser's path from where it was to `to`: what it touches is marked, or with Alt let go. */
  #erase(session: Extract<Session, { kind: "erase" }>, to: CanvasPoint, unmark: boolean) {
    const host = this.#host;
    const world = host.world();
    const from = session.last;
    session.last = to;
    for (const shape of host.inks()) {
      const { id } = shape.ink;
      if (session.marked.has(id) !== unmark) continue;
      if (!canvasEraserTouches(shape, from, to, session.reach)) continue;
      if (unmark) session.marked.delete(id);
      else session.marked.add(id);
      const selector = `g[data-drawing-id="${CSS.escape(id)}"], [data-drawing-label="${CSS.escape(id)}"]`;
      for (const element of world?.querySelectorAll(selector) ?? []) {
        element.toggleAttribute("data-erasing", !unmark);
      }
    }
  }

  #retargetSession(id: string, event: PointerEvent): Session | null {
    const host = this.#host;
    const { nodes, edges } = host.data();
    const arrow = edges.find((each) => each.id === id);
    if (arrow === undefined) return null;
    const from = nodes.find((node) => node.id === arrow.fromNode);
    const to = nodes.find((node) => node.id === arrow.toNode);
    if (from === undefined || to === undefined) return null;
    host.select({ cards: new Set(), arrow: id });
    const point = host.view.toWorld(event.clientX, event.clientY);
    const [fromEnd, toEnd] = canvasEdgeEnds(arrow, from, to);
    const nearFrom =
      Math.hypot(point.x - fromEnd.x, point.y - fromEnd.y) <
      Math.hypot(point.x - toEnd.x, point.y - toEnd.y);
    const fixed = nearFrom ? to : from;
    const fixedSide =
      (nearFrom ? arrow.toSide : arrow.fromSide) ?? nearestSide(fixed, nearFrom ? fromEnd : toEnd);
    return {
      kind: "retarget",
      arrow,
      end: nearFrom ? "from" : "to",
      fixed,
      fixedSide,
      draft: null,
      hidden: null,
    };
  }

  #becomePinch(event: PointerEvent) {
    const host = this.#host;
    this.#clearLongPress();
    const press = this.#press;
    if (press !== null) {
      this.#abandon(press);
      this.#press = null;
    }
    for (const [id, { x, y }] of this.#touches) host.view.press(id, x, y);
    host.board()?.setPointerCapture(event.pointerId);
  }

  #openMenuFromPress() {
    const press = this.#press;
    if (press === null || press.moved) return;
    this.#abandon(press);
    this.#press = null;
    this.#host.openMenu(press.x, press.y, press.target);
    this.#swallowClick = true;
  }

  #clearLongPress() {
    clearTimeout(this.#longPress);
    this.#longPress = undefined;
  }

  move(event: PointerEvent) {
    const host = this.#host;
    if (this.#touches.has(event.pointerId)) {
      this.#touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    host.view.drag(event.pointerId, event.clientX, event.clientY);
    const press = this.#press;
    if (press === null || press.id !== event.pointerId) return;
    press.x = event.clientX;
    press.y = event.clientY;
    press.ctrl = event.ctrlKey;
    press.alt = event.altKey;
    press.shifted = event.shiftKey;
    if (press.session.kind === "ink") this.#addInk(press.session, event);
    if (press.session.kind === "lasso" || press.session.kind === "erase") {
      this.#addPath(press.session, event);
    }
    if (!press.moved) {
      press.moved = Math.hypot(press.x - press.startX, press.y - press.startY) > DRAG_SLOP;
      if (!press.moved) return;
      this.#clearLongPress();
      this.#begin(press);
    }
    if (press.session.kind === "pan" || press.session.kind === "none") return;
    this.#frame ??= requestAnimationFrame(() => {
      this.#frame = null;
      if (this.#press !== null) this.#draw(this.#press);
    });
  }

  /** Every point the pointer went through, not only the last of each frame. */
  #addInk(session: Extract<Session, { kind: "ink" }>, event: PointerEvent) {
    const { view } = this.#host;
    const { points, pressure } = session;
    const least = 1 / view.camera.zoom;
    // A synthetic event has none, a real one at least itself.
    const coalesced = event.getCoalescedEvents?.() ?? [];
    for (const each of coalesced.length > 0 ? coalesced : [event]) {
      const { x, y } = view.toWorld(each.clientX, each.clientY);
      const lastX = points.at(-2) ?? x;
      const lastY = points.at(-1) ?? y;
      const distance = Math.hypot(x - lastX, y - lastY);
      if (points.length > 0 && distance < least) continue;
      points.push(x, y);
      pressure.push(
        session.pressed
          ? each.pressure
          : canvasSimulatedPressure(pressure.at(-1) ?? 0.5, distance, session.width),
      );
    }
  }

  /** The lasso's loop and the eraser's path, through every point the pointer went. */
  #addPath(session: Extract<Session, { kind: "lasso" | "erase" }>, event: PointerEvent) {
    const { view } = this.#host;
    const least = 2 / view.camera.zoom;
    const coalesced = event.getCoalescedEvents?.() ?? [];
    for (const each of coalesced.length > 0 ? coalesced : [event]) {
      const at = view.toWorld(each.clientX, each.clientY);
      const points = session.kind === "lasso" ? session.points : session.trail;
      const lastX = points.at(-2) ?? at.x;
      const lastY = points.at(-1) ?? at.y;
      if (Math.hypot(at.x - lastX, at.y - lastY) < least) continue;
      points.push(at.x, at.y);
      if (session.kind === "erase") {
        if (points.length > ERASER_TRAIL * 2) points.splice(0, 2);
        this.#erase(session, at, event.altKey);
      }
    }
  }

  #inkElement(shape: CanvasInkShape): InkElement | null {
    const world = this.#host.world();
    const id = CSS.escape(shape.ink.id);
    const group = world?.querySelector(`g[data-drawing-id="${id}"]`);
    if (world === null || group === null || group === undefined) return null;
    return {
      shape,
      group,
      label: world.querySelector<HTMLElement>(`[data-drawing-label="${id}"]`),
    };
  }

  #frameOf(id: string) {
    return (
      this.#host.world()?.querySelector<HTMLElement>(`[data-frame-for="${CSS.escape(id)}"]`) ?? null
    );
  }

  #elementOf(id: string) {
    return (
      this.#host.world()?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`) ?? null
    );
  }

  #followers(ids: ReadonlySet<string>, skip: ReadonlySet<string> = NO_DRAWINGS): Followers {
    const world = this.#host.world();
    if (world === null) return NO_FOLLOWERS;
    const shapes = new Map(this.#host.shapes().map((shape) => [shape.edge.id, shape]));
    const arrows: Array<Followers["arrows"][number]> = [];
    for (const group of world.querySelectorAll("g[data-edge-id]")) {
      const id = group.getAttribute("data-edge-id") ?? "";
      const shape = shapes.get(id);
      if (shape === undefined) continue;
      if (!ids.has(shape.edge.fromNode) && !ids.has(shape.edge.toNode)) continue;
      arrows.push({
        shape,
        group,
        label: world.querySelector<HTMLElement>(`[data-edge-label="${CSS.escape(id)}"]`),
      });
    }
    const on = (end: CanvasInkEnd) => "node" in end && ids.has(end.node);
    const inks = this.#host.inks().flatMap((shape) => {
      const { ink } = shape;
      if (ink.type !== "arrow" || skip.has(ink.id) || !(on(ink.from) || on(ink.to))) return [];
      return this.#inkElement(shape) ?? [];
    });
    return { arrows, inks };
  }

  /** The board's cards where a gesture has them, for an elbow to step round: read once a frame. */
  #boxesAt(rectOf: (id: string) => CanvasBounds | undefined) {
    let boxes: CanvasRouteBox[] | undefined;
    return () =>
      (boxes ??= this.#host.data().nodes.map((node) => {
        const rect = rectOf(node.id);
        return rect === undefined || rect === node
          ? node
          : { ...rect, id: node.id, type: node.type };
      }));
  }

  /** Drawings redrawn where a gesture has them: `moved` are dragged by `delta`, the rest follow. */
  #drawInks(
    items: ReadonlyArray<InkElement>,
    rectOf: (id: string) => CanvasBounds | undefined,
    delta: CanvasPoint,
    moved: boolean,
    boxes = this.#boxesAt(rectOf),
  ) {
    const rects = { get: rectOf };
    for (const { shape, group, label } of items) {
      const { ink } = shape;
      if (ink.type === "stroke") {
        if (!moved) continue;
        const shifted = delta.x !== 0 || delta.y !== 0;
        if (shifted) group.setAttribute("transform", `translate(${delta.x} ${delta.y})`);
        else group.removeAttribute("transform");
        continue;
      }
      const next = moved ? ({ ...ink, ...movedInk(ink, delta.x, delta.y) } as CanvasInk) : ink;
      const drawn = canvasInkShape(next, rects, boxes);
      if (drawn !== undefined) this.#setInk({ shape, group, label }, drawn);
    }
  }

  #setInk(
    { group, label }: InkElement,
    drawn: Pick<CanvasInkShape, "path" | "heads" | "labelAt" | "fill">,
  ) {
    for (const line of group.querySelectorAll(".cv-ink-line, .cv-ink-hit")) {
      line.setAttribute("d", drawn.path);
    }
    if (drawn.fill !== undefined)
      group.querySelector(".cv-ink-fill")?.setAttribute("d", drawn.fill);
    group.querySelectorAll(".cv-ink-head").forEach((tip, position) => {
      tip.setAttribute("d", drawn.heads[position] ?? "");
    });
    if (label !== null) {
      label.style.left = `${drawn.labelAt.x}px`;
      label.style.top = `${drawn.labelAt.y}px`;
    }
  }

  #drawArrows(followers: Followers, rectOf: (id: string) => CanvasBounds | undefined) {
    const boxes = this.#boxesAt(rectOf);
    this.#drawInks(followers.inks, rectOf, NO_DELTA, false, boxes);
    for (const { shape, group, label } of followers.arrows) {
      const from = rectOf(shape.edge.fromNode);
      const to = rectOf(shape.edge.toNode);
      if (from === undefined || to === undefined) continue;
      const next = canvasEdgeShape(shape.edge, from, to, boxes);
      for (const line of group.querySelectorAll(".cv-edge-line, .cv-edge-hit")) {
        line.setAttribute("d", next.path);
      }
      group.querySelectorAll(".cv-edge-head").forEach((tip, position) => {
        const d = next.heads[position];
        if (d !== undefined) tip.setAttribute("d", d);
      });
      if (label !== null) {
        label.style.left = `${next.labelAt.x}px`;
        label.style.top = `${next.labelAt.y}px`;
      }
    }
  }

  /** The gesture has moved far enough to be one. */
  #begin(press: Press) {
    const host = this.#host;
    const session = press.session;
    switch (session.kind) {
      case "drag": {
        const { nodes } = host.data();
        const selection = host.selection();
        const drawings = selectedDrawings(selection);
        const held = selection.cards.has(session.card) || drawings.has(session.card);
        const pressed = held
          ? selection.cards
          : session.ink
            ? NO_DRAWINGS
            : new Set([session.card]);
        session.drawings = held ? drawings : session.ink ? new Set([session.card]) : NO_DRAWINGS;
        session.moved = movedWith(nodes, pressed);
        const carried = inkMovedWith(nodes, host.data().drawings ?? [], session.moved);
        if (carried.size > 0) session.drawings = new Set([...session.drawings, ...carried]);
        session.inks = host
          .inks()
          .flatMap((shape) =>
            session.drawings.has(shape.ink.id) ? (this.#inkElement(shape) ?? []) : [],
          );
        const moving = nodes.filter((node) => session.moved.has(node.id));
        session.box = boundsOfRects(moving);
        const mounted = new Map<string, HTMLElement>();
        for (const element of host.world()?.querySelectorAll<HTMLElement>("[data-card-id]") ?? []) {
          mounted.set(element.getAttribute("data-card-id") ?? "", element);
        }
        session.elements = moving.flatMap((node) => {
          const element = mounted.get(node.id);
          return element === undefined ? [] : [{ element, node }];
        });
        session.frames = moving.flatMap((node) => this.#frameOf(node.id) ?? []);
        session.rects = new Map(nodes.map((node) => [node.id, node]));
        const inView = host.view.window(200);
        session.others = nodes.filter(
          (node) => !session.moved.has(node.id) && overlaps(node, inView),
        );
        session.followers = this.#followers(session.moved, session.drawings);
        session.started = true;
        host.board()?.classList.add("cv-moving");
        if (press.alt) this.#addGhosts(session);
        return;
      }
      case "connect":
      case "free-arrow":
        session.draft = this.#newDraft();
        return;
      case "lasso":
        session.draft = this.#newDraft("cv-lasso");
        return;
      case "erase":
        session.draft = this.#newDraft("cv-eraser-trail");
        return;
      case "scale": {
        const mounted = new Map<string, HTMLElement>();
        for (const element of host.world()?.querySelectorAll<HTMLElement>("[data-card-id]") ?? []) {
          mounted.set(element.getAttribute("data-card-id") ?? "", element);
        }
        session.elements = session.nodes.flatMap((node) => {
          const element = mounted.get(node.id);
          return element === undefined ? [] : [{ element, node }];
        });
        session.frame = host.world()?.querySelector<HTMLElement>("[data-selection-box]") ?? null;
        session.restore = snapshot([
          ...session.inks,
          ...session.followers.inks,
          ...session.followers.arrows,
        ]);
        return;
      }
      case "ink":
        session.draft = this.#newDraft("cv-ink-draft");
        if (session.draft !== null) {
          const { color } = host.pen();
          if (color !== undefined) session.draft.style.fill = color;
        }
        return;
      case "ink-end": {
        const shape = host.inks().find((each) => each.ink.id === session.ink.id);
        session.element = shape === undefined ? null : this.#inkElement(shape);
        return;
      }
      case "retarget": {
        session.draft = this.#newDraft();
        const shown = host
          .world()
          ?.querySelector<SVGElement>(`g[data-edge-id="${CSS.escape(session.arrow.id)}"]`);
        if (shown !== undefined && shown !== null) {
          shown.style.visibility = "hidden";
          session.hidden = shown;
        }
        return;
      }
      case "marquee":
      case "draw": {
        const element = document.createElement("div");
        element.className = "cv-marquee";
        if (session.kind === "draw") element.dataset.draw = session.tool;
        host.board()?.append(element);
        session.element = element;
        return;
      }
      default:
        return;
    }
  }

  /** Alt-drag leaves the originals where they are; what follows the pointer is their copy. */
  #addGhosts(session: Extract<Session, { kind: "drag" }>) {
    const world = this.#host.world();
    if (world === null) return;
    session.ghosts = session.elements.map(({ element }) => {
      const ghost = element.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-card-id");
      ghost.setAttribute("aria-hidden", "true");
      world.append(ghost);
      return ghost;
    });
  }

  #newDraft(className = "cv-edge-draft") {
    const svg = this.#host.world()?.querySelector(".cv-drafts");
    if (svg === undefined || svg === null) return null;
    const draft = document.createElementNS("http://www.w3.org/2000/svg", "path");
    draft.setAttribute("class", className);
    svg.append(draft);
    return draft;
  }

  #draw(press: Press) {
    const host = this.#host;
    const session = press.session;
    const point = host.view.toWorld(press.x, press.y);
    switch (session.kind) {
      case "drag": {
        if (!session.started) return;
        const free = { x: point.x - press.start.x, y: point.y - press.start.y };
        const { x: dx, y: dy } = press.shifted ? lockedToAxis(free.x, free.y) : free;
        const snap = host.snap();
        const nudge = press.ctrl
          ? { x: 0, y: 0 }
          : snapDrag(offset(session.box, dx, dy), session.others, {
              ...snap,
              tolerance: CANVAS_SNAP_TOLERANCE / host.view.camera.zoom,
            });
        // Held to an axis, the other one doesn't move at all, snapped or not.
        const delta = {
          x: press.shifted && dx === 0 ? 0 : dx + nudge.x,
          y: press.shifted && dy === 0 ? 0 : dy + nudge.y,
        };
        session.delta = delta;
        const transform = `translate(${delta.x}px, ${delta.y}px)`;
        const movers = session.ghosts.length > 0 ? session.ghosts : session.elements;
        for (const mover of movers) {
          (mover instanceof HTMLElement ? mover : mover.element).style.transform = transform;
        }
        if (session.ghosts.length === 0) {
          for (const frame of session.frames) frame.style.transform = transform;
        }
        if (session.ghosts.length === 0) {
          const rectOf = (id: string) => {
            const rect = session.rects.get(id);
            return rect !== undefined && session.moved.has(id)
              ? offset(rect, delta.x, delta.y)
              : rect;
          };
          this.#drawArrows(session.followers, rectOf);
          this.#drawInks(session.inks, rectOf, delta, true);
        }
        return;
      }
      case "resize": {
        const dx = point.x - press.start.x;
        const dy = point.y - press.start.y;
        const rect = resizeRect(session.card, session.handle, dx, dy, {
          grid: host.snap().grid && !press.ctrl,
          aspect: session.aspect,
        });
        session.rect = rect;
        this.#setBox(session.element, rect);
        this.#setBox(session.frame, rect);
        const { nodes } = host.data();
        this.#drawArrows(session.followers, (id) =>
          id === session.card.id ? rect : nodes.find((node) => node.id === id),
        );
        return;
      }
      case "scale": {
        const scale = canvasScaleFor(
          session.box,
          session.handle,
          point.x - press.start.x,
          point.y - press.start.y,
          { keepAspect: press.shifted, fromCentre: press.alt, least: session.least },
        );
        session.scale = scale;
        const boxes = new Map(session.nodes.map((node) => [node.id, canvasScaledBox(node, scale)]));
        for (const { element, node } of session.elements) {
          this.#setBox(element, boxes.get(node.id) ?? node);
        }
        const rectOf = (id: string) => boxes.get(id) ?? session.rects.get(id);
        const rects = { get: rectOf };
        const { anchor, sx, sy } = scale;
        const stretched = `matrix(${sx} 0 0 ${sy} ${anchor.x * (1 - sx)} ${anchor.y * (1 - sy)})`;
        for (const each of session.inks) {
          if (session.stretch && each.shape.ink.type === "stroke") {
            each.group.setAttribute("transform", stretched);
            continue;
          }
          const next = {
            ...each.shape.ink,
            ...canvasScaledInk(each.shape.ink, scale),
          } as CanvasInk;
          const drawn = canvasInkShape(next, rects);
          if (drawn !== undefined) this.#setInk(each, drawn);
        }
        this.#drawArrows(session.followers, rectOf);
        const { box } = session;
        this.#setBox(session.frame, {
          x: anchor.x + (box.x - anchor.x) * sx,
          y: anchor.y + (box.y - anchor.y) * sy,
          width: box.width * sx,
          height: box.height * sy,
        });
        return;
      }
      case "lasso": {
        const { points } = session;
        let d = "";
        for (let at = 0; at + 1 < points.length; at += 2) {
          d += `${at === 0 ? "M" : "L"}${round(points[at]!)} ${round(points[at + 1]!)}`;
        }
        session.draft?.setAttribute("d", `${d}Z`);
        return;
      }
      case "erase": {
        const { trail } = session;
        let d = "";
        for (let at = 0; at + 1 < trail.length; at += 2) {
          d += `${at === 0 ? "M" : "L"}${round(trail[at]!)} ${round(trail[at + 1]!)}`;
        }
        session.draft?.setAttribute("d", d);
        return;
      }
      case "connect":
        session.draft?.setAttribute(
          "d",
          canvasDraftPath(session.from, this.#fromSide(session, point), point),
        );
        return;
      case "retarget":
        session.draft?.setAttribute("d", canvasDraftPath(session.fixed, session.fixedSide, point));
        return;
      case "ink":
        session.draft?.setAttribute(
          "d",
          canvasInkPath(0, 0, session.points, session.pressure, session.width),
        );
        return;
      case "free-arrow":
        session.draft?.setAttribute(
          "d",
          `M${session.from.x} ${session.from.y}L${point.x} ${point.y}`,
        );
        return;
      case "ink-end": {
        const { element, ink, end } = session;
        if (element === null) return;
        const rects = new Map(host.data().nodes.map((node) => [node.id, node]));
        const target = this.#cardAt(point);
        const next = { ...ink, [end]: target === undefined ? point : this.#endOn(target, point) };
        const drawn = canvasInkShape(next, rects, () => host.data().nodes);
        if (drawn !== undefined) this.#setInk(element, drawn);
        return;
      }
      case "marquee":
      case "draw": {
        const { element } = session;
        const rect = host.board()?.getBoundingClientRect();
        if (element === null || rect === undefined) return;
        const left = Math.min(press.startX, press.x) - rect.left;
        const top = Math.min(press.startY, press.y) - rect.top;
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.width = `${Math.abs(press.x - press.startX)}px`;
        element.style.height = `${Math.abs(press.y - press.startY)}px`;
        return;
      }
      default:
        return;
    }
  }

  #setBox(element: HTMLElement | null, rect: CanvasBounds) {
    if (element === null) return;
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  }

  release(event: PointerEvent) {
    const host = this.#host;
    this.#touches.delete(event.pointerId);
    host.view.release(event.pointerId);
    this.#clearLongPress();
    if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }
    const press = this.#press;
    if (press === null || press.id !== event.pointerId) return;
    this.#press = null;
    // A click with a tool that draws drops one, or a dot: it isn't a click on what's under it.
    const { kind } = press.session;
    if (press.moved || kind === "draw" || kind === "ink" || kind === "erase") {
      this.#draw(press);
      this.#finish(press, event);
      return;
    }
    this.#abandon(press);
    this.#swallowClick = true;
    this.#clicked(press, event);
  }

  cancel(event: PointerEvent) {
    this.#touches.delete(event.pointerId);
    this.#host.view.release(event.pointerId);
    this.#clearLongPress();
    const press = this.#press;
    if (press === null || press.id !== event.pointerId) return;
    this.#press = null;
    this.#abandon(press);
  }

  /** A right-click on a Mac can follow a press with ⌃ held: the press was never a drag. */
  contextMenu() {
    const press = this.#press;
    if (press === null) return;
    this.#press = null;
    this.#abandon(press);
  }

  /** Whatever a gesture has drawn, taken back. The document is the only thing that stays. */
  #abandon(press: Press) {
    const host = this.#host;
    const session = press.session;
    switch (session.kind) {
      case "pan":
        host.view.release(press.id);
        return;
      case "drag":
        host.board()?.classList.remove("cv-moving");
        for (const { element } of session.elements) element.style.transform = "";
        for (const frame of session.frames) frame.style.transform = "";
        for (const ghost of session.ghosts) ghost.remove();
        if (session.started) {
          const rectOf = (id: string) => session.rects.get(id);
          this.#drawArrows(session.followers, rectOf);
          this.#drawInks(session.inks, rectOf, NO_DELTA, true);
        }
        return;
      case "scale":
        for (const { element, node } of session.elements) this.#setBox(element, node);
        this.#setBox(session.frame, session.box);
        session.restore();
        return;
      case "lasso":
        session.draft?.remove();
        return;
      case "erase": {
        session.draft?.remove();
        const world = host.world();
        for (const element of world?.querySelectorAll("[data-erasing]") ?? []) {
          element.removeAttribute("data-erasing");
        }
        return;
      }
      case "resize": {
        this.#setBox(session.element, session.card);
        this.#setBox(session.frame, session.card);
        const { nodes } = host.data();
        this.#drawArrows(session.followers, (id) => nodes.find((node) => node.id === id));
        return;
      }
      case "connect":
      case "free-arrow":
      case "ink":
        session.draft?.remove();
        return;
      case "ink-end":
        if (session.element !== null) this.#setInk(session.element, session.element.shape);
        return;
      case "retarget":
        session.draft?.remove();
        if (session.hidden !== null) session.hidden.style.visibility = "";
        return;
      case "marquee":
      case "draw":
        session.element?.remove();
        return;
      default:
        return;
    }
  }

  #finish(press: Press, event: PointerEvent) {
    const host = this.#host;
    const document = host.document();
    const session = press.session;
    switch (session.kind) {
      case "pan":
        return;
      case "drag":
        this.#finishDrag(press, session, document);
        return;
      case "resize": {
        const { rect, card } = session;
        const unchanged =
          rect.x === card.x &&
          rect.y === card.y &&
          rect.width === card.width &&
          rect.height === card.height;
        // The document's new size reaches the element with the next render, before any paint.
        if (unchanged) this.#abandon(press);
        else document?.commit([{ op: "resize", card: card.id, ...boxOf(rect) }]);
        return;
      }
      case "scale": {
        this.#abandon(press);
        const { scale } = session;
        if (scale === null || document === null) return;
        const edits = canvasScaleEdits(session.nodes, session.drawings, scale);
        if (edits.length > 0) document.commit(edits);
        return;
      }
      case "lasso": {
        this.#abandon(press);
        const zoom = host.view.camera.zoom;
        const loop = canvasSimplified(session.points, 1 / zoom);
        const { nodes } = host.data();
        const rects = new Map(nodes.map((node) => [node.id, node]));
        const picked = canvasLassoPick(loop, nodes, host.inks(), rects);
        const before = host.selection();
        const drawings = [
          ...(session.additive ? selectedDrawings(before) : []),
          ...picked.drawings,
        ];
        host.select({
          cards: new Set([...(session.additive ? before.cards : []), ...picked.cards]),
          arrow: null,
          ...(drawings.length === 0 ? {} : { drawings: new Set(drawings) }),
        });
        return;
      }
      case "erase": {
        const marked = [...session.marked];
        this.#abandon(press);
        if (document === null || marked.length === 0) return;
        document.commit(
          marked.map((id): CanvasHandEdit => ({ op: "remove-drawing", drawing: id })),
        );
        return;
      }
      case "connect":
      case "retarget":
        this.#finishLine(press, session, event);
        return;
      case "ink":
        session.draft?.remove();
        host.inked(session.points, session.pressure);
        return;
      case "free-arrow": {
        this.#abandon(press);
        host.toolDone();
        const point = host.view.toWorld(press.x, press.y);
        const target = this.#cardAt(point);
        this.#putInkArrow(session.from, target === undefined ? point : this.#endOn(target, point));
        return;
      }
      case "ink-end":
        this.#abandon(press);
        this.#finishInkEnd(session, host.view.toWorld(press.x, press.y));
        return;
      case "draw": {
        session.element?.remove();
        const a = press.start;
        const b = host.view.toWorld(press.x, press.y);
        const box = press.moved
          ? {
              x: Math.min(a.x, b.x),
              y: Math.min(a.y, b.y),
              width: Math.abs(a.x - b.x),
              height: Math.abs(a.y - b.y),
            }
          : null;
        host.drawn(session.tool, box, a);
        return;
      }
      case "marquee": {
        session.element?.remove();
        const a = press.start;
        const b = host.view.toWorld(press.x, press.y);
        const area = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(a.x - b.x),
          height: Math.abs(a.y - b.y),
        };
        const { nodes } = host.data();
        const touched = nodes.filter((node) => overlaps(node, area)).map((node) => node.id);
        const inked = host
          .inks()
          .filter((shape) => overlaps(shape.bounds, area) && canvasInkTouches(shape, area))
          .map((shape) => shape.ink.id);
        const before = host.selection();
        const drawings = [...(session.additive ? selectedDrawings(before) : []), ...inked];
        host.select({
          cards: new Set([...(session.additive ? before.cards : []), ...touched]),
          arrow: null,
          ...(drawings.length === 0 ? {} : { drawings: new Set(drawings) }),
        });
        return;
      }
      default:
        return;
    }
  }

  #finishDrag(
    press: Press,
    session: Extract<Session, { kind: "drag" }>,
    document: CanvasDocument | null,
  ) {
    const host = this.#host;
    const { nodes } = host.data();
    const dx = Math.round(session.delta.x);
    const dy = Math.round(session.delta.y);
    const moved = session.moved;
    this.#abandon(press);
    if (document === null || (dx === 0 && dy === 0)) return;
    const inks = (host.data().drawings ?? []).filter((ink) => session.drawings.has(ink.id));
    if (press.alt) {
      const clip = canvasClip(document.document, host.data(), moved, session.drawings);
      const placed = placeClip(clip, dx, dy, document.mint);
      document.commit(placed.edits);
      host.select({
        cards: new Set(placed.cards),
        arrow: null,
        drawings: new Set(placed.drawings),
      });
      return;
    }
    const moving = nodes.filter((node) => moved.has(node.id));
    document.commit([
      ...moving.map((node): CanvasHandEdit => ({
        op: "move",
        card: node.id,
        x: node.x + dx,
        y: node.y + dy,
      })),
      ...inks.flatMap((ink): CanvasHandEdit[] => {
        const keys = movedInk(ink, dx, dy);
        return Object.keys(keys).length === 0 ? [] : [{ op: "set-drawing", drawing: ink.id, keys }];
      }),
    ]);
  }

  /** An arrow's end dropped on a card: on its outline where it's near, else a side's middle. */
  #endOn(card: CanvasNode, point: CanvasPoint) {
    const zoom = this.#host.view.camera.zoom;
    return canvasEndOnCard(card, point, EDGE_REACH / zoom, MIDDLE_SNAP / zoom);
  }

  /**
   * A drawn arrow, unless both its ends are on side middles of cards: then it's a card's arrow, as
   * the file has.
   */
  #putInkArrow(from: CanvasInkEnd, to: CanvasInkEnd) {
    const host = this.#host;
    const document = host.document();
    if (document === null) return;
    if ("node" in from && "node" in to && from.node === to.node) return;
    if (canvasInkIsEdge(from, to, undefined) && "node" in from && "node" in to) {
      document.commit([
        { op: "put-arrow", edge: host.styled("arrow", arrowBetween(document.mint(), from, to)) },
      ]);
      return;
    }
    // A line too short to see was meant as a click.
    const zoom = host.view.camera.zoom;
    if (!("node" in from) && !("node" in to)) {
      if (Math.hypot(from.x - to.x, from.y - to.y) * zoom < 8) return;
    }
    const whole = (end: CanvasInkEnd): CanvasInkEnd =>
      "node" in end ? end : { x: Math.round(end.x), y: Math.round(end.y) };
    const id = document.mint();
    document.commit([
      {
        op: "put-drawing",
        drawing: host.styled("arrow", { id, type: "arrow", from: whole(from), to: whole(to) }),
      },
    ]);
    host.select({ cards: new Set(), arrow: null, drawings: new Set([id]) });
  }

  /** An end dropped on a card holds there; with the other on a card too, it's a card's arrow. */
  #finishInkEnd(session: Extract<Session, { kind: "ink-end" }>, point: CanvasPoint) {
    const host = this.#host;
    const document = host.document();
    if (document === null) return;
    const { ink, end } = session;
    const target = this.#cardAt(point);
    const other = end === "from" ? ink.to : ink.from;
    const placed: CanvasInkEnd =
      target === undefined
        ? { x: Math.round(point.x), y: Math.round(point.y) }
        : this.#endOn(target, point);
    const [from, to] = end === "from" ? [placed, other] : [other, placed];
    if (canvasInkIsEdge(from, to, ink.bends) && "node" in from && "node" in to) {
      const id = document.mint();
      document.commit([
        { op: "remove-drawing", drawing: ink.id },
        {
          op: "put-arrow",
          edge: {
            ...arrowBetween(id, from, to),
            ...(ink.fromEnd === undefined ? {} : { fromEnd: ink.fromEnd }),
            ...(ink.toEnd === undefined ? {} : { toEnd: ink.toEnd }),
            ...(ink.color === undefined ? {} : { color: ink.color }),
            ...(ink.label === undefined ? {} : { label: ink.label }),
            ...(ink.astrolabe === undefined ? {} : { astrolabe: ink.astrolabe }),
          },
        },
      ]);
      host.select({ cards: new Set(), arrow: id });
      return;
    }
    if ("node" in placed && "node" in other && placed.node === other.node) return;
    document.commit([{ op: "set-drawing", drawing: ink.id, keys: { [end]: placed } }]);
  }

  /** The card a drop lands on: a card first, then the smallest group around the point. */
  #cardAt(point: CanvasPoint): CanvasNode | undefined {
    const inside = (node: CanvasNode) =>
      point.x >= node.x &&
      point.x <= node.x + node.width &&
      point.y >= node.y &&
      point.y <= node.y + node.height;
    const hits = this.#host.data().nodes.filter(inside);
    const cards = hits.filter((node) => node.type !== "group");
    if (cards.length > 0) return cards.at(-1);
    return [...hits].sort((a, b) => a.width * a.height - b.width * b.height)[0];
  }

  #finishLine(
    press: Press,
    session: Extract<Session, { kind: "connect" | "retarget" }>,
    event: PointerEvent,
  ) {
    const host = this.#host;
    const document = host.document();
    const point = host.view.toWorld(press.x, press.y);
    const target = this.#cardAt(point);
    if (session.kind === "connect") {
      if (session.tool) host.toolDone();
      if (target === undefined && session.tool) {
        this.#abandon(press);
        this.#putInkArrow({ node: session.from.id, side: this.#fromSide(session, point) }, point);
        return;
      }
      if (target === undefined) {
        host.looseEnd(
          { kind: "new", from: { node: session.from.id, side: this.#fromSide(session, point) } },
          point,
          event.clientX,
          event.clientY,
          () => this.#abandon(press),
        );
        return;
      }
      this.#abandon(press);
      if (target.id === session.from.id || document === null) return;
      const [fromSide, toSide] = session.tool
        ? canvasArrowSides(session.from, target)
        : [session.side, nearestSide(target, point)];
      const arrow = arrowBetween(
        document.mint(),
        { node: session.from.id, side: fromSide },
        { node: target.id, side: toSide },
      );
      document.commit([{ op: "put-arrow", edge: host.styled("arrow", arrow) }]);
      return;
    }
    const { arrow, end, fixed, fixedSide } = session;
    if (target === undefined) {
      host.looseEnd(
        { kind: "retarget", arrow, end, fixed: { node: fixed.id, side: fixedSide } },
        point,
        event.clientX,
        event.clientY,
        () => this.#abandon(press),
      );
      return;
    }
    this.#abandon(press);
    if (target.id === fixed.id || document === null) return;
    document.commit([
      {
        op: "set-arrow",
        arrow: arrow.id,
        keys:
          end === "from"
            ? { fromNode: target.id, fromSide: nearestSide(target, point) }
            : { toNode: target.id, toSide: nearestSide(target, point) },
      },
    ]);
  }

  /** A line from a card's dot leaves by that side; the Arrow tool's, by the side facing the pointer. */
  #fromSide(session: Extract<Session, { kind: "connect" }>, point: CanvasPoint) {
    return session.tool
      ? canvasArrowSides(session.from, { ...point, width: 0, height: 0 })[0]
      : session.side;
  }

  #clicked(press: Press, event: PointerEvent) {
    const host = this.#host;
    const editable = host.document() !== null;
    const { target } = press;
    const now = event.timeStamp;
    const handle = handleOf(target);
    const arrow = arrowOf(target);
    const drawing = inkOf(target);
    const hit = target.closest(".cv-card, .cv-group-label");
    const id = hit === null ? null : cardIdOf(hit);
    const named = handle ?? arrow ?? drawing ?? id;
    const last = this.#lastClick;
    const double =
      last !== null &&
      now - last.at < DOUBLE_MS &&
      last.id === named &&
      Math.hypot(press.x - last.x, press.y - last.y) < DOUBLE_SLOP;
    this.#lastClick = double ? null : { at: now, x: press.x, y: press.y, id: named };

    if (handle !== null) {
      const card = cardIdOf(target);
      if (double && editable && card !== null) host.fitToContent(card, handle);
      return;
    }
    if (arrow !== null) {
      host.select({ cards: new Set(), arrow });
      if (double && editable) host.editArrowLabel(arrow);
      return;
    }
    if (drawing !== null) {
      const selection = host.selection();
      const drawings = new Set(selectedDrawings(selection));
      if (press.shift || host.selectMode()) {
        if (press.wasSelected) drawings.delete(drawing);
        else drawings.add(drawing);
        host.select({ ...selection, arrow: null, drawings });
        return;
      }
      host.select({ cards: new Set(), arrow: null, drawings: new Set([drawing]) });
      const ink = host.inks().find((shape) => shape.ink.id === drawing)?.ink;
      if (double && editable && ink?.type === "arrow") host.editInkLabel(drawing);
      return;
    }
    const onLabel = target.closest(".cv-card-label") !== null;
    if (id === null) {
      if (double && editable) host.addTextAt(press.start);
      else if (!press.shift && !host.selectMode()) host.select({ cards: new Set(), arrow: null });
      return;
    }
    if (double && onLabel) {
      host.openFileCard(id);
      return;
    }
    if (double && target.closest(".cv-group-label") !== null) {
      if (editable) host.editGroupLabel(id);
      return;
    }
    const { cards } = host.selection();
    if (press.shift || host.selectMode()) {
      const next = new Set(cards);
      if (press.togglesOff || (host.selectMode() && next.has(id))) next.delete(id);
      else next.add(id);
      host.select({ cards: next, arrow: null });
      return;
    }
    // A finger has no double click: a selected file card's label opens on the next tap.
    if (press.touch && press.wasSelected && onLabel && !double) {
      host.openFileCard(id);
      return;
    }
    if (press.touch && press.wasSelected && !double && host.followSmallLink(id)) return;
    host.select({ cards: new Set([id]), arrow: null });
    if (editable && (double || press.wasSelected)) host.editCard(id);
  }
}

const boxOf = ({ x, y, width, height }: CanvasBounds) => ({ x, y, width, height });

const round = (value: number) => Math.round(value * 10) / 10;

/** Lines and labels as they are now, and a way to put them back exactly, hand-drawn or not. */
function snapshot(
  items: ReadonlyArray<{ readonly group: Element; readonly label: HTMLElement | null }>,
) {
  const paths = items.flatMap(({ group }) =>
    [...group.querySelectorAll("path")].map((path) => [path, path.getAttribute("d")] as const),
  );
  const transforms = items.map(({ group }) => [group, group.getAttribute("transform")] as const);
  const labels = items.flatMap(({ label }) =>
    label === null ? [] : [[label, label.style.left, label.style.top] as const],
  );
  return () => {
    for (const [path, d] of paths) {
      if (d === null) path.removeAttribute("d");
      else path.setAttribute("d", d);
    }
    for (const [group, transform] of transforms) {
      if (transform === null) group.removeAttribute("transform");
      else group.setAttribute("transform", transform);
    }
    for (const [label, left, top] of labels) {
      label.style.left = left;
      label.style.top = top;
    }
  };
}
