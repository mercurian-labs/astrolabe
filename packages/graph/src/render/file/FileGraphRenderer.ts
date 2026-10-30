/**
 * A file graph drawn the way Obsidian draws a vault: small grey dots sized by their links, the
 * name under each, hairline links at rest, the file in front in the accent colour. The forces run
 * while something moves (a new layout, a drag, new forces) and stop when it settles; a hover lights
 * a node and its neighbours and fades the rest. Frames are drawn only when something changed, by a
 * drawer that only paints (`FileGraphDrawer`), so the graph at rest costs nothing.
 */
import { FileForces, type Point } from "../../layout/fileForces.ts";
import {
  fileGraphDegrees,
  fileGraphSignature,
  fileGraphStructure,
  GROUP_SLOTS,
  neighbourhood,
  nodeLabel,
  type FileGraphData,
  type FileGraphNode,
} from "../../model/fileGraph.ts";
import {
  DEFAULT_FILE_GRAPH_SETTINGS,
  type FileGraphSettings,
} from "../../model/fileGraphSettings.ts";
import { browserClock, FrameScheduler, type Animation, type FrameClock } from "../scheduler.ts";
import { cssHex } from "../theme.ts";

/** A node as the drawer paints it: world units, colours as 0xrrggbb. */
export interface DrawnNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly fill: number;
  readonly alpha: number;
  /** A folded folder: a ring, its middle the paper's colour. */
  readonly hollow: boolean;
  /** A changed file's thin ring, in this colour. */
  readonly ring: number | null;
  readonly label: string;
  readonly labelColor: number;
  readonly labelAlpha: number;
}

/** A link from edge to edge of its nodes, with an arrowhead at its end when arrows are on. */
export interface DrawnLink {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly color: number;
  readonly alpha: number;
  readonly arrow: boolean;
}

export interface Camera {
  /** The world point at the middle of the frame. */
  readonly x: number;
  readonly y: number;
  /** CSS pixels per world unit. */
  readonly zoom: number;
}

export interface FileGraphFrame {
  readonly width: number;
  readonly height: number;
  readonly camera: Camera;
  /** Faded first, so what a hover lights draws over the rest. */
  readonly links: ReadonlyArray<DrawnLink>;
  readonly nodes: ReadonlyArray<DrawnNode>;
  /** A link's width and an outline's, in CSS pixels whatever the zoom. */
  readonly lineWidth: number;
  readonly paper: number;
  /** The labels' CSS font family: the app's own. */
  readonly font: string;
}

export interface FileGraphDrawer {
  resize(width: number, height: number): void;
  draw(frame: FileGraphFrame): void;
  dispose(): void;
}

