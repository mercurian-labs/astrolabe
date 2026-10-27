/**
 * Everything here is a pure function of a node's index and time, or a small state machine that
 * reports when it has settled, so the render loop can sleep the moment nothing moves. A travelling
 * node's wobble is zero at both ends, so a landed node reads exactly its target; a node whose
 * target did not change never moves.
 */

/** A deterministic value in [0, 1) from any number. */
export function hash01(x: number): number {
  const t = 43758.5453 * Math.sin(127.1 * x + 311.7);
  return t - Math.floor(t);
}

export const expoOut = (t: number) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - 2 ** (-10 * t));

export const SPRING_DAMPING = 17;
/** Frame times longer than this are clamped, so a returning tab does not explode the springs. */
export const MAX_SPRING_DT = 0.05;
export const RISE_SECONDS = 1.5;
export const RISE_STAGGER_SECONDS = 0.9;
export const LANDING_SECONDS = 4;

/** A node's fixed personality: how stiff its spring and how it wobbles. */
export interface NodeTraits {
  /** Spring stiffness, 19–78. */
  readonly stiffness: number;
  /** Per-axis wobble amplitude in layout units, 1.35–4.65. */
  readonly amplitude: readonly [number, number, number];
  /** Per-axis wobble frequency in rad/s, 0.114–0.334. */
  readonly omega: readonly [number, number, number];
  readonly phase: readonly [number, number, number];
}

export function nodeTraits(index: number): NodeTraits {
  const base = 2.39996 * index;
  const perAxis = (fn: (slot: number) => number) =>
    [fn(3 * index), fn(3 * index + 1), fn(3 * index + 2)] as const;
  return {
    stiffness: 42 * (0.45 + 1.4 * hash01(index + 0.5)),
    amplitude: perAxis((slot) => 3 * (0.45 + 1.1 * hash01(slot + 7.1))),
    omega: perAxis((slot) => 0.19 * (0.6 + 1.1 * hash01(slot + 13.3))),
    phase: perAxis((slot) => base + 2 * Math.PI * hash01(slot)),
  };
}

/** The two-sine wobble on one axis at time `t` seconds, in layout units. */
export function wobble(traits: NodeTraits, axis: 0 | 1 | 2, t: number): number {
  const omega = traits.omega[axis];
  const phase = traits.phase[axis];
  return (
    traits.amplitude[axis] *
    (0.7 * Math.sin(omega * t + phase) + 0.3 * Math.sin(2.3 * omega * t + 1.7 * phase))
  );
}

/** A journey shorter than this, in layout units, does not wobble at all. */
export const DRIFT_GAP = 2;

/**
 * How strongly a travelling node wobbles, 0 to 1, from its progress (0 setting off, 1 arrived) and
 * journey length in layout units. It is 0 at both ends so the wobble never kicks in or cuts out,
 * and a short hop does not wobble.
 */
export function travelDrift(progress: number, journey: number): number {
  if (journey < DRIFT_GAP || progress <= 0 || progress >= 1) return 0;
  return Math.sin(Math.PI * progress);
}

/**
 * Per-node springs over three axes, stepped by semi-implicit Euler:
 * `v += ((target − x) k − 17 v) dt; x += v dt`. A spring at rest leaves the
 * active set and holds exactly its target, so a settled field costs nothing;
 * aiming it again at the target it holds leaves it at rest.
 */
export class NodeSprings {
  readonly count: number;
  readonly values: Float32Array;
  readonly targets: Float32Array;
  readonly #velocities: Float32Array;
  readonly #stiffness: Float32Array;
  /** Each travelling node's journey length: how far its target was when it set off, or as if it had. */
  readonly #journey: Float32Array;
  readonly #active = new Set<number>();
  #tolerance: number;

  /**
   * @param stiffness  per-node stiffness
   * @param tolerance  distance and speed under which a spring is at rest and snaps
   */
  constructor(stiffness: ArrayLike<number>, tolerance = 0.05) {
    this.count = stiffness.length;
    this.values = new Float32Array(this.count * 3);
    this.targets = new Float32Array(this.count * 3);
    this.#velocities = new Float32Array(this.count * 3);
    this.#stiffness = Float32Array.from(stiffness);
    this.#journey = new Float32Array(this.count);
    this.#tolerance = tolerance;
  }

