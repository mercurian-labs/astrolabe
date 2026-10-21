/**
 * The seam between the flat controller and a 2D drawing library. The
 * controller owns everything the graph does (targets, springs, the story,
 * beads, framing, the pointer); a drawer only draws the frame it is handed.
 * "lean" draws it with Three.js, "pixi" with Pixi.js. Everything it is handed
 * is per slot of the controller's working set, never per note of the memory.
 */
import type { GraphView } from "../../model/view.ts";
import type { BeadSet } from "../beads.ts";
import type { FlatCamera } from "../camera.ts";
import type { EdgeStyle } from "../edgeStyle.ts";
import type { NodeState } from "../nodeState.ts";
import type { Mark } from "../gestures.ts";
import type { GpuMemory, GpuTimer } from "../probe.ts";
import type { GraphTheme } from "../theme.ts";
import type { DrawnGraph } from "../workingSet.ts";

/** Line details in world units at the reading density, and bead pixels per unit of bead size. */
export interface FlatScale {
  /** The base ribbon width: a hovered note's links (attention 0.6) span this. */
  readonly lineWidth: number;
  readonly arrows: boolean;
  readonly arrowSize: number;
  readonly dash: number;
  readonly beadPixels: number;
}

/** Each label as the frame draws it; opacity 0 hides it. */
export interface LabelLayout {
  /** Each slot's name now: a slot can hold another note later. */
  readonly names: ReadonlyArray<string>;
  /** The notes whose labels are drawn this frame (the budget's), `count` of them. */
  readonly drawn: Int32Array;
  count: number;
  /** Labels the budget cut this frame. */
  cut: number;
  readonly opacity: Float32Array;
  /** The label's anchor (its left end, vertically centred) in world units. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Font size in CSS pixels. */
  readonly size: Float32Array;
  /** How far the label is outlined in paper and drawn over the others, 0–1. */
  readonly outline: Float32Array;
}

/** What changed since the last frame the drawer drew; everything else it may keep. */
export interface FlatDirty {
  view: boolean;
  kinds: boolean;
  edgeStyle: boolean;
  prominence: boolean;
  wave: boolean;
  beadsDealt: boolean;
  theme: boolean;
  scale: boolean;
  /** Slots took new notes or edges: edge ends and names changed. */
  slots: boolean;
}

export interface FlatFrame {
  /** The slots: each node slot's note, each edge slot's ends as node slots. */
  readonly universe: DrawnGraph;
  readonly state: NodeState;
  readonly edgeStyle: EdgeStyle;
  readonly view: GraphView;
  /** Each edge's kind, the selected play's edge by the play. */
  readonly edgeKinds: Uint8Array;
  readonly camera: FlatCamera;
  readonly width: number;
  readonly height: number;
  /** 1 for each node in view this frame. */
  readonly inView: Uint8Array;
  readonly scale: FlatScale;
  /** Per edge: 0 still, 1 a landing wave from its a end, 2 from its b end; `pulse` in seconds. */
  readonly waves: Uint8Array;
  readonly pulse: number;
  readonly beads: BeadSet;
  /** x, y, z per bead, and how bright. */
  readonly beadPositions: Float32Array;
  readonly beadBright: Float32Array;
  readonly labels: LabelLayout;
  /** The open containers' circles this frame (x, y, z, radius per region of `view.regions`). */
  readonly regionCircles: Float32Array;
  /** The story's marks this frame, under the labels: the gestures (see `gestures.ts`). */
  readonly marks: ReadonlyArray<Mark>;
  /** The agent's cursor, over the labels: always drawn, parked in the corner when it has nothing to do. */
  readonly agent: AgentDraw;
  readonly theme: GraphTheme;
  readonly dirty: Readonly<FlatDirty>;
}

/** The agent's cursor as a drawer draws it: its caret, its label's chip, and the label's text, in world units. */
export interface AgentDraw {
  /** The caret: its paper outline, then its story-colour dart. */
  readonly caret: ReadonlyArray<Mark>;
  /** The label's chip behind the text. */
  readonly chip: Mark;
  readonly text: string;
  /** Where the text starts: its left end, vertically centred. */
  readonly x: number;
  readonly y: number;
  /** Its font size, in CSS pixels. */
  readonly pixels: number;
}

export interface FlatDrawer {
  /** New slots (a new universe, or the working set resized): build what it draws with. */
  setGraph(graph: DrawnGraph, state: NodeState, edgeStyle: EdgeStyle): void;
  /** A font file (woff, ttf, or otf) for labels; undefined uses the drawer's default. */
  setLabelFont(font: string | undefined): void;
  /**
   * Draw the frame, bracketing the library's render call with `gpu` when a
   * bench times the GPU. Returns the milliseconds spent in that render call
   * alone, or null when nothing was rendered (the drawer is not ready).
   */
  draw(frame: FlatFrame, gpu: GpuTimer | null): number | null;
  resize(width: number, height: number): void;
  /** GPU draw calls in the last frame drawn. */
  readonly drawCalls: number;
  /** Edges drawn in the last frame. */
  readonly edgesDrawn: number;
  /** The drawer's WebGL 2 context once it has one, for GPU timing. */
  readonly gl: WebGL2RenderingContext | null;
  memory(): GpuMemory;
  dispose(): void;
}

/** What a drawer gets from its controller: where to put its canvas, and a way to ask for a frame. */
export interface DrawerHost {
  readonly container: HTMLElement;
  readonly pixelRatio: number;
  /** Ask for a frame, with everything marked changed (a drawer that became ready late). */
  redraw(): void;
  /** Ask for a frame (a font arrived). */
  invalidate(): void;
}

export const ALL_DIRTY: FlatDirty = {
  view: true,
  kinds: true,
  edgeStyle: true,
  prominence: true,
  wave: true,
  beadsDealt: true,
  theme: true,
  scale: true,
  slots: true,
};
