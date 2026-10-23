import { EnvironmentId, ProjectId } from "@t3tools/contracts";

/**
 * Astrolabe: what a Repositories tab shows, named by its key so any section's panes can hold it
 * and keep it across a reload: a file of a checkout, a checkout's changes (uncommitted, or its
 * branch against its base), or the repositories' Manage view. `cwd` is the checkout: the
 * repository's own, or a thread's working tree.
 */
export type RepositoryTab =
  | {
      readonly kind: "file";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly cwd: string;
      readonly path: string;
    }
  | {
      readonly kind: "diff";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly cwd: string;
      readonly source: RepositoryDiffSource;
    }
  | { readonly kind: "manage" };

export type RepositoryDiffSource = "working-tree" | "branch-range";

const FILE_PREFIX = "repo-file:";
const DIFF_PREFIX = "repo-diff:";
const MANAGE_KEY = "repo-manage";

const encode = (parts: readonly string[]) => parts.map(encodeURIComponent).join(":");

export function repositoryTabKey(tab: RepositoryTab): string {
  switch (tab.kind) {
    case "file":
      return FILE_PREFIX + encode([tab.environmentId, tab.projectId, tab.cwd, tab.path]);
    case "diff":
      return DIFF_PREFIX + encode([tab.environmentId, tab.projectId, tab.cwd, tab.source]);
    case "manage":
      return MANAGE_KEY;
  }
}

function decode(rest: string): string[] | null {
  const parts = rest.split(":");
  if (parts.length !== 4) return null;
  try {
    const decoded = parts.map(decodeURIComponent);
    return decoded.every((part) => part.length > 0) ? decoded : null;
  } catch {
    return null;
  }
}

/** The tab a key names; null for any other key. */
export function parseRepositoryTabKey(key: string): RepositoryTab | null {
  if (key === MANAGE_KEY) return { kind: "manage" };
  if (key.startsWith(FILE_PREFIX)) {
    const parts = decode(key.slice(FILE_PREFIX.length));
    if (parts === null) return null;
    const [environmentId, projectId, cwd, path] = parts as [string, string, string, string];
    return {
      kind: "file",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      cwd,
      path,
    };
  }
  if (key.startsWith(DIFF_PREFIX)) {
    const parts = decode(key.slice(DIFF_PREFIX.length));
    if (parts === null) return null;
    const [environmentId, projectId, cwd, source] = parts as [string, string, string, string];
    if (source !== "working-tree" && source !== "branch-range") return null;
    return {
      kind: "diff",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      cwd,
      source,
    };
  }
  return null;
}

/** A file's name, the last part of its path. */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A file's folder within its checkout, or "" at the top. */
export const folderOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
};
