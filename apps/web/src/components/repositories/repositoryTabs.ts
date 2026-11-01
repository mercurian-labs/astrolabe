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
      /** The branch a branch-range compares with; absent means the branch's own base. */
      readonly base?: string;
    };

/** A file or changes tab with the folder its checkout is in now, and what that checkout is called. */
export type CheckedOutRepositoryTab = RepositoryTab & {
  readonly cwd: string;
  readonly checkoutName: string;
};

/** The worktree holding a checkout now: the one on its branch, or the one in its folder. */
export const holderOf = <
  Worktree extends { readonly path: string; readonly branch: string | null },
>(
  worktrees: ReadonlyArray<Worktree>,
  checkout: RepositoryCheckout,
): Worktree | null =>
  worktrees.find((worktree) =>
    "branch" in checkout ? worktree.branch === checkout.branch : worktree.path === checkout.cwd,
  ) ?? null;

/** A checkout's name: its branch, or a folder's branch, or the folder's own name when detached. */
export const checkoutName = (
  checkout: RepositoryCheckout,
  holder: { readonly branch: string | null } | null,
) =>
  "branch" in checkout
    ? checkout.branch
    : (holder?.branch ?? checkout.cwd.slice(checkout.cwd.lastIndexOf("/") + 1));

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
// A chosen base rides on the source part; git refuses `~` in a ref name, so it never collides.
const BASE_SEPARATOR = "~";

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
        encode([
          tab.environmentId,
          tab.projectId,
          ...checkoutParts(tab.checkout),
          tab.base === undefined ? tab.source : `${tab.source}${BASE_SEPARATOR}${tab.base}`,
        ])
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
    const [environmentId, projectId, checkout, last] = parts;
    const separator = last.indexOf(BASE_SEPARATOR);
    const source = separator === -1 ? last : last.slice(0, separator);
    const base = separator === -1 ? undefined : last.slice(separator + 1);
    if (source !== "working-tree" && source !== "branch-range") return null;
    if (base !== undefined && (source !== "branch-range" || base === "")) return null;
    return {
      kind: "diff",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      checkout,
      source,
      ...(base === undefined ? {} : { base }),
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
