/**
 * The Atlas Graph's renderer: one WebGLRenderer, one scene, two cameras (the
 * spatial reading's perspective camera and the flat reading's orthographic
 * one), and an on-demand loop. It draws nothing unless something moved: a
 * view change, a hover, a camera flight, orbit damping, or a drag.
 *
 * The host hands it a universe and a layout once, then views (what is shown
 * and how prominently) and settings as they change. It reports hovers, picks,
 * background clicks, and whether it is following the agent, all by universe
 * index. Inside, everything is drawn from slots sized to what shows (see
 * `WorkingSet`): no buffer, and no loop per frame, is the size of the memory.
 */
import { TagLayer, type GraphTag } from "./tags.ts";
import {
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { layoutUnit, shownRadius, type GraphLayout } from "../layout/forceLayout.ts";
import { gatheringOffset, type Gathering } from "../layout/gathering.ts";
import { composeOffset, dragFrom, type Offset } from "../layout/offsets.ts";
import { nodeTraits, WAVE_SECONDS } from "../layout/motion.ts";
import type { PlayFocus } from "../model/plays.ts";
import type { GraphSettings } from "../model/settings.ts";
import type { Universe } from "../model/universe.ts";
import { EdgeKind, type GraphView, type ReadingView } from "../model/view.ts";
import {
  clampView,
  densityDistance,
  densityView,
  densityZoom,
  fitDistance,
  fitZoom,
  FLIGHT_MS,
  followFlatView,
  followView,
  orthoScale,
  orthoZoomFor,
  READING_PIXELS,
  readingFrame,
  storyCentre,
  viewAt,
  zoomLimits,
  type CameraView,
  type ReadingFrame,
} from "./camera.ts";
import { advanceBeads, placeBeads } from "./beads.ts";
import { classifyInView } from "./inView.ts";
import { EdgeStyle } from "./edgeStyle.ts";
import { LABEL_FADE_STRENGTH } from "./labelFade.ts";
import { Labels } from "./labels.ts";
import {
  createBeadMesh,
  createEdgeMesh,
  createNodeMesh,
  packEdges,
  type BeadMesh,
  type EdgeMesh,
  type NodeMesh,
} from "./meshes.ts";
import { NodeState, StyleChannel } from "./nodeState.ts";
import { RegionNames } from "./regionNames.ts";
import {
  createRegionMesh,
  REGION_PAD,
  regionCircles,
  setRegionTheme,
  updateRegionMesh,
} from "./regions.ts";
import {
  distanceToSegment,
  pickNearestIn,
  PointerTracker,
  projectInto,
  projectNode,
  ScreenNodes,
} from "./picking.ts";
import {
  FrameTimer,
  releaseRenderer,
  runBench,
  type BenchResult,
  type FlatView,
  type GraphRenderer,
  type RendererCallbacks,
  type RendererOptions,
  type RendererStats,
  type ViewContext,
  type WorkCounter,
} from "./renderer.ts";
import { browserClock, FrameScheduler, type Animation } from "./scheduler.ts";
import { LabelBoxes } from "./pool.ts";
import {
  beadChecksum,
  canTimeGpu,
  GpuTimer,
  timeRender,
  visibleBeads,
  webgl2,
  type BenchDriver,
  type FrameSample,
} from "./probe.ts";
import { edgeWidthScale } from "./shaders.ts";
import type { TourVisit } from "../model/tour.ts";
import { Storyline } from "./storyline.ts";
import { StoryOverlay } from "./storyOverlay.ts";
import { Storyteller } from "./storyteller.ts";
import { CameraReach, reachShift } from "./reach.ts";
import { applyTargets, edgeKinds } from "./targets.ts";
import { readTheme, type GraphTheme } from "./theme.ts";
import { WorkingSet, type SlotChange } from "./workingSet.ts";

export type {
  HoverTarget,
  RendererCallbacks,
  RendererOptions,
  RendererStats,
  ViewContext,
} from "./renderer.ts";

/** Everything drawn, per slot: rebuilt at a new size when the working set outgrows it. */
interface Graph {
  readonly slots: WorkingSet;
  state: NodeState;
  nodes: NodeMesh;
  edges: EdgeMesh;
  readonly beads: BeadMesh;
  edgeStyle: EdgeStyle;
  labels: Labels;
}

interface Press {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly node: number;
  dragging: boolean;
}

const FOV = 40;
/**
 * Depth windows around the camera's distance to its target, in spacings (the
 * reading density's measure). Nodes and edges fade from one spacing in front
 * to four behind, where they are cut; labels, the legibility cost, fade to two
 * behind and are off past that.
 */
const FADE_NEAR = 1;
const FADE_FAR = 4;
const LABEL_FADE_FAR = 2;
const NODE_FADE = 0.82;
const EDGE_FADE = 0.98;
const FOCAL_TINT = 0.22;
const DRAG_THRESHOLD = 4;
const EDGE_HOVER_PIXELS = 5;
/**
 * A hovered note's links at the reading density, in CSS pixels at line
 * thickness 1: hairlines. The story's links read 4/3 of it (see `edgeWidthScale`).
 */
const LIT_EDGE_PIXELS = 1.5;
/** Pixels per unit of bead size at line thickness 1: a bead is 3.8–6 px across at the reading density. */
export const BEAD_PIXELS = 1.6;

export class AtlasRenderer implements GraphRenderer {
  readonly #container: HTMLElement;
  readonly #tags: TagLayer;
  readonly #callbacks: RendererCallbacks;
  readonly #renderer: WebGLRenderer;
  readonly #scene = new Scene();
  /** The open containers' discs, drawn in a pass before the scene so no note is ever under one. */
  readonly #regionScene = new Scene();
  /** The open containers' discs and names, behind everything; shared by every universe. */
  readonly #regions = createRegionMesh();
  readonly #regionNames = new RegionNames(() => this.#scheduler.invalidate());
  #regionCircles: Float32Array = new Float32Array(0);
  readonly #perspective = new PerspectiveCamera(FOV, 1, 0.5, 20000);
  readonly #orthographic = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20000);
  readonly #orbit: OrbitControls;
  readonly #pan: OrbitControls;
  readonly #scheduler: FrameScheduler;
  readonly #resize: ResizeObserver;
  readonly #pointer = new Vector2();
  #graph: Graph | null = null;
  #view: GraphView | null = null;
  #layout: GraphLayout | null = null;
  #flat = false;
  #settings: GraphSettings | null = null;
  #hoverNode = -1;
  #hoverEdge = -1;
  #hoverQueued = false;
  #pointerInside = false;
  readonly #pointerTracker = new PointerTracker();
  #press: Press | null = null;
  #interacting = false;
  #following = true;
  /** The notes (universe indices) following frames when there is no reading. */
  #risenNotes: ReadonlyArray<number> = [];
  /** The picked note (universe index) of the last view, or -1. */
  #focusNote = -1;
  /** The selected play, by universe index; the storyline holds it in slots. */
  #playNote: PlayFocus | null = null;
  readonly #counter: WorkCounter | undefined;
  #flight: { from: CameraView; to: CameraView; start: number | null } | null = null;
  /** Each dragged note's drag, by universe index. */
  #dragOffsets = new Map<number, [number, number, number]>();
  #unit = 1;
  #gathering: Gathering | null = null;
  /** Where the gathered reading settles and how densely: the camera's frame for it. */
  #readingFrame: ReadingFrame | null = null;
  /** The landing turn's story, the selected play, and the beads on the lit links. */
  readonly #storyline = new Storyline(() => this.#storyChanged());
  /** The story's marks and the agent's cursor, drawn over the scene in screen space. */
  readonly #overlay = new StoryOverlay(() => this.#scheduler.invalidate());
  #theme: GraphTheme | null = null;
  /** Where the survey's camera stood before each container the tour has open. */
  readonly #surveyViews: Array<CameraView> = [];
  /** The agent's cursor telling the landing turn (shared with the flat controller). */
  readonly #teller = new Storyteller({
    size: () => ({ width: this.#width, height: this.#height }),
    noteOnScreen: (note) => this.#noteOnScreen(note, false),
    noteOnPlane: (note) => this.#noteOnScreen(note, true),
    toPlane: (x, y) => this.#overlay.toPlane(x, y),
    storyLit: () => this.#storyline.lit(),
    holdStory: () => this.#storyline.hold(),
    relight: () => this.#relight(),
    tourCamera: (open) => this.#tourCamera(open),
    onCursor: (play) => this.#callbacks.onCursor?.(play),
    onDrill: (inner, open) => this.#callbacks.onCursorDrill?.(inner, open),
    onCursorAt: (at) => this.#callbacks.onCursorAt?.(at),
    tourEnded: () => {
      // The tour closed what it opened: the camera fits the survey it returned to.
      this.#surveyViews.length = 0;
      if (this.#following) this.#fitFrame(true);
    },
    animate: () => this.#scheduler.animate(this.#telling),
    invalidate: () => this.#scheduler.invalidate(),
  });
  readonly #telling: Animation = {
    step: () => this.#teller.tell(performance.now() / 1000),
  };
  /** The hover's reach toward its links' far ends, and where the camera stood before it reached. */
  readonly #reach = new CameraReach(
    (notes) => this.#reachToward(notes),
    () => this.#reachBack(),
  );
  #reachOrigin: CameraView | null = null;
  readonly #frameTimer = new FrameTimer();
  #drawCalls = 0;
  #edgesDrawn = 0;
  /** A bench listening to every rendered frame, the label boxes it asked for, and its GPU timer. */
  #sampleListener: ((sample: FrameSample) => void) | null = null;
  #sampleBoxes: LabelBoxes | null = null;
  #gpuTimer: GpuTimer | null = null;
  /** Reused by picking: every node's place on screen, and a scratch point. */
  #screen = new ScreenNodes(0);
  readonly #projected = new Vector3();
  /** A layout switch waiting for its view: where nodes were drawn, and whether to reframe. */
  #pendingLayout: { readonly from: Float32Array; readonly frame: boolean } | null = null;
  #reading = false;
  #inView = new Uint8Array(0);
  #inViewCount = 0;
  #labelCount = 0;
  #turnRunning = false;
  /** When the current landing wave started, in seconds, or null when still. */
  #waveStart: number | null = null;
  #labelFont: string | undefined = undefined;
  #themeKey: string | undefined = undefined;
  #width = 1;
  #height = 1;

  readonly #springs: Animation = {
    step: (dt, now) => {
      const graph = this.#graph;
      if (graph === null) return false;
      const prominent = !graph.state.prominence.settled;
      const nodesMoving = graph.state.step(dt, now / 1000);
      if (prominent) graph.nodes.prominence.needsUpdate = true;
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
        graph.edges.uniforms.uPulse.value = pulse;
        return true;
      }
      // Rung down: the edges lie straight again and the wave costs nothing.
      this.#waveStart = null;
      graph.edges.uniforms.uPulse.value = 1000;
      graph.edges.source.waves.fill(0);
      return false;
    },
  };

  /** Beads run while the story is lit; with none left, the loop can sleep. */
  readonly #beading: Animation = {
    step: (dt) => {
      const graph = this.#graph;
      if (graph === null || this.#storyline.beads.count === 0) return false;
      advanceBeads(this.#storyline.beads, dt);
      this.#placeBeads(graph);
      return true;
    },
  };

  readonly #controlsDamping: Animation = {
    step: () => this.#controls.update(),
  };

  readonly #flying: Animation = {
    step: (_dt, now) => {
      const flight = this.#flight;
      if (flight === null) return false;
      if (flight.start === null) flight.start = now;
      const t = (now - flight.start) / FLIGHT_MS;
      this.#applyView(viewAt(flight.from, flight.to, t));
      if (t >= 1) this.#flight = null;
      return t < 1;
    },
  };

  constructor(container: HTMLElement, callbacks: RendererCallbacks, options: RendererOptions = {}) {
    this.#container = container;
    this.#callbacks = callbacks;
    this.#tags = new TagLayer(container, (index) => this.#callbacks.onTag?.(index));
    this.#counter = options.counter;
    this.#renderer = new WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    const canvas = this.#renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    container.append(canvas);
    this.#regionScene.add(this.#regions.mesh);
    this.#scene.add(this.#regionNames.group);

    this.#scheduler = new FrameScheduler(options.clock ?? browserClock, () => this.#render());

    this.#orbit = new OrbitControls(this.#perspective, canvas);
    this.#orbit.enableDamping = true;
    this.#orbit.dampingFactor = 0.12;
    this.#orbit.zoomToCursor = true;
    this.#orbit.enablePan = true;
    this.#pan = new OrbitControls(this.#orthographic, canvas);
    this.#pan.enableRotate = false;
    this.#pan.enableDamping = true;
    this.#pan.dampingFactor = 0.12;
    this.#pan.zoomToCursor = true;
    this.#pan.screenSpacePanning = true;
    this.#pan.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    this.#pan.enabled = false;
    for (const controls of [this.#orbit, this.#pan]) {
      controls.addEventListener("start", this.#onControlsStart);
      controls.addEventListener("end", this.#onControlsEnd);
      controls.addEventListener("change", this.#onControlsChange);
    }

    container.addEventListener("pointerdown", this.#onPointerDown, { capture: true });
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerleave", this.#onPointerLeave);
    globalThis.addEventListener("pointermove", this.#onDragMove);
    globalThis.addEventListener("pointerup", this.#onPointerUp);

    this.#resize = new ResizeObserver(() => this.#onResize());
    this.#resize.observe(container);
    this.#onResize();
    this.refreshTheme();
  }

  get following(): boolean {
    return this.#following;
  }

  get #camera(): Camera {
    return this.#flat ? this.#orthographic : this.#perspective;
  }

  get #controls(): OrbitControls {
    return this.#flat ? this.#pan : this.#orbit;
  }

  stats(now: number): RendererStats {
    return {
      mode: this.#flat ? "flat" : "3d",
      drawCalls: this.#drawCalls,
      renderMs: this.#frameTimer.render,
      prepMs: this.#frameTimer.prep,
      framesLastSecond: this.#scheduler.framesInLastSecond(now),
      totalFrames: this.#scheduler.totalFrames,
      animating: this.#scheduler.animating,
      inView: this.#inViewCount,
      slots: this.#graph?.slots.capacity ?? 0,
      shown: this.#view?.shownNodes ?? 0,
      labels: this.#labelCount,
      radiusPx: this.#radiusPixels(),
      edgePx: this.#edgePixels(),
      beads: this.#storyline.beads.count,
    };
  }

  /** CSS pixels per world unit at the camera's target. */
  #pixelsPerUnit(): number {
    if (this.#flat) {
      const frustum = this.#orthographic.top - this.#orthographic.bottom;
      return (this.#orthographic.zoom * this.#height) / frustum;
    }
    const distance = this.#perspective.position.distanceTo(this.#orbit.target);
    return this.#height / (2 * Math.max(distance, 1e-6) * Math.tan((FOV * Math.PI) / 360));
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
    const scale = this.#pixelsPerUnit();
    return smallest === Infinity
      ? [0, 0, 0]
      : [smallest * scale, largest * scale, prominent * scale];
  }

  #edgePixels(): readonly [number, number] {
    const width = (this.#graph?.edges.uniforms.uLineWidth.value ?? 0) * this.#pixelsPerUnit();
    return [width * edgeWidthScale(0.6), width * edgeWidthScale(1)];
  }

  /** A new universe: start an empty working set; the first view seats what shows and frames it. */
  setGraph(universe: Universe, layout: GraphLayout, flat: boolean): void {
    this.#disposeGraph();
    const slots = new WorkingSet(universe);
    const state = new NodeState(slots.capacity);
    const edgeStyle = new EdgeStyle(slots.edgeCapacity);
    const beads = createBeadMesh();
    beads.points.renderOrder = 2;
    this.#graph = { slots, state, edgeStyle, beads, ...this.#buildMeshes(slots, state) };
    this.#scene.add(beads.points);
    this.#counter?.count("allocate", slots.capacity + slots.edgeCapacity);
    this.#inView = new Uint8Array(slots.capacity);
    this.#screen = new ScreenNodes(slots.capacity);
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
    this.#layout = layout;
    this.#unit = layoutUnit(layout);
    this.#setFlat(flat);
    state.setScale(this.#unit, flat);
    this.#pendingLayout = null;
    this.refreshTheme();
    this.#applyScale();
  }

  /** The node and edge meshes and the labels over `state`'s slots, added to the scene. */
  #buildMeshes(slots: WorkingSet, state: NodeState): Pick<Graph, "nodes" | "edges" | "labels"> {
    const nodes = createNodeMesh(state);
    const edges = createEdgeMesh(state, slots.graph);
    nodes.mesh.renderOrder = 0;
    edges.mesh.renderOrder = 1;
    const labels = this.#createLabels(slots);
    this.#scene.add(edges.mesh, nodes.mesh, labels.group);
    return { nodes, edges, labels };
  }

  /**
   * The working set outgrew (or shrank well below) its slots: rebuild every
   * buffer at the new size, each note carrying its state to its new slot, so
   * nothing moves on screen.
   */
  #resizeGraph(graph: Graph, resized: NonNullable<SlotChange["resized"]>): void {
    const capacity = resized.nodes.length;
    const edgeCapacity = resized.edges.length;
    const state = NodeState.carried(graph.state, capacity, resized.nodes);
    const edgeStyle = new EdgeStyle(edgeCapacity);
    edgeStyle.carry(graph.edgeStyle, resized.edges);
    this.#disposeMeshes(graph);
    graph.state.dispose();
    graph.state = state;
    graph.edgeStyle = edgeStyle;
    Object.assign(graph, this.#buildMeshes(graph.slots, state));
    this.#counter?.count("allocate", capacity + edgeCapacity);
    this.#inView = new Uint8Array(capacity);
    this.#screen = new ScreenNodes(capacity);
    // A wave's edges were renumbered: let it go rather than ring the wrong links.
    this.#waveStart = null;
    this.refreshTheme();
    this.#applyScale();
  }

  /** Seat what arrived: each new note at its home, at rest, invisible (it rises); each new edge dark. */
  #seat(graph: Graph, change: SlotChange): void {
    const { slots, state, edges, edgeStyle } = graph;
    const homes = this.#layout?.positions;
    const view = slots.view;
    for (const slot of change.arrived) {
      const note = slots.nodeOf(slot);
      const home = [homes?.[note * 3] ?? 0, homes?.[note * 3 + 1] ?? 0, homes?.[note * 3 + 2] ?? 0];
      state.assign(slot, home, nodeTraits(note), this.#radiusFor(view.nodeDegree[slot] ?? 0));
    }
    if (change.resized === null) for (const slot of change.releasedEdges) edgeStyle.clear(slot);
    for (const slot of change.arrivedEdges) {
      const edge = slots.graph.edges[slot];
      edges.source.ends[slot * 2] = edge?.a ?? 0;
      edges.source.ends[slot * 2 + 1] = edge?.b ?? 0;
      edges.source.waves[slot] = 0;
      edgeStyle.clear(slot);
    }
    if (change.arrived.length > 0) {
      state.writePositions();
      state.styleTexture.needsUpdate = true;
      graph.nodes.prominence.needsUpdate = true;
    }
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

  /**
   * The same universe laid out anew, or seen flat. The switch completes with
   * the next `setView` for this layout, which brings its gathering: then every
   * node glides to its new place and, when the view went flat or back, the
   * camera frames the new cluster.
   */
  setLayout(layout: GraphLayout, flat: boolean): void {
    const graph = this.#graph;
    if (graph === null) return;
    const switching = flat !== this.#flat;
    const from = this.#pendingLayout?.from ?? graph.state.snapshot();
    this.#layout = layout;
    this.#unit = layoutUnit(layout);
    this.#applyScale();
    this.#dragOffsets.clear();
    if (switching) this.#setFlat(flat);
    else this.#updateProjection();
    graph.state.setScale(this.#unit, flat);
    this.#writeHomes(graph, layout);
    this.#pendingLayout = { from, frame: switching || this.#pendingLayout?.frame === true };
  }

  /**
   * What is shown, how prominently, and where the reading gathers it; every
   * change eases in, each note on its own spring.
   */
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
    this.#hoverNode = hoverNote >= 0 ? slots.slotOf(hoverNote) : -1;
    this.#hoverEdge = hoverEdge >= 0 ? slots.edgeSlotOf(hoverEdge) : -1;
    const view = slots.view;
    this.#view = view;
    // The reading's density first: what arrives is sized against it.
    if (context.gathering !== this.#gathering || first) {
      this.#gathering = context.gathering;
      this.#readingFrame = this.#measureReading();
      this.#applyScale();
      // The density and the reading's reach moved: so do the zoom limits.
      this.#updateClamps();
    }
    this.#seat(graph, change);
    this.#refocus();
    this.#reading = context.reading;
    const { nodes, edges } = graph;
    nodes.flags.array.set(view.nodeFlags);
    nodes.slots.array.set(view.nodeSlot);
    nodes.shapes.array.set(view.nodeShape);
    nodes.flags.needsUpdate = true;
    nodes.slots.needsUpdate = true;
    nodes.shapes.needsUpdate = true;
    this.#writeEdgeKinds();
    edges.source.slots.set(view.edgeSlot);
    edges.source.directions.set(view.edgeDirection);
    if (this.#hoverNode >= 0 && view.nodeVisible[this.#hoverNode] !== 1) this.#setHover(-1, -1);
    this.#applyTargets();
    const pending = this.#pendingLayout;
    if (pending !== null && context.layout === this.#layout && !first) {
      // The layout switch lands now that its gathering is here.
      this.#pendingLayout = null;
      graph.state.glideFrom(pending.from, performance.now() / 1000);
      if (pending.frame) this.#fitFrame(false);
      else this.#updateClamps();
    }
    if (first || instant) {
      this.#focusNote = shown.focus?.index ?? -1;
      graph.state.settle();
      graph.edgeStyle.settle();
      graph.nodes.prominence.needsUpdate = true;
      // The graph opens on the whole gathered reading at its density, never fitted to the whole memory.
      if (first) this.#autoFrame(false);
      this.#scheduler.invalidate();
      return;
    }
    // Notes entering the view rise together; notes leaving it stop rising.
    for (const slot of change.left) graph.state.cancelRise(slot);
    if (change.rose.length > 0) graph.state.rise(change.rose, performance.now() / 1000);
    this.#dealBeads();
    // A newly picked note sends a wave down its links, and the camera turns
    // toward where it lands. The person asked, so it runs even when not following.
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

  /**
   * The checkpoint's turn has landed: its story lights (its new and broken
   * links) and its new links ring with a damped wave. The story holds while the turn runs and
   * through the landing window, then goes dark. Called once per checkpoint
   * the host steps to, alongside `follow`.
   */
  landLinks(): void {
    const view = this.#view;
    if (view === null) return;
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

  /** A turn runs or ends: the story holds while it runs and falls after its landing window. */
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

  /**
   * A play is selected (or cleared): while selected it is the story, its notes
   * in front and its link alone in full, and it holds until cleared. Then the
   * turn's story takes up its own timing where it stands, which is usually dark.
   * When following, the camera turns just enough to bring the play's notes forward.
   */
  setPlay(play: PlayFocus | null): void {
    this.#playNote = play;
    const graph = this.#graph;
    if (graph === null) return;
    if (!this.#refocus()) return;
    const slotted = this.#storyline.play;
    if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#setHover(-1, -1);
    // The play's edge is drawn by the play; clearing it restores the checkpoint's.
    this.#writeEdgeKinds();
    this.#storyChanged();
    if (slotted === null || !this.#following) return;
    // Notes already in view need no turn.
    const outOfView = slotted.nodes.filter((node) => this.#inView[node] !== 1);
    if (outOfView.length > 0) this.#turnToward(slotted.nodes);
  }

  /** The story lit or went dark: retarget the edges and the story's notes, deal the beads, and wake when it should fall. */
  #storyChanged(): void {
    // A story falling or landing changes what the tour leaves lit.
    if (this.#playNote === null && this.#refocus()) this.#writeEdgeKinds();
    this.#applyTargets();
    this.#scheduler.animate(this.#springs);
    this.#dealBeads();
    // A timer, not frames: holding the story costs nothing while nothing moves.
    this.#storyline.schedule();
  }

  /**
   * Beads run on the turn's new links while the story is lit. They are dealt
   * afresh only when the lanes change; with none, the pool empties and the
   * bead animation stops asking for frames.
   */
  #dealBeads(): void {
    const graph = this.#graph;
    if (graph === null || !this.#storyline.deal(this.#view)) return;
    const beads = this.#storyline.beads;
    graph.beads.sizes.array.set(beads.size);
    graph.beads.sizes.needsUpdate = true;
    this.#placeBeads(graph);
    if (beads.count > 0) this.#scheduler.animate(this.#beading);
    else this.#scheduler.invalidate();
  }

  /** Write each bead where it runs now: along its link between the nodes' rims, as the ribbon draws it. */
  #placeBeads(graph: Graph): void {
    const beads = this.#storyline.beads;
    const { positions, bright } = graph.beads;
    placeBeads(
      beads,
      graph.slots.graph.edges,
      graph.state,
      graph.edgeStyle,
      positions.array,
      bright.array,
    );
    graph.beads.points.geometry.setDrawRange(0, beads.count);
    positions.needsUpdate = true;
    bright.needsUpdate = true;
  }

  /** Send a landing wave along `edges`, travelling out from `from` (or from each edge's first end). */
  #startWave(edges: ReadonlyArray<number>, from: number): void {
    const graph = this.#graph;
    if (graph === null || edges.length === 0) return;
    const waves = graph.edges.source.waves;
    waves.fill(0);
    for (const index of edges) {
      const edge = graph.slots.graph.edges[index];
      if (edge !== undefined) waves[index] = from === edge.b ? 2 : 1;
    }
    graph.edges.uniforms.uPulse.value = 0;
    this.#waveStart = performance.now() / 1000;
    this.#scheduler.animate(this.#waving);
  }

  setSettings(settings: GraphSettings): void {
    this.#settings = settings;
    this.#applyScale();
    // Node size and link distance change the drawn radii, which ease to their new size.
    this.#applyTargets();
    this.#scheduler.animate(this.#springs);
  }

  /** The drawn radius of a node of this degree under the current settings and layout. */
  /** The drawn radius of a note of this degree: a share of the reading density's spacing, so the same on screen in every memory. */
  #radiusFor(degree: number): number {
    if (this.#layout === null) return 0;
    return shownRadius(degree, this.#settings?.nodeSize ?? 1, this.#densitySpan);
  }

  #applyScale(): void {
    const graph = this.#graph;
    if (graph === null) return;
    const thickness = this.#settings?.lineThickness ?? 1;
    graph.nodes.uniforms.uUnit.value = this.#unit;
    // Hairlines at the reading density: the base width spans LIT_EDGE_PIXELS where a spacing spans READING_PIXELS.
    graph.edges.uniforms.uLineWidth.value =
      (LIT_EDGE_PIXELS * thickness * this.#densitySpan) / READING_PIXELS;
    graph.edges.uniforms.uArrows.value = this.#settings?.arrows === true ? 1 : 0;
    graph.edges.uniforms.uArrowSize.value = (1.6 + 0.6 * thickness) * this.#unit;
    graph.edges.uniforms.uDash.value = 1.6 * this.#unit;
    graph.beads.uniforms.uSizeScale.value = BEAD_PIXELS * thickness;
  }

  /** A font file (woff, ttf, or otf) for the labels; undefined uses troika's default. */
  setLabelFont(font: string | undefined): void {
    if (font === this.#labelFont) return;
    this.#labelFont = font;
    this.#overlay.setFont(font);
    const graph = this.#graph;
    if (graph === null) return;
    this.#scene.remove(graph.labels.group);
    graph.labels.dispose();
    graph.labels = this.#createLabels(graph.slots);
    this.#scene.add(graph.labels.group);
    const theme = readTheme(this.#container);
    graph.labels.setColor(theme.ink);
    graph.labels.setOutlineColor(theme.paper);
    this.#scheduler.invalidate();
  }

  /** The host's theme changed: re-read the colors when the key moves. */
  setThemeKey(key: string | undefined): void {
    if (key === this.#themeKey) return;
    this.#themeKey = key;
    this.refreshTheme();
  }

  /** Read the colors from the container's CSS custom properties. */
  refreshTheme(): void {
    const theme = readTheme(this.#container);
    this.#theme = theme;
    this.#renderer.setClearColor(theme.paper, 1);
    const graph = this.#graph;
    if (graph !== null) {
      for (const uniforms of [graph.nodes.uniforms, graph.edges.uniforms]) {
        uniforms.uPaper.value.copy(theme.paper);
        uniforms.uInk.value.copy(theme.ink);
        uniforms.uAccent.value.copy(theme.accent);
        uniforms.uWarning.value.copy(theme.warning);
        uniforms.uLens.value.forEach((color, slot) => {
          const tint = theme.lenses[slot];
          if (tint !== undefined) color.copy(tint);
        });
      }
      graph.beads.uniforms.uAccent.value.copy(theme.accent);
      graph.labels.setColor(theme.ink);
      graph.labels.setOutlineColor(theme.paper);
    }
    setRegionTheme(this.#regions, theme);
    this.#regionNames.setColor(theme.ink);
    this.#scheduler.invalidate();
  }

  /**
   * Follow the reading, if following: frame the whole gathered reading where
   * it settles, at the reading density, so the risen notes are in view and the
   * camera never ends up inside the cluster. Without a reading, frame the
   * checkpoint's risen notes. The indices are remembered so resuming can frame them too.
   */
  setMoves(
    visits: ReadonlyArray<TourVisit>,
    appended: ReadonlyArray<TourVisit> | null = null,
  ): void {
    if (!this.#teller.setMoves(visits, appended)) return;
    if (appended === null) this.#surveyViews.length = 0;
    if (this.#refocus()) this.#writeEdgeKinds();
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

  /** Light the story by the selected play, else by the tour; returns whether anything changed. */
  #refocus(): boolean {
    const graph = this.#graph;
    if (graph === null) return false;
    return this.#storyline.setPlay(graph.slots.playInSlots(this.#playNote ?? this.#teller.focus()));
  }

  /** What the tour has told changed: light anew, unless a chosen play holds the story. */
  #relight(): void {
    if (this.#playNote !== null || !this.#refocus()) return;
    this.#writeEdgeKinds();
    this.#applyTargets();
    this.#scheduler.animate(this.#springs);
    this.#dealBeads();
  }

  /**
   * The survey's camera across a tour's openings: opening a container keeps
   * where the camera stood (where its flight was going), and closing it flies
   * back there, so successive opens never drift the survey. A reader who took
   * the camera keeps it: nothing flies back.
   */
  #tourCamera(open: boolean): void {
    if (open) {
      this.#surveyViews.push(this.#flight?.to ?? this.#currentView());
      return;
    }
    const back = this.#surveyViews.pop();
    if (back === undefined || !this.#following) return;
    this.#startFlight(back);
  }

  /**
   * A shown note (universe index) on screen: its projected centre and drawn
   * radius in CSS pixels, y down; on the overlay's plane (y up) for its marks.
   */
  #noteOnScreen(
    note: number,
    onPlane: boolean,
  ): { readonly x: number; readonly y: number; readonly r: number } | null {
    const graph = this.#graph;
    const slot = graph?.slots.slotOf(note) ?? -1;
    if (graph === null || slot < 0) return null;
    const visibility = graph.state.styleOf(slot, StyleChannel.visibility);
    if (onPlane && visibility < 0.05) return null;
    const at = graph.state.current(slot, new Vector3());
    const radius = graph.state.drawnRadius(slot) * visibility;
    const screen = projectNode(this.#camera, at.x, at.y, at.z, radius, this.#width, this.#height);
    if (screen === null) return null;
    return { x: screen.x, y: onPlane ? this.#height - screen.y : screen.y, r: screen.radius };
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

  /**
   * Bring these notes inside the frame's edge: on the flat camera the least
   * pan; in 3D the least turn, as a play's notes are brought forward. Whether
   * the camera moved.
   */
  #reachToward(notes: ReadonlyArray<number>): boolean {
    if (this.#graph === null) return false;
    const current = this.#flight?.to ?? this.#currentView();
    const points = notes.map((note) => this.#landing(note, new Vector3()));
    let next: CameraView | null;
    if (this.#flat) {
      const zoom = Math.max(current.zoom, 1e-6);
      const shift = reachShift(
        {
          x: current.target.x,
          y: current.target.y,
          halfWidth: this.#orthographic.right / zoom,
          halfHeight: this.#orthographic.top / zoom,
        },
        points,
      );
      next =
        shift === null
          ? null
          : {
              position: current.position.clone().add(new Vector3(shift.dx, shift.dy, 0)),
              target: current.target.clone().add(new Vector3(shift.dx, shift.dy, 0)),
              zoom: current.zoom,
            };
    } else {
      next = followView(current, points);
    }
    if (next === null) return false;
    this.#reachOrigin ??= current;
    this.#startFlight(next);
    return true;
  }

  #reachBack(): void {
    const origin = this.#reachOrigin;
    this.#reachOrigin = null;
    if (origin !== null) this.#startFlight(origin);
  }

  frame(indices: ReadonlyArray<number>): void {
    const slots = this.#graph?.slots.slotsOf(indices) ?? [];
    if (slots.length > 0) this.#frame(true, this.#landingCentroid(slots));
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

  /** Return to the reading density: on the pick, else the frame following would take. */
  fit(): void {
    this.#fitFrame(true);
  }

  flatView(): FlatView | null {
    // Before any view was shown there is no picture to hand over.
    if (!this.#flat || this.#view === null) return null;
    const target = this.#pan.target;
    const frustum = this.#orthographic.top - this.#orthographic.bottom;
    return {
      x: target.x,
      y: target.y,
      scale: orthoScale(this.#orthographic.zoom, frustum, this.#height),
    };
  }

  adoptView(view: FlatView | null, following: boolean): void {
    if (this.#flat && view !== null) {
      const frustum = this.#orthographic.top - this.#orthographic.bottom;
      const current = this.#currentView();
      this.#flight = null;
      this.#applyView({
        position: new Vector3(view.x, view.y, current.position.z),
        target: new Vector3(view.x, view.y, 0),
        zoom: orthoZoomFor(view.scale, frustum, this.#height),
      });
      this.#scheduler.invalidate();
    }
    if (!following) this.#pauseFollowing();
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
    const at = graph.state.current(index, new Vector3());
    const screen = projectNode(this.#camera, at.x, at.y, at.z, 0, this.#width, this.#height);
    return screen === null ? null : [screen.x, screen.y];
  }

  setTags(tags: ReadonlyArray<GraphTag>): void {
    if (tags.length === 0 && this.#tags.count === 0) return;
    this.#tags.set(tags);
    this.#scheduler.invalidate();
  }

  dispose(): void {
    this.#tags.dispose();
    this.#reach.dispose();
    this.#scheduler.stop(this.#telling);
    this.#overlay.dispose();
    this.#gpuTimer?.dispose();
    this.#regionScene.remove(this.#regions.mesh);
    this.#scene.remove(this.#regionNames.group);
    this.#regions.mesh.geometry.dispose();
    this.#regions.mesh.material.dispose();
    this.#regionNames.dispose();
    this.#storyline.dispose();
    this.#scheduler.dispose();
    this.#resize.disconnect();
    this.#container.removeEventListener("pointerdown", this.#onPointerDown, { capture: true });
    const canvas = this.#renderer.domElement;
    canvas.removeEventListener("pointermove", this.#onPointerMove);
    canvas.removeEventListener("pointerleave", this.#onPointerLeave);
    globalThis.removeEventListener("pointermove", this.#onDragMove);
    globalThis.removeEventListener("pointerup", this.#onPointerUp);
    this.#orbit.dispose();
    this.#pan.dispose();
    this.#disposeGraph();
    releaseRenderer(this.#renderer);
  }

  // ---------------------------------------------------------------------------
  // Targets

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
  }

  /** Each edge's kind (plain, new, broken) as the checkpoint has it, the selected play's edge by the play. */
  #writeEdgeKinds(): void {
    const graph = this.#graph;
    const view = this.#view;
    if (graph === null || view === null) return;
    edgeKinds(view, this.#storyline.play, graph.edges.source.kinds);
  }

  /** The frame for the gathered reading, measured where its notes settle, or null outside a reading. */
  #measureReading(): ReadingFrame | null {
    const gathering = this.#gathering;
    if (gathering === null) return null;
    const members = [...gathering.positions.keys()];
    const slots = this.#graph?.slots;
    return readingFrame(
      members.map((index) => gathering.positions.get(index) ?? [0, 0, 0]),
      (at) => this.#radiusFor(slots?.degreeOf(members[at] ?? -1) ?? 0),
    );
  }

  /** Where the reading's gathering puts slot `slot`'s note, relative to its home, before any drag. */
  #baseOffset(slot: number): Offset {
    const graph = this.#graph;
    const homes = this.#layout?.positions;
    if (graph === null || homes === undefined) return [0, 0, 0];
    return gatheringOffset(this.#gathering, homes, graph.slots.nodeOf(slot));
  }

  // ---------------------------------------------------------------------------
  // Camera

  #setFlat(flat: boolean): void {
    this.#flat = flat;
    this.#orbit.enabled = !flat;
    this.#pan.enabled = flat;
    this.#flight = null;
    this.#updateProjection();
  }

  #currentView(): CameraView {
    const camera = this.#camera;
    return {
      position: camera.position.clone(),
      target: this.#controls.target.clone(),
      zoom: this.#flat ? this.#orthographic.zoom : 1,
    };
  }

  #applyView(view: CameraView): void {
    const camera = this.#camera;
    camera.position.copy(view.position);
    this.#controls.target.copy(view.target);
    if (this.#flat) {
      this.#orthographic.zoom = view.zoom;
      this.#orthographic.updateProjectionMatrix();
    }
    camera.lookAt(view.target);
    this.#controls.update();
  }

  #startFlight(to: CameraView): void {
    this.#flight = { from: this.#currentView(), to, start: null };
    this.#scheduler.animate(this.#flying);
  }

  #turnToward(indices: ReadonlyArray<number>): void {
    const graph = this.#graph;
    if (graph === null || indices.length === 0) return;
    const points = indices.map((index) => this.#landing(index, new Vector3()));
    const current = this.#flight?.to ?? this.#currentView();
    const reach = (this.#orthographic.top / Math.max(this.#orthographic.zoom, 1e-6)) * 0.35;
    const next = this.#flat ? followFlatView(current, points, reach) : followView(current, points);
    if (next !== null) this.#startFlight(next);
  }

  /** Where node `index` is headed: its home plus its springs' target. */
  #landing(index: number, out: Vector3): Vector3 {
    const graph = this.#graph;
    if (graph === null) return out.set(0, 0, 0);
    const { rest, offsets } = graph.state;
    return out.set(
      (rest[index * 3] ?? 0) + (offsets.targets[index * 3] ?? 0),
      (rest[index * 3 + 1] ?? 0) + (offsets.targets[index * 3 + 1] ?? 0),
      (rest[index * 3 + 2] ?? 0) + (offsets.targets[index * 3 + 2] ?? 0),
    );
  }

  #landingCentroid(indices: ReadonlyArray<number>): Vector3 {
    const sum = new Vector3();
    const at = new Vector3();
    for (const index of indices) sum.add(this.#landing(index, at));
    return indices.length === 0 ? sum : sum.divideScalar(indices.length);
  }

  /**
   * The frame the graph takes on its own (opening, following, resuming, a
   * resize while following): the whole gathered reading at its density; outside
   * a reading, the turn's risen notes, else the shown notes' anchor.
   */
  #autoFrame(fly: boolean): void {
    const reading = this.#readingFrame;
    if (reading !== null) {
      // Always at the reading density, never zoomed out to fit: centred on the
      // turn's story, the rest of the reading reached by panning.
      this.#frame(fly, this.#storyTarget() ?? reading.target);
      return;
    }
    const risen = this.#view?.risen ?? [];
    this.#frame(fly, risen.length > 0 ? this.#landingCentroid(risen) : this.#anchor());
  }

  /** Where a landing centres: the turn's story (else its worked notes), or their densest part. */
  #storyTarget(): Vector3 | null {
    const view = this.#view;
    if (view === null) return null;
    const notes = view.story.length > 0 ? view.story : view.risen;
    const points = notes.map((index) => this.#landing(index, new Vector3()));
    return storyCentre(points, this.#frameReach());
  }

  /** Half the frame's shorter side at the reading density, in world units. */
  #frameReach(): number {
    return ((Math.min(this.#width, this.#height) / 2) * this.#densitySpan) / READING_PIXELS;
  }

  /** Fit: the pick at the reading density, else the reading's centre at it, else the frame following would take. */
  #fitFrame(fly: boolean): void {
    const focus = this.#view?.focus ?? null;
    const reading = this.#readingFrame;
    if (focus !== null) this.#frame(fly, this.#landing(focus.index, new Vector3()));
    else if (reading !== null) this.#frame(fly, reading.target);
    else this.#autoFrame(fly);
  }

  /** What to centre on without a reading or risen notes: the shown notes' centroid in a reading, else the densest hub. */
  #anchor(): Vector3 {
    const view = this.#view;
    if (view === null) return new Vector3(...(this.#layout?.center ?? [0, 0, 0]));
    const shown: Array<number> = [];
    view.nodeVisible.forEach((visible, index) => {
      if (visible === 1) shown.push(index);
    });
    if (this.#reading && shown.length > 0) return this.#landingCentroid(shown);
    // The densest hub: the most-linked shown note, so the first screen is never empty.
    let hub = -1;
    for (const index of shown) {
      if (hub < 0 || (view.nodeDegree[index] ?? 0) > (view.nodeDegree[hub] ?? 0)) hub = index;
    }
    return hub < 0
      ? new Vector3(...(this.#layout?.center ?? [0, 0, 0]))
      : this.#landing(hub, new Vector3());
  }

  /**
   * The reading density's measure in world units: how far apart the notes on
   * screen actually sit (the median nearest-neighbour distance), taken from the
   * gathered reading where it settles, else from the layout, and never less
   * than half the link distance, the collision force's own minimum spacing.
   */
  get #densitySpan(): number {
    const floor = 0.5 * (this.#settings?.linkDistance ?? 34);
    const reading = this.#readingFrame?.span ?? 0;
    return Math.max(reading > 0 ? reading : (this.#layout?.spacing ?? 0), floor);
  }

  #densityDistance(): number {
    return densityDistance(this.#densitySpan, this.#height, FOV);
  }

  #densityZoom(): number {
    const frustumHeight = this.#orthographic.top - this.#orthographic.bottom;
    return densityZoom(this.#densitySpan, this.#height, frustumHeight);
  }

  /** How far back the perspective camera must stand to hold everything within `extent` of its target. */
  #fitDistance(extent: number): number {
    return fitDistance(extent, this.#width, this.#height, FOV);
  }

  /** The orthographic zoom that holds everything within `extent` of its target. */
  #fitZoom(extent: number): number {
    const frustum = this.#orthographic;
    return fitZoom(extent, frustum.right - frustum.left, frustum.top - frustum.bottom);
  }

  /**
   * Zoom is free within a quarter to four times the reading density, extended
   * outward as far as framing the whole reading (or `extent`) needs. When the
   * limits move (a resize, a new layout or reading), a settled camera outside
   * them is brought back inside, once.
   */
  #updateClamps(extent = 0): void {
    const reach = Math.max(extent, this.#readingFrame?.extent ?? 0);
    const limits = zoomLimits({
      densityDistance: this.#densityDistance(),
      densityZoom: this.#densityZoom(),
      fitDistance: this.#fitDistance(reach),
      fitZoom: this.#fitZoom(reach),
    });
    this.#orbit.minDistance = limits.minDistance;
    this.#orbit.maxDistance = limits.maxDistance;
    this.#pan.minZoom = limits.minZoom;
    this.#pan.maxZoom = limits.maxZoom;
    if (this.#flight !== null || this.#graph === null) return;
    const clamped = clampView(this.#currentView(), limits, this.#flat);
    if (clamped === null) return;
    this.#applyView(clamped);
    this.#scheduler.invalidate();
  }

  /**
   * Frame `target` at the reading density, standing back further only as far
   * as it takes to hold everything within `extent` of it, flying there or jumping.
   */
  #frame(fly: boolean, target: Vector3, extent = 0): void {
    if (this.#graph === null || this.#layout === null) return;
    this.#updateClamps(extent);
    let to: CameraView;
    if (this.#flat) {
      const height = Math.max(this.#layout.radius, 8) * 4;
      to = {
        position: new Vector3(target.x, target.y, height),
        target: new Vector3(target.x, target.y, 0),
        zoom: Math.min(this.#densityZoom(), this.#fitZoom(extent)),
      };
    } else {
      const current = this.#flight?.to ?? this.#currentView();
      const direction = fly ? current.position.clone().sub(current.target) : new Vector3();
      const distance = Math.max(this.#densityDistance(), this.#fitDistance(extent));
      to = densityView(target, direction, distance);
    }
    if (fly) this.#startFlight(to);
    else {
      this.#flight = null;
      this.#applyView(to);
      this.#scheduler.invalidate();
    }
  }

  #updateProjection(): void {
    const aspect = this.#width / this.#height;
    this.#perspective.aspect = aspect;
    this.#perspective.updateProjectionMatrix();
    const half = Math.max(this.#layout?.radius ?? 100, 8) * 1.2;
    this.#orthographic.top = half;
    this.#orthographic.bottom = -half;
    this.#orthographic.left = -half * aspect;
    this.#orthographic.right = half * aspect;
    this.#orthographic.far = half * 20;
    this.#orthographic.updateProjectionMatrix();
  }

  #pauseFollowing(): void {
    if (!this.#following) return;
    this.#following = false;
    this.#callbacks.onFollowingChange(false);
  }

  readonly #onControlsStart = () => {
    this.#interacting = true;
    // The reader took the camera: a reach never returns it.
    this.#reach.release();
    this.#reachOrigin = null;
    // Any touch of the camera during a flight takes the camera back.
    if (this.#flight !== null) {
      this.#flight = null;
      this.#scheduler.stop(this.#flying);
      this.#pauseFollowing();
    }
  };

  readonly #onControlsEnd = () => {
    this.#interacting = false;
  };

  readonly #onControlsChange = () => {
    if (this.#interacting) {
      // The person turned or zoomed: following stops, and hover lets go.
      this.#pauseFollowing();
      if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#setHover(-1, -1);
    }
    this.#scheduler.animate(this.#controlsDamping);
  };

  // ---------------------------------------------------------------------------
  // Pointer

  #localPointer(event: PointerEvent): Vector2 {
    const rect = this.#renderer.domElement.getBoundingClientRect();
    return this.#pointer.set(event.clientX - rect.left, event.clientY - rect.top);
  }

  /** Every pickable node's place on screen, into the reused buffer: no allocation per node. */
  #project(): ScreenNodes | null {
    const graph = this.#graph;
    const view = this.#view;
    if (graph === null || view === null) return null;
    const camera = this.#camera;
    camera.updateMatrixWorld();
    const screen = this.#screen;
    const at = this.#projected;
    let projected = 0;
    for (let index = 0; index < graph.state.count; index += 1) {
      const visibility = graph.state.styleOf(index, StyleChannel.visibility);
      // Only what the last frame drew in view can be picked.
      if (this.#inView[index] !== 1 || view.nodeVisible[index] !== 1 || visibility < 0.5) {
        screen.shown[index] = 0;
        continue;
      }
      graph.state.current(index, at);
      const radius = graph.state.drawnRadius(index) * visibility;
      projectInto(screen, index, camera, at.x, at.y, at.z, radius, this.#width, this.#height);
      projected += 1;
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
    // Only lens edges name anything on hover.
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
    this.#renderer.domElement.style.cursor = node >= 0 ? "pointer" : "";
    if (nodeChanged) {
      this.#applyTargets();
      this.#scheduler.animate(this.#springs);
      // After a linger, the camera reaches for the hovered note's links' far ends; it returns on unhover.
      this.#reach.hover(node >= 0 ? this.#litEnds(node) : null);
    }
    if (node >= 0) {
      const graph = this.#graph;
      const at = graph?.state.current(node, new Vector3());
      const screen =
        at === undefined
          ? null
          : projectNode(this.#camera, at.x, at.y, at.z, 0, this.#width, this.#height);
      this.#callbacks.onHover({
        kind: "node",
        index: graph?.slots.nodeOf(node) ?? -1,
        x: screen?.x ?? this.#pointer.x,
        y: screen?.y ?? this.#pointer.y,
      });
    } else if (edge >= 0) {
      this.#callbacks.onHover({
        kind: "edge",
        index: this.#graph?.slots.edgeOf(edge) ?? -1,
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
    this.#localPointer(event);
    if (this.#hoverQueued) return;
    this.#hoverQueued = true;
    // Picking runs at most once per frame, and draws only if the hover changed.
    this.#scheduler.beforeFrame(() => {
      this.#hoverQueued = false;
      if (!this.#pointerInside || this.#interacting || this.#press?.dragging === true) return false;
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
    if (this.#flight !== null) {
      this.#flight = null;
      this.#scheduler.stop(this.#flying);
      this.#pauseFollowing();
    }
    const { x, y } = this.#localPointer(event);
    const node = this.#pickAt(x, y).node;
    this.#press = { pointerId: event.pointerId, x, y, node, dragging: false };
    if (node >= 0) {
      // A press on a node is the node's, not the camera's.
      event.stopPropagation();
      event.preventDefault();
    }
  };

  readonly #onDragMove = (event: PointerEvent) => {
    const press = this.#press;
    const graph = this.#graph;
    if (press === null || graph === null || press.node < 0 || event.pointerId !== press.pointerId) {
      return;
    }
    const { x, y } = this.#localPointer(event);
    if (!press.dragging && Math.hypot(x - press.x, y - press.y) < DRAG_THRESHOLD) return;
    press.dragging = true;
    // Move the node in the plane facing the camera through where it is drawn.
    const camera = this.#camera;
    const at = graph.state.current(press.node, new Vector3());
    const normal = camera.getWorldDirection(new Vector3());
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, at);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      new Vector2((x / this.#width) * 2 - 1, -(y / this.#height) * 2 + 1),
      camera,
    );
    const hit = raycaster.ray.intersectPlane(plane, new Vector3());
    if (hit === null) return;
    const rest = graph.state.rest;
    const index = press.node;
    const home = [
      rest[index * 3] ?? 0,
      rest[index * 3 + 1] ?? 0,
      rest[index * 3 + 2] ?? 0,
    ] as const;
    // The drag is kept relative to where the gathering puts the note.
    const base = this.#baseOffset(index);
    const drag = dragFrom([hit.x, hit.y, this.#flat ? home[2] + base[2] : hit.z], home, base);
    this.#dragOffsets.set(graph.slots.nodeOf(index), drag);
    graph.state.offsets.hold(index, composeOffset(base, drag));
    graph.state.writePositions();
    this.#scheduler.invalidate();
  };

  readonly #onPointerUp = (event: PointerEvent) => {
    const press = this.#press;
    if (press === null || event.pointerId !== press.pointerId) return;
    this.#press = null;
    const { x, y } = this.#localPointer(event);
    if (press.node >= 0) {
      const note = this.#graph?.slots.nodeOf(press.node) ?? -1;
      if (!press.dragging && note >= 0) this.#callbacks.onPick(note);
      return;
    }
    if (Math.hypot(x - press.x, y - press.y) >= DRAG_THRESHOLD) return;
    // The cursor's chip opens the turn's moves beside it.
    if (this.#callbacks.onCursorChip !== undefined && this.#teller.chipAt(press.x, press.y)) {
      this.#callbacks.onCursorChip();
      return;
    }
    this.#callbacks.onBackground();
  };

  #onResize(): void {
    const width = Math.max(1, this.#container.clientWidth);
    const height = Math.max(1, this.#container.clientHeight);
    const resized = width !== this.#width || height !== this.#height;
    this.#width = width;
    this.#height = height;
    this.#renderer.setSize(width, height, false);
    this.#overlay.resize(width, height);
    this.#updateProjection();
    if (this.#graph !== null) this.#updateClamps();
    // While following, the frame is the graph's: a host that mounted it before
    // it had a size (or resized it since) still sees the whole reading.
    if (resized && this.#following && this.#view !== null) this.#autoFrame(false);
    this.#scheduler.invalidate();
  }

  // ---------------------------------------------------------------------------
  // Drawing

  readonly #renderCall = () => {
    const renderer = this.#renderer;
    if (this.#regions.mesh.geometry.instanceCount === 0) {
      renderer.render(this.#scene, this.#camera);
    } else {
      // The discs first (they write no depth), then the scene over them without clearing.
      renderer.render(this.#regionScene, this.#camera);
      renderer.autoClear = false;
      renderer.render(this.#scene, this.#camera);
      renderer.autoClear = true;
    }
    // The story's marks and the agent's cursor, over everything.
    this.#overlay.render(renderer);
  };

  /** One frame: prepare it, then render; only the render call counts as render time. */
  #render(): void {
    const started = performance.now();
    this.#prepare();
    this.#drawStory();
    if (this.#tags.count > 0) this.#tags.place((note) => this.#screenOf(note));

    const renderMs = timeRender(this.#renderCall, this.#gpuTimer);
    const prepMs = performance.now() - started - renderMs;
    this.#frameTimer.add(renderMs, prepMs);
    this.#drawCalls = this.#renderer.info.render.calls;
    const listener = this.#sampleListener;
    const graph = this.#graph;
    if (listener === null || graph === null) return;
    const beads = this.#storyline.beads.count;
    listener({
      time: performance.now(),
      renderMs,
      prepMs,
      drawCalls: this.#drawCalls,
      labels: this.#labelCount,
      labelsCut: graph.labels.cut,
      edges: this.#edgesDrawn,
      beads,
      beadsVisible: visibleBeads(graph.beads.bright.array, beads),
      beadChecksum: beadChecksum(graph.beads.positions.array, graph.beads.bright.array, beads),
      gpuMs: this.#gpuTimer?.poll() ?? [],
      boxes: this.#sampleBoxes,
    });
  }

  driver(): BenchDriver {
    return {
      view: () => ({
        following: this.#following,
        hovering: this.#hoverNode >= 0 || this.#hoverEdge >= 0,
        picked: this.#focusNote,
      }),
      sample: (listener, options = {}) => {
        this.#sampleListener = listener;
        this.#sampleBoxes = listener !== null && options.boxes === true ? new LabelBoxes() : null;
        this.#gpuTimer?.dispose();
        this.#gpuTimer =
          listener !== null && options.gpu === true
            ? GpuTimer.create(webgl2(this.#renderer.getContext()))
            : null;
      },
      inView: () => this.#notesInView(),
      pan: (dx, dy) => this.#benchPan(dx, dy),
      zoom: (x, y, factor) => this.#benchZoom(x, y, factor),
      hover: (x, y) => {
        this.#pointer.set(x, y);
        if (x < 0) this.#setHover(-1, -1);
        else {
          const { node, edge } = this.#pickAt(x, y);
          this.#setHover(node, edge);
        }
      },
      screenOf: (note) => this.#screenOf(note),
      gpuTiming: canTimeGpu(webgl2(this.#renderer.getContext())),
      memory: () => ({
        textures: this.#renderer.info.memory.textures,
        buffers: this.#renderer.info.memory.geometries,
      }),
    };
  }

  /** The notes (universe indices) drawn in view at the last frame. */
  #notesInView(): Array<number> {
    const graph = this.#graph;
    const notes: Array<number> = [];
    if (graph === null) return notes;
    this.#inView.forEach((flag, slot) => {
      if (flag === 1) notes.push(graph.slots.nodeOf(slot));
    });
    return notes;
  }

  /** The person's camera, taken by a script: a flight stops, following stops, the hover lets go. */
  #benchTake(): void {
    this.#flight = null;
    this.#scheduler.stop(this.#flying);
    this.#pauseFollowing();
    if (this.#hoverNode >= 0 || this.#hoverEdge >= 0) this.#setHover(-1, -1);
  }

  /** World units per CSS pixel at the camera's target. */
  #perPixel(): number {
    return 1 / this.#pixelsPerUnit();
  }

  #benchPan(dx: number, dy: number): void {
    this.#benchTake();
    const camera = this.#camera;
    const perPixel = this.#perPixel();
    const shift = new Vector3(1, 0, 0)
      .applyQuaternion(camera.quaternion)
      .multiplyScalar(-dx * perPixel)
      .add(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(dy * perPixel));
    camera.position.add(shift);
    this.#controls.target.add(shift);
    this.#controls.update();
    this.#scheduler.invalidate();
  }

  #benchZoom(x: number, y: number, factor: number): void {
    this.#benchTake();
    const camera = this.#camera;
    const target = this.#controls.target;
    // The world point under the pointer, on the plane through the target facing the camera.
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      new Vector2((x / this.#width) * 2 - 1, -(y / this.#height) * 2 + 1),
      camera,
    );
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new Vector3()),
      target,
    );
    const point = raycaster.ray.intersectPlane(plane, new Vector3()) ?? target.clone();
    if (this.#flat) {
      const zoom = Math.min(
        this.#pan.maxZoom,
        Math.max(this.#pan.minZoom, this.#orthographic.zoom * factor),
      );
      const kept = 1 - this.#orthographic.zoom / zoom;
      const shift = point.clone().sub(target).multiplyScalar(kept);
      shift.z = 0;
      this.#applyView({
        position: camera.position.clone().add(shift),
        target: target.clone().add(shift),
        zoom,
      });
    } else {
      const offset = camera.position.clone().sub(target);
      const distance = offset.length();
      const next = Math.min(
        this.#orbit.maxDistance,
        Math.max(this.#orbit.minDistance, distance / factor),
      );
      const nextTarget = target.clone().add(point.sub(target).multiplyScalar(1 - next / distance));
      this.#applyView({
        position: nextTarget.clone().add(offset.setLength(next)),
        target: nextTarget,
        zoom: 1,
      });
    }
    this.#scheduler.invalidate();
  }

  /** The cursor this frame, its gestures, and its caret and chip, into the overlay. */
  #drawStory(): void {
    const theme = this.#theme;
    if (theme === null) return;
    const { marks, agent } = this.#teller.frame();
    this.#overlay.draw(marks, agent, { paper: theme.paper, ink: theme.ink, accent: theme.accent });
  }

  #prepare(): void {
    const graph = this.#graph;
    const camera = this.#camera;
    if (graph !== null && this.#layout !== null) {
      // Only the edges that show are drawn: none at all when nothing is lit.
      this.#edgesDrawn = packEdges(graph.edges, graph.edgeStyle.lit, graph.edgeStyle.values);
      // The fade window and the focal plane sit around the camera's distance to its target.
      const distance = camera.position.distanceTo(this.#controls.target);
      const spacing = this.#densitySpan;
      const near = distance - FADE_NEAR * spacing;
      const far = distance + FADE_FAR * spacing;
      for (const uniforms of [graph.nodes.uniforms, graph.edges.uniforms]) {
        uniforms.uFadeNear.value = near;
        uniforms.uFadeFar.value = far;
      }
      graph.nodes.uniforms.uFadeStrength.value = this.#flat ? 0 : NODE_FADE;
      graph.edges.uniforms.uFadeStrength.value = this.#flat ? 0 : EDGE_FADE;
      graph.nodes.uniforms.uFocal.value = distance;
      graph.nodes.uniforms.uFocalTint.value = this.#flat ? 0 : FOCAL_TINT;
      // Past the fade-far plane nothing is drawn: the shader cuts it, labels skip it.
      const cut = this.#flat ? Infinity : far;
      graph.nodes.uniforms.uDepthCut.value = this.#flat ? 1e9 : far;
      const settings = this.#settings;
      const view = this.#view;
      const state = graph.state;
      const prominence = state.prominence.values;
      this.#inViewCount = classifyInView(
        camera,
        state.count,
        (index, out) => state.current(index, out),
        (index) => state.drawnRadius(index) * state.styleOf(index, StyleChannel.visibility),
        (index) =>
          view?.nodeVisible[index] === 1 || state.styleOf(index, StyleChannel.visibility) > 0.01,
        // The story's notes have no cut: they are the story.
        (index) => ((prominence[index] ?? 0) > 0.01 ? Infinity : cut),
        this.#inView,
      );
      // The flat reading's zoom, read as the distance a perspective camera would stand at.
      const density = this.#densityDistance();
      graph.beads.uniforms.uDensity.value = density;
      graph.beads.uniforms.uFlat.value = this.#flat ? 1 : 0;
      graph.beads.uniforms.uPixelRatio.value = this.#renderer.getPixelRatio();
      const flatDistance =
        (density * this.#densityZoom()) / Math.max(this.#orthographic.zoom, 1e-6);
      this.#labelCount = graph.labels.update(
        {
          camera,
          state,
          fade: {
            near: (this.#flat ? density : distance) - FADE_NEAR * spacing,
            far: (this.#flat ? density : distance) + LABEL_FADE_FAR * spacing,
            strength: LABEL_FADE_STRENGTH * (settings?.labelFade ?? 1),
          },
          distance: (point) => (this.#flat ? flatDistance : camera.position.distanceTo(point)),
          worldPerPixel: (at) =>
            this.#flat
              ? (this.#orthographic.top - this.#orthographic.bottom) /
                this.#orthographic.zoom /
                this.#height
              : (2 * at * Math.tan((FOV * Math.PI) / 360)) / this.#height,
          middle: this.#flat ? flatDistance : distance,
          forced: (index) =>
            index === this.#hoverNode ||
            (view?.nodeGlow[index] ?? 0) > 0.5 ||
            view?.focus?.index === index,
          outlined: (index) => index === this.#hoverNode || view?.focus?.index === index,
          boxes: this.#sampleBoxes,
          width: this.#width,
          height: this.#height,
        },
        this.#inView,
      );
      this.#regionCircles = regionCircles(
        view?.regions ?? [],
        state,
        REGION_PAD * spacing,
        this.#regionCircles,
      );
      updateRegionMesh(this.#regions, view?.regions ?? [], this.#regionCircles);
      this.#regionNames.update(
        view?.regions ?? [],
        this.#regionCircles,
        camera,
        (point) => (this.#flat ? flatDistance : camera.position.distanceTo(point)),
        (at) =>
          this.#flat
            ? (this.#orthographic.top - this.#orthographic.bottom) /
              this.#orthographic.zoom /
              this.#height
            : (2 * at * Math.tan((FOV * Math.PI) / 360)) / this.#height,
        this.#flat ? flatDistance : distance,
      );
    }
  }

  /** Labels over the working set's slots: each slot shows its note's name, read afresh as notes come and go. */
  #createLabels(slots: WorkingSet): Labels {
    return new Labels(
      (slot) => slots.names[slot] ?? "",
      slots.capacity,
      this.#labelFont,
      () => this.#scheduler.invalidate(),
    );
  }

  #disposeMeshes(graph: Graph): void {
    this.#scene.remove(graph.nodes.mesh, graph.edges.mesh, graph.labels.group);
    graph.nodes.mesh.geometry.dispose();
    graph.nodes.mesh.material.dispose();
    graph.edges.mesh.geometry.dispose();
    graph.edges.mesh.material.dispose();
    graph.labels.dispose();
  }

  #disposeGraph(): void {
    const graph = this.#graph;
    if (graph === null) return;
    this.#disposeMeshes(graph);
    this.#scene.remove(graph.beads.points);
    graph.beads.points.geometry.dispose();
    graph.beads.points.material.dispose();
    graph.state.dispose();
    this.#graph = null;
  }
}
