import { EnvironmentId, ProjectId } from "@t3tools/contracts";

/**
 * Where a tab reads: a branch, in whichever worktree holds it now (worktrees are reused, so a
 * folder can hold another branch later), or a folder, for a detached checkout.
 */
export type RepositoryCheckout = { readonly branch: string } | { readonly cwd: string };

/**
 * Astrolabe: what a Repositories tab shows, named by its key so any section's panes can hold it
 * and keep it across a reload: a file of a checkout, a checkout's changes (uncommitted, or its
 * branch against its base).
 */
export type RepositoryTab =
  | {
      readonly kind: "file";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly checkout: RepositoryCheckout;
      readonly path: string;
    }
  | {
      readonly kind: "diff";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly checkout: RepositoryCheckout;
      readonly source: RepositoryDiffSource;
    };

/** A file or changes tab with the folder its checkout is in now. */
export type CheckedOutRepositoryTab = RepositoryTab & {
  readonly cwd: string;
};

/**
 * A worktree's checkout: a linked worktree's branch, as it can be reused for another; the main
 * checkout's folder, which is never reused here; a detached checkout's folder.
 */
export const checkoutOf = (worktree: {
  readonly path: string;
  readonly isMain: boolean;
  readonly branch: string | null;
}): RepositoryCheckout =>
  worktree.isMain || worktree.branch === null
    ? { cwd: worktree.path }
    : { branch: worktree.branch };

export type RepositoryDiffSource = "working-tree" | "branch-range";

const FILE_PREFIX = "repo-file:";
const DIFF_PREFIX = "repo-diff:";

const encode = (parts: readonly string[]) => parts.map(encodeURIComponent).join(":");
// A branch checkout adds a marker part; a folder's keeps the four parts keys had before.
const BRANCH_MARKER = "branch";
const checkoutParts = (checkout: RepositoryCheckout) =>
  "branch" in checkout ? [BRANCH_MARKER, checkout.branch] : [checkout.cwd];

export function repositoryTabKey(tab: RepositoryTab): string {
  switch (tab.kind) {
    case "file":
      return (
        FILE_PREFIX +
        encode([tab.environmentId, tab.projectId, ...checkoutParts(tab.checkout), tab.path])
      );
    case "diff":
      return (
        DIFF_PREFIX +
        encode([tab.environmentId, tab.projectId, ...checkoutParts(tab.checkout), tab.source])
      );
  }
}

/** Environment, project, checkout and the last part, from four or five key parts. */
function decode(
  rest: string,
): [environmentId: string, projectId: string, checkout: RepositoryCheckout, last: string] | null {
  const parts = rest.split(":");
  if (parts.length !== 4 && parts.length !== 5) return null;
  try {
    const decoded = parts.map(decodeURIComponent);
    if (!decoded.every((part) => part.length > 0)) return null;
    if (decoded.length === 4) {
      const [environmentId, projectId, cwd, last] = decoded as [string, string, string, string];
      return [environmentId, projectId, { cwd }, last];
    }
    const [environmentId, projectId, marker, branch, last] = decoded as [
      string,
      string,
      string,
      string,
      string,
    ];
    return marker === BRANCH_MARKER ? [environmentId, projectId, { branch }, last] : null;
  } catch {
    return null;
  }
}

/** The tab a key names; null for any other key. */
export function parseRepositoryTabKey(key: string): RepositoryTab | null {
  if (key.startsWith(FILE_PREFIX)) {
    const parts = decode(key.slice(FILE_PREFIX.length));
    if (parts === null) return null;
    const [environmentId, projectId, checkout, path] = parts;
    return {
      kind: "file",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      checkout,
      path,
    };
  }
  if (key.startsWith(DIFF_PREFIX)) {
    const parts = decode(key.slice(DIFF_PREFIX.length));
    if (parts === null) return null;
    const [environmentId, projectId, checkout, source] = parts;
    if (source !== "working-tree" && source !== "branch-range") return null;
    return {
      kind: "diff",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      checkout,
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
