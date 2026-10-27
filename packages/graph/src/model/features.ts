/**
 * The design-level features: what each toggle does to the memory, layers and the links crossing
 * them, uncaught throws, and the shapes the shown graph makes. Every function here runs on a change
 * of memory, toggle, or view, never per frame.
 */
import type { Boundaries, LinkKind, Memory, MemoryLink, MemoryLens } from "./memory.ts";
import type { DesignFeatures } from "./settings.ts";
import { resolveRelinks, type ThreadEvent, type ThreadRecord } from "./thread.ts";
import { EdgeMark, type Universe } from "./universe.ts";

export const DATA_KINDS: ReadonlySet<string> = new Set<LinkKind>(["accepts", "returns"]);
export const FAILURE_KINDS: ReadonlySet<string> = new Set<LinkKind>(["throws", "catches"]);

/** The lens that types every link by its kind (a code story's). */
const RELATIONSHIPS = "Relationships";
const KIND_MEANINGS: Readonly<Record<string, string>> = {
  accepts: "Takes the type as a parameter.",
  returns: "Gives the type back.",
  throws: "Raises the error type.",
  catches: "Handles the error type.",
  references: "Names the other symbol.",
};

/**
 * The memory and thread a graph reads, relinks resolved and `features` applied: data-flow links
 * read as references while their feature is off, and failure links are gone, events and all.
 * Returns the very objects given when nothing changes. Hosts show their play-by-play from the same
 * thread so plays line up with the graph.
 */
