import {
  activateTab,
  allTabs,
  closeTab,
  focusedPane,
  openBeside,
  replaceTab,
  type Arrangement,
} from "~/panes/arrangement";
import type { PaneArrangementStore } from "~/panes/panesHost";
import { leafWithTab, leaves } from "~/panes/tree";
import {
  parseRepositoryTabKey,
  repositoryTabKey,
  sameCheckout,
  type RepositoryFileTab,
  type RepositoryGraphTab,
  type RepositoryTab,
} from "./repositoryTabs";

/**
 * Astrolabe: where a Repositories local graph stands among the section's panes, and which file
 * it shows. A graph follows the file in front of the focused pane of its checkout, or is pinned to
 * one file; it opens as a split to the right of its file.
 */

type Checkout = Pick<RepositoryTab, "environmentId" | "projectId" | "cwd">;

/** A local graph's share of the room it divides with its file. */
const GRAPH_WEIGHT = 0.4;

/** The file a tab key names, when it is a file of `checkout`. */
function fileOf(key: string, checkout: Checkout): RepositoryFileTab | null {
  const tab = parseRepositoryTabKey(key);
  return tab?.kind === "file" && sameCheckout(tab, checkout) ? tab : null;
}

function graphOf(key: string, checkout: Checkout): RepositoryGraphTab | null {
  const tab = parseRepositoryTabKey(key);
  return tab?.kind === "graph" && sameCheckout(tab, checkout) ? tab : null;
}

/** The key of `checkout`'s local graph: pinned to `path`, or following when null. */
export const localGraphKey = (checkout: Checkout, path: string | null = null) =>
  repositoryTabKey({
    kind: "graph",
    environmentId: checkout.environmentId,
    projectId: checkout.projectId,
    cwd: checkout.cwd,
    path,
  });

/**
 * The file a following graph shows: the file in front of the focused pane, when it is of the
 * graph's checkout; else the one it showed (`previous`) while that is still in front somewhere, so
 * focus moving into the graph keeps its picture; else the first of the checkout's files in front
 * of a pane; else the one it showed, or none.
 */
export function followedPath(
  arrangement: Arrangement,
  graph: Checkout,
  previous: string | null,
): string | null {
  const focused = fileOf(focusedPane(arrangement).active, graph);
  if (focused !== null) return focused.path;
  const fronts = leaves(arrangement.root).flatMap((leaf) => fileOf(leaf.active, graph)?.path ?? []);
  if (previous !== null && fronts.includes(previous)) return previous;
  return fronts[0] ?? previous;
}

/**
 * Opens `file`'s local graph beside it (`file` must be open): the file comes to the front of its
 * pane and keeps the focus, so a following graph shows it. A local graph of the checkout already
 * open comes to the front instead of a second opening: in its own pane, or split out to the
 * file's right when it shared the file's pane. One pinned elsewhere is pinned to this file.
 */
export function openLocalGraph(arrangement: Arrangement, file: RepositoryFileTab): Arrangement {
  const fileKey = repositoryTabKey(file);
  if (!leafWithTab(arrangement.root, fileKey)) return arrangement;
  let next = activateTab(arrangement, fileKey);
  const graphs = allTabs(next).flatMap((key) => {
    const graph = graphOf(key, file);
    return graph === null ? [] : [{ key, graph }];
  });
  const chosen =
    graphs.find(({ graph }) => graph.path === file.path) ??
    graphs.find(({ graph }) => graph.path === null) ??
    graphs[0];
  let graphKey = localGraphKey(file);
  if (chosen !== undefined) {
    graphKey = chosen.graph.path === null ? chosen.key : localGraphKey(file, file.path);
    if (graphKey !== chosen.key) next = replaceTab(next, chosen.key, graphKey);
  }
  const filePane = leafWithTab(next.root, fileKey);
  const graphPane = leafWithTab(next.root, graphKey);
  if (filePane === undefined) return next;
  if (graphPane !== undefined && graphPane.id !== filePane.id) {
    return activateTab(next, graphKey, false);
  }
  return openBeside(next, graphKey, filePane.id, "right", { focus: false, weight: GRAPH_WEIGHT });
}

/**
 * The pane a graph opens files in: the one with its file in front, else the first pane that does
 * not hold the graph; null when the graph's pane is the only one.
 */
export function filePaneOf(
  arrangement: Arrangement,
  graphKey: string,
  checkout: Checkout,
  path: string | null,
): string | null {
  const panes = leaves(arrangement.root);
  const front =
    path === null ? undefined : panes.find((leaf) => fileOf(leaf.active, checkout)?.path === path);
  return (front ?? panes.find((leaf) => !leaf.tabs.includes(graphKey)))?.id ?? null;
}

/**
 * Opens the local graph of the file in front of the focused pane of `panes` (the keyboard menu's
 * and the Command Palette's), or null when that is not a repository file.
 */
export function localGraphOpener(panes: PaneArrangementStore | null): (() => void) | null {
  const arrangement = panes?.getSnapshot()?.arrangement;
  if (panes === null || arrangement === undefined) return null;
  const tab = parseRepositoryTabKey(focusedPane(arrangement).active);
  if (tab?.kind !== "file") return null;
  return () => panes.update((next) => openLocalGraph(next, tab));
}

/** `next` in `key`'s place, or in front where it is open already, `key` closing. */
function swapTab(arrangement: Arrangement, key: string, next: string): Arrangement {
  return allTabs(arrangement).includes(next)
    ? activateTab(closeTab(arrangement, key), next)
    : replaceTab(arrangement, key, next);
}

/**
 * Pins a graph to `path`, as unlinking it from the file it follows does, and as clicking a file
 * in a pinned graph re-pins it there.
 */
export function pinLocalGraph(
  arrangement: Arrangement,
  graphKey: string,
  graph: Checkout,
  path: string,
): Arrangement {
  const pinned = localGraphKey(graph, path);
  return pinned === graphKey ? arrangement : swapTab(arrangement, graphKey, pinned);
}

/**
 * Lets a pinned graph follow the file in front again, as linking it does, picking up from the file
 * it was pinned to where that is open.
 */
export function followLocalGraph(
  arrangement: Arrangement,
  graphKey: string,
  graph: RepositoryGraphTab,
): Arrangement {
  const swapped = swapTab(arrangement, graphKey, localGraphKey(graph));
  if (graph.path === null) return swapped;
  const pinnedFile = repositoryTabKey({ ...graph, kind: "file", path: graph.path });
  return leafWithTab(swapped.root, pinnedFile) ? activateTab(swapped, pinnedFile) : swapped;
}