  get settled(): boolean {
    return this.#active.size === 0;
  }

  /** Whether node `index`'s spring is moving. */
  isActive(index: number): boolean {
    return this.#active.has(index);
  }

  /**
   * Rescale the rest threshold with the layout. At rest within 0.05 unit (well
   * under a pixel at any zoom), so the softest, overdamped springs stop
   * crawling within about five seconds.
   */
  setScale(unit: number): void {
    this.#tolerance = 0.05 * unit;
  }

  /**
   * Aim node `index` at `target`. The targets are float32, so the comparison is
   * made at float32: a target that rounds to the one held is no change, and a
   * spring at rest stays at rest.
   */
  setTarget(index: number, target: ArrayLike<number>): void {
    const progress = this.progressOf(index);
    let changed = false;
    for (let axis = 0; axis < 3; axis += 1) {
      const at = index * 3 + axis;
      const value = Math.fround(target[axis] ?? 0);
      if (this.targets[at] === value) continue;
      this.targets[at] = value;
      changed = true;
    }
    if (!changed) return;
    // The journey starts here, or carries on from as far along as the node
    // already was, so its wobble goes on without a jump.
    const gap = this.#gap(index);
    const along = this.#active.has(index) && progress < 1 ? progress : 0;
    this.#journey[index] = gap / (1 - along);
    this.#active.add(index);
  }

