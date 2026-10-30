import type { NodeShape } from "./kinds.ts";

/**
 * A memory as the Atlas Graph reads it: notes, the wikilinks between them, and
 * the skill maps that can be laid over them as lenses. This is the shape of the
 * fixtures and of whatever index a host hands the graph.
 */

/** What a note is, when the memory is a codebase; absent for a vault's notes. */
export type NoteKind =
  | "folder"
  | "package"
  | "file"
  | "class"
  | "interface"
  | "enum"
  | "type"
  | "function"
  | "method"
  | "constant";

/** What a link means, when the memory is a codebase; absent for a vault's wikilinks. */
export type LinkKind =
  | "calls"
  | "instantiates"
  | "references"
  | "imports"
  | "exports"
  | "inherits"
  | "implements"
  | "overrides"
  /** Data flow: a function takes the type as a parameter (from the function, to the type). */
  | "accepts"
  /** Data flow: a function gives the type back (from the function, to the type). */
  | "returns"
  /** Failure flow: a function raises the error type (from the function, to the error type). */
  | "throws"
  /** Failure flow: a function handles the error type (from the function, to the error type). */
  | "catches";

/** How surely a codebase's link was resolved to its target. */
export type LinkResolution = "exact" | "overload" | "heuristic";

export interface MemoryNote {
  /** The note's name is its identity. */
  readonly id: string;
  readonly name: string;
  /** A red link: a name referenced but never written. */
  readonly frontier: boolean;
  /** ISO date of the note's last change, when the index knows it. */
  readonly lastChanged?: string;
  /**
   * A hint for laying out large memories: notes of one group settle together
   * (a vault's folder, a synthetic memory's cluster). Small memories ignore it.
   * When `parent` is set, it supersedes `group`.
   */
  readonly group?: string;
  /** What the note is, in a codebase. */
  readonly kind?: NoteKind;
  /** How it draws, in place of its kind's shape: a local graph's workspace package is a square. */
  readonly shape?: NodeShape;
  /** A codebase symbol's declaration line, as written ("function f(a: A): B"). */
  readonly signature?: string;
  /** A codebase symbol's doc comment, plain text; paragraphs split by a blank line. */
  readonly doc?: string;
  /**
   * The id of the note that contains this one: method → class; class,
   * interface, enum, type, function, constant → file; file → folder; folder →
   * folder (root folders have none). A note that is some note's parent is a
   * container. Containment is never a link.
   */
  readonly parent?: string;
}

/**
 * One wikilink, from the note that writes it to the note it names. In a
 * codebase: a use or polymorphism edge, one per directed pair per kind (the
 * graph still draws one edge per pair; the kind is for lenses, styling, and
 * the popover). Containment and definition are never links.
 */
export interface MemoryLink {
  readonly from: string;
  readonly to: string;
  readonly kind?: LinkKind;
  readonly resolution?: LinkResolution;
}

/** A skill map's edge, typed in the map's own vocabulary. */
export interface LensEdge {
  readonly from: string;
  readonly type: string;
  readonly to: string;
  readonly rationale?: string;
}

/** A skill map: a curated, typed subgraph over the notes. */
export interface MemoryLens {
  readonly name: string;
  /** The map's edge vocabulary: type name to its meaning. */
  readonly types: Readonly<Record<string, string>>;
  readonly edges: ReadonlyArray<LensEdge>;
}

export interface Memory {
  readonly id: string;
  readonly notes: ReadonlyArray<MemoryNote>;
  readonly links: ReadonlyArray<MemoryLink>;
  readonly lenses: ReadonlyArray<MemoryLens>;
}

/** The key of an unordered pair, the same whichever end is named first. */
export const pairKey = (left: string, right: string) =>
  left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;

/** One drawn edge per linked pair; the directions that exist are kept for arrowheads. */
export interface LinkPair {
  readonly key: string;
  /** The lesser id of the two. */
  readonly a: string;
  readonly b: string;
  /** A link a → b exists. */
  readonly forward: boolean;
  /** A link b → a exists. */
  readonly backward: boolean;
}

