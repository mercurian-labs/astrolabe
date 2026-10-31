/**
 * A file graph drawn the way Obsidian draws a vault: grey dots sized by their links, names under
 * them, hairline links at rest, the file in front in the accent. Where names would collide the
 * more important keeps its place (`labelPlacement.ts`). Forces run only while something moves;
 * frames are drawn only on a change, by a drawer that only paints (`FileGraphDrawer`).
 */
import { FileForces, type Point } from "../../layout/fileForces.ts";
import { seededPoint } from "../../layout/forceLayout.ts";
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
import {
  LABEL_VISIBLE,
  labelBoxes,
  labelOrder,
  placeLabels,
  type LabelBoxes,
} from "./labelPlacement.ts";

/** A node as the drawer paints it: world units, colours as 0xrrggbb. */
export interface DrawnNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly fill: number;
  readonly alpha: number;
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
  /** A link's width, in CSS pixels whatever the zoom. */
  readonly lineWidth: number;
  /** How large labels draw against `LABEL_SIZE`: see `labelScale`. */
  readonly labelScale: number;
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
  readonly ink: number;
  readonly node: number;
  /** A folded folder: a touch lighter than a file. */
  readonly folder: number;
  /** An outside package: lighter still, as Obsidian draws an attachment. */
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
/** Labels are set at this size: CSS pixels at zoom 1. */
export const LABEL_SIZE = 12;
/** A label's box is this many times its size tall. */
const LABEL_HEIGHT = 1.2;
/** What a hover leaves of everything it does not light. */
const FADED_NODE = 0.2;
const FADED_LINK = 0.08;
/** A link resolved by name alone draws at this share of a link's alpha. */
const GUESSED = 0.5;
/** How long a hover takes to light or fade, and a label to make way or come back, in seconds. */
const FADE_SECONDS = 0.15;
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

/** What sizes a node: its links, a folded folder's files. */
const nodeWeight = (node: FileGraphNode, degree: number): number =>
  node.kind === "folder" ? Math.max(degree, node.files ?? 0) : degree;

/** A node's radius in world units: bigger with more links, a folded folder with more files. */
export function nodeRadius(node: FileGraphNode, degree: number, nodeSize: number): number {
  return (
    nodeSize *
    Math.min(MAX_RADIUS, BASE_RADIUS + RADIUS_GROWTH * Math.sqrt(nodeWeight(node, degree)))
  );
}

/**
 * How much of its label a node shows at `zoom`: all of it zoomed in, none zoomed out past the
 * threshold. A higher text fade threshold fades labels sooner, as Obsidian's does.
 */
export function labelOpacity(zoom: number, textFade: number): number {
  const gone = 0.4 * 2 ** textFade;
  return Math.max(0, Math.min(1, (zoom - gone) / (gone * 0.5)));
}

/**
 * How large labels draw at `zoom`, against their size at zoom 1: with the graph zoomed out, and
 * more slowly zoomed in, so zooming in makes room between labels that collide.
 */
export const labelScale = (zoom: number): number => (zoom <= 1 ? zoom : Math.sqrt(zoom));

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
      ink: read("--atlas-ink", FALLBACK.ink),
      node,
      folder: mix(node, paper, 0.3),
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

