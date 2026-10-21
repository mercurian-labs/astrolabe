/**
 * Per-edge visibility and attention, eased with the dictionary's asymmetric
 * rates. An edge within 5e-4 of its target snaps and stops costing anything.
 * The edges that can show anything (lit, or easing in or out) are kept as a
 * set, so renderers draw only those: at rest with nothing lit, no edge work.
 */
import { easeAttention } from "../layout/motion.ts";

export class EdgeStyle {
  readonly count: number;
  /** Visibility and attention per edge: the `aStyle` attribute's array. */
  readonly values: Float32Array;
  readonly #targets: Float32Array;
  readonly #active = new Set<number>();
  readonly #lit = new Set<number>();

  constructor(count: number) {
    this.count = count;
    this.values = new Float32Array(count * 2);
    this.#targets = new Float32Array(count * 2);
  }

  get settled(): boolean {
    return this.#active.size === 0;
  }

  /** The edges with visibility and attention both above 0, now or where they are headed. */
  get lit(): ReadonlySet<number> {
    return this.#lit;
  }

  /** Whether edge `index` shows anything now or will once eased. */
  #mayShow(index: number): boolean {
    const at = index * 2;
    const visible = Math.max(this.values[at] ?? 0, this.#targets[at] ?? 0);
    const attention = Math.max(this.values[at + 1] ?? 0, this.#targets[at + 1] ?? 0);
    return visible > 0 && attention > 0;
  }

  #relight(index: number): void {
    if (this.#mayShow(index)) this.#lit.add(index);
    else this.#lit.delete(index);
  }

  setTarget(index: number, visibility: number, attention: number): void {
    this.#targets[index * 2] = visibility;
    this.#targets[index * 2 + 1] = attention;
    if (this.values[index * 2] !== visibility || this.values[index * 2 + 1] !== attention) {
      this.#active.add(index);
    }
    this.#relight(index);
  }

  /** Edge slot `index` holds nothing, or a new edge: dark and at rest. */
  clear(index: number): void {
    this.values[index * 2] = 0;
    this.values[index * 2 + 1] = 0;
    this.#targets[index * 2] = 0;
    this.#targets[index * 2 + 1] = 0;
    this.#active.delete(index);
    this.#lit.delete(index);
  }

  /** Take up `old`'s edges after a renumbering: slot `slot` carries `old`'s `from[slot]` (-1 for none). */
  carry(old: EdgeStyle, from: Int32Array): void {
    from.forEach((source, slot) => {
      if (source < 0 || slot >= this.count || source >= old.count) return;
      for (let channel = 0; channel < 2; channel += 1) {
        this.values[slot * 2 + channel] = old.values[source * 2 + channel] ?? 0;
        this.#targets[slot * 2 + channel] = old.#targets[source * 2 + channel] ?? 0;
      }
      if (old.#active.has(source)) this.#active.add(slot);
      this.#relight(slot);
    });
  }

  settle(): void {
    this.values.set(this.#targets);
    for (const index of this.#active) this.#relight(index);
    this.#active.clear();
  }

  /** Advance by `dt` seconds; returns whether any edge is still easing. */
  step(dt: number): boolean {
    for (const index of this.#active) {
      let resting = true;
      for (let channel = 0; channel < 2; channel += 1) {
        const at = index * 2 + channel;
        const target = this.#targets[at] ?? 0;
        const next = easeAttention(this.values[at] ?? 0, target, dt);
        this.values[at] = next;
        if (next !== target) resting = false;
      }
      if (resting) {
        this.#active.delete(index);
        this.#relight(index);
      }
    }
    return this.#active.size > 0;
  }
}
