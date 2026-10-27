/**
 * Per-node state in two float textures both shaders read, written only while something moves:
 * `positions` (rest plus spring offset and wobble, and the drawn radius) and `style` (visibility,
 * emphasis, glow, hover). `step` reports whether anything moves, so the loop sleeps at rest; hover,
 * pick, and a play never change a target.
 */
import { DataTexture, FloatType, NearestFilter, RGBAFormat, Vector3 } from "three";

import {
  NodeSprings,
  nodeTraits,
  riseAmount,
  riseDelays,
  travelDrift,
  wobble,
  type NodeTraits,
} from "../layout/motion.ts";
import { SpringField } from "../layout/springs.ts";
import { easeInOutCubic } from "./camera.ts";

/** A fully prominent note (the story's, the play's, hovered, or picked) draws this much bigger. */
export const PROMINENT_RADIUS_GAIN = 1.4;
/** How much bigger a note draws at `prominence` 0–1, eased by the prominence spring. */
export const prominentGrowth = (prominence: number) =>
  1 + (PROMINENT_RADIUS_GAIN - 1) * Math.max(0, Math.min(1, prominence));

/** How long a switch between layouts (3D and flat, or new forces) takes. */
export const GLIDE_SECONDS = 0.9;

export const StyleChannel = { visibility: 0, emphasis: 1, glow: 2, hover: 3 } as const;

export class NodeState {
  readonly count: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
  /** Rest positions from the layout, x, y, z per node. */
  readonly rest: Float32Array;
  /** Each slot's note's personality: its spring's stiffness and its wobble. */
  readonly traits: Array<NodeTraits>;
  readonly offsets: NodeSprings;
  /** Drawn radius in world units. */
  readonly radius: SpringField;
  readonly style: SpringField;
  /** 1 for the story's notes while it is lit, eased in and out: their nodes and labels stand out. */
  readonly prominence: SpringField;
  /**
   * 1 for the hovered or picked note, eased: it grows. The story never grows a
   * note; size means connectedness, and what happened is told by gestures.
   */
  readonly grow: SpringField;
  readonly positionTexture: DataTexture;
  readonly styleTexture: DataTexture;
  readonly #positionData: Float32Array;
  readonly #rising = new Map<number, { readonly start: number; readonly delay: number }>();
  /** The clock of the last step, in seconds. */
  #time = 0;
  /** World units per layout unit: wobble amplitudes scale with the web. */
  #unit = 1;
  /** On the flat reading, nothing drifts off the plane. */
  #flat = false;
  /** A glide between layouts: each node's leftover displacement, eased away. */
  #glide: { readonly delta: Float32Array; readonly start: number } | null = null;

