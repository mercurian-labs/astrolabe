import type { FileGraphData } from "@mercurian/graph/file";
import type {
  CodeGraphLink,
  CodeGraphNode,
  CodeLocalGraph,
  CodeLocalGraphInput,
  ProjectId,
} from "@t3tools/contracts";

/** What a local graph's toolbar asks for. Tests and dependencies are filtered here, not asked. */
export interface LocalGraphOptions {
  readonly depth: CodeLocalGraphInput["depth"];
  readonly uses: boolean;
  readonly usedBy: boolean;
  readonly tests: boolean;
  readonly dependencies: boolean;
}

export const DEFAULT_LOCAL_GRAPH_OPTIONS: LocalGraphOptions = {
  depth: 1,
  uses: true,
  usedBy: true,
  tests: true,
  dependencies: false,
};

/** Options as stored on the device; anything malformed reads as null (the defaults). */
export function parseLocalGraphOptions(stored: string): LocalGraphOptions | null {
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null) return null;
    const { depth, uses, usedBy, tests, dependencies } = value as Record<string, unknown>;
    if (depth !== 1 && depth !== 2 && depth !== 3) return null;
    const flags = [uses, usedBy, tests, dependencies];
    if (!flags.every((flag) => typeof flag === "boolean")) return null;
    return {
      depth,
      uses: uses as boolean,
      usedBy: usedBy as boolean,
      tests: tests as boolean,
      dependencies: dependencies as boolean,
    };
  } catch {
    return null;
  }
}

/** The folders a reader opened in the graph of `center`; a new centre starts folded again. */
export interface Expansion {
  readonly center: string | null;
  readonly folders: readonly string[];
}

export const NO_EXPANSION: Expansion = { center: null, folders: [] };

export const expandedFor = (expansion: Expansion, center: string) =>
  expansion.center === center ? expansion.folders : [];

export const expandFolder = (expansion: Expansion, center: string, folder: string): Expansion => ({
  center,
  folders: [...new Set([...expandedFor(expansion, center), folder])].toSorted(),
});

/**
 * The request for `path`'s graph. Dependencies are always asked for, so the toolbar can say how
 * many there are while they are hidden.
 */
export const localGraphInput = (
  checkout: { readonly projectId: ProjectId; readonly cwd: string },
  path: string,
  options: LocalGraphOptions,
  expanded: readonly string[],
): CodeLocalGraphInput => ({
  projectId: checkout.projectId,
  cwd: checkout.cwd,
  path,
  depth: options.depth,
  uses: options.uses,
  usedBy: options.usedBy,
  dependencies: true,
  expanded: [...expanded],
});

export interface ShownLocalGraph {
  readonly data: FileGraphData;
  /** Outside packages the graph reaches, shown or not. */
  readonly dependencies: number;
}

/**
 * What the graph draws of an answer: hidden tests and dependencies dropped, with their links,
 * and then whatever no longer reaches the centre through what is left.
 */
export function shownLocalGraph(
  graph: CodeLocalGraph,
  options: LocalGraphOptions,
): ShownLocalGraph {
  const kept = graph.nodes.filter(
    (node) =>
      node.id === graph.center ||
      ((options.dependencies || node.kind !== "dependency") && (options.tests || !node.test)),
  );
  const keptIds = new Set(kept.map((node) => node.id));
  const links = graph.links.filter((link) => keptIds.has(link.from) && keptIds.has(link.to));
  const neighbours = new Map<string, Array<string>>();
  for (const link of links) {
    neighbours.set(link.from, [...(neighbours.get(link.from) ?? []), link.to]);
    neighbours.set(link.to, [...(neighbours.get(link.to) ?? []), link.from]);
  }
  const reached = new Set([graph.center]);
  const queue = [graph.center];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const next of neighbours.get(id) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return {
    data: {
      center: graph.center,
      nodes: kept
        .filter((node) => reached.has(node.id))
        .map((node) => ({
          id: node.id,
          name: node.name,
          kind: node.kind,
          changed: node.changed !== null,
          files: node.files,
        })),
      links: links
        .filter((link) => reached.has(link.from) && reached.has(link.to))
        .map((link) => ({
          from: link.from,
          to: link.to,
          guessed: link.resolution === "heuristic",
        })),
    },
    dependencies: graph.nodes.filter((node) => node.kind === "dependency").length,
  };
}

/**
 * The import a hovered node's card quotes: the one between it and the centre, else one between it
 * and a node a ring nearer the centre, else any it has that names its line. None for the centre.
 */
export function importOf(graph: CodeLocalGraph, id: string): CodeGraphLink | null {
  if (id === graph.center) return null;
  const depthOf = new Map(graph.nodes.map((node) => [node.id, node.depth]));
  const depth = depthOf.get(id) ?? 0;
  const written = graph.links.filter(
    (link) => link.line !== null && (link.from === id || link.to === id) && link.from !== link.to,
  );
  const other = (link: CodeGraphLink) => (link.from === id ? link.to : link.from);
  return (
    written.find((link) => other(link) === graph.center) ??
    written.find((link) => depthOf.get(other(link)) === depth - 1) ??
    written[0] ??
    null
  );
}

/** What a click on a node does: open its file (a package's entry), open a folder, or nothing. */
export function nodeAction(
  node: CodeGraphNode,
):
  | { readonly kind: "open"; readonly path: string }
  | { readonly kind: "expand"; readonly folder: string }
  | null {
  if (node.path === null) return null;
  return node.kind === "folder"
    ? { kind: "expand", folder: node.path }
    : { kind: "open", path: node.path };
}
