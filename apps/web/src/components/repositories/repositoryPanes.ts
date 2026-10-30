import { allTabs } from "~/panes/arrangement";
import { createSectionPanes } from "~/panes/sectionPanes";
import { isSectionTabKey } from "~/sectionTabs/sectionTabs";
import { pullRequestTargetOfKey } from "../pullRequest/pullRequestTabs";
import { openLocalGraph } from "./localGraph";
import { repositoryTabKey, type RepositoryFileTab } from "./repositoryTabs";

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
  if (!allTabs(repositoryPanes.arrangement()).includes(key)) repositoryPanes.show(key);
  repositoryPanes.store.update((arrangement) => openLocalGraph(arrangement, file));
}
