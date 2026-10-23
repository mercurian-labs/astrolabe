/**
 * Critically damped springs over a flat array of values: node offsets (three
 * values per node), or style channels (one per node). A spring reaches its
 * target without overshoot, and once within tolerance it snaps to the target
 * and leaves the active set, so a settled field costs nothing per frame.
 *
 * Each step uses the closed-form solution, so it is stable for any frame time.
 */
export class SpringField {
  readonly count: number;
  readonly width: number;
  readonly omega: number;
  readonly tolerance: number;
  readonly values: Float32Array;
  readonly targets: Float32Array;
  readonly #velocities: Float32Array;
  readonly #active = new Set<number>();

  /**
   * @param count  how many springs
   * @param width  values per spring (3 for an offset, 1 for a scalar)
   * @param omega  stiffness as angular frequency; ~4/omega seconds to settle
   * @param tolerance  distance under which a spring is at rest (and speed, per unit of omega)
   */
  constructor(count: number, width: number, omega: number, tolerance = 1e-3) {
    this.count = count;
    this.width = width;
    this.omega = omega;
    this.tolerance = tolerance;
    this.values = new Float32Array(count * width);
    this.targets = new Float32Array(count * width);
    this.#velocities = new Float32Array(count * width);
  }

  get settled(): boolean {
    return this.#active.size === 0;
  }

  get activeCount(): number {
    return this.#active.size;
  }

  /**
   * Aim spring `index` at a target; it moves only if the target differs. The
   * targets are float32, so the comparison is made at float32: a target that
   * rounds to the one held is no change, and a spring at rest stays at rest.
   */
  setTarget(index: number, target: ArrayLike<number>): void {
    let moved = false;
    for (let k = 0; k < this.width; k += 1) {
      const value = Math.fround(target[k] ?? 0);
      const at = index * this.width + k;
      if (this.targets[at] === value) continue;
      this.targets[at] = value;
      moved = true;
    }
    if (moved) this.#active.add(index);
  }

  setScalarTarget(index: number, target: number): void {
    this.setTarget(index, [target]);
  }

  /** Put spring `index` somewhere at once, keeping its target: it springs back from there. */
  displace(index: number, value: ArrayLike<number>): void {
    for (let k = 0; k < this.width; k += 1) {
      this.values[index * this.width + k] = value[k] ?? 0;
      this.#velocities[index * this.width + k] = 0;
    }
    this.#active.add(index);
  }

  /**
   * Drive one channel of spring `index` from outside (an eased rise): its value
   * is set and its velocity cleared, so the spring takes over from rest there.
   */
  setValue(index: number, channel: number, value: number): void {
    const at = index * this.width + channel;
    this.values[at] = value;
    this.#velocities[at] = 0;
    if (Math.abs((this.targets[at] ?? 0) - value) > this.tolerance) this.#active.add(index);
  }

  /** Put spring `index` at a value and hold it there: value, target, and rest at once. */
  hold(index: number, value: ArrayLike<number>): void {
    for (let k = 0; k < this.width; k += 1) {
      const at = index * this.width + k;
      this.values[at] = value[k] ?? 0;
      this.targets[at] = value[k] ?? 0;
      this.#velocities[at] = 0;
    }
    this.#active.delete(index);
  }

  /**
   * Take up the springs of `old` after its slots were renumbered: spring
   * `slot` carries `old`'s spring `from[slot]`, value, target, speed, and all;
   * a slot with none (-1) starts at rest at 0.
   */
  carry(old: SpringField, from: Int32Array): void {
    const width = this.width;
    from.forEach((source, slot) => {
      if (source < 0 || slot >= this.count || source >= old.count) return;
      for (let k = 0; k < width; k += 1) {
        this.values[slot * width + k] = old.values[source * width + k] ?? 0;
        this.targets[slot * width + k] = old.targets[source * width + k] ?? 0;
        this.#velocities[slot * width + k] = old.#velocities[source * width + k] ?? 0;
      }
      if (old.#active.has(source)) this.#active.add(slot);
    });
  }

  /** Snap every spring to its target. */
  settle(): void {
    this.values.set(this.targets);
    this.#velocities.fill(0);
    this.#active.clear();
  }

  /** Advance the active springs by `dt` seconds; returns whether any is still moving. */
  step(dt: number): boolean {
    const omega = this.omega;
    const decay = Math.exp(-omega * dt);
    for (const index of this.#active) {
      let resting = true;
      for (let k = 0; k < this.width; k += 1) {
        const at = index * this.width + k;
        const target = this.targets[at] ?? 0;
        const offset = (this.values[at] ?? 0) - target;
        const velocity = this.#velocities[at] ?? 0;
        // x(t) = (x0 + (v0 + ω x0) t) e^(-ωt); v(t) = (v0 - ω (v0 + ω x0) t) e^(-ωt)
        const c = velocity + omega * offset;
        const nextOffset = (offset + c * dt) * decay;
        const nextVelocity = (velocity - omega * c * dt) * decay;
        // At rest within `tolerance`, and moving slower than it would cover that in 1/ω.
        if (
          Math.abs(nextOffset) > this.tolerance ||
          Math.abs(nextVelocity) > this.tolerance * omega
        ) {
          resting = false;
          this.values[at] = target + nextOffset;
          this.#velocities[at] = nextVelocity;
        } else {
          this.values[at] = target;
          this.#velocities[at] = 0;
        }
      }
      if (resting) this.#active.delete(index);
    }
    return this.#active.size > 0;
  }
}