/** What the label pass keeps between frames for one graph: one slot per node, in its order. */
interface Labels {
  readonly texts: ReadonlyArray<string>;
  readonly weights: Float64Array;
  /** Measured in `font` at `LABEL_SIZE`, or not yet (null). */
  widths: Float64Array;
  font: string | null;
  /** Whether a label has room at rest (1) or makes way (0), as the last frame placed it. */
  readonly fits: Float64Array;
  /** How much of its label each node shows at rest, easing towards `fits`; null until placed. */
  shown: Float64Array | null;
  readonly rest: Int32Array;
  /** While a hover lights some: their labels lead; the first `forced` show whatever they meet. */
  lit: Int32Array;
  forced: number;
  readonly boxes: LabelBoxes;
  readonly restAlpha: Float64Array;
  readonly litAlpha: Float64Array;
  readonly placed: Int32Array;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** A label's width at `LABEL_SIZE` in `font`, estimated where there is no canvas to measure it. */
function measureLabel(text: string, font: string): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (measureContext === null) return text.length * LABEL_CHAR;
  measureContext.font = `${LABEL_SIZE}px ${font}`;
  return measureContext.measureText(text).width;
}

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
  #labels: Labels | null = null;
  #forces: FileForces | null = null;
  #settings: FileGraphSettings = DEFAULT_FILE_GRAPH_SETTINGS;
  #camera: Camera = { x: 0, y: 0, zoom: 1 };
  /** Read at the next frame, after the host's effects have applied its theme. */
  #theme: ReturnType<typeof readFileGraphTheme> | null = null;
  #themeKey: string | undefined = undefined;
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
      const delta = dt / FADE_SECONDS;
      this.#hoverMix =
        target > this.#hoverMix
          ? Math.min(target, this.#hoverMix + delta)
          : Math.max(target, this.#hoverMix - delta);
      if (this.#hoverMix === 0 && this.#lit.size > 0) this.#lit = new Set();
      const fading = this.#fadeLabels(delta);
      // A hovered node the forces move takes its card along.
      if (moving && this.#hovered !== null && this.#press === null) this.#tellHover();
      return moving || this.#hoverMix !== target || fading;
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
    if (structure !== this.#structure) this.#degrees = fileGraphDegrees(graph);
    this.#labels = this.#labelsOf(graph);
    if (structure === this.#structure && forces !== null) {
      this.#scheduler.invalidate();
      return;
    }
    this.#structure = structure;
    const sameCenter = previous !== null && previous.center === graph.center;
    // A folder just unfolded: its files start where it stood.
    const folders = (previous?.nodes ?? []).filter((node) => node.kind === "folder");
    const startOf = (id: string): Point | null => {
      const kept = forces?.positionOf(id) ?? null;
      if (kept !== null) return kept;
      const folder = folders.find((each) => id.startsWith(`${each.id}/`));
      const at = folder === undefined ? null : (forces?.positionOf(folder.id) ?? null);
      if (at === null) return null;
      const [dx, dy] = seededPoint(id, 24);
      return { x: at.x + dx, y: at.y + dy };
    };
    const next = new FileForces(graph, this.#settings, startOf);
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
      before.changedFiles === settings.changedFiles &&
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

  /** A new theme (named by `key`): its colours and font are read at the next frame. */
  setTheme(key: string | undefined): void {
    if (key === this.#themeKey && this.#theme !== null) return;
    this.#themeKey = key;
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
    const labels = this.#placeLabels(graph, positions, font, zoomLabels, lighting);
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
          : settings.changedFiles && node.changed
            ? colors.changed
            : node.group !== null
              ? (colors.groups[node.group] ?? colors.node)
              : node.kind === "dependency"
                ? colors.faint
                : node.kind === "folder"
                  ? colors.folder
                  : colors.node;
      const isLit = lighting && lit.has(node.id);
      const restLabel = labels.restAlpha[index] ?? 0;
      return {
        id: node.id,
        x: at.x,
        y: at.y,
        radius,
        fill: isLit ? mix(base, colors.accent, share) : base,
        alpha: lighting && !isLit ? 1 - (1 - FADED_NODE) * share : 1,
        label: labels.texts[index] ?? "",
        labelColor: node.test ? colors.node : colors.ink,
        // A hover takes each label from where it rests to where the hover places it.
        labelAlpha: !lighting
          ? restLabel
          : restLabel +
            ((isLit ? 1 : FADED_NODE) * (labels.litAlpha[index] ?? 0) - restLabel) * share,
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
      labelScale: labelScale(camera.zoom),
      font,
    };
  }

  #draw(): void {
    const frame = this.frame();
    if (frame === null) return;
    this.#drawer.draw(frame);
    if (this.#labelsMoving()) this.#scheduler.animate(this.#motion);
  }

  /** The label pass's buffers for `graph`, ordered by the hover lighting it now. */
  #labelsOf(graph: FileGraphData): Labels {
    const count = graph.nodes.length;
    const weights = Float64Array.from(graph.nodes, (node) =>
      nodeWeight(node, this.#degrees.get(node.id) ?? 0),
    );
    const labels: Labels = {
      texts: graph.nodes.map(nodeLabel),
      weights,
      widths: new Float64Array(count),
      font: null,
      fits: new Float64Array(count),
      shown: null,
      rest: labelOrder(
        count,
        (index) => (graph.nodes[index]?.id === graph.center ? 0 : 1),
        (index) => weights[index] ?? 0,
      ),
      lit: new Int32Array(0),
      forced: 0,
      boxes: labelBoxes(count),
      restAlpha: new Float64Array(count),
      litAlpha: new Float64Array(count),
      placed: new Int32Array(count),
    };
    this.#orderLit(graph, labels);
    return labels;
  }

  /** The centre, then the hovered node, then what it lights, then the rest, each bigger first. */
  #orderLit(graph: FileGraphData, labels: Labels): void {
    const lit = this.#lit;
    const from = this.#litFrom;
    const rank = (index: number) => {
      const id = graph.nodes[index]?.id;
      if (id === graph.center) return 0;
      if (id === from) return 1;
      return id !== undefined && lit.has(id) ? 2 : 3;
    };
    labels.lit = labelOrder(graph.nodes.length, rank, (index) => labels.weights[index] ?? 0);
    // Only the centre and the hovered node always show: a hub's forty neighbours named at once
    // would pile up, so they claim room first but still give way to each other.
    labels.forced = labels.lit.findIndex((index) => rank(index) >= 2);
    if (labels.forced < 0) labels.forced = labels.lit.length;
  }

  /**
   * Where each label shows at rest (`restAlpha`) and, while a hover lights some, under it
   * (`litAlpha`): the zoom's fade, then what collisions leave it.
   */
  #placeLabels(
    graph: FileGraphData,
    positions: ReadonlyArray<Point>,
    font: string,
    zoomLabels: number,
    lighting: boolean,
  ): Labels {
    const labels = this.#labels ?? this.#labelsOf(graph);
    this.#labels = labels;
    if (labels.font !== font) {
      for (let index = 0; index < labels.texts.length; index += 1) {
        labels.widths[index] = measureLabel(labels.texts[index] ?? "", font);
      }
      labels.font = font;
    }
    const { boxes, restAlpha, litAlpha } = labels;
    const { x, y, zoom } = this.#camera;
    const scale = labelScale(zoom);
    const height = LABEL_SIZE * LABEL_HEIGHT * scale;
    for (let index = 0; index < graph.nodes.length; index += 1) {
      const node = graph.nodes[index];
      const at = positions[index];
      if (node === undefined || at === undefined) continue;
      const below = at.y + this.#radiusOf(node.id) + LABEL_GAP;
      boxes.x[index] = (at.x - x) * zoom + this.#width / 2;
      boxes.top[index] = (below - y) * zoom + this.#height / 2;
      boxes.width[index] = (labels.widths[index] ?? 0) * scale;
      boxes.height[index] = height;
      const alone = node.id === graph.center ? 1 : zoomLabels;
      restAlpha[index] = alone;
      litAlpha[index] = lighting && this.#lit.has(node.id) ? 1 : alone;
    }
    placeLabels(boxes, restAlpha, labels.rest, 0, labels.placed);
    if (lighting) placeLabels(boxes, litAlpha, labels.lit, labels.forced, labels.placed);
    const { fits } = labels;
    // A new graph's labels start where they are placed; after that they ease there.
    const shown = labels.shown ?? fits;
    for (let index = 0; index < graph.nodes.length; index += 1) {
      const alone = graph.nodes[index]?.id === graph.center ? 1 : zoomLabels;
      // A label the zoom has faded out keeps the room it had, for when it comes back.
      if (alone > LABEL_VISIBLE) fits[index] = (restAlpha[index] ?? 0) > LABEL_VISIBLE ? 1 : 0;
      restAlpha[index] = alone * (shown[index] ?? 0);
    }
    labels.shown ??= Float64Array.from(fits);
    return labels;
  }

  /** Eases each label towards the room it has, by `delta`; true while one still moves. */
  #fadeLabels(delta: number): boolean {
    const shown = this.#labels?.shown;
    const fits = this.#labels?.fits;
    if (shown === undefined || shown === null || fits === undefined) return false;
    let fading = false;
    for (let index = 0; index < shown.length; index += 1) {
      const from = shown[index] ?? 0;
      const to = fits[index] ?? 0;
      if (from === to) continue;
      const next = to > from ? Math.min(to, from + delta) : Math.max(to, from - delta);
      shown[index] = next;
      if (next !== to) fading = true;
    }
    return fading;
  }

  /** Whether a label the last frame placed has yet to get there. */
  #labelsMoving(): boolean {
    const shown = this.#labels?.shown;
    const fits = this.#labels?.fits;
    if (shown === undefined || shown === null || fits === undefined) return false;
    for (let index = 0; index < shown.length; index += 1) {
      if (shown[index] !== fits[index]) return true;
    }
    return false;
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
      if (this.#labels !== null) this.#orderLit(this.#graph, this.#labels);
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
