/**
 * The thread's reading, gathered: for each checkpoint, the notes the reading
 * shows are drawn into a cluster that grows from the previous checkpoint's.
 * Checkpoint k needs k−1's cluster, so checkpoints are gathered in order and
 * cached; jumping to k walks 0..k once. A pick never regathers: it lights
 * and grows notes where they stand.
 */
import type { Memory } from "../model/memory.ts";
import { closedKey } from "../model/level.ts";
import { readingAt, type Reading } from "../model/reading.ts";
import type { GraphFilters } from "../model/search.ts";
import type { GraphSettings } from "../model/settings.ts";
import type { ThreadRecord } from "../model/thread.ts";
import type { Universe } from "../model/universe.ts";
import { deriveView, viewDegree, type ReadingView } from "../model/view.ts";
import { layoutSpan, shownRadius, type GraphLayout } from "./forceLayout.ts";
import { gather, type Gathering, type Point } from "./gathering.ts";

export interface GatherContext {
  readonly memory: Memory;
  readonly thread: ThreadRecord;
  readonly universe: Universe;
  /** The homes: the spatial or the flat layout. */
  readonly layout: GraphLayout;
  readonly settings: Pick<GraphSettings, "depth" | "nodeSize" | "linkDistance">;
  readonly thisTurnOnly: boolean;
  readonly filters: GraphFilters;
  /**
   * The level each checkpoint lands at, in a containment tree: its closed
   * containers from its reading (the span rule). `key` names what the levels
   * depend on (the frame's capacity), so a different one gathers anew.
   */
  readonly level?: {
    readonly key: string;
    readonly closedAt: (reading: Reading) => ReadonlySet<number>;
  };
}

/**
 * The reading's view at a checkpoint, as the gathering sees it: members and
 * links only, at `closed` (else the checkpoint's own level).
 */
function readingView(context: GatherContext, checkpoint: number, closed?: ReadonlySet<number>) {
  const reading = readingAt(context.memory, context.thread, checkpoint, {
    depth: context.settings.depth,
    thisTurnOnly: context.thisTurnOnly,
  });
  const level = closed ?? context.level?.closedAt(reading);
  return deriveView({
    universe: context.universe,
    lenses: context.memory.lenses,
    shownLensSlots: [],
    reading,
    whole: false,
    pickedId: null,
    depth: context.settings.depth,
    filters: context.filters,
    ...(level === undefined ? {} : { closed: level }),
  });
}

/**
 * A seed for gathering `view` from `from`: everything gathered before stands
 * where it stood, and a note that only now shows (its container opened)
 * starts where the nearest container above it stood, so it unfolds from there.
 */
function unfoldFrom(
  universe: GatherContext["universe"],
  from: Gathering,
  view: ReadingView,
): Gathering {
  const positions = new Map(from.positions);
  // A container that closes starts where its members stood, at their middle.
  const folded = new Map<number, Array<Point>>();
  for (const [member, holder] of view.holders) {
    const stood = from.positions.get(member);
    if (stood === undefined || positions.has(holder)) continue;
    folded.set(holder, [...(folded.get(holder) ?? []), stood]);
  }
  for (const [holder, points] of folded) {
    const middle = [0, 1, 2].map(
      (axis) => points.reduce((sum, point) => sum + (point[axis] ?? 0), 0) / points.length,
    );
    positions.set(holder, [middle[0] ?? 0, middle[1] ?? 0, middle[2] ?? 0]);
  }
  for (const index of view.nodes) {
    if (positions.has(index)) continue;
    for (let up = universe.parentOf[index] ?? -1; up >= 0; up = universe.parentOf[up] ?? -1) {
      const stood = from.positions.get(up);
      if (stood !== undefined) {
        positions.set(index, stood);
        break;
      }
    }
  }
  return { positions, centre: from.centre };
}

function gatherView(context: GatherContext, view: ReadingView, seed: Gathering | null): Gathering {
  const members = [...view.nodes];
  const links: Array<readonly [number, number]> = [];
  for (const index of view.edges) {
    const edge = context.universe.edges[index];
    if (edge !== undefined && !edge.lensOnly) links.push([edge.a, edge.b]);
  }
  const { nodeSize, linkDistance } = context.settings;
  // Gathered at the home layout's density: the reading's notes sit as far apart as they do at home.
  const spacing = layoutSpan(context.layout, linkDistance);
  return gather({
    homes: context.layout.positions,
    members,
    links,
    radius: (index) =>
      shownRadius(viewDegree(view, view.nodeAt.get(index) ?? -1), nodeSize, spacing),
    previous: seed,
    spacing,
    dimensions: context.layout.dimensions,
    ...(context.universe.tree ? { parentOf: context.universe.parentOf } : {}),
  });
}

export class GatheringCache {
  /** Keyed by the layout (one per universe, forces, and dimensions), then by the reading's options. */
  readonly #entries = new WeakMap<GraphLayout, Map<string, Array<Gathering>>>();

  #chain(context: GatherContext): Array<Gathering> {
    let byOptions = this.#entries.get(context.layout);
    if (byOptions === undefined) {
      byOptions = new Map();
      this.#entries.set(context.layout, byOptions);
    }
    const { filters, settings } = context;
    const key = [
      context.thread.id,
      settings.depth,
      settings.nodeSize,
      context.thisTurnOnly,
      filters.search.trim().toLocaleLowerCase(),
      filters.hideFrontier,
      filters.hideOrphans,
      context.level?.key ?? "",
    ].join("|");
    let chain = byOptions.get(key);
    if (chain === undefined) {
      chain = [];
      byOptions.set(key, chain);
      // Filters change with every keystroke; keep only the recent few.
      for (const old of byOptions.keys()) {
        if (byOptions.size <= 8) break;
        byOptions.delete(old);
      }
    }
    return chain;
  }

  /** Gatherings at a level the reader drilled to, by checkpoint and closed set: the recent few. */
  readonly #drilled = new WeakMap<Array<Gathering>, Map<string, Gathering>>();

  /**
   * The cluster at `checkpoint`, gathering every earlier checkpoint first if
   * needed. `closed`, when the reader has drilled away from the checkpoint's
   * own level, gathers that level from the checkpoint's: what stays stands,
   * what opens unfolds from where its container stood.
   */
  at(context: GatherContext, checkpoint: number, closed?: ReadonlySet<number>): Gathering {
    const last = Math.max(0, Math.min(checkpoint, context.thread.turns.length - 1));
    const chain = this.#chain(context);
    for (let step = chain.length; step <= last; step += 1) {
      chain.push(gatherView(context, readingView(context, step), chain[step - 1] ?? null));
    }
    const gathering = chain[last];
    if (gathering === undefined) throw new Error("gathering chain is shorter than its checkpoint");
    if (closed === undefined) return gathering;
    let drilledHere = this.#drilled.get(chain);
    if (drilledHere === undefined) {
      drilledHere = new Map();
      this.#drilled.set(chain, drilledHere);
    }
    const key = `${last}|${closedKey(closed)}`;
    const known = drilledHere.get(key);
    if (known !== undefined) return known;
    const view = readingView(context, last, closed);
    const drilled = gatherView(context, view, unfoldFrom(context.universe, gathering, view));
    drilledHere.set(key, drilled);
    for (const old of drilledHere.keys()) {
      if (drilledHere.size <= 8) break;
      drilledHere.delete(old);
    }
    return drilled;
  }
}
