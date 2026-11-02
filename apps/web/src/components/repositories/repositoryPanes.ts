import { allTabs, focusedPane } from "~/panes/arrangement";
import { workspace } from "~/panes/workspace";
import { filePaneOf, openLocalGraph } from "./localGraph";
import { parseRepositoryTabKey, repositoryTabKey, type RepositoryFileTab } from "./repositoryTabs";

/**
 * Opens a file's local graph as a split to its right, showing the file first where it is not open
 * (see `openLocalGraph`).
 */
export function showLocalGraph(file: RepositoryFileTab) {
  const key = repositoryTabKey(file);
  const arrangement = workspace.arrangement();
  if (!allTabs(arrangement).includes(key)) {
    // From a graph's pane the file opens where that graph opens files, not over the graph.
    const front = focusedPane(arrangement).active;
    const graph = parseRepositoryTabKey(front);
    const paneId = graph?.kind === "graph" ? filePaneOf(arrangement, front, graph, null) : null;
    workspace.show(key, paneId ?? undefined);
  }
  workspace.update((next) => openLocalGraph(next, file));
}
