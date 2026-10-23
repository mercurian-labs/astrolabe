/**
 * The flat renderers' shared controller. It runs the graph exactly as the
 * Atlas renderer's Flat mode does (the same targets, springs, story, beads,
 * framing, following, zoom limits, label windows, and pointer rules) on a
 * plain 2D camera: a centre and a scale, pan by dragging empty space, zoom
 * with the wheel toward the pointer. It draws nothing itself; a `FlatDrawer`
 * (Three for "lean", Pixi for "pixi") draws the frame it hands over. Like
 * the Atlas renderer, it holds what shows in slots of its own (see
 * `WorkingSet`) and speaks to the host in universe indices.
 */
import { TagLayer, type GraphTag } from "../tags.ts";
import { Vector3 } from "three";

import { layoutUnit, shownRadius, type GraphLayout } from "../../layout/forceLayout.ts";
import { gatheringOffset, type Gathering } from "../../layout/gathering.ts";
import { nodeTraits, WAVE_SECONDS } from "../../layout/motion.ts";
import { composeOffset, dragFrom, type Offset } from "../../layout/offsets.ts";
import type { PlayFocus } from "../../model/plays.ts";
import type { GraphSettings } from "../../model/settings.ts";
import { grewFrom, type Universe } from "../../model/universe.ts";
import { EdgeKind, type GraphView, type ReadingView } from "../../model/view.ts";
import { BEAD_POOL, advanceBeads, placeBeads } from "../beads.ts";
import {
  densityDistance,
  FIT_MARGIN,
  FLIGHT_MS,
  flatToScreen,
  flatToWorld,
  flatViewAt,
  followFlatView,
  READING_PIXELS,
  readingFrame,
  storyCentre,
  zoomFlatAt,
  type FlatCamera,
  type ReadingFrame,
} from "../camera.ts";
import { EdgeStyle } from "../edgeStyle.ts";
import { classifyInViewRect, flatViewRect } from "../inView.ts";
import { LABEL_FADE_STRENGTH, labelGrowth, labelOpacity, prominentOpacity } from "../labelFade.ts";
import { LABEL_PIXELS } from "../labels.ts";
import { NodeState, StyleChannel } from "../nodeState.ts";
import { distanceToSegment, pickNearestIn, PointerTracker, ScreenNodes } from "../picking.ts";
import { LABEL_BUDGET, LabelBoxes, panelLabelBudget, placeLabels } from "../pool.ts";
import {
  beadChecksum,
  canTimeGpu,
  GpuTimer,
  visibleBeads,
  type BenchDriver,
  type FrameSample,
} from "../probe.ts";
import {
  FrameTimer,
  runBench,
  type BenchResult,
  type FlatView,
  type GraphRenderer,
  type RendererCallbacks,
  type RendererOptions,
  type RendererStats,
  type ViewContext,
  type WorkCounter,
} from "../renderer.ts";
import { browserClock, FrameScheduler, type Animation } from "../scheduler.ts";
import { edgeWidthScale } from "../shaders.ts";
import { Storyline } from "../storyline.ts";
import { Storyteller } from "../storyteller.ts";
import { applyTargets, edgeKinds } from "../targets.ts";
import type { TourVisit } from "../../model/tour.ts";
import { CameraReach, reachShift } from "../reach.ts";
import { namedRegions, REGION_NAME_PIXELS, REGION_PAD, regionCircles } from "../regions.ts";
import { readTheme, type GraphTheme } from "../theme.ts";
import { WorkingSet, type SlotChange } from "../workingSet.ts";
import {
  ALL_DIRTY,
  type DrawerHost,
  type FlatDirty,
  type FlatDrawer,
  type FlatScale,
  type LabelLayout,
} from "./drawer.ts";

/** The Atlas renderer's field of view: the flat label window is measured as if seen through it. */
const FOV = 40;
/** Label window around the reading density, in spacings: fully drawn one in front, off two behind. */
const FADE_NEAR = 1;
const LABEL_FADE_FAR = 2;
const DRAG_THRESHOLD = 4;
const EDGE_HOVER_PIXELS = 5;
const LIT_EDGE_PIXELS = 1.5;
const BEAD_PIXELS = 1.6;
/** Wheel zoom: the scale changes by e^(−k · delta pixels). */
const WHEEL_ZOOM = 0.0015;
const DENSITY_ZOOM_RANGE = 4;
/** A label drawn last frame keeps its place against a near rival: names do not flicker as notes glide. */
const LABEL_STICKY = 0.25;

/** Everything drawn, per slot: rebuilt at a new size when the working set outgrows it. */
interface Graph {
  readonly slots: WorkingSet;
  state: NodeState;
  edgeStyle: EdgeStyle;
  kinds: Uint8Array;
  waves: Uint8Array;
  readonly beadPositions: Float32Array;
  readonly beadBright: Float32Array;
  labels: LabelLayout;
}

interface Press {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly node: number;
  readonly from: FlatCamera;
  dragging: boolean;
  panning: boolean;
}

export type DrawerFactory = (host: DrawerHost) => FlatDrawer;