export interface MemoryIndex {
  readonly notes: ReadonlyArray<MemoryNote>;
  readonly byId: ReadonlyMap<string, MemoryNote>;
  readonly pairs: ReadonlyArray<LinkPair>;
  readonly pairByKey: ReadonlyMap<string, LinkPair>;
  readonly outgoing: ReadonlyMap<string, ReadonlySet<string>>;
  readonly incoming: ReadonlyMap<string, ReadonlySet<string>>;
  /** Distinct notes linked to a note in either direction. */
  readonly neighbors: ReadonlyMap<string, ReadonlySet<string>>;
  /** Size is connectedness: the number of distinct linked notes. */
  readonly degree: ReadonlyMap<string, number>;
  /** Notes with no link in either direction. */
  readonly orphans: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

/** Links from a note to itself, and links naming a note the memory lacks, draw nothing. */
export function indexMemory(
  notes: ReadonlyArray<MemoryNote>,
  links: ReadonlyArray<MemoryLink>,
): MemoryIndex {
  const byId = new Map<string, MemoryNote>();
  for (const note of notes) if (!byId.has(note.id)) byId.set(note.id, note);
  const outgoing = new Map([...byId.keys()].map((id) => [id, new Set<string>()]));
  const incoming = new Map([...byId.keys()].map((id) => [id, new Set<string>()]));
  const neighbors = new Map([...byId.keys()].map((id) => [id, new Set<string>()]));
  const pairs = new Map<string, { a: string; b: string; forward: boolean; backward: boolean }>();
  for (const link of links) {
    if (link.from === link.to || !byId.has(link.from) || !byId.has(link.to)) continue;
    outgoing.get(link.from)?.add(link.to);
    incoming.get(link.to)?.add(link.from);
    neighbors.get(link.from)?.add(link.to);
    neighbors.get(link.to)?.add(link.from);
    const key = pairKey(link.from, link.to);
    const [a, b] = link.from < link.to ? [link.from, link.to] : [link.to, link.from];
    const pair = pairs.get(key) ?? { a, b, forward: false, backward: false };
    if (link.from === a) pair.forward = true;
    else pair.backward = true;
    pairs.set(key, pair);
  }
  const pairList = [...pairs].map(([key, pair]) => ({ key, ...pair }));
  const degree = new Map([...neighbors].map(([id, set]) => [id, set.size]));
  const orphans = new Set([...degree].filter(([, count]) => count === 0).map(([id]) => id));
  return {
    notes: [...byId.values()],
    byId,
    pairs: pairList,
    pairByKey: new Map(pairList.map((pair) => [pair.key, pair])),
    outgoing,
    incoming,
    neighbors,
    degree,
    orphans,
  };
}

export const neighborsOf = (index: MemoryIndex, id: string) => index.neighbors.get(id) ?? EMPTY;

/**
 * The notes within `depth` links of any seed, seeds included: the union of the
 * seeds' local graphs, the way Obsidian's local graph reaches.
 */
export function localGraph(
  neighbors: (id: string) => Iterable<string>,
  seeds: Iterable<string>,
  depth: number,
): Set<string> {
  const reached = new Set(seeds);
  let ring = [...reached];
  for (let step = 0; step < depth && ring.length > 0; step += 1) {
    const next: Array<string> = [];
    for (const id of ring) {
      for (const neighbor of neighbors(id)) {
        if (reached.has(neighbor)) continue;
        reached.add(neighbor);
        next.push(neighbor);
      }
    }
    ring = next;
  }
  return reached;
}

/**
 * A map read through a small change over a large base: reads go to the change
 * first, then the base, so building one costs only the change. Iterating it
 * (the whole memory's view, and nothing per checkpoint) merges once, lazily.
 */
export class OverlayMap<K, V> implements ReadonlyMap<K, V> {
  readonly #base: ReadonlyMap<K, V>;
  readonly #delta: ReadonlyMap<K, V>;
  readonly #removed: ReadonlySet<K>;
  readonly size: number;
  #merged: Map<K, V> | null = null;

  constructor(base: ReadonlyMap<K, V>, delta: ReadonlyMap<K, V>, removed: ReadonlySet<K>) {
    this.#base = base;
    this.#delta = delta;
    this.#removed = removed;
    let size = base.size;
    for (const key of delta.keys()) if (!removed.has(key) && !base.has(key)) size += 1;
    for (const key of removed) if (base.has(key) && !delta.has(key)) size -= 1;
    this.size = size;
  }

