/**
 * Larger memories to feel the scale: clustered notes linking mostly within
 * their cluster, hubs by preferential attachment, about a tenth of the notes
 * red links, and a few orphans. Deterministic for a given seed and size, and
 * generated in one pass per note (O(n)), so 100,000 notes take well under a
 * second.
 */
import type { LensEdge, Memory, MemoryLink, MemoryNote } from "../src/model/memory.ts";

export interface SyntheticOptions {
  readonly notes?: number;
  /** Defaults to about one cluster per 50 notes, at least 12. */
  readonly clusters?: number;
  /** Outgoing links per written note, on average, before duplicates fold. */
  readonly linksPerNote?: number;
  readonly frontierShare?: number;
  readonly orphans?: number;
  readonly seed?: number;
}

/** The synthetic memories the playground and the bench offer. */
export const SYNTHETIC_SIZES = [600, 3000, 10_000, 100_000] as const;
export type SyntheticSize = (typeof SYNTHETIC_SIZES)[number];

export const DEFAULT_SEED = 20260926;

const CLUSTER_WORDS = [
  "Orbit",
  "Ledger",
  "Harbor",
  "Signal",
  "Lattice",
  "Meridian",
  "Quarry",
  "Beacon",
  "Cipher",
  "Delta",
  "Ember",
  "Fathom",
  "Gantry",
  "Helix",
  "Isobar",
  "Juniper",
];
/** Second words for clusters past the first sixteen; none is a noun below, so names stay unique. */
const CLUSTER_SECONDS = [
  "North",
  "Vale",
  "Crest",
  "Reach",
  "Hollow",
  "Spire",
  "Weald",
  "Fen",
  "Ridge",
  "Moor",
  "Cove",
  "Glen",
  "Heath",
  "Tarn",
  "Brook",
  "Mesa",
];
const NOUNS = [
  "Index",
  "Draft",
  "Rule",
  "Frame",
  "Model",
  "Queue",
  "Trace",
  "Loop",
  "Gate",
  "Pivot",
  "Seam",
  "Anchor",
  "Field",
  "Budget",
  "Ledger",
  "Ruling",
  "Surface",
  "Record",
];

/** mulberry32: a small, fast, seeded generator. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cluster `index`'s name: a word, then a word pair past the first sixteen, then a numbered pair. */
export function clusterName(index: number): string {
  const first = CLUSTER_WORDS[index % CLUSTER_WORDS.length] ?? "Cluster";
  if (index < CLUSTER_WORDS.length) return first;
  const pair = Math.floor(index / CLUSTER_WORDS.length) - 1;
  const second = CLUSTER_SECONDS[pair % CLUSTER_SECONDS.length] ?? "Far";
  const round = Math.floor(pair / CLUSTER_SECONDS.length);
  return `${first} ${second}${round > 0 ? ` ${round + 1}` : ""}`;
}

interface Cluster {
  readonly name: string;
  readonly members: Array<MemoryNote>;
  /** The written members so far: where a red link's author is picked from. */
  readonly written: Array<MemoryNote>;
}

export function syntheticMemory(options: SyntheticOptions = {}): Memory {
  const total = options.notes ?? 600;
  const clusterCount = Math.max(1, options.clusters ?? Math.max(12, Math.round(total / 50)));
  const linksPerNote = options.linksPerNote ?? 3.7;
  const frontierShare = options.frontierShare ?? 0.1;
  const orphanCount = options.orphans ?? Math.max(5, Math.round(total / 2000));
  const random = seededRandom(options.seed ?? DEFAULT_SEED);

  const clusters: Array<Cluster> = Array.from({ length: clusterCount }, (_, index) => ({
    name: clusterName(index),
    members: [],
    written: [],
  }));
  const notes: Array<MemoryNote> = [];
  for (let index = 0; index < total; index += 1) {
    const cluster = clusters[index % clusterCount];
    if (cluster === undefined) continue;
    const member = cluster.members.length;
    const noun = NOUNS[member % NOUNS.length] ?? "Note";
    const round = Math.floor(member / NOUNS.length);
    const name = `${cluster.name} ${noun}${round > 0 ? ` ${round + 1}` : ""}`;
    // The first notes of a cluster are its hubs, so red links come from later ones.
    const frontier = member > 3 && random() < frontierShare;
    const note: MemoryNote = { id: name, name, frontier, group: cluster.name };
    notes.push(note);
    cluster.members.push(note);
    if (!frontier) cluster.written.push(note);
  }

  // The last few written notes stay unlinked either way.
  const orphans = new Set<string>();
  for (let index = notes.length - 1; index >= 0 && orphans.size < orphanCount; index -= 1) {
    const note = notes[index];
    if (note !== undefined && !note.frontier) orphans.add(note.id);
  }
  const linkKeys = new Set<string>();
  const links: Array<MemoryLink> = [];
  const addLink = (from: string, to: string) => {
    const key = `${from}\u0000${to}`;
    if (from === to || linkKeys.has(key) || orphans.has(to) || orphans.has(from)) return;
    linkKeys.add(key);
    links.push({ from, to });
  };
  // Earlier members are picked more often: hubs emerge.
  const pickIn = (members: ReadonlyArray<MemoryNote>) =>
    members[Math.floor(random() ** 2.2 * members.length)];

  notes.forEach((note, index) => {
    if (note.frontier || orphans.has(note.id)) return;
    const own = clusters[index % clusterCount]?.members ?? [];
    const count = Math.max(1, Math.round(linksPerNote * (0.5 + random())));
    for (let link = 0; link < count; link += 1) {
      const pool =
        random() < 0.84 ? own : (clusters[Math.floor(random() * clusterCount)]?.members ?? own);
      const target = pickIn(pool);
      if (target !== undefined) addLink(note.id, target.id);
    }
  });
  // Every red link is named by a written note of its cluster.
  notes.forEach((note, index) => {
    if (!note.frontier) return;
    const written = clusters[index % clusterCount]?.written ?? [];
    const source = written[Math.floor(random() * written.length)];
    if (source !== undefined) addLink(source.id, note.id);
  });

  const hubs = clusters.map((cluster) => cluster.members[0]).filter((hub) => hub !== undefined);
  const outline: Array<LensEdge> = [];
  hubs.forEach((hub, cluster) => {
    if (cluster > 0) outline.push({ from: hubs[0]?.id ?? hub.id, type: "contains", to: hub.id });
    for (const member of (clusters[cluster]?.members ?? []).slice(1, 4)) {
      if (!member.frontier) outline.push({ from: hub.id, type: "contains", to: member.id });
    }
  });
  const informs: Array<LensEdge> = hubs.slice(1).map((hub, index) => ({
    from: hubs[index]?.id ?? hub.id,
    type: "informs",
    to: hub.id,
  }));

  return {
    id: `synthetic-${total}`,
    notes,
    links,
    lenses: [
      {
        name: "Outline",
        types: { contains: "The destination is a constituent part of the source." },
        edges: outline,
      },
      {
        name: "Lineage",
        types: { informs: "The source supplies context for the destination." },
        edges: informs,
      },
    ],
  };
}