export class FlatRenderer implements GraphRenderer {
  readonly #container: HTMLElement;
  readonly #tags: TagLayer;
  readonly #callbacks: RendererCallbacks;
  readonly #mode: "lean" | "pixi";
  readonly #drawer: FlatDrawer;
  readonly #scheduler: FrameScheduler;
  readonly #resize: ResizeObserver;
  readonly #frameTimer = new FrameTimer();
  readonly #storyline = new Storyline(() => this.#storyChanged());
  #graph: Graph | null = null;
  #view: GraphView | null = null;
  #layout: GraphLayout | null = null;
  #settings: GraphSettings | null = null;
  #gathering: Gathering | null = null;
  #readingFrame: ReadingFrame | null = null;
  #reading = false;
  #camera: FlatCamera = { x: 0, y: 0, scale: 1 };
  #flight: { from: FlatCamera; to: FlatCamera; start: number | null } | null = null;
  #following = true;
  /** The notes (universe indices) following frames when there is no reading. */
  #risenNotes: ReadonlyArray<number> = [];
  /** The picked note (universe index) of the last view, or -1. */
  #focusNote = -1;
  /** The selected play, by universe index; the storyline holds it in slots. */
  #playNote: PlayFocus | null = null;
  readonly #counter: WorkCounter | undefined;
  #hoverNode = -1;
  #hoverEdge = -1;
  #hoverQueued = false;
  #pointerInside = false;
  readonly #pointerTracker = new PointerTracker();
  #pointer = { x: 0, y: 0 };
  #press: Press | null = null;
  /** Each dragged note's drag, by universe index. */
  #dragOffsets = new Map<number, [number, number, number]>();
  #pendingLayout: Float32Array | null = null;
  #unit = 1;
  #inView = new Uint8Array(0);
  /** Reused by picking and the label budget: nothing is allocated per node. */
  #screen = new ScreenNodes(0);
  #priority = new Float32Array(0);
  /** 1 for each slot whose label the last frame drew. */
  #labelDrawn = new Uint8Array(0);
  /** 1 for each slot whose label reads on its node's left (it would cross the right edge). */
  #labelLeft = new Uint8Array(0);
  /** How far each slot's label stacked off its node's line, in CSS pixels (down positive). */
  #labelDy = new Float32Array(0);
  readonly #candidates: Array<number> = [];
  /** A bench listening to every rendered frame, the label boxes it asked for, and its GPU timer. */
  #sampleListener: ((sample: FrameSample) => void) | null = null;
  #sampleBoxes: LabelBoxes | null = null;
  #gpuTimer: GpuTimer | null = null;
  readonly #at = new Vector3();
  #inViewCount = 0;
  #labelCount = 0;
  /**
   * While the universe grows within one landing (a working turn writes files):
   * where each seated note stands, by universe index, fixed. The grown layout
   * and gathering move nothing already settled; a note new to the view is
   * placed once, at its group's edge, and held there too. The next landing
   * lets go, and the reading regathers.
   */
  #held: Map<number, readonly [number, number, number]> | null = null;
  /** How many arrivals each group (by parent, universe index) has taken while held. */
  readonly #arrivals = new Map<number, number>();
  /** The open containers' circles, recomputed each drawn frame. */
  #regionCircles: Float32Array = new Float32Array(0);
  #turnRunning = false;
  #waveStart: number | null = null;
  #pulse = 1000;
  #theme: GraphTheme;
  #themeKey: string | undefined = undefined;
  #scale: FlatScale = {
    lineWidth: 1,
    arrows: false,
    arrowSize: 1,
    dash: 1,
    beadPixels: BEAD_PIXELS,
  };
  #dirty: FlatDirty = { ...ALL_DIRTY };
  #width = 1;
  #height = 1;

  readonly #springs: Animation = {
    step: (dt, now) => {
      const graph = this.#graph;
      if (graph === null) return false;
      if (!graph.state.prominence.settled) this.#dirty.prominence = true;
      const nodesMoving = graph.state.step(dt, now / 1000);
      if (!graph.edgeStyle.settled) this.#dirty.edgeStyle = true;
      graph.edgeStyle.step(dt);
      return nodesMoving || !graph.edgeStyle.settled;
    },
  };

  readonly #waving: Animation = {
    step: (_dt, now) => {
      const graph = this.#graph;
      if (graph === null || this.#waveStart === null) return false;
      const pulse = now / 1000 - this.#waveStart;
      if (pulse < WAVE_SECONDS) {
        this.#pulse = pulse;
        return true;
      }
      this.#waveStart = null;
      this.#pulse = 1000;
      graph.waves.fill(0);
      this.#dirty.wave = true;
      return false;
    },
  };

  readonly #beading: Animation = {
    step: (dt) => {
      const graph = this.#graph;
      if (graph === null || this.#storyline.beads.count === 0) return false;
      advanceBeads(this.#storyline.beads, dt);
      this.#placeBeads(graph);
      return true;
    },
  };

  /** The hover's reach toward its links' far ends, and where the camera stood before it reached. */
  readonly #reach = new CameraReach(
    (notes) => this.#reachToward(notes),
    () => this.#reachBack(),
  );
  #reachOrigin: FlatView | null = null;

  /** Where the survey's camera stood before each container the tour has open. */
  readonly #surveyViews: Array<FlatView> = [];
  /** The agent's cursor telling the landing turn (shared with the Atlas renderer). */
  readonly #teller = new Storyteller({
    size: () => ({ width: this.#width, height: this.#height }),
    noteOnScreen: (note) => {
      const graph = this.#graph;
      const slot = graph?.slots.slotOf(note) ?? -1;
      if (graph === null || slot < 0) return null;
      const visibility = graph.state.styleOf(slot, StyleChannel.visibility);
      const at = graph.state.current(slot, new Vector3());
      const [x, y] = flatToScreen(this.#camera, this.#width, this.#height, at.x, at.y);
      return { x, y, r: graph.state.drawnRadius(slot) * visibility * this.#camera.scale };
    },
    noteOnPlane: (note) => {
      const graph = this.#graph;
      const slot = graph?.slots.slotOf(note) ?? -1;
      if (graph === null || slot < 0) return null;
      const visibility = graph.state.styleOf(slot, StyleChannel.visibility);
      if (visibility < 0.05) return null;
      const at = graph.state.current(slot, new Vector3());
      return { x: at.x, y: at.y, r: graph.state.drawnRadius(slot) * visibility };
    },
    toPlane: (x, y) => this.#toWorld(x, y),
    storyLit: () => this.#storyline.lit(),
    holdStory: () => this.#storyline.hold(),
    relight: () => this.#relight(),
    tourCamera: (open) => this.#tourCamera(open),
    onCursor: (play) => this.#callbacks.onCursor?.(play),
    onDrill: (inner, open) => this.#callbacks.onCursorDrill?.(inner, open),
    onCursorAt: (at) => this.#callbacks.onCursorAt?.(at),
    tourEnded: () => {
      // The tour closed what it opened: the camera fits the survey it returned to, at the
      // reading density, to the frame as it is now (a resize mid-tour moved nothing saved).
      this.#surveyViews.length = 0;
      if (this.#following) this.#fitFrame(true);
    },
    animate: () => this.#scheduler.animate(this.#telling),
    invalidate: () => this.#scheduler.invalidate(),
  });
  readonly #telling: Animation = {
    step: () => this.#teller.tell(performance.now() / 1000),
  };

  readonly #flying: Animation = {
    step: (_dt, now) => {
      const flight = this.#flight;
      if (flight === null) return false;
      if (flight.start === null) flight.start = now;
      const t = (now - flight.start) / FLIGHT_MS;
      this.#camera = flatViewAt(flight.from, flight.to, t);
      if (t >= 1) this.#flight = null;
      return t < 1;
    },
  };

  constructor(
    container: HTMLElement,
    callbacks: RendererCallbacks,
    mode: "lean" | "pixi",
    createDrawer: DrawerFactory,
    options: RendererOptions = {},
  ) {
    this.#container = container;
    this.#callbacks = callbacks;
    this.#tags = new TagLayer(container, (index) => this.#callbacks.onTag?.(index));
    this.#mode = mode;
    this.#counter = options.counter;
    this.#theme = readTheme(container);
    this.#scheduler = new FrameScheduler(options.clock ?? browserClock, () => this.#render());
    this.#drawer = createDrawer({
      container,
      pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
      redraw: () => {
        this.#dirty = { ...ALL_DIRTY };
        this.#scheduler.invalidate();
      },
      invalidate: () => this.#scheduler.invalidate(),
    });
    container.style.touchAction = "none";
    container.addEventListener("pointerdown", this.#onPointerDown);
    container.addEventListener("pointermove", this.#onPointerMove);
    container.addEventListener("pointerleave", this.#onPointerLeave);
    container.addEventListener("wheel", this.#onWheel, { passive: false });
    globalThis.addEventListener("pointermove", this.#onDragMove);
    globalThis.addEventListener("pointerup", this.#onPointerUp);
    this.#resize = new ResizeObserver(() => this.#onResize());
    this.#resize.observe(container);
    this.#onResize();
  }

  get following(): boolean {
    return this.#following;
  }

  stats(now: number): RendererStats {
    return {
      mode: this.#mode,
      framesLastSecond: this.#scheduler.framesInLastSecond(now),
      totalFrames: this.#scheduler.totalFrames,
      animating: this.#scheduler.animating,
      inView: this.#inViewCount,
      slots: this.#graph?.slots.capacity ?? 0,
      shown: this.#view?.shownNodes ?? 0,
      labels: this.#labelCount,
      radiusPx: this.#radiusPixels(),
      edgePx: [
        this.#scale.lineWidth * this.#camera.scale * edgeWidthScale(0.6),
        this.#scale.lineWidth * this.#camera.scale * edgeWidthScale(1),
      ],
      beads: this.#storyline.beads.count,
      drawCalls: this.#drawer.drawCalls,
      renderMs: this.#frameTimer.render,
      prepMs: this.#frameTimer.prep,
    };
  }

  #radiusPixels(): readonly [number, number, number] {
    const graph = this.#graph;
    const view = this.#view;
    if (graph === null || view === null) return [0, 0, 0];
    const { state } = graph;
    let smallest = Infinity;
    let largest = 0;
    let prominent = 0;
    view.nodeVisible.forEach((visible, index) => {
      if (visible !== 1) return;
      const radius = state.baseRadius(index);
      smallest = Math.min(smallest, radius);
      largest = Math.max(largest, radius);
      if ((state.prominence.values[index] ?? 0) > 0.01) {
        prominent = Math.max(prominent, state.drawnRadius(index));
      }
    });
    const scale = this.#camera.scale;
    return smallest === Infinity
      ? [0, 0, 0]
      : [smallest * scale, largest * scale, prominent * scale];
  }

  /**
   * A new universe: start an empty working set; the first view seats what
   * shows and frames it. A universe that grew from the one held (a working
   * turn wrote a file) keeps every slot, spring, and the camera: it is laid
   * out anew, and the next view seats what is new and glides what moved.
   */
  setGraph(universe: Universe, layout: GraphLayout): void {
    const graph = this.#graph;
    if (graph !== null && this.#view !== null && grewFrom(graph.slots.universe, universe)) {
      // Every seated note stays where it is settled: its landing, before the new layout.
      const held = this.#held ?? new Map<number, readonly [number, number, number]>();
      const at = new Vector3();
      for (let slot = 0; slot < graph.slots.capacity; slot += 1) {
        const note = graph.slots.nodeOf(slot);
        if (note < 0 || held.has(note) || this.#view.nodeVisible[slot] !== 1) continue;
        this.#landing(slot, at);
        held.set(note, [at.x, at.y, at.z]);
      }
      this.#held = held;
      graph.slots.grow(universe);
      this.setLayout(layout);
      return;
    }
    this.#held = null;
    this.#arrivals.clear();
    const slots = new WorkingSet(universe);
    const state = new NodeState(slots.capacity);
    this.#graph?.state.dispose();
    this.#graph = {
      slots,
      state,
      edgeStyle: new EdgeStyle(slots.edgeCapacity),
      kinds: new Uint8Array(slots.edgeCapacity),
      waves: new Uint8Array(slots.edgeCapacity),
      beadPositions: new Float32Array(BEAD_POOL * 3),
      beadBright: new Float32Array(BEAD_POOL),
      labels: labelLayout(slots),
    };
    this.#counter?.count("allocate", slots.capacity + slots.edgeCapacity);
    this.#sizeScratch(slots.capacity);
    this.#view = null;
    this.#focusNote = -1;
    this.#gathering = null;
    this.#readingFrame = null;
    this.#storyline.reset();
    if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#callbacks.onHover(null);
    this.#hoverNode = -1;
    this.#hoverEdge = -1;
    this.#dragOffsets.clear();
    this.#flight = null;
    this.#waveStart = null;
    this.#pulse = 1000;
    this.#pendingLayout = null;
    this.#layout = layout;
    this.#unit = layoutUnit(layout);
    state.setScale(this.#unit, true);
    this.#drawer.setGraph(slots.graph, state, this.#graph.edgeStyle);
    this.#dirty = { ...ALL_DIRTY };
    this.#applyScale();
  }

  /** The per-slot scratch buffers: in view, picking, and label priority. */
  #sizeScratch(capacity: number): void {
    this.#inView = new Uint8Array(capacity);
    this.#screen = new ScreenNodes(capacity);
    this.#priority = new Float32Array(capacity);
    this.#labelDrawn = new Uint8Array(capacity);
    this.#labelLeft = new Uint8Array(capacity);
    this.#labelDy = new Float32Array(capacity);
  }

  /**
   * The working set outgrew (or shrank well below) its slots: rebuild every
   * buffer at the new size, each note carrying its state to its new slot.
   */
  #resizeGraph(graph: Graph, resized: NonNullable<SlotChange["resized"]>): void {
    const capacity = resized.nodes.length;
    const edgeCapacity = resized.edges.length;
    const state = NodeState.carried(graph.state, capacity, resized.nodes);
    const edgeStyle = new EdgeStyle(edgeCapacity);
    edgeStyle.carry(graph.edgeStyle, resized.edges);
    graph.state.dispose();
    graph.state = state;
    graph.edgeStyle = edgeStyle;
    graph.kinds = new Uint8Array(edgeCapacity);
    graph.waves = new Uint8Array(edgeCapacity);
    graph.labels = labelLayout(graph.slots);
    this.#counter?.count("allocate", capacity + edgeCapacity);
    this.#sizeScratch(capacity);
    // A wave's edges were renumbered: let it go rather than ring the wrong links.
    this.#waveStart = null;
    this.#pulse = 1000;
    this.#drawer.setGraph(graph.slots.graph, state, edgeStyle);
    this.#dirty = { ...ALL_DIRTY };
  }

  /** Seat what arrived: each new note at its home, at rest, invisible (it rises); each new edge dark. */
  #seat(graph: Graph, change: SlotChange): void {
    const { slots, state, edgeStyle } = graph;
    const homes = this.#layout?.positions;
    const view = slots.view;
    for (const slot of change.arrived) {
      const note = slots.nodeOf(slot);
      const home = [homes?.[note * 3] ?? 0, homes?.[note * 3 + 1] ?? 0, homes?.[note * 3 + 2] ?? 0];
      state.assign(slot, home, nodeTraits(note), this.#radiusFor(view.nodeDegree[slot] ?? 0));
    }
    if (change.resized === null) for (const slot of change.releasedEdges) edgeStyle.clear(slot);
    for (const slot of change.arrivedEdges) {
      graph.waves[slot] = 0;
      edgeStyle.clear(slot);
    }
    if (change.arrived.length > 0) {
      state.writePositions();
      state.styleTexture.needsUpdate = true;
      this.#dirty.prominence = true;
    }
    if (change.arrived.length > 0 || change.arrivedEdges.length > 0) this.#dirty.slots = true;
  }

  /** Whether a slot's note or edge has finished fading out, so its slot can be given up. */
  #faded(graph: Graph) {
    return {
      node: (slot: number) =>
        graph.state.styleOf(slot, StyleChannel.visibility) < 0.01 && !graph.state.isRising(slot),
      edge: (slot: number) =>
        !graph.edgeStyle.lit.has(slot) && (graph.edgeStyle.values[slot * 2] ?? 0) < 0.01,
    };
  }

  /** Every seated note's home from `layout`. */
  #writeHomes(graph: Graph, layout: GraphLayout): void {
    const { slots, state } = graph;
    const homes = layout.positions;
    for (let slot = 0; slot < slots.capacity; slot += 1) {
      const note = slots.nodeOf(slot);
      if (note < 0) continue;
      state.setRestAt(
        slot,
        homes[note * 3] ?? 0,
        homes[note * 3 + 1] ?? 0,
        homes[note * 3 + 2] ?? 0,
      );
    }
    state.writePositions();
  }

  setLayout(layout: GraphLayout): void {
    const graph = this.#graph;
    if (graph === null) return;
    const from = this.#pendingLayout ?? graph.state.snapshot();
    this.#layout = layout;
    this.#unit = layoutUnit(layout);
    this.#applyScale();
    this.#dragOffsets.clear();
    graph.state.setScale(this.#unit, true);
    this.#writeHomes(graph, layout);
    this.#pendingLayout = from;
  }

  setView(shown: ReadingView, context: ViewContext, instant = false): void {
    const graph = this.#graph;
    if (graph === null) return;
    const first = this.#view === null;
    // Seat the view in slots, keeping the hover by note across any renumbering.
    const { slots } = graph;
    const hoverNote = this.#hoverNode >= 0 ? slots.nodeOf(this.#hoverNode) : -1;
    const hoverEdge = this.#hoverEdge >= 0 ? slots.edgeOf(this.#hoverEdge) : -1;
    const change = slots.apply(shown, this.#faded(graph));
    if (change.resized !== null) this.#resizeGraph(graph, change.resized);
    // The glide's starting points are per slot: they follow their notes through any
    // renumbering, and a slot that took a new note starts where that note is (no glide).
    if (this.#pendingLayout !== null) {
      this.#pendingLayout = carrySnapshot(this.#pendingLayout, change, slots.capacity);
    }
    this.#hoverNode = hoverNote >= 0 ? slots.slotOf(hoverNote) : -1;
    this.#hoverEdge = hoverEdge >= 0 ? slots.edgeSlotOf(hoverEdge) : -1;
    const view = slots.view;
    this.#view = view;
    // The reading's density first: what arrives is sized against it.
    if (context.gathering !== this.#gathering || first) {
      this.#gathering = context.gathering;
      this.#readingFrame = this.#measureReading();
      this.#applyScale();
      this.#updateClamps();
    }
    this.#seat(graph, change);
    this.#placeArrivals(graph);
    // Held, the reading is where its notes are drawn: Fit and following frame that.
    if (this.#held !== null) {
      this.#readingFrame = this.#measureReading();
      this.#applyScale();
      this.#updateClamps();
    }
    this.#refocus();
    this.#reading = context.reading;
    edgeKinds(view, this.#storyline.play, graph.kinds);
    this.#dirty.view = true;
    this.#dirty.kinds = true;
    if (this.#hoverNode >= 0 && view.nodeVisible[this.#hoverNode] !== 1) this.#setHover(-1, -1);
    this.#applyTargets();
    const pending = this.#pendingLayout;
    if (pending !== null && context.layout === this.#layout && !first) {
      this.#pendingLayout = null;
      graph.state.glideFrom(pending, performance.now() / 1000);
      this.#updateClamps();
    }
    if (first || instant) {
      this.#focusNote = shown.focus?.index ?? -1;
      graph.state.settle();
      graph.edgeStyle.settle();
      this.#dirty.edgeStyle = true;
      this.#dirty.prominence = true;
      if (first) this.#autoFrame(false);
      this.#scheduler.invalidate();
      return;
    }
    for (const slot of change.left) graph.state.cancelRise(slot);
    if (change.rose.length > 0) graph.state.rise(change.rose, performance.now() / 1000);
    this.#dealBeads();
    const picked = view.focus?.index ?? -1;
    const pickedNote = shown.focus?.index ?? -1;
    if (picked >= 0 && pickedNote !== this.#focusNote) {
      const touching = (slots.edgesOf[picked] ?? []).filter((edge) => view.edgeVisible[edge] === 1);
      this.#startWave(touching, picked);
      this.#turnToward([picked]);
    }
    this.#focusNote = pickedNote;
    this.#scheduler.animate(this.#springs);
  }

  landLinks(): void {
    const view = this.#view;
    if (view === null) return;
    // A landing regathers the reading: what a growing turn held lets go.
    if (this.#held !== null) {
      this.#held = null;
      this.#arrivals.clear();
      this.#applyTargets();
      this.#scheduler.animate(this.#springs);
    }
    // A step is the story's: a hover lets go, so the story is never dressed as a hover.
    if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#setHover(-1, -1);
    this.#storyline.land();
    this.#storyChanged();
    this.#teller.startTour();
    const landed: Array<number> = [];
    view.edgeCurrent.forEach((current, index) => {
      if (current === 1 && view.edgeKind[index] === EdgeKind.new && view.edgeVisible[index] === 1) {
        landed.push(index);
      }
    });
    this.#startWave(landed, -1);
  }

  setTurnRunning(running: boolean): void {
    if (running === this.#turnRunning) return;
    this.#turnRunning = running;
    // A running turn moves nothing by itself: only a change in whether the story
    // is lit retargets anything. Otherwise the story's fall timer is all it needs.
    const lit = this.#storyline.lit();
    this.#storyline.setRunning(running);
    if (this.#graph === null) return;
    if (this.#storyline.lit() !== lit) this.#storyChanged();
    else this.#storyline.schedule();
  }

  setMoves(
    visits: ReadonlyArray<TourVisit>,
    appended: ReadonlyArray<TourVisit> | null = null,
  ): void {
    if (!this.#teller.setMoves(visits, appended)) return;
    if (appended === null) this.#surveyViews.length = 0;
    this.#refocus();
  }

  setCursorPopover(open: boolean): void {
    this.#teller.setExpanded(open);
  }

  cursorTo(play: number | null): void {
    // Letting go of a chosen play, the camera returns to the reading while it follows: the
    // reader is never left looking at the empty place the play took it to.
    const letGo = play === null && this.#teller.holding;
    this.#teller.cursorTo(play);
    if (letGo && this.#following) this.#autoFrame(true);
  }

  /**
   * The survey's camera across a tour's openings: opening a container keeps
   * where the camera stood (where its flight was going), and closing it flies
   * back there exactly, so successive opens never drift the survey. A reader
   * who took the camera keeps it: nothing flies back.
   */
  #tourCamera(open: boolean): void {
    if (open) {
      this.#surveyViews.push({ ...(this.#flight?.to ?? this.#camera) });
      return;
    }
    const back = this.#surveyViews.pop();
    if (back === undefined || !this.#following) return;
    this.#flight = { from: this.#camera, to: back, start: null };
    this.#scheduler.animate(this.#flying);
  }

  /** What the tour has told changed: light anew, unless a chosen play holds the story. */
  #relight(): void {
    if (this.#playNote !== null || !this.#refocus()) return;
    const view = this.#view;
    const graph = this.#graph;
    if (view !== null && graph !== null) {
      edgeKinds(view, this.#storyline.play, graph.kinds);
      this.#dirty.kinds = true;
    }
    this.#applyTargets();
    this.#scheduler.animate(this.#springs);
    this.#dealBeads();
  }

  /** Light the story by the selected play, else by the tour; returns whether anything changed. */
  #refocus(): boolean {
    const graph = this.#graph;
    if (graph === null) return false;
    return this.#storyline.setPlay(graph.slots.playInSlots(this.#playNote ?? this.#teller.focus()));
  }

  /** A screen point (CSS pixels) as a world point under the current camera. */
  #toWorld(x: number, y: number): { x: number; y: number } {
    const camera = this.#camera;
    return {
      x: camera.x + (x - this.#width / 2) / camera.scale,
      y: camera.y - (y - this.#height / 2) / camera.scale,
    };
  }

  setPlay(play: PlayFocus | null): void {
    this.#playNote = play;
    const graph = this.#graph;
    const view = this.#view;
    if (graph === null) return;
    if (!this.#refocus()) return;
    const slotted = this.#storyline.play;
    if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#setHover(-1, -1);
    if (view !== null) {
      edgeKinds(view, slotted, graph.kinds);
      this.#dirty.kinds = true;
    }
    this.#storyChanged();
    if (slotted === null || !this.#following) return;
    if (slotted.nodes.some((node) => this.#inView[node] !== 1)) this.#turnToward(slotted.nodes);
  }

  #storyChanged(): void {
    // A story falling or landing changes what the tour leaves lit.
    if (this.#playNote === null && this.#refocus() && this.#view !== null && this.#graph !== null) {
      edgeKinds(this.#view, this.#storyline.play, this.#graph.kinds);
      this.#dirty.kinds = true;
    }
    this.#applyTargets();
    this.#scheduler.animate(this.#springs);
    this.#dealBeads();
    this.#storyline.schedule();
  }

  #dealBeads(): void {
    const graph = this.#graph;
    if (graph === null || !this.#storyline.deal(this.#view)) return;
    this.#dirty.beadsDealt = true;
    this.#placeBeads(graph);
    if (this.#storyline.beads.count > 0) this.#scheduler.animate(this.#beading);
    else this.#scheduler.invalidate();
  }

  #placeBeads(graph: Graph): void {
    placeBeads(
      this.#storyline.beads,
      graph.slots.graph.edges,
      graph.state,
      graph.edgeStyle,
      graph.beadPositions,
      graph.beadBright,
    );
  }

  #startWave(edges: ReadonlyArray<number>, from: number): void {
    const graph = this.#graph;
    if (graph === null || edges.length === 0) return;
    graph.waves.fill(0);
    for (const index of edges) {
      const edge = graph.slots.graph.edges[index];
      if (edge !== undefined) graph.waves[index] = from === edge.b ? 2 : 1;
    }
    this.#dirty.wave = true;
    this.#pulse = 0;
    this.#waveStart = performance.now() / 1000;
    this.#scheduler.animate(this.#waving);
  }

  setSettings(settings: GraphSettings): void {
    this.#settings = settings;
    this.#applyScale();
    this.#applyTargets();
    this.#scheduler.animate(this.#springs);
  }

  /** The drawn radius of a note of this degree: a share of the reading density's spacing, so the same on screen in every memory. */
  #radiusFor(degree: number): number {
    if (this.#layout === null) return 0;
    return shownRadius(degree, this.#settings?.nodeSize ?? 1, this.#densitySpan);
  }

  #applyScale(): void {
    const thickness = this.#settings?.lineThickness ?? 1;
    this.#scale = {
      lineWidth: (LIT_EDGE_PIXELS * thickness * this.#densitySpan) / READING_PIXELS,
      arrows: this.#settings?.arrows === true,
      arrowSize: (1.6 + 0.6 * thickness) * this.#unit,
      dash: 1.6 * this.#unit,
      beadPixels: BEAD_PIXELS * thickness,
    };
    this.#dirty.scale = true;
    this.#scheduler.invalidate();
  }

  setLabelFont(font: string | undefined): void {
    this.#drawer.setLabelFont(font);
    this.#scheduler.invalidate();
  }

  setThemeKey(key: string | undefined): void {
    if (key === this.#themeKey) return;
    this.#themeKey = key;
    this.#theme = readTheme(this.#container);
    this.#dirty.theme = true;
    this.#scheduler.invalidate();
  }

  frame(indices: ReadonlyArray<number>): void {
    const slots = this.#graph?.slots.slotsOf(indices) ?? [];
    if (slots.length === 0) return;
    const at = this.#landingCentroid(slots);
    this.#frame(true, at.x, at.y);
  }

  follow(indices: ReadonlyArray<number>): void {
    this.#risenNotes = indices;
    if (!this.#following) return;
    if (this.#readingFrame !== null || indices.length > 0) this.#autoFrame(true);
  }

  resumeFollowing(): void {
    if (!this.#following) {
      this.#following = true;
      this.#callbacks.onFollowingChange(true);
    }
    if (this.#readingFrame !== null || this.#risenNotes.length > 0) this.#autoFrame(true);
  }

  fit(): void {
    this.#fitFrame(true);
  }

  /**
   * The current flat view, or null before any view was shown: a renderer
   * that never framed anything (React's development double mount, say) has
   * no picture for the next one to take over.
   */
  flatView(): FlatView | null {
    return this.#view === null ? null : this.#camera;
  }

  adoptView(view: FlatView | null, following: boolean): void {
    if (view !== null) {
      this.#flight = null;
      this.#camera = { ...view };
      this.#updateClamps();
    }
    if (!following) this.#pauseFollowing();
    this.#scheduler.invalidate();
  }

  bench(seconds = 3): Promise<BenchResult> {
    return runBench(
      this.#frameTimer,
      (factor) => {
        const graph = this.#graph;
        if (graph === null) return;
        graph.state.glideFrom(graph.state.scaledSnapshot(factor), performance.now() / 1000);
        this.#scheduler.animate(this.#springs);
      },
      seconds,
    );
  }

  /** Where shown note `note` (universe index) is on screen now, or null when it is out of view. */
  #screenOf(note: number): readonly [number, number] | null {
    const graph = this.#graph;
    const index = graph?.slots.slotOf(note) ?? -1;
    if (graph === null || index < 0 || this.#inView[index] !== 1) return null;
    const at = graph.state.current(index, this.#at);
    return flatToScreen(this.#camera, this.#width, this.#height, at.x, at.y);
  }

  setTags(tags: ReadonlyArray<GraphTag>): void {
    if (tags.length === 0 && this.#tags.count === 0) return;
    this.#tags.set(tags);
    this.#scheduler.invalidate();
  }

  dispose(): void {
    this.#tags.dispose();
    this.#gpuTimer?.dispose();
    this.#reach.dispose();
    this.#scheduler.stop(this.#telling);
    this.#storyline.dispose();
    this.#scheduler.dispose();
    this.#resize.disconnect();
    const container = this.#container;
    container.removeEventListener("pointerdown", this.#onPointerDown);
    container.removeEventListener("pointermove", this.#onPointerMove);
    container.removeEventListener("pointerleave", this.#onPointerLeave);
    container.removeEventListener("wheel", this.#onWheel);
    globalThis.removeEventListener("pointermove", this.#onDragMove);
    globalThis.removeEventListener("pointerup", this.#onPointerUp);
    this.#drawer.dispose();
    this.#graph?.state.dispose();
    this.#graph = null;
  }

  #applyTargets(): void {
    const graph = this.#graph;
    const view = this.#view;
    if (graph === null || view === null) return;
    applyTargets({
      view,
      universe: graph.slots.graph,
      edgesOf: graph.slots.edgesOf,
      state: graph.state,
      edgeStyle: graph.edgeStyle,
      hover: this.#hoverNode,
      storyLit: this.#storyline.lit(),
      play: this.#storyline.play,
      radiusFor: (degree) => this.#radiusFor(degree),
      offsetFor: (index) =>
        composeOffset(this.#baseOffset(index), this.#dragOffsets.get(graph.slots.nodeOf(index))),
    });
    this.#dirty.edgeStyle = true;
  }

  /** The reading's frame from where its notes settle: their held places while a hold lasts. */
  #measureReading(): ReadingFrame | null {
    const gathering = this.#gathering;
    if (gathering === null) return null;
    const members = [...gathering.positions.keys()];
    const slots = this.#graph?.slots;
    const held = this.#held;
    return readingFrame(
      members.map((index) => held?.get(index) ?? gathering.positions.get(index) ?? [0, 0, 0]),
      (at) => this.#radiusFor(slots?.degreeOf(members[at] ?? -1) ?? 0),
    );
  }

  /** Where the reading's gathering puts slot `slot`'s note, relative to its home, before any drag. */
  #baseOffset(slot: number): Offset {
    const graph = this.#graph;
    const homes = this.#layout?.positions;
    if (graph === null || homes === undefined) return [0, 0, 0];
    const note = graph.slots.nodeOf(slot);
    const held = this.#held?.get(note);
    if (held !== undefined) {
      return [
        held[0] - (homes[note * 3] ?? 0),
        held[1] - (homes[note * 3 + 1] ?? 0),
        held[2] - (homes[note * 3 + 2] ?? 0),
      ];
    }
    return gatheringOffset(this.#gathering, homes, graph.slots.nodeOf(slot));
  }

  get #densitySpan(): number {
    const floor = 0.5 * (this.#settings?.linkDistance ?? 34);
    const reading = this.#readingFrame?.span ?? 0;
    return Math.max(reading > 0 ? reading : (this.#layout?.spacing ?? 0), floor);
  }

  /** The reading density's scale: one spacing spans READING_PIXELS. */
  get #densityScale(): number {
    return READING_PIXELS / this.#densitySpan;
  }

  /** The scale at which everything within `extent` of the centre fits, with margin. */
  #fitScale(extent: number): number {
    if (extent <= 0) return Infinity;
    return Math.min(this.#width, this.#height) / (2 * extent * FIT_MARGIN);
  }

  /** Zoom is free within a quarter to four times the reading density, and out as far as the reading needs. */
  #limits(extent = 0): { min: number; max: number } {
    const reach = Math.max(extent, this.#readingFrame?.extent ?? 0);
    const density = this.#densityScale;
    return {
      min: Math.min(density / DENSITY_ZOOM_RANGE, this.#fitScale(reach)),
      max: density * DENSITY_ZOOM_RANGE,
    };
  }

  #updateClamps(extent = 0): void {
    if (this.#flight !== null || this.#graph === null) return;
    const { min, max } = this.#limits(extent);
    const scale = Math.min(max, Math.max(min, this.#camera.scale));
    if (scale === this.#camera.scale) return;
    this.#camera = { ...this.#camera, scale };
    this.#scheduler.invalidate();
  }

  #frame(fly: boolean, x: number, y: number, extent = 0): void {
    if (this.#graph === null || this.#layout === null) return;
    const to = { x, y, scale: Math.min(this.#densityScale, this.#fitScale(extent)) };
    if (fly) {
      this.#flight = { from: this.#flight?.to ?? this.#camera, to, start: null };
      this.#scheduler.animate(this.#flying);
    } else {
      this.#flight = null;
      this.#camera = to;
      this.#scheduler.invalidate();
    }
  }

  /**
   * While held, each shown note not yet held is placed once and held there:
   * where the regathered reading puts it, moved by however far the reading
   * as a whole stands from its regathering (the mean offset of the held notes
   * the gathering also places), so arrivals keep the gathering's arrangement
   * (a folder opened by a new level packs as it would) beside notes that did
   * not move. One that would land on a held note, or that the gathering does
   * not place, goes to its group's edge instead (see `edgePlace`). The
   * settled notes never make room.
   */
  #placeArrivals(graph: Graph): void {
    const held = this.#held;
    const view = this.#view;
    if (held === null || view === null) return;
    const { slots } = graph;
    const parentOf = slots.universe.parentOf;
    const gathered = this.#gathering?.positions;
    const spacing = this.#densitySpan;
    let shift: readonly [number, number, number] | null = null;
    const alignment = (): readonly [number, number, number] => {
      let x = 0;
      let y = 0;
      let z = 0;
      let count = 0;
      for (const [note, point] of held) {
        const there = gathered?.get(note);
        if (there === undefined) continue;
        x += point[0] - there[0];
        y += point[1] - there[1];
        z += point[2] - there[2];
        count += 1;
      }
      return count === 0 ? [0, 0, 0] : [x / count, y / count, z / count];
    };
    const crowded = (point: readonly [number, number, number]) => {
      for (const other of held.values()) {
        if (Math.hypot(other[0] - point[0], other[1] - point[1]) < spacing * 0.5) return true;
      }
      return false;
    };
    for (let slot = 0; slot < slots.capacity; slot += 1) {
      const note = slots.nodeOf(slot);
      if (note < 0 || held.has(note) || view.nodeVisible[slot] !== 1) continue;
      const there = gathered?.get(note);
      if (there !== undefined) {
        shift ??= alignment();
        const point = [there[0] + shift[0], there[1] + shift[1], there[2] + shift[2]] as const;
        if (!crowded(point)) {
          held.set(note, point);
          continue;
        }
      }
      const parent = parentOf[note] ?? -1;
      const all = [...held.values()];
      const siblings = [...held].filter(([other]) => (parentOf[other] ?? -1) === parent);
      // No settled sibling: around the nearest held container above it (one the tour just
      // opened, say), else at the edge of the whole cluster.
      let around: readonly [number, number, number] | undefined;
      for (let up = parent; up >= 0 && around === undefined; up = parentOf[up] ?? -1) {
        around = held.get(up);
      }
      const group =
        siblings.length > 0
          ? siblings.map(([, point]) => point)
          : around !== undefined
            ? [around]
            : all;
      const taken = this.#arrivals.get(parent) ?? 0;
      this.#arrivals.set(parent, taken + 1);
      held.set(note, edgePlace(group, all, spacing, taken));
    }
  }

  #landing(index: number, out: Vector3): Vector3 {
    const graph = this.#graph;
    if (graph === null) return out.set(0, 0, 0);
    const { rest, offsets } = graph.state;
    return out.set(
      (rest[index * 3] ?? 0) + (offsets.targets[index * 3] ?? 0),
      (rest[index * 3 + 1] ?? 0) + (offsets.targets[index * 3 + 1] ?? 0),
      0,
    );
  }

  #landingCentroid(indices: ReadonlyArray<number>): Vector3 {
    const sum = new Vector3();
    const at = new Vector3();
    for (const index of indices) sum.add(this.#landing(index, at));
    return indices.length === 0 ? sum : sum.divideScalar(indices.length);
  }

  #autoFrame(fly: boolean): void {
    const reading = this.#readingFrame;
    if (reading !== null) {
      // Always at the reading density, never zoomed out to fit: centred on the
      // turn's story, the rest of the reading reached by panning.
      const target = this.#storyTarget() ?? reading.target;
      this.#frame(fly, target.x, target.y);
      return;
    }
    const risen = this.#view?.risen ?? [];
    const target = risen.length > 0 ? this.#landingCentroid(risen) : this.#anchor();
    this.#frame(fly, target.x, target.y);
  }

  /** Where a landing centres: the turn's story (else its worked notes), or their densest part. */
  #storyTarget(): Vector3 | null {
    const view = this.#view;
    if (view === null) return null;
    const notes = view.story.length > 0 ? view.story : view.risen;
    const points = notes.map((index) => this.#landing(index, new Vector3()));
    const reach = ((Math.min(this.#width, this.#height) / 2) * this.#densitySpan) / READING_PIXELS;
    return storyCentre(points, reach);
  }

  /** Fit: the pick at the reading density, else the reading's centre at it, else the frame following would take. */
  #fitFrame(fly: boolean): void {
    const focus = this.#view?.focus ?? null;
    const reading = this.#readingFrame;
    if (focus === null && reading !== null) {
      this.#frame(fly, reading.target.x, reading.target.y);
      return;
    }
    if (focus === null) {
      this.#autoFrame(fly);
      return;
    }
    const at = this.#landing(focus.index, new Vector3());
    this.#frame(fly, at.x, at.y);
  }

  #anchor(): Vector3 {
    const view = this.#view;
    const center = this.#layout?.center ?? [0, 0, 0];
    if (view === null) return new Vector3(center[0], center[1], 0);
    const shown: Array<number> = [];
    view.nodeVisible.forEach((visible, index) => {
      if (visible === 1) shown.push(index);
    });
    if (this.#reading && shown.length > 0) return this.#landingCentroid(shown);
    let hub = -1;
    for (const index of shown) {
      if (hub < 0 || (view.nodeDegree[index] ?? 0) > (view.nodeDegree[hub] ?? 0)) hub = index;
    }
    return hub < 0 ? new Vector3(center[0], center[1], 0) : this.#landing(hub, new Vector3());
  }

  #turnToward(indices: ReadonlyArray<number>): void {
    if (this.#graph === null || indices.length === 0) return;
    const points = indices.map((index) => this.#landing(index, new Vector3()));
    const current = this.#flight?.to ?? this.#camera;
    const reach = (this.#height / 2 / current.scale) * 0.35;
    const next = followFlatView(
      {
        position: new Vector3(current.x, current.y, 1),
        target: new Vector3(current.x, current.y, 0),
        zoom: 1,
      },
      points,
      reach,
    );
    if (next === null) return;
    this.#flight = {
      from: this.#camera,
      to: { x: next.target.x, y: next.target.y, scale: current.scale },
      start: null,
    };
    this.#scheduler.animate(this.#flying);
  }

  #pauseFollowing(): void {
    if (!this.#following) return;
    this.#following = false;
    this.#callbacks.onFollowingChange(false);
  }

  /** The container whose region name lies under (x, y), in CSS pixels, or -1. */
  #regionNameAt(x: number, y: number): number {
    const view = this.#view;
    if (view === null) return -1;
    const circles = this.#regionCircles;
    for (const position of namedRegions(view.regions, circles, this.#camera.scale)) {
      const region = view.regions[position];
      const r = circles[position * 4 + 3] ?? 0;
      if (region === undefined) continue;
      // Where the drawers place the name: just inside the disc's upper left, anchored left and middle.
      const [left, middle] = flatToScreen(
        this.#camera,
        this.#width,
        this.#height,
        (circles[position * 4] ?? 0) - r * 0.62,
        (circles[position * 4 + 1] ?? 0) + r * 0.74,
      );
      const width = [...region.name].length * REGION_NAME_PIXELS * 0.62;
      if (x >= left - 4 && x <= left + width + 4 && Math.abs(y - middle) <= REGION_NAME_PIXELS) {
        return region.note;
      }
    }
    return -1;
  }

  /** The hovered note's lit links' far ends, the hovered note first: what the reach brings into the frame. */
  #litEnds(node: number): Array<number> {
    const graph = this.#graph;
    const view = this.#view;
    const ends = [node];
    if (graph === null || view === null) return ends;
    for (const edge of graph.slots.edgesOf[node] ?? []) {
      const drawn = graph.slots.graph.edges[edge];
      if (view.edgeVisible[edge] !== 1 || drawn === undefined) continue;
      ends.push(drawn.a === node ? drawn.b : drawn.a);
    }
    return ends;
  }

  /** Pan just enough to bring these notes inside the frame's edge; whether the camera moved. */
  #reachToward(notes: ReadonlyArray<number>): boolean {
    if (this.#graph === null) return false;
    const current = this.#flight?.to ?? this.#camera;
    const shift = reachShift(
      {
        x: current.x,
        y: current.y,
        halfWidth: this.#width / 2 / current.scale,
        halfHeight: this.#height / 2 / current.scale,
      },
      notes.map((note) => this.#landing(note, new Vector3())),
    );
    if (shift === null) return false;
    this.#reachOrigin ??= { ...current };
    this.#flight = {
      from: this.#camera,
      to: { x: current.x + shift.dx, y: current.y + shift.dy, scale: current.scale },
      start: null,
    };
    this.#scheduler.animate(this.#flying);
    return true;
  }

  #reachBack(): void {
    const origin = this.#reachOrigin;
    this.#reachOrigin = null;
    if (origin === null) return;
    this.#flight = { from: this.#camera, to: origin, start: null };
    this.#scheduler.animate(this.#flying);
  }

  /** Any touch of the camera during a flight takes the camera back. */
  #takeCamera(): void {
    this.#reach.release();
    this.#reachOrigin = null;
    if (this.#flight !== null) {
      this.#flight = null;
      this.#scheduler.stop(this.#flying);
    }
    this.#pauseFollowing();
  }

  #local(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.#container.getBoundingClientRect();
    this.#pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return this.#pointer;
  }

  /** Every pickable node's place on screen, into the reused buffer: no allocation per node. */
  #project(): ScreenNodes | null {
    const graph = this.#graph;
    const view = this.#view;
    if (graph === null || view === null) return null;
    const screen = this.#screen;
    const at = this.#at;
    let projected = 0;
    for (let index = 0; index < graph.state.count; index += 1) {
      const visibility = graph.state.styleOf(index, StyleChannel.visibility);
      if (this.#inView[index] !== 1 || view.nodeVisible[index] !== 1 || visibility < 0.5) {
        screen.shown[index] = 0;
        continue;
      }
      projected += 1;
      graph.state.current(index, at);
      const { scale } = this.#camera;
      screen.set(
        index,
        this.#width / 2 + (at.x - this.#camera.x) * scale,
        this.#height / 2 - (at.y - this.#camera.y) * scale,
        graph.state.drawnRadius(index) * visibility * scale,
        0,
      );
    }
    this.#counter?.count("project", projected);
    return screen;
  }

  #pickAt(x: number, y: number): { node: number; edge: number } {
    const graph = this.#graph;
    const view = this.#view;
    const screen = this.#project();
    if (graph === null || view === null || screen === null) return { node: -1, edge: -1 };
    const node = pickNearestIn(screen, x, y);
    if (node >= 0) return { node, edge: -1 };
    let edge = -1;
    let best = EDGE_HOVER_PIXELS;
    graph.slots.graph.edges.forEach((candidate, index) => {
      if (view.edgeVisible[index] !== 1 || (view.edgeSlot[index] ?? -1) < 0) return;
      if (screen.shown[candidate.a] !== 1 || screen.shown[candidate.b] !== 1) return;
      const distance = distanceToSegment(
        x,
        y,
        screen.x[candidate.a] ?? 0,
        screen.y[candidate.a] ?? 0,
        screen.x[candidate.b] ?? 0,
        screen.y[candidate.b] ?? 0,
      );
      if (distance < best) {
        best = distance;
        edge = index;
      }
    });
    return { node: -1, edge };
  }

  #setHover(node: number, edge: number): boolean {
    if (node === this.#hoverNode && edge === this.#hoverEdge) return false;
    const nodeChanged = node !== this.#hoverNode;
    this.#hoverNode = node;
    this.#hoverEdge = edge;
    this.#container.style.cursor = node >= 0 ? "pointer" : "";
    if (nodeChanged) {
      this.#applyTargets();
      this.#scheduler.animate(this.#springs);
      this.#reach.hover(node >= 0 ? this.#litEnds(node) : null);
    }
    const graph = this.#graph;
    if (node >= 0 && graph !== null) {
      const at = graph.state.current(node, new Vector3());
      const [x, y] = flatToScreen(this.#camera, this.#width, this.#height, at.x, at.y);
      this.#callbacks.onHover({ kind: "node", index: graph.slots.nodeOf(node), x, y });
    } else if (edge >= 0) {
      this.#callbacks.onHover({
        kind: "edge",
        index: graph?.slots.edgeOf(edge) ?? -1,
        x: this.#pointer.x,
        y: this.#pointer.y,
      });
    } else {
      this.#callbacks.onHover(null);
    }
    return true;
  }

  readonly #onPointerMove = (event: PointerEvent) => {
    this.#pointerInside = true;
    // Only a real move re-runs the hit test: a note gliding under a still pointer never hovers.
    if (!this.#pointerTracker.moved(event.clientX, event.clientY)) return;
    this.#local(event);
    if (this.#press !== null || this.#hoverQueued) return;
    this.#hoverQueued = true;
    this.#scheduler.beforeFrame(() => {
      this.#hoverQueued = false;
      if (!this.#pointerInside || this.#press !== null) return false;
      const { node, edge } = this.#pickAt(this.#pointer.x, this.#pointer.y);
      return this.#setHover(node, edge);
    });
  };

  readonly #onPointerLeave = () => {
    this.#pointerInside = false;
    this.#pointerTracker.reset();
    if (this.#press === null) this.#setHover(-1, -1);
  };

  readonly #onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (this.#flight !== null) this.#takeCamera();
    const { x, y } = this.#local(event);
    const node = this.#pickAt(x, y).node;
    this.#press = {
      pointerId: event.pointerId,
      x,
      y,
      node,
      from: this.#camera,
      dragging: false,
      panning: false,
    };
    event.preventDefault();
  };

  readonly #onDragMove = (event: PointerEvent) => {
    const press = this.#press;
    const graph = this.#graph;
    if (press === null || graph === null || event.pointerId !== press.pointerId) return;
    const { x, y } = this.#local(event);
    const moved = Math.hypot(x - press.x, y - press.y) >= DRAG_THRESHOLD;
    if (press.node < 0) {
      // Dragging empty space pans: following stops, and hover lets go.
      if (!press.panning && !moved) return;
      if (!press.panning) {
        press.panning = true;
        this.#takeCamera();
        if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#setHover(-1, -1);
      }
      const { from } = press;
      this.#camera = {
        x: from.x - (x - press.x) / from.scale,
        y: from.y + (y - press.y) / from.scale,
        scale: from.scale,
      };
      this.#scheduler.invalidate();
      return;
    }
    if (!press.dragging && !moved) return;
    press.dragging = true;
    const [wx, wy] = flatToWorld(this.#camera, this.#width, this.#height, x, y);
    const rest = graph.state.rest;
    const index = press.node;
    const home = [
      rest[index * 3] ?? 0,
      rest[index * 3 + 1] ?? 0,
      rest[index * 3 + 2] ?? 0,
    ] as const;
    const base = this.#baseOffset(index);
    const drag = dragFrom([wx, wy, home[2] + base[2]], home, base);
    this.#dragOffsets.set(graph.slots.nodeOf(index), drag);
    graph.state.offsets.hold(index, composeOffset(base, drag));
    graph.state.writePositions();
    this.#scheduler.invalidate();
  };

  readonly #onPointerUp = (event: PointerEvent) => {
    const press = this.#press;
    if (press === null || event.pointerId !== press.pointerId) return;
    this.#press = null;
    if (press.node >= 0) {
      const note = this.#graph?.slots.nodeOf(press.node) ?? -1;
      if (!press.dragging && note >= 0) this.#callbacks.onPick(note);
      return;
    }
    if (press.panning) return;
    // The cursor's chip opens the turn's moves beside it.
    if (this.#callbacks.onCursorChip !== undefined && this.#teller.chipAt(press.x, press.y)) {
      this.#callbacks.onCursorChip();
      return;
    }
    // A region's name closes its container; anywhere else lets go of the pick.
    const region = this.#regionNameAt(press.x, press.y);
    if (region >= 0 && this.#callbacks.onRegion !== undefined) this.#callbacks.onRegion(region);
    else this.#callbacks.onBackground();
  };

  readonly #onWheel = (event: WheelEvent) => {
    if (this.#graph === null) return;
    event.preventDefault();
    this.#takeCamera();
    const { x, y } = this.#local(event);
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const { min, max } = this.#limits();
    const scale = Math.min(max, Math.max(min, this.#camera.scale * Math.exp(-pixels * WHEEL_ZOOM)));
    this.#camera = zoomFlatAt(this.#camera, this.#width, this.#height, x, y, scale);
    if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#setHover(-1, -1);
    this.#scheduler.invalidate();
  };

  #onResize(): void {
    const width = Math.max(1, this.#container.clientWidth);
    const height = Math.max(1, this.#container.clientHeight);
    const resized = width !== this.#width || height !== this.#height;
    this.#width = width;
    this.#height = height;
    this.#drawer.resize(width, height);
    if (this.#graph !== null) this.#updateClamps();
    if (resized && this.#following && this.#view !== null) this.#autoFrame(false);
    this.#scheduler.invalidate();
  }

  #render(): void {
    const graph = this.#graph;
    const view = this.#view;
    if (graph === null || view === null) return;
    const started = performance.now();
    const { state } = graph;
    this.#inViewCount = classifyInViewRect(
      state.count,
      (index, out) => state.current(index, out),
      (index) => state.drawnRadius(index) * state.styleOf(index, StyleChannel.visibility),
      (index) =>
        view.nodeVisible[index] === 1 || state.styleOf(index, StyleChannel.visibility) > 0.01,
      flatViewRect(this.#camera, this.#width, this.#height),
      this.#inView,
    );
    this.#labelCount = this.#layoutLabels(graph, view);
    this.#regionCircles = regionCircles(
      view.regions,
      state,
      REGION_PAD * this.#densitySpan,
      this.#regionCircles,
    );
    if (this.#tags.count > 0) this.#tags.place((note) => this.#screenOf(note));
    const rendered = this.#drawer.draw(
      {
        universe: graph.slots.graph,
        state,
        edgeStyle: graph.edgeStyle,
        view,
        edgeKinds: graph.kinds,
        camera: this.#camera,
        width: this.#width,
        height: this.#height,
        inView: this.#inView,
        scale: this.#scale,
        waves: graph.waves,
        pulse: this.#pulse,
        beads: this.#storyline.beads,
        beadPositions: graph.beadPositions,
        beadBright: graph.beadBright,
        labels: graph.labels,
        regionCircles: this.#regionCircles,
        ...this.#teller.frame(),
        theme: this.#theme,
        dirty: this.#dirty,
      },
      this.#gpuTimer,
    );
    this.#dirty = {
      view: false,
      kinds: false,
      edgeStyle: false,
      prominence: false,
      wave: false,
      beadsDealt: false,
      theme: false,
      scale: false,
      slots: false,
    };
    // Only a frame that rendered counts: its render call, and everything else as preparation.
    if (rendered === null) return;
    const prepMs = performance.now() - started - rendered;
    this.#frameTimer.add(rendered, prepMs);
    const listener = this.#sampleListener;
    if (listener === null) return;
    const boxes = this.#sampleBoxes;
    if (boxes !== null) {
      boxes.count = 0;
      const { labels } = graph;
      for (let at = 0; at < labels.count; at += 1) {
        const index = labels.drawn[at] ?? 0;
        const [x, y] = flatToScreen(
          this.#camera,
          this.#width,
          this.#height,
          labels.x[index] ?? 0,
          labels.y[index] ?? 0,
        );
        boxes.add(x, y, (labels.names[index] ?? "").length, labels.size[index] ?? 0);
      }
    }
    const beads = this.#storyline.beads.count;
    listener({
      time: performance.now(),
      renderMs: rendered,
      prepMs,
      drawCalls: this.#drawer.drawCalls,
      labels: graph.labels.count,
      labelsCut: graph.labels.cut,
      edges: this.#drawer.edgesDrawn,
      beads,
      beadsVisible: visibleBeads(graph.beadBright, beads),
      beadChecksum: beadChecksum(graph.beadPositions, graph.beadBright, beads),
      gpuMs: this.#gpuTimer?.poll() ?? [],
      boxes,
    });
  }

  driver(): BenchDriver {
    return {
      view: () => ({
        following: this.#following,
        hovering: this.#hoverNode >= 0 || this.#hoverEdge >= 0,
        picked: this.#focusNote,
      }),
      inView: () => {
        const graph = this.#graph;
        const notes: Array<number> = [];
        this.#inView.forEach((flag, slot) => {
          if (flag === 1 && graph !== null) notes.push(graph.slots.nodeOf(slot));
        });
        return notes;
      },
      sample: (listener, options = {}) => {
        this.#sampleListener = listener;
        this.#sampleBoxes = listener !== null && options.boxes === true ? new LabelBoxes() : null;
        this.#gpuTimer?.dispose();
        this.#gpuTimer =
          listener !== null && options.gpu === true ? GpuTimer.create(this.#drawer.gl) : null;
      },
      pan: (dx, dy) => {
        this.#takeCamera();
        if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#setHover(-1, -1);
        const { x, y, scale } = this.#camera;
        this.#camera = { x: x - dx / scale, y: y + dy / scale, scale };
        this.#scheduler.invalidate();
      },
      zoom: (x, y, factor) => {
        this.#takeCamera();
        if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#setHover(-1, -1);
        const { min, max } = this.#limits();
        const scale = Math.min(max, Math.max(min, this.#camera.scale * factor));
        this.#camera = zoomFlatAt(this.#camera, this.#width, this.#height, x, y, scale);
        this.#scheduler.invalidate();
      },
      hover: (x, y) => {
        this.#pointer = { x, y };
        if (x < 0) this.#setHover(-1, -1);
        else {
          const { node, edge } = this.#pickAt(x, y);
          this.#setHover(node, edge);
        }
      },
      screenOf: (note) => this.#screenOf(note),
      gpuTiming: canTimeGpu(this.#drawer.gl),
      memory: () => this.#drawer.memory(),
    };
  }

  /**
   * The labels of the nodes in view, by the Flat mode's rules: every label
   * reads at the flat reading's one distance, fades by the label window around
   * the reading density, and holds 11 px on screen; the story's labels read in
   * full and grow, and they and a hovered or picked note's are outlined.
   */
  #layoutLabels(graph: Graph, view: GraphView): number {
    const { state, labels } = graph;
    const span = this.#densitySpan;
    const density = densityDistance(span, this.#height, FOV);
    const distance = (density * this.#densityScale) / Math.max(this.#camera.scale, 1e-9);
    const fade = {
      near: density - FADE_NEAR * span,
      far: density + LABEL_FADE_FAR * span,
      strength: LABEL_FADE_STRENGTH * (this.#settings?.labelFade ?? 1),
    };
    const hover = this.#hoverNode;
    const picked = view.focus?.index ?? -1;
    const at = this.#at;
    const candidates = this.#candidates;
    candidates.length = 0;
    for (let index = 0; index < state.count; index += 1) {
      labels.opacity[index] = 0;
      if (this.#inView[index] !== 1) continue;
      const visibility = state.styleOf(index, StyleChannel.visibility);
      const prominence = state.prominence.values[index] ?? 0;
      const forced = index === hover || index === picked || (view.nodeGlow[index] ?? 0) > 0.5;
      const opacity = prominentOpacity(
        labelOpacity(
          distance,
          fade,
          visibility,
          state.styleOf(index, StyleChannel.emphasis),
          forced,
        ),
        visibility,
        prominence,
      );
      if (opacity < 0.03) continue;
      labels.opacity[index] = opacity;
      // Prominent, then forced, then the most opaque: what the budget keeps first.
      this.#priority[index] = opacity + (forced ? 1 : 0) + 2 * prominence;
      candidates.push(index);
    }
    // The budget follows the frame's size, and no kept label overlaps another: the story's
    // names read whole in a narrow panel, and the rest give way.
    const drawn = this.#labelDrawn;
    labels.cut = placeLabels(
      candidates,
      (index) => (this.#priority[index] ?? 0) + (drawn[index] === 1 ? LABEL_STICKY : 0),
      (index, out, side) => {
        state.current(index, at);
        const radius = state.drawnRadius(index) * state.styleOf(index, StyleChannel.visibility);
        const size = LABEL_PIXELS * labelGrowth(state.prominence.values[index] ?? 0);
        const width = [...(labels.names[index] ?? "")].length * size * 0.6;
        const [x, y] = flatToScreen(this.#camera, this.#width, this.#height, at.x, at.y);
        // The gap between the node and its label, in CSS pixels, either side.
        const gap = radius * 1.25 * this.#camera.scale + 5;
        out.left = side === "right" ? x + gap : x - gap - width;
        out.right = out.left + width;
        out.top = y - size / 2;
        out.bottom = y + size / 2;
      },
      panelLabelBudget(this.#width, this.#height),
      this.#width,
      (index, side, dy) => {
        this.#labelLeft[index] = side === "left" ? 1 : 0;
        this.#labelDy[index] = dy;
      },
      // The story's labels (the turn's worked notes), a hover's, and a pick's are never cut.
      (index) => index === hover || index === picked || (view.nodeGlow[index] ?? 0) > 0.5,
    );
    drawn.fill(0);
    for (const index of candidates) drawn[index] = 1;
    labels.count = 0;
    for (const index of candidates) {
      const visibility = state.styleOf(index, StyleChannel.visibility);
      const prominence = state.prominence.values[index] ?? 0;
      state.current(index, at);
      const radius = state.drawnRadius(index) * visibility;
      const gap = radius * 1.25 + 5 / this.#camera.scale;
      // A label that would cross the frame's right edge reads on its node's left.
      const width =
        ([...(labels.names[index] ?? "")].length * LABEL_PIXELS * labelGrowth(prominence) * 0.6) /
        this.#camera.scale;
      labels.x[index] = this.#labelLeft[index] === 1 ? at.x - gap - width : at.x + gap;
      // A forced label stacked out of another's way: screen pixels down are world units down.
      labels.y[index] = at.y - (this.#labelDy[index] ?? 0) / this.#camera.scale;
      labels.size[index] = LABEL_PIXELS * labelGrowth(prominence);
      labels.outline[index] = index === hover || index === picked ? 1 : prominence;
      labels.drawn[labels.count] = index;
      labels.count += 1;
    }
    // Labels the budget cut draw nothing: only the kept keep their opacity.
    if (labels.cut > 0) {
      for (const index of candidates) this.#priority[index] = -1;
      for (let index = 0; index < state.count; index += 1) {
        if ((labels.opacity[index] ?? 0) > 0 && this.#priority[index] !== -1)
          labels.opacity[index] = 0;
      }
    }
    return labels.count;
  }
}

/** The label layout over the working set's slots: names are the slots' own, read afresh each frame. */
function labelLayout(slots: WorkingSet): LabelLayout {
  const capacity = slots.capacity;
  return {
    names: slots.names,
    drawn: new Int32Array(LABEL_BUDGET),
    count: 0,
    cut: 0,
    opacity: new Float32Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    size: new Float32Array(capacity),
    outline: new Float32Array(capacity),
  };
}

/**
 * Where the `taken`-th arrival to a group settles: on a ring `spacing` past
 * the group's reach, fanning out from the direction pointing away from the
 * whole cluster's centre, one spacing apart, a ring further once a half circle
 * is full. A group of none sits at the cluster's centre.
 */
export function edgePlace(
  group: ReadonlyArray<readonly [number, number, number]>,
  cluster: ReadonlyArray<readonly [number, number, number]>,
  spacing: number,
  taken: number,
): readonly [number, number, number] {
  const centre = (
    points: ReadonlyArray<readonly [number, number, number]>,
  ): readonly [number, number, number] => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const point of points) {
      x += point[0];
      y += point[1];
      z += point[2];
    }
    const count = Math.max(1, points.length);
    return [x / count, y / count, z / count];
  };
  const middle = centre(group);
  if (group.length === 0) return middle;
  const whole = centre(cluster);
  let reach = 0;
  for (const point of group) {
    reach = Math.max(reach, Math.hypot(point[0] - middle[0], point[1] - middle[1]));
  }
  const away = Math.hypot(middle[0] - whole[0], middle[1] - whole[1]);
  const base = away > 1e-6 ? Math.atan2(middle[1] - whole[1], middle[0] - whole[0]) : 0;
  let radius = reach + spacing;
  let left = taken;
  for (;;) {
    const perSide = Math.floor(Math.PI / 2 / (spacing / radius));
    const places = 1 + 2 * perSide;
    if (left < places) break;
    left -= places;
    radius += spacing;
  }
  const side = left === 0 ? 0 : (left % 2 === 1 ? 1 : -1) * Math.ceil(left / 2);
  const angle = base + (side * spacing) / radius;
  return [middle[0] + Math.cos(angle) * radius, middle[1] + Math.sin(angle) * radius, middle[2]];
}

/**
 * A per-slot snapshot (x, y, z per slot) carried through a view's slot change:
 * each kept note's values move with it to its new slot, and a slot with no
 * note carried (or one that took a new note) holds NaN, which a glide reads
 * as "start where it is".
 */
export function carrySnapshot(
  snapshot: Float32Array,
  change: Pick<SlotChange, "resized" | "arrived">,
  capacity: number,
): Float32Array {
  const carried = new Float32Array(capacity * 3).fill(Number.NaN);
  for (let slot = 0; slot < capacity; slot += 1) {
    const source = change.resized === null ? slot : (change.resized.nodes[slot] ?? -1);
    if (source < 0 || source * 3 + 2 >= snapshot.length) continue;
    carried[slot * 3] = snapshot[source * 3] ?? Number.NaN;
    carried[slot * 3 + 1] = snapshot[source * 3 + 1] ?? Number.NaN;
    carried[slot * 3 + 2] = snapshot[source * 3 + 2] ?? Number.NaN;
  }
  for (const slot of change.arrived) carried.fill(Number.NaN, slot * 3, slot * 3 + 3);
  return carried;
}