  get(key: K): V | undefined {
    if (this.#removed.has(key)) return undefined;
    return this.#delta.has(key) ? this.#delta.get(key) : this.#base.get(key);
  }

  has(key: K): boolean {
    if (this.#removed.has(key)) return false;
    return this.#delta.has(key) || this.#base.has(key);
  }

  #all(): Map<K, V> {
    if (this.#merged === null) {
      const merged = new Map<K, V>();
      for (const [key, value] of this.#base) if (!this.#removed.has(key)) merged.set(key, value);
      for (const [key, value] of this.#delta) if (!this.#removed.has(key)) merged.set(key, value);
      this.#merged = merged;
    }
    return this.#merged;
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    for (const [key, value] of this.#all()) callback(value, key, this);
  }

  entries() {
    return this.#all().entries();
  }

  keys() {
    return this.#all().keys();
  }

  values() {
    return this.#all().values();
  }

  [Symbol.iterator]() {
    return this.#all()[Symbol.iterator]();
  }
}

/** What an index changes to at a moment: some notes hidden or replaced, some links hidden. */
export interface IndexChange {
  /** Notes that do not exist yet: they and every link touching them are gone. */
  readonly hiddenNotes: ReadonlySet<string>;
  /** Notes whose version differs from the base's. */
  readonly notes: ReadonlyMap<string, MemoryNote>;
  /** Links (by `from`, `to`) the base holds that do not stand now. */
  readonly hiddenLinks: ReadonlyArray<MemoryLink>;
}

/**
 * The base index with `change` applied, built in time proportional to the
 * change and the adjacency it touches: only the notes whose links changed
 * get new link sets; everything else reads through to the base. Its lists
 * (`notes`, `pairs`, `orphans`) are computed on first use.
 */
export function overlayIndex(base: MemoryIndex, change: IndexChange): MemoryIndex {
  const { hiddenNotes } = change;
  const hiddenKeys = new Set(change.hiddenLinks.map((link) => `${link.from}\u0000${link.to}`));
  const gone = (from: string, to: string) =>
    hiddenNotes.has(from) || hiddenNotes.has(to) || hiddenKeys.has(`${from}\u0000${to}`);
  // Every note a hidden link or a hidden note's links touch.
  const affected = new Set<string>();
  for (const link of change.hiddenLinks) {
    affected.add(link.from);
    affected.add(link.to);
  }
  const pairKeys = new Set<string>();
  for (const id of hiddenNotes) {
    for (const other of neighborsOf(base, id)) {
      affected.add(other);
      pairKeys.add(pairKey(id, other));
    }
  }
  for (const id of hiddenNotes) affected.delete(id);

  const outgoing = new Map<string, ReadonlySet<string>>();
  const incoming = new Map<string, ReadonlySet<string>>();
  const neighbors = new Map<string, ReadonlySet<string>>();
  const degree = new Map<string, number>();
  for (const id of affected) {
    if (!base.byId.has(id)) continue;
    const out = new Set([...(base.outgoing.get(id) ?? EMPTY)].filter((to) => !gone(id, to)));
    const into = new Set([...(base.incoming.get(id) ?? EMPTY)].filter((from) => !gone(from, id)));
    const near = new Set([...out, ...into]);
    outgoing.set(id, out);
    incoming.set(id, into);
    neighbors.set(id, near);
    degree.set(id, near.size);
    for (const other of neighborsOf(base, id)) pairKeys.add(pairKey(id, other));
  }
  const pairs = new Map<string, LinkPair>();
  const removedPairs = new Set<string>();
  for (const key of pairKeys) {
    const pair = base.pairByKey.get(key);
    if (pair === undefined) continue;
    const forward = !gone(pair.a, pair.b) && pair.forward;
    const backward = !gone(pair.b, pair.a) && pair.backward;
    if (!forward && !backward) removedPairs.add(key);
    else if (forward !== pair.forward || backward !== pair.backward) {
      pairs.set(key, { ...pair, forward, backward });
    }
  }

  const byId = new OverlayMap(base.byId, change.notes, hiddenNotes);
  const pairByKey = new OverlayMap(base.pairByKey, pairs, removedPairs);
  const degreeMap = new OverlayMap(base.degree, degree, hiddenNotes);
  let notes: ReadonlyArray<MemoryNote> | null = null;
  let pairList: ReadonlyArray<LinkPair> | null = null;
  let orphans: ReadonlySet<string> | null = null;
  return {
    get notes() {
      notes ??= [...byId.values()];
      return notes;
    },
    byId,
    get pairs() {
      pairList ??= [...pairByKey.values()];
      return pairList;
    },
    pairByKey,
    outgoing: new OverlayMap(base.outgoing, outgoing, hiddenNotes),
    incoming: new OverlayMap(base.incoming, incoming, hiddenNotes),
    neighbors: new OverlayMap(base.neighbors, neighbors, hiddenNotes),
    degree: degreeMap,
    get orphans() {
      orphans ??= new Set([...degreeMap].filter(([, count]) => count === 0).map(([id]) => id));
      return orphans;
    },
  };
}

/**
 * A codebase's declared architecture: named layers by path prefix, and the
 * directed pairs of layers a link may cross (from the layer of the link's
 * source to the layer of its target). A link between two layers not listed
 * is a violation; a link inside one layer always is not.
 */
export interface Boundaries {
  readonly layers: ReadonlyArray<{ readonly name: string; readonly paths: ReadonlyArray<string> }>;
  /** Each a [from, to] pair of layer names (a story file's JSON reads as plain arrays). */
  readonly allowed: ReadonlyArray<ReadonlyArray<string>>;
}
