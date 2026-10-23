/**
 * The home layout every renderer draws from: settled by forces up to
 * FORCE_LAYOUT_LIMIT notes, placed procedurally past it, nested by
 * containment when the memory is a tree, and cached.
 */
import type { LayoutForces } from "../model/settings.ts";
import type { Universe } from "../model/universe.ts";
import { layoutUniverse, type GraphLayout } from "./forceLayout.ts";
import { FORCE_LAYOUT_LIMIT, proceduralLayout } from "./proceduralLayout.ts";
import { treeLayout } from "./treeLayout.ts";

/**
 * The home layout for `universe`: the force layout while it is small enough to
 * settle on the main thread (the flat one seeded from the spatial one, which
 * `seed` supplies), else the procedural placement.
 */
export function homeLayout(
  universe: Universe,
  forces: LayoutForces,
  dimensions: 2 | 3,
  seed: (dimensions: 3) => GraphLayout,
): GraphLayout {
  // A containment tree (a codebase) lays each note inside its container.
  if (universe.tree) {
    return treeLayout(universe, forces, dimensions, universe.nodes.length > FORCE_LAYOUT_LIMIT);
  }
  if (universe.nodes.length > FORCE_LAYOUT_LIMIT)
    return proceduralLayout(universe, forces, dimensions);
  return layoutUniverse(universe, forces, dimensions, dimensions === 2 ? seed(3) : undefined);
}

/**
 * Layouts cached by universe, dimensions, and forces. Positions never change
 * between checkpoints because the universe holds everything a thread reaches.
 */
export class LayoutCache {
  /** Dragging a force slider solves many layouts; only the recent few are kept per universe. */
  static readonly LIMIT = 8;
  /**
   * Keyed by the universe object, not its key: a memory handed over again under
   * the same id with different notes is a new universe and solves anew.
   */
  readonly #entries = new WeakMap<Universe, Map<string, GraphLayout>>();

  get(universe: Universe, forces: LayoutForces, dimensions: 2 | 3): GraphLayout {
    const key = `${dimensions}|${forces.centerForce}/${forces.repelForce}/${forces.linkDistance}`;
    let layouts = this.#entries.get(universe);
    if (layouts === undefined) {
      layouts = new Map();
      this.#entries.set(universe, layouts);
    }
    const cached = layouts.get(key);
    if (cached !== undefined) return cached;
    const layout = homeLayout(universe, forces, dimensions, (seedDimensions) =>
      this.get(universe, forces, seedDimensions),
    );
    layouts.set(key, layout);
    for (const old of layouts.keys()) {
      if (layouts.size <= LayoutCache.LIMIT) break;
      layouts.delete(old);
    }
    return layout;
  }
}
