import { createSectionPanes } from "~/panes/sectionPanes";
import { isSectionTabKey } from "~/sectionTabs/sectionTabs";
import { pullRequestTargetOfKey } from "../pullRequest/pullRequestTabs";

/**
 * Astrolabe: the Repositories area's tabs and splits: files and changes from every repository,
 * and the chats, documents and pull requests opened beside them.
 */
export const repositoryPanes = createSectionPanes({
  storageKey: "astrolabe:repository-panes:v1",
  historyStorageKey: "astrolabe:repository-tab-history:v1",
  isKey: (key) => isSectionTabKey(key) || pullRequestTargetOfKey(key) !== null,
});
