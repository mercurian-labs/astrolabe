import {
  DEFAULT_FILE_GRAPH_SETTINGS,
  fileGraphSettingsOf,
  GROUP_SLOTS,
  type FileGraphData,
  type FileGraphFocus,
  type FileGraphSettings,
} from "@mercurian/graph/file";
import {
  CodeGraphLevel,
  type CodeGraphCluster,
  type CodeGraphLink,
  type CodeGraphNode,
  type CodeLocalGraph,
  type CodeLocalGraphInput,
  type ProjectId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** A group: files whose path holds every word of `query` take the colour in `color`'s slot. */
export interface CodeGraphGroup {
  readonly query: string;
  readonly color: number;
}

/** Which of the filter panel's sections are open, and whether the panel is. */
export interface CodeGraphPanelState {
  readonly open: boolean;
  readonly filters: boolean;
  readonly groups: boolean;
  readonly display: boolean;
  readonly forces: boolean;
}

/**
 * What a code graph's filter panel holds, kept on the device. Tests and dependencies are filtered
 * here, not asked.
 */
export interface CodeGraphOptions {
  readonly level: CodeGraphLevel;
  readonly depth: CodeLocalGraphInput["depth"];
  readonly uses: boolean;
  readonly usedBy: boolean;
  readonly tests: boolean;
  readonly dependencies: boolean;
  readonly groups: ReadonlyArray<CodeGraphGroup>;
  /** Display and forces. */
  readonly settings: FileGraphSettings;
  readonly panel: CodeGraphPanelState;
}

export const DEFAULT_CODE_GRAPH_PANEL: CodeGraphPanelState = {
  open: false,
  filters: true,
  groups: false,
  display: false,
  forces: false,
};

export const DEFAULT_CODE_GRAPH_OPTIONS: CodeGraphOptions = {
  level: "file",
  depth: 1,
  uses: true,
  usedBy: true,
  tests: true,
  dependencies: false,
  groups: [],
  settings: DEFAULT_FILE_GRAPH_SETTINGS,
  panel: DEFAULT_CODE_GRAPH_PANEL,
};

const isLevel = Schema.is(CodeGraphLevel);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Stored groups, a malformed one left out. */
function groupsOf(stored: unknown): ReadonlyArray<CodeGraphGroup> {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((group) =>
    isRecord(group) &&
    typeof group.query === "string" &&
    Number.isInteger(group.color) &&
    (group.color as number) >= 0 &&
    (group.color as number) < GROUP_SLOTS
      ? [{ query: group.query, color: group.color as number }]
      : [],
  );
}

function panelOf(stored: unknown): CodeGraphPanelState {
  if (!isRecord(stored)) return DEFAULT_CODE_GRAPH_PANEL;
  const read = (key: keyof CodeGraphPanelState) =>
    typeof stored[key] === "boolean" ? (stored[key] as boolean) : DEFAULT_CODE_GRAPH_PANEL[key];
  return {
    open: read("open"),
    filters: read("filters"),
    groups: read("groups"),
    display: read("display"),
    forces: read("forces"),
  };
}

/**
 * Options as stored on the device: anything malformed in the filters reads as null (the
 * defaults); the level, groups, display and forces, and the panel each read as their defaults
 * when they are missing (options stored before them) or malformed.
 */
export function parseCodeGraphOptions(stored: string): CodeGraphOptions | null {
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { depth, uses, usedBy, tests, dependencies } = value;
  if (depth !== 0 && depth !== 1 && depth !== 2 && depth !== 3) return null;
  const flags = [uses, usedBy, tests, dependencies];
  if (!flags.every((flag) => typeof flag === "boolean")) return null;
  return {
    // Options stored before levels read as files.
    level: isLevel(value.level) ? value.level : "file",
    depth,
    uses: uses as boolean,
    usedBy: usedBy as boolean,
    tests: tests as boolean,
    dependencies: dependencies as boolean,
    groups: groupsOf(value.groups),
    settings: fileGraphSettingsOf(value.settings),
    panel: panelOf(value.panel),
  };
}

/** The first group whose every word `path` holds, ignoring case; an empty query holds none. */
export function groupOf(path: string, groups: ReadonlyArray<CodeGraphGroup>): number | null {
  const haystack = path.toLowerCase();
  for (const group of groups) {
    const words = group.query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    if (words.length > 0 && words.every((word) => haystack.includes(word))) return group.color;
  }
  return null;
}

/**
 * What the reader added to a graph by hand: nodes whose neighbours it expanded, nodes it opened
 * into their contents, and nodes it closed though the level opens them. Kept per roots: a graph
 * re-rooted elsewhere starts plain again.
 */
export interface CodeGraphExpansion {
  readonly neighbours: readonly string[];
  readonly contents: readonly string[];
  readonly collapsed: readonly string[];
}

export const NO_EXPANSION: CodeGraphExpansion = { neighbours: [], contents: [], collapsed: [] };

export interface KeyedExpansion {
  readonly key: string | null;
  readonly expansion: CodeGraphExpansion;
}

export const NO_KEYED_EXPANSION: KeyedExpansion = { key: null, expansion: NO_EXPANSION };

export const rootsKey = (roots: readonly string[]) => JSON.stringify(roots.toSorted());

export const expansionFor = (state: KeyedExpansion, key: string): CodeGraphExpansion =>
  state.key === key ? state.expansion : NO_EXPANSION;

const toggled = (list: readonly string[], id: string, on: boolean) =>
  on ? [...new Set([...list, id])].toSorted() : list.filter((each) => each !== id);

const hasNeighbours = (expansion: CodeGraphExpansion, id: string) =>
  expansion.neighbours.includes(id);

export const toggleNeighbours = (
  expansion: CodeGraphExpansion,
  id: string,
): CodeGraphExpansion => ({
  ...expansion,
  neighbours: toggled(expansion.neighbours, id, !expansion.neighbours.includes(id)),
});

/** Open a node into its contents: undo a close, else ask for it open. */
export const showContents = (expansion: CodeGraphExpansion, id: string): CodeGraphExpansion =>
  expansion.collapsed.includes(id)
    ? { ...expansion, collapsed: toggled(expansion.collapsed, id, false) }
    : { ...expansion, contents: toggled(expansion.contents, id, true) };

/** Close an open cluster: undo an open, else close what the level opened. */
export const hideContents = (expansion: CodeGraphExpansion, id: string): CodeGraphExpansion =>
  expansion.contents.includes(id)
    ? { ...expansion, contents: toggled(expansion.contents, id, false) }
    : { ...expansion, collapsed: toggled(expansion.collapsed, id, true) };

/** The request for a graph around `roots`, as the reader built it. */
export const codeGraphInput = (
  checkout: { readonly projectId: ProjectId; readonly cwd: string },
  roots: readonly [string, ...string[]],
  options: Pick<CodeGraphOptions, "depth" | "uses" | "usedBy" | "level">,
  expansion: CodeGraphExpansion,
): CodeLocalGraphInput => ({
  projectId: checkout.projectId,
  cwd: checkout.cwd,
  roots: [...roots],
  depth: options.depth,
  uses: options.uses,
  usedBy: options.usedBy,
  // Always asked for, so the panel can say how many there are while they are hidden.
  dependencies: true,
  level: options.level,
  expandedNeighbours: [...expansion.neighbours],
  expandedContents: [...expansion.contents],
  collapsedContents: [...expansion.collapsed],
});

export interface ShownCodeGraph {
  readonly data: FileGraphData;
  /** Outside packages the graph reaches, shown or not. */
  readonly dependencies: number;
}

/**
 * Each folder's name in a graph: the fewest trailing parts of its path that no other folder's
 * path ends in too, so `apps/web/src` and `apps/server/src` read `web/src` and `server/src`.
 */
export function folderNames(paths: ReadonlyArray<string>): Map<string, string> {
  const parts = paths.map((path) => path.split("/").filter((part) => part.length > 0));
  const tail = (each: ReadonlyArray<string>, count: number) => each.slice(-count).join("/");
  return new Map(
    paths.map((path, at) => {
      const own = parts[at] ?? [];
      const sharedAt = (count: number) =>
        parts.some((other, index) => index !== at && tail(other, count) === tail(own, count));
      let count = 1;
      while (count < own.length && sharedAt(count)) count += 1;
      return [path, own.length === 0 ? path : tail(own, count)];
    }),
  );
}

/**
 * What the graph draws of an answer: hidden tests and dependencies dropped, then whatever no longer
 * reaches a root. A search keeps the roots and the nodes whose name holds it; groups tint what
 * their query matches; `plainRoots` leaves the roots uncoloured, for a story's own lighting.
 */
export function shownCodeGraph(
  graph: CodeLocalGraph,
  options: CodeGraphOptions,
  search = "",
  plainRoots = false,
): ShownCodeGraph {
  const roots = new Set(graph.roots);
  const kept = graph.nodes.filter(
    (node) =>
      roots.has(node.id) ||
      ((options.dependencies || node.kind !== "dependency") && (options.tests || !node.test)),
  );
  const keptIds = new Set(kept.map((node) => node.id));
  const links = graph.links.filter((link) => keptIds.has(link.from) && keptIds.has(link.to));
  const neighbours = new Map<string, Array<string>>();
  for (const link of links) {
    neighbours.set(link.from, [...(neighbours.get(link.from) ?? []), link.to]);
    neighbours.set(link.to, [...(neighbours.get(link.to) ?? []), link.from]);
  }
  // A cluster's nodes hang together: one of them reaching a root keeps the rest.
  const byCluster = new Map<string, Array<string>>();
  for (const node of kept) {
    if (node.parent !== null)
      byCluster.set(node.parent, [...(byCluster.get(node.parent) ?? []), node.id]);
  }
  const reached = new Set(kept.filter((node) => roots.has(node.id)).map((node) => node.id));
  const queue = [...reached];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const parent = kept.find((node) => node.id === id)?.parent ?? null;
    for (const next of [...(neighbours.get(id) ?? []), ...(byCluster.get(parent ?? "") ?? [])]) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  const query = search.trim().toLowerCase();
  const drawn = (node: CodeGraphNode) =>
    reached.has(node.id) &&
    (query === "" || roots.has(node.id) || node.name.toLowerCase().includes(query));
  const nodes = kept.filter(drawn);
  const drawnIds = new Set(nodes.map((node) => node.id));
  const folders = folderNames(
    graph.nodes.flatMap((node) => (node.kind === "folder" ? [node.path ?? node.id] : [])),
  );
  // Clusters holding something drawn, and the clusters around them.
  const clusterById = new Map(graph.clusters.map((cluster) => [cluster.id, cluster]));
  const liveClusters = new Set<string>();
  for (const node of nodes) {
    for (let at = node.parent; at !== null && !liveClusters.has(at);) {
      liveClusters.add(at);
      at = clusterById.get(at)?.parent ?? null;
    }
  }
  return {
    data: {
      roots: plainRoots ? [] : graph.roots.filter((id) => drawnIds.has(id)),
      nodes: nodes.map((node) => ({
        id: node.id,
        name: node.kind === "folder" ? (folders.get(node.path ?? node.id) ?? node.name) : node.name,
        kind: node.kind,
        changed: node.changed !== null,
        test: node.test,
        files: node.files,
        group: groupOf(node.path ?? node.name, options.groups),
        cluster: node.parent,
      })),
      links: links
        .filter((link) => drawnIds.has(link.from) && drawnIds.has(link.to))
        .map((link) => ({
          from: link.from,
          to: link.to,
          guessed: link.resolution === "heuristic",
        })),
      clusters: graph.clusters
        .filter((cluster) => liveClusters.has(cluster.id))
        .map((cluster) => ({
          id: cluster.id,
          name:
            cluster.kind === "folder"
              ? (folders.get(cluster.path ?? cluster.id) ?? cluster.name)
              : cluster.name,
          parent: cluster.parent,
          root: !plainRoots && cluster.root,
        })),
    },
    dependencies: graph.nodes.filter((node) => node.kind === "dependency").length,
  };
}

/**
 * The import a hovered node's card quotes: the one between it and a root, else one between it
 * and a node a ring nearer the roots, else any it has that names its line. None for a root.
 */
export function importOf(graph: CodeLocalGraph, id: string): CodeGraphLink | null {
  const roots = new Set(graph.roots);
  if (roots.has(id)) return null;
  const depthOf = new Map(graph.nodes.map((node) => [node.id, node.depth]));
  const depth = depthOf.get(id) ?? 0;
  const written = graph.links.filter(
    (link) => link.line !== null && (link.from === id || link.to === id) && link.from !== link.to,
  );
  const other = (link: CodeGraphLink) => (link.from === id ? link.to : link.from);
  return (
    written.find((link) => roots.has(other(link))) ??
    written.find((link) => depthOf.get(other(link)) === depth - 1) ??
    written[0] ??
    null
  );
}

/** Where a node opens: its file (a package's entry), at a definition's line. */
export interface OpenTarget {
  readonly path: string;
  readonly line: number | null;
}

/** A node's file to open, or null: a folder, a module, a dependency, or a file outside the project. */
export function openTargetOf(node: CodeGraphNode): OpenTarget | null {
  if (node.path === null || node.outsideProject === true) return null;
  if (node.kind === "folder" || node.kind === "module" || node.kind === "dependency") return null;
  return { path: node.path, line: node.symbol?.line ?? null };
}

/**
 * What a click on a node does: open its file and re-root the graph there (on a definition, the
 * definition), or open a folder's or module's contents; nothing for a dependency.
 */
export function clickAction(
  node: CodeGraphNode,
):
  | { readonly kind: "open"; readonly target: OpenTarget; readonly root: string }
  | { readonly kind: "contents"; readonly id: string }
  | null {
  if (node.kind === "folder" || node.kind === "module") {
    return node.contents ? { kind: "contents", id: node.id } : null;
  }
  const target = openTargetOf(node);
  if (target === null) return null;
  return { kind: "open", target, root: node.kind === "symbol" ? node.id : target.path };
}

export type CodeGraphAction =
  | "expand-neighbours"
  | "collapse-neighbours"
  | "show-contents"
  | "hide-contents"
  | "centre"
  | "open";

export const ACTION_LABELS: Record<CodeGraphAction, string> = {
  "expand-neighbours": "Expand neighbours",
  "collapse-neighbours": "Collapse neighbours",
  "show-contents": "Show contents",
  "hide-contents": "Hide contents",
  centre: "Centre here",
  open: "Open",
};

/** A node's context menu, in order; a dependency or a package only opens or re-roots. */
export function nodeMenu(
  node: CodeGraphNode,
  expansion: CodeGraphExpansion,
): ReadonlyArray<CodeGraphAction> {
  const actions: Array<CodeGraphAction> = [];
  const grows = node.kind !== "dependency" && node.kind !== "package";
  if (grows) {
    actions.push(hasNeighbours(expansion, node.id) ? "collapse-neighbours" : "expand-neighbours");
  }
  if (node.contents) actions.push("show-contents");
  if (grows) actions.push("centre");
  if (openTargetOf(node) !== null) actions.push("open");
  return actions;
}

/** An open cluster's context menu: close it, re-root on it, open its file. */
export function clusterMenu(cluster: CodeGraphCluster): ReadonlyArray<CodeGraphAction> {
  return [
    "hide-contents",
    "centre",
    ...(cluster.kind === "file" || cluster.kind === "symbol" ? (["open"] as const) : []),
  ];
}

/** Whether node id `inner` lies inside `outer`: a folder's or module's file, a file's definition. */
function inside(outer: string, inner: string): boolean {
  const folder = outer.startsWith("module:") ? outer.slice("module:".length) : outer;
  if (folder === "." || folder === "") return !inner.startsWith("dependency:");
  return (
    inner.startsWith(`${folder}/`) || inner.startsWith(`${outer}#`) || inner.startsWith(`${outer}.`)
  );
}

/**
 * A story step's nodes and links as the graph shows them: an id the graph rolled up lights the
 * node holding it, and an id it opened lights what shows inside it.
 */
export function focusOf(
  graph: FileGraphData,
  step: {
    readonly nodes: readonly string[];
    readonly links: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  },
): FileGraphFocus {
  const ids = graph.nodes.map((node) => node.id);
  const shownAs = (id: string): readonly string[] => {
    if (ids.includes(id)) return [id];
    const holder = ids
      .filter((each) => inside(each, id))
      .toSorted((a, b) => b.length - a.length)[0];
    if (holder !== undefined) return [holder];
    return ids.filter((each) => inside(id, each));
  };
  const nodes = new Set(step.nodes.flatMap(shownAs));
  const links = step.links.flatMap((link) => {
    const from = shownAs(link.from)[0];
    const to = shownAs(link.to)[0];
    if (from !== undefined) nodes.add(from);
    if (to !== undefined) nodes.add(to);
    return from === undefined || to === undefined || from === to ? [] : [{ from, to }];
  });
  return { nodes: [...nodes], links };
}
