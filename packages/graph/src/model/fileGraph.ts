/**
 * A file graph: one file in the middle and the files it imports and that import it, as the
 * Repositories' local graph draws it (`FileGraph`). Its host caps, folds and filters it; the
 * graph lays it out by forces and draws it as Obsidian draws a vault.
 */

export type FileGraphNodeKind = "file" | "package" | "dependency" | "folder";

export interface FileGraphNode {
  readonly id: string;
  readonly name: string;
  /** A dependency is a lighter dot, a folded folder a ring; files and packages are plain dots. */
  readonly kind: FileGraphNodeKind;
  /** Changed on its branch or not yet committed: it carries a thin ring. */
  readonly changed: boolean;
  /** A test: its label is quieter. */
  readonly test: boolean;
  /** A folded folder's file count, said in its label. */
  readonly files: number | null;
  /** The group whose colour tints it (one of `GROUP_SLOTS`), or null. */
  readonly group: number | null;
}

/** `from` imports `to`. */
export interface FileGraphLink {
  readonly from: string;
  readonly to: string;
  /** Resolved by name alone: drawn fainter. */
  readonly guessed: boolean;
}

export interface FileGraphData {
  readonly center: string;
  readonly nodes: ReadonlyArray<FileGraphNode>;
  readonly links: ReadonlyArray<FileGraphLink>;
}

/** How many group colours there are: the theme's `--atlas-lens-1` to `--atlas-lens-6`. */
export const GROUP_SLOTS = 6;

/** What a graph lays out, as one string: two graphs with the same lay out the same. */
export const fileGraphStructure = (graph: FileGraphData): string =>
  JSON.stringify([
    graph.center,
    graph.nodes.map((node) => node.id),
    graph.links.map((link) => [link.from, link.to]),
  ]);

/** What a graph draws, as one string: two graphs with the same draw the same picture. */
export const fileGraphSignature = (graph: FileGraphData): string =>
  JSON.stringify([
    fileGraphStructure(graph),
    graph.nodes.map((node) => [
      node.name,
      node.kind,
      node.changed,
      node.test,
      node.files,
      node.group,
    ]),
    graph.links.map((link) => link.guessed),
  ]);

/** Each node's link count, a link to itself not counted. */
export function fileGraphDegrees(graph: FileGraphData): Map<string, number> {
  const degrees = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const link of graph.links) {
    if (link.from === link.to) continue;
    degrees.set(link.from, (degrees.get(link.from) ?? 0) + 1);
    degrees.set(link.to, (degrees.get(link.to) ?? 0) + 1);
  }
  return degrees;
}

/** A node and the nodes it links to either way: what a hover keeps lit. */
export function neighbourhood(graph: FileGraphData, id: string): Set<string> {
  const lit = new Set([id]);
  for (const link of graph.links) {
    if (link.from === id) lit.add(link.to);
    if (link.to === id) lit.add(link.from);
  }
  return lit;
}

/** What a node's label says: its name, a folded folder's with its file count. */
export const nodeLabel = (node: FileGraphNode): string =>
  node.kind === "folder" && node.files !== null ? `${node.name} · ${node.files}` : node.name;
