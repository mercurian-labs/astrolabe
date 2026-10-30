import {
  DEFAULT_FILE_GRAPH_SETTINGS,
  fileGraphSettingsOf,
  GROUP_SLOTS,
  type FileGraphData,
  type FileGraphSettings,
} from "@mercurian/graph/file";
import type {
  CodeGraphLink,
  CodeGraphNode,
  CodeLocalGraph,
  CodeLocalGraphInput,
  ProjectId,
} from "@t3tools/contracts";

/** A group: files whose path holds every word of `query` take the colour in `color`'s slot. */
export interface LocalGraphGroup {
  readonly query: string;
  readonly color: number;
}

/** Which of the filter panel's sections are open, and whether the panel is. */
export interface LocalGraphPanel {
  readonly open: boolean;
  readonly filters: boolean;
  readonly groups: boolean;
  readonly display: boolean;
  readonly forces: boolean;
}

/**
 * What a local graph's filter panel holds, kept on the device. Tests and dependencies are filtered
 * here, not asked.
 */
export interface LocalGraphOptions {
  readonly depth: CodeLocalGraphInput["depth"];
  readonly uses: boolean;
  readonly usedBy: boolean;
  readonly tests: boolean;
  readonly dependencies: boolean;
  readonly groups: ReadonlyArray<LocalGraphGroup>;
  /** Display and forces. */
  readonly settings: FileGraphSettings;
  readonly panel: LocalGraphPanel;
}

export const DEFAULT_LOCAL_GRAPH_PANEL: LocalGraphPanel = {
  open: false,
  filters: true,
  groups: false,
  display: false,
  forces: false,
};

export const DEFAULT_LOCAL_GRAPH_OPTIONS: LocalGraphOptions = {
  depth: 1,
  uses: true,
  usedBy: true,
  tests: true,
  dependencies: false,
  groups: [],
  settings: DEFAULT_FILE_GRAPH_SETTINGS,
  panel: DEFAULT_LOCAL_GRAPH_PANEL,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Stored groups, a malformed one left out. */
function groupsOf(stored: unknown): ReadonlyArray<LocalGraphGroup> {
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

function panelOf(stored: unknown): LocalGraphPanel {
  if (!isRecord(stored)) return DEFAULT_LOCAL_GRAPH_PANEL;
  const read = (key: keyof LocalGraphPanel) =>
    typeof stored[key] === "boolean" ? (stored[key] as boolean) : DEFAULT_LOCAL_GRAPH_PANEL[key];
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
 * defaults); groups, display and forces, and the panel each read as their defaults when they are
 * missing (options stored before the panel) or malformed.
 */
export function parseLocalGraphOptions(stored: string): LocalGraphOptions | null {
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { depth, uses, usedBy, tests, dependencies } = value;
  if (depth !== 1 && depth !== 2 && depth !== 3) return null;
  const flags = [uses, usedBy, tests, dependencies];
  if (!flags.every((flag) => typeof flag === "boolean")) return null;
  return {
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
export function groupOf(path: string, groups: ReadonlyArray<LocalGraphGroup>): number | null {
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
 * What the graph draws of an answer: hidden tests and dependencies dropped, with their links, and
 * then whatever no longer reaches the centre through what is left. A search keeps the centre and
 * the files whose name holds it; groups tint the files their query matches.
 */
export function shownLocalGraph(
  graph: CodeLocalGraph,
  options: LocalGraphOptions,
  search = "",
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
  const query = search.trim().toLowerCase();
  const drawn = (node: CodeGraphNode) =>
    reached.has(node.id) &&
    (query === "" || node.id === graph.center || node.name.toLowerCase().includes(query));
  const nodes = kept.filter(drawn);
  const drawnIds = new Set(nodes.map((node) => node.id));
  return {
    data: {
      center: graph.center,
      nodes: nodes.map((node) => ({
        id: node.id,
        name: node.name,
        kind: node.kind,
        changed: node.changed !== null,
        test: node.test,
        files: node.files,
        group: groupOf(node.path ?? node.name, options.groups),
      })),
      links: links
        .filter((link) => drawnIds.has(link.from) && drawnIds.has(link.to))
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

/**
 * What a click on a node does: open its file (a package's entry), open a folder, or nothing. A
 * file outside the project's folder stays closed: its file tabs read only inside it.
 */
export function nodeAction(
  node: CodeGraphNode,
):
  | { readonly kind: "open"; readonly path: string }
  | { readonly kind: "expand"; readonly folder: string }
  | null {
  if (node.path === null) return null;
  if (node.kind === "folder") return { kind: "expand", folder: node.path };
  return node.outsideProject === true ? null : { kind: "open", path: node.path };
}