  constructor(count: number) {
    this.count = count;
    this.textureWidth = Math.max(1, Math.ceil(Math.sqrt(count)));
    this.textureHeight = Math.max(1, Math.ceil(count / this.textureWidth));
    const texels = this.textureWidth * this.textureHeight;
    this.rest = new Float32Array(count * 3);
    this.traits = Array.from({ length: count }, (_, index) => nodeTraits(index));
    this.offsets = new NodeSprings(this.traits.map((traits) => traits.stiffness));
    this.radius = new SpringField(count, 1, 9, 0.002);
    // Style (a hover's emphasis) and prominence settle within about half a second.
    this.style = new SpringField(texels, 4, 18, 0.002);
    this.prominence = new SpringField(count, 1, 18, 0.002);
    this.grow = new SpringField(count, 1, 18, 0.002);
    this.#positionData = new Float32Array(texels * 4);
    this.positionTexture = dataTexture(this.#positionData, this.textureWidth, this.textureHeight);
    this.styleTexture = dataTexture(this.style.values, this.textureWidth, this.textureHeight);
  }

  /**
   * A state `capacity` slots wide carrying `old`'s: slot `slot` takes up
   * `old`'s slot `from[slot]` (-1 for none), home, springs, style, rise, and
   * glide, so a renumbering moves nothing on screen.
   */
  static carried(old: NodeState, capacity: number, from: Int32Array): NodeState {
    const next = new NodeState(capacity);
    next.#time = old.#time;
    next.#unit = old.#unit;
    next.#flat = old.#flat;
    next.offsets.setScale(old.#unit);
    next.offsets.carry(old.offsets, from);
    next.radius.carry(old.radius, from);
    next.style.carry(old.style, from);
    next.prominence.carry(old.prominence, from);
    next.grow.carry(old.grow, from);
    const glide = old.#glide;
    const delta = glide === null ? null : new Float32Array(capacity * 3);
    from.forEach((source, slot) => {
      if (source < 0 || source >= old.count || slot >= capacity) return;
      for (let axis = 0; axis < 3; axis += 1) {
        next.rest[slot * 3 + axis] = old.rest[source * 3 + axis] ?? 0;
        if (delta !== null) delta[slot * 3 + axis] = glide?.delta[source * 3 + axis] ?? 0;
      }
      next.traits[slot] = old.traits[source] ?? next.traits[slot] ?? nodeTraits(slot);
      const rise = old.#rising.get(source);
      if (rise !== undefined) next.#rising.set(slot, rise);
    });
    if (glide !== null && delta !== null) next.#glide = { delta, start: glide.start };
    next.writePositions();
    next.styleTexture.needsUpdate = true;
    return next;
  }

  /**
   * Slot `slot` now holds a note arriving in the view: at its `home`, at rest
   * on its spring, invisible (it rises), drawn at `radius`.
   */
  assign(slot: number, home: ArrayLike<number>, traits: NodeTraits, radius: number): void {
    this.traits[slot] = traits;
    for (let axis = 0; axis < 3; axis += 1) this.rest[slot * 3 + axis] = home[axis] ?? 0;
    this.offsets.reset(slot, traits.stiffness);
    this.radius.hold(slot, [radius]);
    this.style.hold(slot, [0, 0, 0, 0]);
    this.prominence.hold(slot, [0]);
    this.grow.hold(slot, [0]);
    this.#rising.delete(slot);
    const glide = this.#glide;
    if (glide !== null) glide.delta.fill(0, slot * 3, slot * 3 + 3);
  }

  /** Slot `slot`'s home moved (a new layout): it glides there with the others. */
  setRestAt(slot: number, x: number, y: number, z: number): void {
    this.rest[slot * 3] = x;
    this.rest[slot * 3 + 1] = y;
    this.rest[slot * 3 + 2] = z;
  }

  get settled(): boolean {
    return (
      this.offsets.settled &&
      this.radius.settled &&
      this.style.settled &&
      this.prominence.settled &&
      this.grow.settled &&
      this.#rising.size === 0 &&
      this.#glide === null
    );
  }

  setScale(unit: number, flat: boolean): void {
    this.#unit = unit;
    this.#flat = flat;
    this.offsets.setScale(unit);
  }

  /** How strongly node `index` wobbles now: only while it travels, and 0 at rest. */
  #drift(index: number): number {
    if (!this.offsets.isActive(index)) return 0;
    return travelDrift(this.offsets.progressOf(index), this.offsets.journeyOf(index) / this.#unit);
  }

  /** Where node `index` is drawn now. */
  current(index: number, out: Vector3): Vector3 {
    out.set(
      (this.rest[index * 3] ?? 0) + (this.offsets.values[index * 3] ?? 0),
      (this.rest[index * 3 + 1] ?? 0) + (this.offsets.values[index * 3 + 1] ?? 0),
      (this.rest[index * 3 + 2] ?? 0) + (this.offsets.values[index * 3 + 2] ?? 0),
    );
    const glide = this.#glide;
    if (glide !== null) {
      const left = 1 - easeInOutCubic(Math.max(0, (this.#time - glide.start) / GLIDE_SECONDS));
      out.x += (glide.delta[index * 3] ?? 0) * left;
      out.y += (glide.delta[index * 3 + 1] ?? 0) * left;
      out.z += (glide.delta[index * 3 + 2] ?? 0) * left;
    }
    const drift = this.#drift(index);
    const traits = this.traits[index];
    if (drift > 0 && traits !== undefined) {
      const scale = drift * this.#unit;
      out.x += wobble(traits, 0, this.#time) * scale;
      out.y += wobble(traits, 1, this.#time) * scale;
      if (!this.#flat) out.z += wobble(traits, 2, this.#time) * scale;
    }
    return out;
  }

  /** The radius node `index` would be drawn at now without its prominence, before visibility. */
  baseRadius(index: number): number {
    return this.radius.values[index] ?? 0;
  }

  /**
   * The radius node `index` is drawn (and picked) at now, before visibility: a
   * prominent note grows by up to 1.4 times. Ordinary notes keep their radius,
   * so the no-overlap rule holds for them; a prominent one is drawn on top.
   */
  drawnRadius(index: number): number {
    return this.baseRadius(index) * prominentGrowth(this.grow.values[index] ?? 0);
  }

  styleOf(index: number, channel: number): number {
    return this.style.values[index * 4 + channel] ?? 0;
  }

  /**
   * Notes entering the view rise together: each grows in on an expo-out ease,
   * waiting in proportion to its distance from the group's centroid.
   */
  rise(indices: ReadonlyArray<number>, now: number): void {
    const delays = riseDelays(this.rest, indices);
    indices.forEach((index, position) => {
      this.style.setValue(index, StyleChannel.visibility, 0);
      this.#rising.set(index, { start: now, delay: delays[position] ?? 0 });
    });
    this.styleTexture.needsUpdate = true;
  }

  /** A node leaving the view stops rising and fades out on its spring. */
  cancelRise(index: number): void {
    this.#rising.delete(index);
  }

  isRising(index: number): boolean {
    return this.#rising.has(index);
  }

  /** Take new homes at once; the caller glides the change away with `glideFrom`. */
  setRest(positions: Float32Array): void {
    this.rest.set(positions.subarray(0, this.count * 3));
    this.writePositions();
  }

  /** Where every node is drawn now, to glide from after the homes or targets change. */
  snapshot(): Float32Array {
    const at = new Vector3();
    const drawn = new Float32Array(this.count * 3);
    for (let index = 0; index < this.count; index += 1) {
      this.current(index, at);
      drawn[index * 3] = at.x;
      drawn[index * 3 + 1] = at.y;
      drawn[index * 3 + 2] = at.z;
    }
    return drawn;
  }

  /** Where every node is drawn now, pushed out from (or in toward) their centroid by `factor`: a bench's start. */
  scaledSnapshot(factor: number): Float32Array {
    const drawn = this.snapshot();
    const centre = [0, 0, 0];
    for (let index = 0; index < this.count; index += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        centre[axis] =
          (centre[axis] ?? 0) + (drawn[index * 3 + axis] ?? 0) / Math.max(this.count, 1);
      }
    }
    for (let index = 0; index < this.count; index += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const at = index * 3 + axis;
        const middle = centre[axis] ?? 0;
        drawn[at] = middle + ((drawn[at] ?? 0) - middle) * factor;
      }
    }
    return drawn;
  }

  /**
   * Switch layouts without a jump or a crawl: every spring snaps to its new
   * target and each node glides from where it was drawn (`from`) to its new
   * place on one eased curve. A glide is a change of view, not a transition
   * in the reading, so nothing drifts after it.
   */
  glideFrom(from: Float32Array, now: number): void {
    this.offsets.settle();
    const delta = new Float32Array(this.count * 3);
    const at = new Vector3();
    this.#glide = null;
    for (let index = 0; index < this.count; index += 1) {
      this.current(index, at);
      // A slot with no starting point (NaN, or none given) starts where it is: no glide.
      const x = from[index * 3] ?? Number.NaN;
      if (Number.isNaN(x)) continue;
      delta[index * 3] = x - at.x;
      delta[index * 3 + 1] = (from[index * 3 + 1] ?? at.y) - at.y;
      delta[index * 3 + 2] = (from[index * 3 + 2] ?? at.z) - at.z;
    }
    this.#glide = { delta, start: now };
    this.writePositions();
  }

  /** Advance everything by `dt` at clock `now` (seconds); returns whether anything still moves. */
  step(dt: number, now: number): boolean {
    this.#time = now;
    const moving =
      !this.offsets.settled ||
      !this.radius.settled ||
      !this.prominence.settled ||
      !this.grow.settled ||
      this.#glide !== null;
    if (this.#glide !== null && now - this.#glide.start >= GLIDE_SECONDS) this.#glide = null;
    const styling = !this.style.settled || this.#rising.size > 0;
    this.offsets.step(dt);
    this.radius.step(dt);
    this.style.step(dt);
    this.prominence.step(dt);
    this.grow.step(dt);
    for (const [index, rise] of this.#rising) {
      const amount = riseAmount(now - rise.start, rise.delay);
      this.style.setValue(index, StyleChannel.visibility, amount);
      if (amount >= 1) this.#rising.delete(index);
    }
    if (moving) this.writePositions();
    if (styling) this.styleTexture.needsUpdate = true;
    return !this.settled;
  }

  /** Snap every spring and ease to its end and upload: nothing drifts afterwards. */
  settle(): void {
    this.#glide = null;
    this.offsets.settle();
    this.radius.settle();
    this.style.settle();
    this.prominence.settle();
    this.grow.settle();
    this.#rising.clear();
    this.writePositions();
    this.styleTexture.needsUpdate = true;
  }

  writePositions(): void {
    const data = this.#positionData;
    const at = new Vector3();
    for (let index = 0; index < this.count; index += 1) {
      this.current(index, at);
      data[index * 4] = at.x;
      data[index * 4 + 1] = at.y;
      data[index * 4 + 2] = at.z;
      data[index * 4 + 3] = this.drawnRadius(index);
    }
    this.positionTexture.needsUpdate = true;
  }

  dispose(): void {
    this.positionTexture.dispose();
    this.styleTexture.dispose();
  }
}

function dataTexture(data: Float32Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