/** The hovered node and where it sits in the frame, in CSS pixels. */
export interface FileGraphHover {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface FileGraphCallbacks {
  readonly onHover: (hover: FileGraphHover | null) => void;
  /** A node was clicked; `modifier` while ⌘ or Ctrl was held. */
  readonly onOpen: (id: string, modifier: boolean) => void;
}

export interface FileGraphRendererOptions {
  readonly clock?: FrameClock;
  readonly createDrawer: (host: HTMLElement) => FileGraphDrawer;
}

interface FileGraphColors {
  readonly paper: number;
  readonly ink: number;
  readonly node: number;
  /** An outside package: lighter, as Obsidian draws an attachment. */
  readonly faint: number;
  readonly link: number;
  readonly accent: number;
  readonly changed: number;
  readonly groups: ReadonlyArray<number>;
}

const FALLBACK = {
  paper: "#ffffff",
  ink: "#1f1f1f",
  muted: "#6b6b6b",
  rule: "#e5e5e5",
  accent: "#7c5cff",
  warning: "#d97706",
  groups: ["#0d9488", "#ca8a04", "#7c3aed", "#16a34a", "#db2777", "#0284c7"],
};

/** A lone node's radius at node size 1, in world units; it grows with the root of its links. */
const BASE_RADIUS = 4;
const RADIUS_GROWTH = 1;
const MAX_RADIUS = 16;
/** Labels sit this far under their node. */
export const LABEL_GAP = 3;
/** What a hover leaves of everything it does not light. */
const FADED_NODE = 0.2;
const FADED_LINK = 0.08;
/** A link resolved by name alone draws at this share of a link's alpha. */
const GUESSED = 0.5;
/** How long a hover takes to light or fade, in seconds. */
const HOVER_SECONDS = 0.15;
/** A press that moves less than this, in CSS pixels, is a click. */
const CLICK_SLOP = 4;
/** A pointer this near a node's edge, in CSS pixels, is on it. */
const HIT_SLOP = 4;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 6;
/** Fitting never zooms in past this, so a small graph stays its size. */
const MAX_FIT_ZOOM = 1.4;
const FIT_PADDING = 32;
/** A label's room in a fit: about this wide per character, and a line tall. */
const LABEL_CHAR = 6.5;
const LABEL_LINE = 16;

/** A node's radius in world units: bigger with more links, a folded folder with more files. */
export function nodeRadius(node: FileGraphNode, degree: number, nodeSize: number): number {
  const weight = node.kind === "folder" ? Math.max(degree, node.files ?? 0) : degree;
  return nodeSize * Math.min(MAX_RADIUS, BASE_RADIUS + RADIUS_GROWTH * Math.sqrt(weight));
}

/**
 * How much of its label a node shows at `zoom`: all of it zoomed in, none zoomed out past the
 * threshold. A higher text fade threshold fades labels sooner, as Obsidian's does.
 */
export function labelOpacity(zoom: number, textFade: number): number {
  const gone = 0.4 * 2 ** textFade;
  return Math.max(0, Math.min(1, (zoom - gone) / (gone * 0.5)));
}

/** The camera that frames `points` (each with the room around it) in a `width` × `height` frame. */
export function fitCamera(
  boxes: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly left: number;
    readonly right: number;
    readonly below: number;
    readonly above: number;
  }>,
  width: number,
  height: number,
): Camera {
  if (boxes.length === 0) return { x: 0, y: 0, zoom: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x - box.left);
    maxX = Math.max(maxX, box.x + box.right);
    minY = Math.min(minY, box.y - box.above);
    maxY = Math.max(maxY, box.y + box.below);
  }
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(
      MAX_FIT_ZOOM,
      (width - 2 * FIT_PADDING) / Math.max(1, maxX - minX),
      (height - 2 * FIT_PADDING) / Math.max(1, maxY - minY),
    ),
  );
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom };
}

const mix = (from: number, to: number, share: number): number => {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * share) << shift;
  };
  return channel(16) | channel(8) | channel(0);
};

const hexToNumber = (hex: string) => Number.parseInt(hex.slice(1), 16);

/** The `--atlas-*` colours the host sets, and the font the frame is set in. */
export function readFileGraphTheme(element: Element): {
  readonly colors: FileGraphColors;
  readonly font: string;
} {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => hexToNumber(cssHex(style, name, fallback));
  const paper = read("--atlas-paper", FALLBACK.paper);
  const node = read("--atlas-muted", FALLBACK.muted);
  return {
    colors: {
      paper,
      ink: read("--atlas-ink", FALLBACK.ink),
      node,
      faint: mix(node, paper, 0.55),
      // The theme's rule, a touch darker so a hairline still reads on the paper.
      link: mix(read("--atlas-rule", FALLBACK.rule), node, 0.12),
      accent: read("--atlas-accent", FALLBACK.accent),
      changed: read("--atlas-warning", FALLBACK.warning),
      groups: Array.from({ length: GROUP_SLOTS }, (_, slot) =>
        read(`--atlas-lens-${slot + 1}`, FALLBACK.groups[slot] ?? FALLBACK.muted),
      ),
    },
    font: style.fontFamily || "system-ui, sans-serif",
  };
}

type Press =
  | {
      readonly kind: "node";
      readonly id: string;
      readonly pointer: number;
      readonly x: number;
      readonly y: number;
      readonly modifier: boolean;
      moved: boolean;
    }
  | {
      readonly kind: "pan";
      readonly pointer: number;
      readonly x: number;
      readonly y: number;
      readonly camera: Camera;
    };

