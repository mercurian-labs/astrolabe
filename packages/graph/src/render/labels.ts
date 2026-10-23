/**
 * Every node carries its name. Labels are SDF text (troika Text) that face the
 * camera, keep a near-constant size on screen, and fade with distance from the
 * camera: returning as it comes closer. A hovered, picked, or worked note's
 * label stays at full strength. The story's notes' labels, and a hovered or
 * picked note's, are outlined in paper and drawn over everything, so they read
 * across any line; the story's are also exempt from the fade and the cutoff.
 *
 * Labels are pooled: only the labels within the draw budget (in view, inside
 * the label window, at most LABEL_BUDGET of them, prominent first) own a Text,
 * and a note keeps its Text while it stays in the budget, so a memory of any
 * size owns only as many as it shows. A Text given a new name stays hidden
 * until it has typeset. Labels update only when a frame is drawn.
 */
import { Group, Vector3, type Camera, type Color } from "three";
import { BatchedText, Text } from "troika-three-text";

import { labelGrowth, labelOpacity, prominentOpacity, type LabelFade } from "./labelFade.ts";
import type { NodeState } from "./nodeState.ts";
import { StyleChannel } from "./nodeState.ts";
import { budgetLabels, StickyPool, type LabelBoxes } from "./pool.ts";

/** Label height on screen at the middle of the web, in CSS pixels. */
export const LABEL_PIXELS = 11;
/** A prominent label's paper outline, as a share of its font size. */
export const LABEL_OUTLINE = "12%";
/** Labels draw after nodes, edges, and beads; prominent labels after every other label. */
const LABEL_ORDER = 3;
const PROMINENT_ORDER = 4;

export interface LabelFrame {
  readonly camera: Camera;
  readonly state: NodeState;
  readonly fade: LabelFade;
  /**
   * How far a point reads from the camera. A flat reading's orthographic
   * camera reports its zoom as a distance, so its labels fade the same way.
   */
  readonly distance: (point: Vector3) => number;
  /** World units per CSS pixel at a given camera distance. */
  readonly worldPerPixel: (distance: number) => number;
  /** The camera distance to the web's middle, where labels are drawn at nominal size. */
  readonly middle: number;
  /** Whether a node's label is forced to full strength. */
  readonly forced: (index: number) => boolean;
  /** Whether a node is hovered or picked: its label is outlined and drawn on top. */
  readonly outlined: (index: number) => boolean;
  /** Where drawn labels' screen rectangles go, while a bench asks for them. */
  readonly boxes?: LabelBoxes | null;
  readonly width?: number;
  readonly height?: number;
}

const at = new Vector3();
const right = new Vector3();

export class Labels {
  readonly group = new Group();
  /**
   * Every label draws in one of two batches, one draw call each, whatever the
   * label count: ordinary labels depth-tested, and prominent (outlined) ones
   * over everything. A label moves between them as its prominence changes;
   * a label the budget does not draw stays in its batch at zero opacity.
   */
  readonly #ordinary = new BatchedText();
  readonly #prominent = new BatchedText();
  readonly #batchOf = new WeakMap<Text, BatchedText>();
  /** Each slot's name now: a slot can hold another note later. */
  readonly #nameOf: (index: number) => string;
  readonly #font: string | undefined;
  readonly #onSynced: () => void;
  readonly #pool: StickyPool<Text>;
  /** Texts whose current name has typeset, so they can show. */
  readonly #ready = new WeakSet<Text>();
  readonly #opacity: Float32Array;
  readonly #priority: Float32Array;
  readonly #candidates: Array<number> = [];
  #ink: Color | null = null;
  #paper: Color | null = null;
  /** Labels the budget cut in the last frame. */
  cut = 0;

  constructor(
    nameOf: (index: number) => string,
    count: number,
    font: string | undefined,
    onSynced: () => void,
  ) {
    this.#nameOf = nameOf;
    this.#font = font;
    this.#onSynced = onSynced;
    this.#opacity = new Float32Array(count);
    this.#priority = new Float32Array(count);
    this.#pool = new StickyPool(
      () => this.#createText(),
      (text) => hide(text),
    );
    for (const [batch, order, depthTest] of [
      [this.#ordinary, LABEL_ORDER, true],
      [this.#prominent, PROMINENT_ORDER, false],
    ] as const) {
      batch.renderOrder = order;
      // Labels move every frame; the batch's bounds are only refreshed when it repacks.
      batch.frustumCulled = false;
      batch.userData.depthTest = depthTest;
      this.group.add(batch);
    }
  }

  /** The labels' Texts, each in one of the two batches. */
  get texts(): ReadonlyArray<Text> {
    return this.#pool.items;
  }

  /** Put `text` in the batch for its prominence, if it is not there already. */
  #batch(text: Text, top: boolean): void {
    const batch = top ? this.#prominent : this.#ordinary;
    const was = this.#batchOf.get(text);
    if (was === batch) return;
    was?.removeText(text);
    batch.addText(text);
    this.#batchOf.set(text, batch);
  }

