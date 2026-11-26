import type { ProjectFile } from "@mercurian/wiki/resolve-link";
import { isDocumentFile, resolveProjectWikiLink } from "@t3tools/client-runtime/wikiLogic";
import {
  parseProjectRootId,
  projectRootId,
  WikiId,
  type EnvironmentId,
  type ProjectId,
  type ProjectRootCheckout,
  type ProjectWorktreeOwner,
  type RootKey,
  type WikiIndexResult,
} from "@t3tools/contracts";
import { workspaceRelativeFilePath } from "@t3tools/shared/path";

import type { RepositoryCheckout, RepositoryFileTab } from "./repositoryTabs";

/**
 * Astrolabe: the project and root a file tab is opened from: a project's own tab is its workspace
 * root's (null key), a tracked folder's carries its root id. A wiki registered before projects had
 * roots has neither, and its files stay plain files.
 */
export function projectDocumentOwner(
  owner: ProjectWorktreeOwner,
): { readonly projectId: ProjectId; readonly rootKey: RootKey | null } | null {
  if ("projectId" in owner) return { projectId: owner.projectId, rootKey: null };
  return parseProjectRootId(owner.wikiId);
}

/**
 * Whether a file tab shows the file in the document editors: a note or a base. A canvas keeps the
 * code editor until its board can save on disk too.
 */
export const opensAsProjectDocument = (path: string): boolean =>
  isDocumentFile(path) && !/\.canvas$/i.test(path);

/** A document as its root holds it: which root, its path there, and the folder read and written. */
export interface LocatedDocument {
  readonly root: ProjectRootCheckout;
  readonly file: string;
  readonly checkout: string;
  /** The root's folder from the tab's folder: "" when they're one, else a nested repository's. */
  readonly prefix: string;
}

const within = (folder: string, path: string) => {
  const relative = workspaceRelativeFilePath(path, folder);
  return relative === null ? null : relative === "." ? "" : relative;
};

/**
 * Where a file tab's document belongs. In a root's live checkout, the deepest root holding the
 * file owns it, so a doc in a nested repository is that repository's. A worktree is its own root's.
 */
export function locateProjectDocument(
  roots: ReadonlyArray<ProjectRootCheckout>,
  owner: RootKey | null,
  cwd: string,
  path: string,
): LocatedDocument | null {
  const own = roots.find((root) =>
    owner === null ? root.kind === "workspace" : root.key === owner,
  );
  if (own === undefined) return null;
  if (within(own.path, cwd) !== "") return { root: own, file: path, checkout: cwd, prefix: "" };
  const absolute = `${cwd.replace(/\/+$/, "")}/${path}`;
  let found: { root: ProjectRootCheckout; file: string } | null = null;
  for (const root of roots) {
    if (root.state === "missing") continue;
    const file = within(root.path, absolute);
    if (file === null || file === "") continue;
    if (found === null || file.length < found.file.length) found = { root, file };
  }
  if (found === null) return null;
  return {
    root: found.root,
    file: found.file,
    checkout: found.root.path,
    prefix: within(cwd, found.root.path) ?? "",
  };
}

/**
 * The file tab a project document opens in: the current root's in the tab's own checkout, a root in
 * the project's folder as the project's file (as its tree shows it), any other root's in its folder.
 */
export function projectDocumentTab(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly roots: ReadonlyArray<ProjectRootCheckout>;
  readonly target: ProjectFile;
  readonly current: {
    readonly owner: ProjectWorktreeOwner;
    readonly checkout: RepositoryCheckout;
    readonly located: LocatedDocument;
  };
}): RepositoryFileTab | null {
  const { environmentId, projectId, roots, target, current } = input;
  if (target.root === current.located.root.key) {
    const prefix = current.located.prefix;
    return {
      kind: "file",
      environmentId,
      ...current.owner,
      checkout: current.checkout,
      path: prefix === "" ? target.file : `${prefix}/${target.file}`,
    };
  }
  const root = roots.find((each) => each.key === target.root);
  if (root === undefined || root.state === "missing") return null;
  const workspace = roots.find((each) => each.kind === "workspace");
  const inWorkspace = workspace === undefined ? null : within(workspace.path, root.path);
  if (workspace !== undefined && inWorkspace !== null) {
    return {
      kind: "file",
      environmentId,
      projectId,
      checkout: { cwd: workspace.path },
      path: inWorkspace === "" ? target.file : `${inWorkspace}/${target.file}`,
    };
  }
  return {
    kind: "file",
    environmentId,
    wikiId: WikiId.make(projectRootId(projectId, root.key)),
    checkout: { cwd: root.path },
    path: target.file,
  };
}

/** A project's roots' indexes, by root key. */
export type ProjectIndexes = ReadonlyMap<string, WikiIndexResult>;

/** The documents of every root linking to `target`, each once, in index order. */
export function projectBacklinks(
  indexes: ProjectIndexes,
  target: ProjectFile,
): ReadonlyArray<ProjectFile> {
  const found: ProjectFile[] = [];
  const seen = new Set<string>();
  for (const [root, index] of indexes) {
    const fileOf = new Map(index.notes.map((note) => [note.name, note.file] as const));
    for (const edge of index.links) {
      const file = fileOf.get(edge.from) ?? edge.from;
      const id = `${root}\0${file}`;
      if (seen.has(id) || (root === target.root && file === target.file)) continue;
      const landed = resolveProjectWikiLink(indexes, edge.to, { root, file }).file;
      if (landed?.root !== target.root || landed.file !== target.file) continue;
      seen.add(id);
      found.push({ root, file });
    }
  }
  return found;
}