export class FileGraphRenderer {
  readonly #host: HTMLElement;
  readonly #callbacks: FileGraphCallbacks;
  readonly #drawer: FileGraphDrawer;
  readonly #scheduler: FrameScheduler;
  readonly #resize: ResizeObserver;
  #width: number;
  #height: number;
  #graph: FileGraphData | null = null;
  #signature = "";
  #structure = "";
  #degrees = new Map<string, number>();
  #nodesById = new Map<string, FileGraphNode>();
  #forces: FileForces | null = null;
  #settings: FileGraphSettings = DEFAULT_FILE_GRAPH_SETTINGS;
  #camera: Camera = { x: 0, y: 0, zoom: 1 };
  /** Read at the next frame, after the host's effects have applied its theme. */
  #theme: ReturnType<typeof readFileGraphTheme> | null = null;
  #hovered: string | null = null;
  /** What the hover lights, kept while it fades out. */
  #lit = new Set<string>();
  #litFrom: string | null = null;
  /** 0 with nothing hovered, 1 with a hover fully lit. */
  #hoverMix = 0;
  #press: Press | null = null;
  readonly #motion: Animation = {
    step: (dt) => {
      const moving = this.#forces?.step() ?? false;
      const target = this.#hovered === null ? 0 : 1;
      const delta = dt / HOVER_SECONDS;
      this.#hoverMix =
        target > this.#hoverMix
          ? Math.min(target, this.#hoverMix + delta)
          : Math.max(target, this.#hoverMix - delta);
      if (this.#hoverMix === 0) this.#lit = new Set();
      // A hovered node the forces move takes its card along.
      if (moving && this.#hovered !== null && this.#press === null) this.#tellHover();
      return moving || this.#hoverMix !== target;
    },
  };

  constructor(host: HTMLElement, callbacks: FileGraphCallbacks, options: FileGraphRendererOptions) {
    this.#host = host;
    this.#callbacks = callbacks;
    this.#width = Math.max(1, host.clientWidth);
    this.#height = Math.max(1, host.clientHeight);
    this.#drawer = options.createDrawer(host);
    this.#drawer.resize(this.#width, this.#height);
    this.#scheduler = new FrameScheduler(options.clock ?? browserClock, () => this.#draw());
    this.#resize = new ResizeObserver(() => {
      const width = Math.max(1, this.#host.clientWidth);
      const height = Math.max(1, this.#host.clientHeight);
      if (width === this.#width && height === this.#height) return;
      this.#width = width;
      this.#height = height;
      this.#drawer.resize(width, height);
      this.#scheduler.invalidate();
    });
    this.#resize.observe(host);
    host.addEventListener("pointerdown", this.#onPointerDown);
    host.addEventListener("pointermove", this.#onPointerMove);
    host.addEventListener("pointerup", this.#onPointerUp);
    host.addEventListener("pointercancel", this.#onPointerCancel);
    host.addEventListener("pointerleave", this.#onPointerLeave);
    host.addEventListener("wheel", this.#onWheel, { passive: false });
  }

  get camera(): Camera {
    return this.#camera;
  }

  /** Whether the forces are still moving: false once the graph has settled. */
  get moving(): boolean {
    return this.#forces?.moving ?? false;
  }

  /**
   * A graph to draw. One equal to the drawn one changes nothing; one that lays out the same is
   * repainted in place. Around the same file, the nodes it keeps stay where they are and the rest
   * find their places as the forces run. Around a new file, it settles at once and is framed whole,
   * so it never shows half laid out.
   */
  setGraph(graph: FileGraphData): void {
    const signature = fileGraphSignature(graph);
    if (signature === this.#signature) return;
    const previous = this.#graph;
    const forces = this.#forces;
    this.#graph = graph;
    this.#signature = signature;
    this.#nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    if (this.#hovered !== null) {
      if (this.#nodesById.has(this.#hovered)) this.#lit = neighbourhood(graph, this.#hovered);
      else this.#setHovered(null);
    }
    const structure = fileGraphStructure(graph);
    if (structure === this.#structure && forces !== null) {
      this.#scheduler.invalidate();
      return;
    }
    this.#structure = structure;
    this.#degrees = fileGraphDegrees(graph);
    const sameCenter = previous !== null && previous.center === graph.center;
    const next = new FileForces(graph, this.#settings, (id) => forces?.positionOf(id) ?? null);
    this.#forces = next;
    if (sameCenter) {
      next.reheat(0.5);
      this.#scheduler.animate(this.#motion);
      return;
    }
    next.settle();
    this.fit();
  }

  setSettings(settings: FileGraphSettings): void {
    const before = this.#settings;
    if (
      before.arrows === settings.arrows &&
      before.textFade === settings.textFade &&
      before.nodeSize === settings.nodeSize &&
      before.linkThickness === settings.linkThickness &&
      before.centerForce === settings.centerForce &&
      before.repelForce === settings.repelForce &&
      before.linkForce === settings.linkForce &&
      before.linkDistance === settings.linkDistance
    ) {
      return;
    }
    this.#settings = settings;
    const forces = this.#forces;
    if (forces !== null) {
      if (
        before.centerForce !== settings.centerForce ||
        before.repelForce !== settings.repelForce ||
        before.linkForce !== settings.linkForce ||
        before.linkDistance !== settings.linkDistance
      ) {
        forces.setForces(settings);
      }
      if (forces.moving) this.#scheduler.animate(this.#motion);
    }
    this.#scheduler.invalidate();
  }

  /** Read the theme's colours and font again, at the next frame. */
  setTheme(): void {
    this.#theme = null;
    this.#scheduler.invalidate();
  }

  /** Frame the whole graph. */
  fit(): void {
    const graph = this.#graph;
    const forces = this.#forces;
    if (graph === null || forces === null) return;
    const positions = forces.positions();
    this.#camera = fitCamera(
      graph.nodes.map((node, index) => {
        const radius = this.#radiusOf(node.id);
        const half = Math.max(radius, (nodeLabel(node).length * LABEL_CHAR) / 2);
        const at = positions[index] ?? { x: 0, y: 0 };
        return {
          x: at.x,
          y: at.y,
          left: half,
          right: half,
          above: radius,
          below: radius + LABEL_GAP + LABEL_LINE,
        };
      }),
      this.#width,
      this.#height,
    );
    this.#scheduler.invalidate();
  }

  /** Lay the graph out again from a scatter, as Obsidian's Animate does. */
  animate(): void {
    this.#forces?.scatter();
    this.#scheduler.animate(this.#motion);
  }

  dispose(): void {
    this.#scheduler.dispose();
    this.#resize.disconnect();
    this.#host.removeEventListener("pointerdown", this.#onPointerDown);
    this.#host.removeEventListener("pointermove", this.#onPointerMove);
    this.#host.removeEventListener("pointerup", this.#onPointerUp);
    this.#host.removeEventListener("pointercancel", this.#onPointerCancel);
    this.#host.removeEventListener("pointerleave", this.#onPointerLeave);
    this.#host.removeEventListener("wheel", this.#onWheel);
    this.#drawer.dispose();
  }

  /** The frame as it would be drawn now. */
  frame(): FileGraphFrame | null {
    const graph = this.#graph;
    const forces = this.#forces;
    if (graph === null || forces === null) return null;
    this.#theme ??= readFileGraphTheme(this.#host);
    const { colors, font } = this.#theme;
    const settings = this.#settings;
    const camera = this.#camera;
    const lit = this.#lit;
    const share = this.#hoverMix;
    const lighting = share > 0 && lit.size > 0;
    const positions = forces.positions();
    const zoomLabels = labelOpacity(camera.zoom, settings.textFade);
    const placed = new Map<
      string,
      { readonly x: number; readonly y: number; readonly radius: number }
    >();
    const nodes: Array<DrawnNode & { readonly order: number }> = graph.nodes.map((node, index) => {
      const at = positions[index] ?? { x: 0, y: 0 };
      const radius = this.#radiusOf(node.id);
      placed.set(node.id, { x: at.x, y: at.y, radius });
      const base =
        node.id === graph.center
          ? colors.accent
          : node.group !== null
            ? (colors.groups[node.group] ?? colors.node)
            : node.kind === "dependency"
              ? colors.faint
              : colors.node;
      const isLit = lighting && lit.has(node.id);
      const restLabel = node.id === graph.center ? 1 : zoomLabels;
      return {
        id: node.id,
        x: at.x,
        y: at.y,
        radius,
        fill: isLit ? mix(base, colors.accent, share) : base,
        alpha: lighting && !isLit ? 1 - (1 - FADED_NODE) * share : 1,
        hollow: node.kind === "folder",
        ring: node.changed ? colors.changed : null,
        label: nodeLabel(node),
        labelColor: node.test ? colors.node : colors.ink,
        labelAlpha: !lighting
          ? restLabel
          : isLit
            ? restLabel + (1 - restLabel) * share
            : restLabel * (1 - (1 - FADED_NODE) * share),
        order: isLit ? 1 : 0,
      };
    });
    const links: Array<DrawnLink & { readonly order: number }> = [];
    for (const link of graph.links) {
      const from = placed.get(link.from);
      const to = placed.get(link.to);
      if (from === undefined || to === undefined || link.from === link.to) continue;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length <= from.radius + to.radius) continue;
      const ux = (to.x - from.x) / length;
      const uy = (to.y - from.y) / length;
      const isLit =
        lighting &&
        this.#litFrom !== null &&
        (link.from === this.#litFrom || link.to === this.#litFrom);
      const alpha =
        (link.guessed ? GUESSED : 1) * (lighting && !isLit ? 1 - (1 - FADED_LINK) * share : 1);
      links.push({
        x1: from.x + ux * from.radius,
        y1: from.y + uy * from.radius,
        x2: to.x - ux * to.radius,
        y2: to.y - uy * to.radius,
        color: isLit ? mix(colors.link, colors.accent, share) : colors.link,
        alpha,
        arrow: settings.arrows,
        order: isLit ? 1 : 0,
      });
    }
    const byOrder = (left: { order: number }, right: { order: number }) => left.order - right.order;
    return {
      width: this.#width,
      height: this.#height,
      camera,
      links: links.toSorted(byOrder).map(({ order: _, ...link }) => link),
      nodes: nodes.toSorted(byOrder).map(({ order: _, ...node }) => node),
      lineWidth: settings.linkThickness,
      paper: colors.paper,
      font,
    };
  }

  #draw(): void {
    const frame = this.frame();
    if (frame !== null) this.#drawer.draw(frame);
  }

  #radiusOf(id: string): number {
    const node = this.#nodesById.get(id);
    return node === undefined
      ? BASE_RADIUS
      : nodeRadius(node, this.#degrees.get(id) ?? 0, this.#settings.nodeSize);
  }

  #toWorld(x: number, y: number): Point {
    const { camera } = this;
    return {
      x: camera.x + (x - this.#width / 2) / camera.zoom,
      y: camera.y + (y - this.#height / 2) / camera.zoom,
    };
  }

  #toScreen(point: Point): Point {
    const { camera } = this;
    return {
      x: (point.x - camera.x) * camera.zoom + this.#width / 2,
      y: (point.y - camera.y) * camera.zoom + this.#height / 2,
    };
  }

  #local(event: PointerEvent | WheelEvent): Point {
    const bounds = this.#host.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  /** The node under a point in the frame, the nearest when several are. */
  nodeAt(x: number, y: number): string | null {
    const graph = this.#graph;
    const forces = this.#forces;
    if (graph === null || forces === null) return null;
    const world = this.#toWorld(x, y);
    const slop = HIT_SLOP / this.#camera.zoom;
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const node of graph.nodes) {
      const at = forces.positionOf(node.id);
      if (at === null) continue;
      const distance = Math.hypot(at.x - world.x, at.y - world.y);
      if (distance <= this.#radiusOf(node.id) + slop && distance < bestDistance) {
        best = node.id;
        bestDistance = distance;
      }
    }
    return best;
  }

  #setHovered(id: string | null): void {
    if (id === this.#hovered) return;
    this.#hovered = id;
    if (id !== null && this.#graph !== null) {
      this.#lit = neighbourhood(this.#graph, id);
      this.#litFrom = id;
    }
    this.#host.style.cursor = id === null ? "" : "pointer";
    this.#scheduler.animate(this.#motion);
    this.#tellHover();
  }

  #tellHover(): void {
    const id = this.#hovered;
    const at = id === null || this.#press !== null ? null : this.#forces?.positionOf(id);
    if (id === null || at === null || at === undefined) {
      this.#callbacks.onHover(null);
      return;
    }
    const screen = this.#toScreen(at);
    this.#callbacks.onHover({ id, x: screen.x, y: screen.y });
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.#press !== null) return;
    const at = this.#local(event);
    const id = this.nodeAt(at.x, at.y);
    this.#press =
      id === null
        ? { kind: "pan", pointer: event.pointerId, x: at.x, y: at.y, camera: this.#camera }
        : {
            kind: "node",
            id,
            pointer: event.pointerId,
            x: at.x,
            y: at.y,
            modifier: event.metaKey || event.ctrlKey,
            moved: false,
          };
    this.#host.setPointerCapture?.(event.pointerId);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    const at = this.#local(event);
    const press = this.#press;
    if (press === null) {
      this.#setHovered(this.nodeAt(at.x, at.y));
      return;
    }
    if (press.pointer !== event.pointerId) return;
    if (press.kind === "pan") {
      this.#camera = {
        ...press.camera,
        x: press.camera.x - (at.x - press.x) / press.camera.zoom,
        y: press.camera.y - (at.y - press.y) / press.camera.zoom,
      };
      this.#scheduler.invalidate();
      return;
    }
    if (!press.moved && Math.hypot(at.x - press.x, at.y - press.y) < CLICK_SLOP) return;
    if (!press.moved) {
      press.moved = true;
      // The card would ride over the dragged node: it goes until the drag ends.
      this.#setHovered(press.id);
      this.#callbacks.onHover(null);
    }
    this.#forces?.drag(press.id, this.#toWorld(at.x, at.y));
    this.#scheduler.animate(this.#motion);
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    const press = this.#press;
    if (press === null || press.pointer !== event.pointerId) return;
    this.#press = null;
    this.#host.releasePointerCapture?.(event.pointerId);
    if (press.kind !== "node") return;
    if (press.moved) {
      this.#forces?.release(press.id);
      this.#scheduler.animate(this.#motion);
      const at = this.#local(event);
      this.#setHovered(this.nodeAt(at.x, at.y));
      this.#tellHover();
      return;
    }
    this.#callbacks.onOpen(press.id, press.modifier || event.metaKey || event.ctrlKey);
  };

  readonly #onPointerCancel = (event: PointerEvent): void => {
    const press = this.#press;
    if (press === null || press.pointer !== event.pointerId) return;
    this.#press = null;
    if (press.kind === "node" && press.moved) {
      this.#forces?.release(press.id);
      this.#scheduler.animate(this.#motion);
    }
  };

  readonly #onPointerLeave = (): void => {
    if (this.#press === null) this.#setHovered(null);
  };

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const at = this.#local(event);
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    // A pinch arrives as a wheel with Ctrl held, in smaller steps.
    const factor = Math.exp(-pixels * (event.ctrlKey ? 0.01 : 0.002));
    const before = this.#toWorld(at.x, at.y);
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.#camera.zoom * factor));
    // The world point under the pointer stays under it.
    this.#camera = {
      zoom,
      x: before.x - (at.x - this.#width / 2) / zoom,
      y: before.y - (at.y - this.#height / 2) / zoom,
    };
    if (this.#hovered !== null) this.#tellHover();
    this.#scheduler.invalidate();
  };
}
