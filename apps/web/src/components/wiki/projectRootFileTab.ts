import {
  parseProjectRootId,
  projectRootId,
  WikiId,
  type EnvironmentId,
  type ProjectId,
  type ProjectRootCheckout,
  type RootKey,
} from "@t3tools/contracts";
import { workspaceRelativeFilePath } from "@t3tools/shared/path";

import type { RepositoryFileTab } from "../repositories/repositoryTabs";

/**
 * The project root an old wiki id names: a root id as it is, else the root the server said an
 * old registered wiki became (`resolved`, the id its index answers with); null when neither is one.
 */
export function legacyWikiRoot(
  wikiId: string,
  resolved: string | null,
): { readonly projectId: ProjectId; readonly rootKey: RootKey } | null {
  return parseProjectRootId(wikiId) ?? (resolved === null ? null : parseProjectRootId(resolved));
}

/**
 * The Projects file tab for `file` in a root's own folder, as the Projects tree opens it: a root
 * inside the project's folder as the project's file, any other as its root's. Null for a root the
 * project no longer has, or one not on disk.
 */
export function projectRootFileTab(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly roots: ReadonlyArray<ProjectRootCheckout>;
  readonly rootKey: RootKey;
  readonly file: string;
}): RepositoryFileTab | null {
  const { environmentId, projectId, roots, rootKey, file } = input;
  const root = roots.find((each) => each.key === rootKey);
  if (root === undefined || root.state === "missing") return null;
  const workspace = roots.find((each) => each.kind === "workspace");
  const inWorkspace =
    workspace === undefined ? null : workspaceRelativeFilePath(root.path, workspace.path);
  if (workspace !== undefined && inWorkspace !== null) {
    return {
      kind: "file",
      environmentId,
      projectId,
      checkout: { cwd: workspace.path },
      path: inWorkspace === "." || inWorkspace === "" ? file : `${inWorkspace}/${file}`,
    };
  }
  return {
    kind: "file",
    environmentId,
    wikiId: WikiId.make(projectRootId(projectId, root.key)),
    checkout: { cwd: root.path },
    path: file,
  };
}