  #gap(index: number): number {
    const at = index * 3;
    return Math.hypot(
      (this.targets[at] ?? 0) - (this.values[at] ?? 0),
      (this.targets[at + 1] ?? 0) - (this.values[at + 1] ?? 0),
      (this.targets[at + 2] ?? 0) - (this.values[at + 2] ?? 0),
    );
  }

  /** How far along its journey node `index` is: 0 setting off, 1 arrived (and at rest). */
  progressOf(index: number): number {
    const journey = this.#journey[index] ?? 0;
    if (!this.#active.has(index) || journey <= 0) return 1;
    return Math.max(0, Math.min(1, 1 - this.#gap(index) / journey));
  }

  /** How long node `index`'s journey is; 0 at rest. */
  journeyOf(index: number): number {
    return this.#active.has(index) ? (this.#journey[index] ?? 0) : 0;
  }

  /** A fresh node in slot `index`: at rest at 0, with stiffness `stiffness`. */
  reset(index: number, stiffness: number): void {
    for (let axis = 0; axis < 3; axis += 1) {
      const at = index * 3 + axis;
      this.values[at] = 0;
      this.targets[at] = 0;
      this.#velocities[at] = 0;
    }
    this.#stiffness[index] = stiffness;
    this.#journey[index] = 0;
    this.#active.delete(index);
  }

  /** Take up `old`'s springs after a renumbering: slot `slot` carries `old`'s `from[slot]` (-1 for none). */
  carry(old: NodeSprings, from: Int32Array): void {
    from.forEach((source, slot) => {
      if (source < 0 || slot >= this.count || source >= old.count) return;
      for (let axis = 0; axis < 3; axis += 1) {
        this.values[slot * 3 + axis] = old.values[source * 3 + axis] ?? 0;
        this.targets[slot * 3 + axis] = old.targets[source * 3 + axis] ?? 0;
        this.#velocities[slot * 3 + axis] = old.#velocities[source * 3 + axis] ?? 0;
      }
      this.#stiffness[slot] = old.#stiffness[source] ?? 42;
      this.#journey[slot] = old.#journey[source] ?? 0;
      if (old.#active.has(source)) this.#active.add(slot);
    });
  }

  /** Put a spring somewhere at once, keeping its target: it springs back from there. */
  displace(index: number, value: ArrayLike<number>): void {
    for (let axis = 0; axis < 3; axis += 1) {
      this.values[index * 3 + axis] = value[axis] ?? 0;
      this.#velocities[index * 3 + axis] = 0;
    }
    this.#active.add(index);
  }

  /** Hold a spring at a value: value, target, and rest at once (a drag). */
  hold(index: number, value: ArrayLike<number>): void {
    for (let axis = 0; axis < 3; axis += 1) {
      const at = index * 3 + axis;
      this.values[at] = value[axis] ?? 0;
      this.targets[at] = value[axis] ?? 0;
      this.#velocities[at] = 0;
    }
    this.#active.delete(index);
  }

  settle(): void {
    this.values.set(this.targets);
    this.#velocities.fill(0);
    this.#active.clear();
  }

  /** Advance by `dt` seconds (clamped). Returns whether any spring is still moving. */
  step(dt: number): boolean {
    const h = Math.min(Math.max(dt, 0), MAX_SPRING_DT);
    for (const index of this.#active) {
      const k = this.#stiffness[index] ?? 42;
      let resting = true;
      for (let axis = 0; axis < 3; axis += 1) {
        const at = index * 3 + axis;
        const target = this.targets[at] ?? 0;
        let x = this.values[at] ?? 0;
        let v = this.#velocities[at] ?? 0;
        v += ((target - x) * k - SPRING_DAMPING * v) * h;
        x += v * h;
        if (Math.abs(x - target) > this.#tolerance || Math.abs(v) > this.#tolerance)
          resting = false;
        this.values[at] = x;
        this.#velocities[at] = v;
      }
      if (resting) {
        for (let axis = 0; axis < 3; axis += 1) {
          this.values[index * 3 + axis] = this.targets[index * 3 + axis] ?? 0;
          this.#velocities[index * 3 + axis] = 0;
        }
        this.#active.delete(index);
      }
    }
    return this.#active.size > 0;
  }
}

/**
 * Stagger for notes rising together: each waits in proportion to its distance
 * from the group's centroid, up to 0.9 s, so the group opens outward.
 */
export function riseDelays(positions: Float32Array, indices: ReadonlyArray<number>): Array<number> {
  if (indices.length === 0) return [];
  const centroid = [0, 0, 0];
  for (const index of indices) {
    for (let axis = 0; axis < 3; axis += 1) {
      centroid[axis] = (centroid[axis] ?? 0) + (positions[index * 3 + axis] ?? 0) / indices.length;
    }
  }
  const distances = indices.map((index) =>
    Math.hypot(
      (positions[index * 3] ?? 0) - (centroid[0] ?? 0),
      (positions[index * 3 + 1] ?? 0) - (centroid[1] ?? 0),
      (positions[index * 3 + 2] ?? 0) - (centroid[2] ?? 0),
    ),
  );
  const farthest = Math.max(...distances);
  return distances.map((distance) =>
    farthest > 0 ? (RISE_STAGGER_SECONDS * distance) / farthest : 0,
  );
}

/** Rise progress `elapsed` seconds after a rise began, given its stagger delay. */
export const riseAmount = (elapsed: number, delay: number) =>
  expoOut((elapsed - delay) / RISE_SECONDS);

/** Edges ease toward their attention with these time constants (seconds): lit in, dimmed out. */
export const ATTENTION_RISE_TAU = 0.07;
export const ATTENTION_FALL_TAU = 0.08;
/** Within this of its target an edge's attention snaps there: under one 8-bit step. */
export const ATTENTION_SNAP = 2e-3;

/**
 * Attention easing for edges: exponential toward the target, so a hover's
 * edges light or dim fully within half a second, then snap and stop.
 */
export function easeAttention(current: number, target: number, dt: number): number {
  const tau = target > current ? ATTENTION_RISE_TAU : ATTENTION_FALL_TAU;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(dt, 0) / tau));
  return Math.abs(next - target) < ATTENTION_SNAP ? target : next;
}

export const WAVE_SECONDS = 3;

/** The landing wave's envelope `pulse` seconds after it started, for an edge's seed. */
export const waveEnvelope = (pulse: number, seed: number) => Math.exp(-pulse * (1.5 + 0.8 * seed));