  #createText(): Text {
    const text = new Text();
    if (this.#font !== undefined) text.font = this.#font;
    text.fontSize = 1;
    text.anchorX = "left";
    text.anchorY = "middle";
    hide(text);
    text.outlineWidth = 0;
    if (this.#ink !== null) text.color = this.#ink.clone();
    if (this.#paper !== null) text.outlineColor = this.#paper.clone();
    this.#batch(text, false);
    return text;
  }

  /** Give a pooled Text a note's name; it shows once the name has typeset. */
  #name(text: Text, name: string): void {
    text.text = name;
    this.#ready.delete(text);
    text.sync(() => {
      if (text.text !== name) return;
      this.#ready.add(text);
      this.#onSynced();
    });
  }

  /** Texts the pool owns now. */
  get pooled(): number {
    return this.#pool.items.length;
  }

  setColor(color: Color): void {
    this.#ink = color.clone();
    for (const text of this.#pool.items) text.color = color.clone();
  }

  /** The paper the prominent labels are outlined in. */
  setOutlineColor(color: Color): void {
    this.#paper = color.clone();
    for (const text of this.#pool.items) text.outlineColor = color.clone();
  }

  /**
   * Place, size, and fade the labels of the nodes in view for the frame about
   * to be drawn: the ones inside the label window compete for the budget, and
   * only those kept hold a Text. Returns how many labels are drawn.
   */
  update(frame: LabelFrame, inView: Uint8Array): number {
    const { camera, state } = frame;
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const candidates = this.#candidates;
    candidates.length = 0;
    for (let index = 0; index < state.count; index += 1) {
      if (inView[index] !== 1) continue;
      state.current(index, at);
      const visibility = state.styleOf(index, StyleChannel.visibility);
      const prominence = state.prominence.values[index] ?? 0;
      const forced = frame.forced(index);
      const opacity = prominentOpacity(
        labelOpacity(
          frame.distance(at),
          frame.fade,
          visibility,
          state.styleOf(index, StyleChannel.emphasis),
          forced,
        ),
        visibility,
        prominence,
      );
      if (opacity < 0.03) continue;
      this.#opacity[index] = opacity;
      // Prominent, then forced, then the most opaque: what the budget keeps first.
      this.#priority[index] = opacity + (forced ? 1 : 0) + 2 * prominence;
      candidates.push(index);
    }
    this.cut = budgetLabels(candidates, (index) => this.#priority[index] ?? 0);
    const boxes = frame.boxes ?? null;
    if (boxes !== null) boxes.count = 0;
    this.#pool.begin();
    let drawn = 0;
    for (const index of candidates) {
      const { item: text, fresh } = this.#pool.take(index);
      const name = this.#nameOf(index);
      // A slot that took another note since its Text typeset shows the new name once typeset.
      if (fresh || text.text !== name) this.#name(text, name);
      if (!this.#ready.has(text)) {
        hide(text);
        continue;
      }
      state.current(index, at);
      const distance = frame.distance(at);
      const opacity = this.#opacity[index] ?? 0;
      const prominence = state.prominence.values[index] ?? 0;
      const shown = frame.outlined(index) ? 1 : prominence;
      setProminence(text, shown, opacity);
      this.#batch(text, shown > 0.5);
      const perPixel = frame.worldPerPixel(distance);
      // Near-constant on screen, with a little perspective left in as a depth cue.
      const depthCue = Math.max(0.8, Math.min(1.25, frame.middle / Math.max(distance, 1e-3)));
      // A prominent note's label grows with it; scaling the text keeps its layout, so nothing jumps.
      const size = LABEL_PIXELS * perPixel * depthCue * labelGrowth(prominence);
      const radius = state.drawnRadius(index) * state.styleOf(index, StyleChannel.visibility);
      text.visible = true;
      drawn += 1;
      text.fillOpacity = opacity;
      text.scale.setScalar(size);
      text.quaternion.copy(camera.quaternion);
      text.position.copy(at).addScaledVector(right, radius * 1.25 + 5 * perPixel);
      text.updateMatrix();
      if (boxes !== null) {
        at.copy(text.position).project(camera);
        boxes.add(
          ((at.x + 1) / 2) * (frame.width ?? 1),
          ((1 - at.y) / 2) * (frame.height ?? 1),
          this.#nameOf(index).length,
          size / perPixel,
        );
      }
    }
    this.#pool.end();
    for (const batch of [this.#ordinary, this.#prominent]) {
      const materials = Array.isArray(batch.material) ? batch.material : [batch.material];
      for (const material of materials) material.depthTest = batch.userData.depthTest === true;
    }
    return drawn;
  }

  /**
   * Release every label's GPU resources. troika's `Text.dispose()` frees only
   * the geometry; each Text also owns a clone of the default base material and
   * the material derived from it, so both are disposed here.
   */
  dispose(): void {
    for (const batch of [this.#ordinary, this.#prominent]) {
      const materials = Array.isArray(batch.material) ? batch.material : [batch.material];
      for (const material of materials) {
        material.dispose();
        material.baseMaterial?.dispose();
      }
      batch.dispose();
    }
    for (const text of this.#pool.items) {
      const materials = Array.isArray(text.material) ? text.material : [text.material];
      for (const material of materials) {
        material.dispose();
        material.baseMaterial?.dispose();
      }
      text.dispose();
    }
    this.group.clear();
  }
}

/**
 * Outline a label in paper in proportion to `prominence`; at 0 it is an
 * ordinary label again. The outline is a uniform, so turning it on and off
 * needs no new layout. (Which batch it draws in, and so whether it draws
 * over everything, is the Labels' to say.)
 */
function setProminence(text: Text, prominence: number, opacity: number): void {
  text.visible = true;
  text.outlineWidth = prominence > 0.01 ? LABEL_OUTLINE : 0;
  text.outlineOpacity = opacity * prominence;
}

/** A label not drawn this frame: it stays in its batch, drawing nothing. */
function hide(text: Text): void {
  text.visible = false;
  text.fillOpacity = 0;
  text.outlineOpacity = 0;
}