export function applyFeatures(
  memory: Memory,
  given: ThreadRecord | null,
  features: Pick<DesignFeatures, "dataEdges" | "failureEdges">,
): { readonly memory: Memory; readonly thread: ThreadRecord | null } {
  // A link to a link that already stands is a re-resolution, not a move.
  const thread = given === null ? null : resolveRelinks(memory, given);
  const rewrite = (kind: string | undefined): string | null | undefined => {
    if (kind === undefined) return kind;
    if (!features.failureEdges && FAILURE_KINDS.has(kind)) return null;
    if (!features.dataEdges && DATA_KINDS.has(kind)) return "references";
    return kind;
  };
  const shown = (kind: string) =>
    (features.dataEdges && DATA_KINDS.has(kind)) ||
    (features.failureEdges && FAILURE_KINDS.has(kind));
  const linkEvents = (thread?.turns ?? []).flatMap((turn) =>
    turn.events.filter(
      (event): event is Extract<ThreadEvent, { kind: "link" | "unlink" | "resolve" }> =>
        event.kind === "link" || event.kind === "unlink" || event.kind === "resolve",
    ),
  );

  // The thread: failure events dropped, data events retyped, while off.
  const touched = (kind: string | undefined) => rewrite(kind) !== kind;
  let nextThread = thread;
  if (thread !== null && linkEvents.some((event) => touched(event.linkKind))) {
    nextThread = {
      ...thread,
      turns: thread.turns.map((turn) => ({
        ...turn,
        events: turn.events.flatMap((event): Array<ThreadEvent> => {
          if (event.kind !== "link" && event.kind !== "unlink" && event.kind !== "resolve") {
            return [event];
          }
          const kind = rewrite(event.linkKind);
          if (kind === null) return [];
          return kind === event.linkKind ? [event] : [{ ...event, linkKind: "references" }];
        }),
      })),
    };
  }

  // The memory's links, the same way; a retyped link that duplicates one goes.
  let links = memory.links;
  if (links.some((link) => touched(link.kind))) {
    const seen = new Set<string>();
    links = links.flatMap((link): Array<MemoryLink> => {
      const kind = rewrite(link.kind);
      if (kind === null) return [];
      const next: MemoryLink = kind === link.kind ? link : { ...link, kind: "references" };
      const key = `${next.from}\u0000${next.to}\u0000${next.kind ?? ""}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [next];
    });
  }

  // The Relationships lens: off, its edges follow the links; on, it holds every such link.
  let lenses = memory.lenses;
  const at = lenses.findIndex((lens) => lens.name === RELATIONSHIPS);
  const lens = lenses[at];
  if (lens !== undefined) {
    const seen = new Set<string>();
    const edges = lens.edges.flatMap((edge) => {
      const kind = rewrite(edge.type);
      if (kind === null || kind === undefined) return [];
      const next = kind === edge.type ? edge : { ...edge, type: kind };
      const key = `${next.from}\u0000${next.to}\u0000${next.type}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [next];
    });
    const extra = [
      ...memory.links.map((link) => ({ from: link.from, to: link.to, kind: link.kind })),
      ...linkEvents
        .filter((event) => event.kind === "link")
        .map((event) => ({ from: event.from, to: event.to, kind: event.linkKind })),
    ].flatMap(({ from, to, kind }) => {
      if (kind === undefined || !shown(kind)) return [];
      const key = `${from}\u0000${to}\u0000${kind}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ from, type: kind, to }];
    });
    const changed =
      extra.length > 0 ||
      edges.length !== lens.edges.length ||
      edges.some((edge, position) => edge !== lens.edges[position]);
    if (changed) {
      const types: Record<string, string> = {};
      for (const edge of [...edges, ...extra]) {
        types[edge.type] = lens.types[edge.type] ?? KIND_MEANINGS[edge.type] ?? edge.type;
      }
      const next: MemoryLens = { ...lens, types, edges: [...edges, ...extra] };
      lenses = lenses.map((each, position) => (position === at ? next : each));
    }
  }

  const nextMemory =
    links === memory.links && lenses === memory.lenses ? memory : { ...memory, links, lenses };
  return { memory: nextMemory, thread: nextThread };
}

/** The path a codebase note's id names: the part before its "#". */
export const notePath = (id: string) => {
  const hash = id.indexOf("#");
  return hash < 0 ? id : id.slice(0, hash);
};

/** A boundaries declaration indexed over a universe: each note's layer, and the edges that cross where they may not. */
export interface BoundaryIndex {
  readonly names: ReadonlyArray<string>;
  /** Each universe node's layer (into `names`), or -1 for none. */
  readonly layerOf: Int16Array;
  /**
   * Per universe edge: 1 when one of its links crosses two layers the
   * declaration does not allow, however it is resolved. Whether it counts
   * is the reading's to say: only a link resolved exactly or by overload does.
   */
  readonly crossing: Uint8Array;
  /** Whether `link` crosses two layers the declaration does not allow (its resolution aside). */
  readonly crosses: (link: Pick<MemoryLink, "from" | "to">) => boolean;
}

/** Whether a link, resolved as `resolution`, breaks the boundaries: a guess (heuristic) never does. */
export const violatesWith = (
  index: BoundaryIndex,
  link: Pick<MemoryLink, "from" | "to">,
  resolution: string | undefined,
) => resolution !== "heuristic" && index.crosses(link);

/** The layer holding `path`: the longest declared path it sits under, or -1. */
export function layerAt(boundaries: Boundaries, path: string): number {
  let best = -1;
  let longest = -1;
  boundaries.layers.forEach((layer, index) => {
    for (const prefix of layer.paths) {
      const bare = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
      const under = path === bare || path.startsWith(`${bare}/`) || bare === "";
      if (under && bare.length > longest) {
        best = index;
        longest = bare.length;
      }
    }
  });
  return best;
}

/** Whether a link from layer `from` to layer `to` breaks the declaration (both known, different, not allowed). */
export function crossesBoundary(boundaries: Boundaries, from: number, to: number): boolean {
  if (from < 0 || to < 0 || from === to) return false;
  const a = boundaries.layers[from]?.name;
  const b = boundaries.layers[to]?.name;
  return !boundaries.allowed.some(([left, right]) => left === a && right === b);
}

export function boundaryIndex(universe: Universe, boundaries: Boundaries): BoundaryIndex {
  const layerOf = Int16Array.from(universe.nodes, (node) => layerAt(boundaries, notePath(node.id)));
  const crosses = (link: Pick<MemoryLink, "from" | "to">) =>
    crossesBoundary(
      boundaries,
      layerOf[universe.indexOf.get(link.from) ?? -1] ?? -1,
      layerOf[universe.indexOf.get(link.to) ?? -1] ?? -1,
    );
  const crossing = new Uint8Array(universe.edges.length);
  universe.edgeLinks.forEach((links, at) => {
    if (links.some(crosses)) crossing[at] = 1;
  });
  return { names: boundaries.layers.map((layer) => layer.name), layerOf, crossing, crosses };
}

/** The popover's crossing row for `link` resolved as `resolution`, or null when it breaks nothing (a guess never does). */
export function crossingText(
  boundaries: Boundaries,
  index: BoundaryIndex,
  universe: Pick<Universe, "indexOf">,
  link: Pick<MemoryLink, "from" | "to">,
  resolution: string | undefined,
): string | null {
  const from = index.layerOf[universe.indexOf.get(link.from) ?? -1] ?? -1;
  const to = index.layerOf[universe.indexOf.get(link.to) ?? -1] ?? -1;
  if (resolution === "heuristic" || !crossesBoundary(boundaries, from, to)) return null;
  return `crosses ${index.names[from] ?? ""} → ${index.names[to] ?? ""} (not allowed)`;
}

/** The links of a shown graph, directed, by universe node index: what the recognisers walk. */
export interface ShownLinks {
  /** The shown nodes, by universe index. */
  readonly nodes: ReadonlyArray<number>;
  /** Each standing typed link between two shown nodes (each as itself, not folded into a container). */
  readonly links: ReadonlyArray<{
    readonly from: number;
    readonly to: number;
    readonly kind: string;
  }>;
  /** How many shown edges touch each shown node, by universe index. */
  readonly degree: ReadonlyMap<number, number>;
}

/**
 * The functions that throw with nothing above them catching: a node with a
 * throws link, none of whose callers (transitively, over calls links among
 * the shown nodes) nor itself has a catches link.
 */
export function uncaughtThrowers(shown: ShownLinks): Set<number> {
  const throwers = new Set<number>();
  const catchers = new Set<number>();
  const callers = new Map<number, Array<number>>();
  for (const link of shown.links) {
    if (link.kind === "throws") throwers.add(link.from);
    else if (link.kind === "catches") catchers.add(link.from);
    else if (link.kind === "calls") {
      const list = callers.get(link.to) ?? [];
      list.push(link.from);
      callers.set(link.to, list);
    }
  }
  const uncaught = new Set<number>();
  for (const thrower of throwers) {
    const seen = new Set([thrower]);
    const queue = [thrower];
    let caught = false;
    while (queue.length > 0 && !caught) {
      const at = queue.pop() ?? -1;
      if (catchers.has(at)) caught = true;
      for (const caller of callers.get(at) ?? []) {
        if (seen.has(caller)) continue;
        seen.add(caller);
        queue.push(caller);
      }
    }
    if (!caught) uncaught.add(thrower);
  }
  return uncaught;
}

/** A shape the shown graph makes, labelled near its members' centroid. */
export interface Silhouette {
  readonly kind: "hub" | "strategy" | "cycle";
  readonly text: string;
  /** Its members, by universe index; the first is its centre (the hub, the interface). */
  readonly members: ReadonlyArray<number>;
  /** Where its tag sits: under its centre (a hub's star reads from the hub), else at its centroid. */
  readonly anchor?: number;
}

export const HUB_DEGREE = 8;
export const HUB_OVER_MEDIAN = 3;
export const STRATEGY_IMPLEMENTERS = 3;
export const CYCLE_SIZE = 3;

const POLYMORPHIC_IN: ReadonlySet<string> = new Set(["implements", "inherits"]);
const CYCLIC: ReadonlySet<string> = new Set(["calls", "imports"]);

/**
 * Hubs (shown degree at least HUB_DEGREE and HUB_OVER_MEDIAN times the median), strategies (an
 * interface STRATEGY_IMPLEMENTERS or more shown nodes implement or inherit), and cycles (a strongly
 * connected set of at least CYCLE_SIZE shown nodes over calls and imports).
 */
export function silhouettes(
  shown: ShownLinks,
  kindOf: (index: number) => string | undefined,
): Array<Silhouette> {
  const found: Array<Silhouette> = [];
  const degrees = shown.nodes.map((node) => shown.degree.get(node) ?? 0).toSorted((a, b) => a - b);
  const middle = degrees.length / 2;
  const median =
    degrees.length === 0
      ? 0
      : degrees.length % 2 === 1
        ? (degrees[Math.floor(middle)] ?? 0)
        : ((degrees[middle - 1] ?? 0) + (degrees[middle] ?? 0)) / 2;
  const neighbours = new Map<number, Set<number>>();
  for (const link of shown.links) {
    if (!neighbours.has(link.from)) neighbours.set(link.from, new Set());
    if (!neighbours.has(link.to)) neighbours.set(link.to, new Set());
    neighbours.get(link.from)?.add(link.to);
    neighbours.get(link.to)?.add(link.from);
  }
  for (const node of shown.nodes) {
    const degree = shown.degree.get(node) ?? 0;
    if (degree >= HUB_DEGREE && degree >= HUB_OVER_MEDIAN * median) {
      found.push({
        kind: "hub",
        text: "hub",
        members: [node, ...(neighbours.get(node) ?? [])],
        anchor: node,
      });
    }
  }
  const implementers = new Map<number, Set<number>>();
  for (const link of shown.links) {
    if (!POLYMORPHIC_IN.has(link.kind) || kindOf(link.to) !== "interface") continue;
    const set = implementers.get(link.to) ?? new Set<number>();
    set.add(link.from);
    implementers.set(link.to, set);
  }
  for (const [face, set] of [...implementers].toSorted(([a], [b]) => a - b)) {
    if (set.size < STRATEGY_IMPLEMENTERS) continue;
    found.push({
      kind: "strategy",
      text: `strategy: ${set.size} implementers`,
      members: [face, ...[...set].toSorted((a, b) => a - b)],
    });
  }
  for (const component of stronglyConnected(shown.nodes, shown.links)) {
    if (component.length < CYCLE_SIZE) continue;
    found.push({ kind: "cycle", text: `cycle: ${component.length}`, members: component });
  }
  return found;
}

/** Tarjan's strongly connected components over the calls and imports links, each sorted. */
function stronglyConnected(
  nodes: ReadonlyArray<number>,
  links: ShownLinks["links"],
): Array<Array<number>> {
  const out = new Map<number, Array<number>>();
  for (const link of links) {
    if (!CYCLIC.has(link.kind) || link.from === link.to) continue;
    const list = out.get(link.from) ?? [];
    list.push(link.to);
    out.set(link.from, list);
  }
  const index = new Map<number, number>();
  const low = new Map<number, number>();
  const stack: Array<number> = [];
  const onStack = new Set<number>();
  const components: Array<Array<number>> = [];
  let counter = 0;
  const visit = (start: number) => {
    // Iterative, so a long chain never overflows the call stack.
    const work: Array<{ node: number; next: number }> = [{ node: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const frame = work.at(-1);
      if (frame === undefined) break;
      const targets = out.get(frame.node) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next] ?? -1;
        frame.next += 1;
        if (!index.has(target)) {
          index.set(target, counter);
          low.set(target, counter);
          counter += 1;
          stack.push(target);
          onStack.add(target);
          work.push({ node: target, next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(target) ?? 0));
        }
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent !== undefined) {
        low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: Array<number> = [];
        for (;;) {
          const member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        components.push(component.toSorted((a, b) => a - b));
      }
    }
  };
  for (const node of nodes) if (!index.has(node)) visit(node);
  return components;
}

/**
 * Standing links on shown edges whose ends show as themselves, plus each shown node's shown-edge
 * count. Links resolved by name alone (heuristic, per `resolutionOf`) are left out, and so are
 * edges whose every standing link is one.
 */
export function shownLinks(
  universe: Pick<Universe, "edges" | "edgeLinks" | "edgeMarks" | "indexOf">,
  view: {
    readonly nodes: ArrayLike<number>;
    readonly edges: ArrayLike<number>;
    readonly nodeAt: ReadonlyMap<number, number>;
  },
  stands: (link: MemoryLink) => boolean,
  resolutionOf: (link: MemoryLink) => string | undefined = (link) => link.resolution,
): ShownLinks {
  const degree = new Map<number, number>();
  const links: Array<{ from: number; to: number; kind: string }> = [];
  for (let at = 0; at < view.edges.length; at += 1) {
    const index = view.edges[at] ?? -1;
    const edge = universe.edges[index];
    if (edge === undefined) continue;
    // Links resolved by name alone are left out: the recognisers read only what is sure.
    const standing = (universe.edgeLinks[index] ?? []).filter(
      (link) => link.kind !== undefined && stands(link),
    );
    const sure = standing.filter((link) => resolutionOf(link) !== "heuristic");
    const guessed =
      standing.length > 0
        ? sure.length === 0
        : ((universe.edgeMarks[index] ?? 0) & EdgeMark.heuristic) !== 0;
    if (guessed) continue;
    degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
    degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
    if (edge.aggregate) continue;
    for (const link of sure) {
      if (link.kind === undefined) continue;
      const from = universe.indexOf.get(link.from);
      const to = universe.indexOf.get(link.to);
      if (from === undefined || to === undefined) continue;
      if (!view.nodeAt.has(from) || !view.nodeAt.has(to)) continue;
      links.push({ from, to, kind: link.kind });
    }
  }
  return { nodes: Array.from(view.nodes), links, degree };
}

/** How many standing links take (accepts) and give back (returns) the type at universe node `index`. */
export function dataFlowCounts(
  universe: Pick<Universe, "edgesOf" | "edgeLinks" | "nodes">,
  index: number,
  stands: (link: MemoryLink) => boolean,
): { readonly accepted: number; readonly returned: number } {
  const id = universe.nodes[index]?.id;
  let accepted = 0;
  let returned = 0;
  for (const edge of universe.edgesOf[index] ?? []) {
    for (const link of universe.edgeLinks[edge] ?? []) {
      if (link.to !== id || !stands(link)) continue;
      if (link.kind === "accepts") accepted += 1;
      else if (link.kind === "returns") returned += 1;
    }
  }
  return { accepted, returned };
}
