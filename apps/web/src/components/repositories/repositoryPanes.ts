import { allTabs, focusedPane } from "~/panes/arrangement";
import { createSectionPanes } from "~/panes/sectionPanes";
import { isSectionTabKey } from "~/sectionTabs/sectionTabs";
import { pullRequestTargetOfKey } from "../pullRequest/pullRequestTabs";
import { filePaneOf, openLocalGraph } from "./localGraph";
import { parseRepositoryTabKey, repositoryTabKey, type RepositoryFileTab } from "./repositoryTabs";

/**
 * Astrolabe: the Repositories area's tabs and splits: files and changes from every repository,
 * and the chats, documents and pull requests opened beside them.
 */
export const repositoryPanes = createSectionPanes({
  storageKey: "astrolabe:repository-panes:v1",
  historyStorageKey: "astrolabe:repository-tab-history:v1",
  isKey: (key) => isSectionTabKey(key) || pullRequestTargetOfKey(key) !== null,
});

/**
 * Opens a file's local graph as a split to its right, showing the file first where it is not open
 * (see `openLocalGraph`).
 */
export function showLocalGraph(file: RepositoryFileTab) {
  const key = repositoryTabKey(file);
  const arrangement = repositoryPanes.arrangement();
  if (!allTabs(arrangement).includes(key)) {
    // From a graph's pane the file opens where that graph opens files, not over the graph.
    const front = focusedPane(arrangement).active;
    const graph = parseRepositoryTabKey(front);
    const paneId = graph?.kind === "graph" ? filePaneOf(arrangement, front, graph, null) : null;
    repositoryPanes.show(key, paneId ?? undefined);
  }
  repositoryPanes.store.update((next) => openLocalGraph(next, file));
}
