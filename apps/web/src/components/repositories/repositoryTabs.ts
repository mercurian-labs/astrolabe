import {
  EnvironmentId,
  LanguageServerId,
  ProjectId,
  WikiId,
  type ProjectWorktreeOwner,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * Where a tab reads: a branch, in whichever worktree holds it now (worktrees are reused, so a
 * folder can hold another branch later), or a folder, for a detached checkout.
 */
export type RepositoryCheckout = { readonly branch: string } | { readonly cwd: string };

/**
 * Astrolabe: what a Repositories tab shows, named by its key so any section's panes can hold it
 * and keep it across a reload: a file of a checkout, a checkout's changes (uncommitted, or its
 * branch against its base), or a file's local graph. A file may be a wiki's (a wiki is no
 * project): one in a wiki's worktree that is not a note.
 */
export type RepositoryTab =
  | ({
      readonly kind: "file";
      readonly environmentId: EnvironmentId;
      readonly checkout: RepositoryCheckout;
      readonly path: string;
    } & ProjectWorktreeOwner)
  | {
      readonly kind: "diff";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly checkout: RepositoryCheckout;
      readonly source: RepositoryDiffSource;
      /** The branch a branch-range compares with; absent means the branch's own base. */
      readonly base?: string;
    }
  | {
      readonly kind: "graph";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly checkout: RepositoryCheckout;
      /** The file it is pinned to; null while it follows the file in front (`followedPath`). */
      readonly path: string | null;
    }
  // A project search's results as one editor, run again from the key after a reload.
  | {
      readonly kind: "search";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly cwd: string;
      readonly search: RepositorySearch;
    }
  // Every file's language-server problems in a checkout.
  | {
      readonly kind: "problems";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly cwd: string;
    }
  // Places in a checkout's files someone asked to see together (`openLocationsInMultibuffer`).
  | {
      readonly kind: "locations";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly cwd: string;
      readonly id: string;
    }
  // What a checkout's language server is doing; a wiki's file has one too, so no project here.
  | {
      readonly kind: "language-server-logs";
      readonly environmentId: EnvironmentId;
      readonly cwd: string;
      readonly server: LanguageServerId;
    }
  // A test or entry point run from a code file, in its own terminal (`runTabs`).
  | {
      readonly kind: "run";
      readonly environmentId: EnvironmentId;
      readonly cwd: string;
      /** The folder it runs in, within the checkout; "" at its root. */
      readonly directory: string;
      /** The file it came from. */
      readonly path: string;
      readonly name: string;
      readonly command: string;
    };

/** What a search tab searches for, as the project search palette asked. */
export interface RepositorySearch {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly useRegex: boolean;
  readonly include?: string;
  readonly exclude?: string;
  readonly includeIgnored?: boolean;
}

export type RepositoryFileTab = Extract<RepositoryTab, { kind: "file" }>;
/** A project's file, the only kind with a local graph (the code index is a project's). */
export type ProjectFileTab = Extract<RepositoryFileTab, { readonly projectId: ProjectId }>;
export type RepositoryGraphTab = Extract<RepositoryTab, { kind: "graph" }>;
export type RepositorySearchTab = Extract<RepositoryTab, { kind: "search" }>;
export type RepositoryProblemsTab = Extract<RepositoryTab, { kind: "problems" }>;
export type RepositoryLocationsTab = Extract<RepositoryTab, { kind: "locations" }>;
export type RepositoryLanguageServerLogsTab = Extract<
  RepositoryTab,
  { kind: "language-server-logs" }
>;

/** A tab read from a checkout (a file, changes, a local graph), as against a folder's multi-file views. */
export type CheckoutRepositoryTab = Extract<
  RepositoryTab,
  { readonly checkout: RepositoryCheckout }
>;

/** A file or changes tab with the folder its checkout is in now, and what that checkout is called. */
export type CheckedOutRepositoryTab = CheckoutRepositoryTab & {
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

/** The folder a tab reads now: its own, or the worktree's holding its branch; null when none does. */
export const tabFolder = (
  tab: RepositoryTab,
  worktrees: ReadonlyArray<{ readonly path: string; readonly branch: string | null }> | null,
): string | null =>
  !("checkout" in tab)
    ? tab.cwd
    : "cwd" in tab.checkout
      ? tab.checkout.cwd
      : (holderOf(worktrees ?? [], tab.checkout)?.path ?? null);

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
const WIKI_FILE_PREFIX = "wiki-file:";
// A chosen base rides on the source part; git refuses `~` in a ref name, so it never collides.
const BASE_SEPARATOR = "~";
const GRAPH_PREFIX = "repo-graph:";
const SEARCH_PREFIX = "repo-search:";
const PROBLEMS_PREFIX = "repo-problems:";
const LOCATIONS_PREFIX = "repo-locations:";
const LANGUAGE_SERVER_LOGS_PREFIX = "repo-lsp-logs:";
const RUN_PREFIX = "repo-run:";
// An empty part doesn't survive a key: this stands for the checkout's root.
const ROOT_DIRECTORY = ".";
const isLanguageServerId = Schema.is(LanguageServerId);

function searchOf(text: string): RepositorySearch | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { query, caseSensitive, wholeWord, useRegex, include, exclude, includeIgnored } =
      value as Record<string, unknown>;
    if (typeof query !== "string" || query.length === 0) return null;
    return {
      query,
      caseSensitive: caseSensitive === true,
      wholeWord: wholeWord === true,
      useRegex: useRegex === true,
      ...(typeof include === "string" && include !== "" ? { include } : {}),
      ...(typeof exclude === "string" && exclude !== "" ? { exclude } : {}),
      ...(includeIgnored === true ? { includeIgnored: true } : {}),
    };
  } catch {
    return null;
  }
}

const encode = (parts: readonly string[]) => parts.map(encodeURIComponent).join(":");
// A branch checkout adds a marker part; a folder's keeps the four parts keys had before.
const BRANCH_MARKER = "branch";
const checkoutParts = (checkout: RepositoryCheckout) =>
  "branch" in checkout ? [BRANCH_MARKER, checkout.branch] : [checkout.cwd];

export function repositoryTabKey(tab: RepositoryTab): string {
  switch (tab.kind) {
    case "file":
      return "wikiId" in tab
        ? WIKI_FILE_PREFIX +
            encode([tab.environmentId, tab.wikiId, ...checkoutParts(tab.checkout), tab.path])
        : FILE_PREFIX +
            encode([tab.environmentId, tab.projectId, ...checkoutParts(tab.checkout), tab.path]);
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
    case "graph":
      return (
        GRAPH_PREFIX +
        encode([
          tab.environmentId,
          tab.projectId,
          ...checkoutParts(tab.checkout),
          ...(tab.path === null ? [] : [tab.path]),
        ])
      );
    case "search":
      return (
        SEARCH_PREFIX +
        encode([tab.environmentId, tab.projectId, tab.cwd, JSON.stringify(tab.search)])
      );
    case "problems":
      return PROBLEMS_PREFIX + encode([tab.environmentId, tab.projectId, tab.cwd]);
    case "locations":
      return LOCATIONS_PREFIX + encode([tab.environmentId, tab.projectId, tab.cwd, tab.id]);
    case "language-server-logs":
      return LANGUAGE_SERVER_LOGS_PREFIX + encode([tab.environmentId, tab.cwd, tab.server]);
    case "run":
      return (
        RUN_PREFIX +
        encode([
          tab.environmentId,
          tab.cwd,
          tab.directory === "" ? ROOT_DIRECTORY : tab.directory,
          tab.path,
          tab.name,
          tab.command,
        ])
      );
  }
}

/** Environment, owner (a project or a wiki), checkout and the parts after them, from a key's parts. */
function decode(rest: string): {
  environmentId: string;
  projectId: string;
  checkout: RepositoryCheckout;
  tail: string[];
} | null {
  try {
    const parts = rest.split(":").map(decodeURIComponent);
    if (!parts.every((part) => part.length > 0)) return null;
    const [environmentId, projectId, first, ...after] = parts;
    if (environmentId === undefined || projectId === undefined || first === undefined) return null;
    if (first !== BRANCH_MARKER)
      return { environmentId, projectId, checkout: { cwd: first }, tail: after };
    const [branch, ...tail] = after;
    return branch === undefined ? null : { environmentId, projectId, checkout: { branch }, tail };
  } catch {
    return null;
  }
}

/** A folder-scoped key's parts (search, problems, places), when there are as many as `counts` allows. */
function decodeParts(rest: string, counts: readonly number[] = [4]): string[] | null {
  const parts = rest.split(":");
  if (!counts.includes(parts.length)) return null;
  try {
    const decoded = parts.map(decodeURIComponent);
    return decoded.every((part) => part.length > 0) ? decoded : null;
  } catch {
    return null;
  }
}

/** A decoded file or changes key, which ends in exactly one part. */
function decodeOne(rest: string) {
  const parts = decode(rest);
  const [last, ...more] = parts?.tail ?? [];
  return parts === null || last === undefined || more.length > 0 ? null : { ...parts, last };
}

/** The tab a key names; null for any other key. */
export function parseRepositoryTabKey(key: string): RepositoryTab | null {
  if (key.startsWith(FILE_PREFIX)) {
    const parts = decodeOne(key.slice(FILE_PREFIX.length));
    if (parts === null) return null;
    const { environmentId, projectId, checkout, last: path } = parts;
    return {
      kind: "file",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      checkout,
      path,
    };
  }
  if (key.startsWith(WIKI_FILE_PREFIX)) {
    const parts = decodeOne(key.slice(WIKI_FILE_PREFIX.length));
    if (parts === null) return null;
    const { environmentId, projectId: wikiId, checkout, last: path } = parts;
    return {
      kind: "file",
      environmentId: EnvironmentId.make(environmentId),
      wikiId: WikiId.make(wikiId),
      checkout,
      path,
    };
  }
  if (key.startsWith(DIFF_PREFIX)) {
    const parts = decodeOne(key.slice(DIFF_PREFIX.length));
    if (parts === null) return null;
    const { environmentId, projectId, checkout, last } = parts;
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
  if (key.startsWith(GRAPH_PREFIX)) {
    const parts = decode(key.slice(GRAPH_PREFIX.length));
    if (parts === null || parts.tail.length > 1) return null;
    const { environmentId, projectId, checkout, tail } = parts;
    return {
      kind: "graph",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      checkout,
      path: tail[0] ?? null,
    };
  }
  if (key.startsWith(SEARCH_PREFIX)) {
    const parts = decodeParts(key.slice(SEARCH_PREFIX.length));
    if (parts === null) return null;
    const [environmentId, projectId, cwd, text] = parts as [string, string, string, string];
    const search = searchOf(text);
    if (search === null) return null;
    return {
      kind: "search",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      cwd,
      search,
    };
  }
  if (key.startsWith(PROBLEMS_PREFIX)) {
    const parts = decodeParts(key.slice(PROBLEMS_PREFIX.length), [3]);
    if (parts === null) return null;
    const [environmentId, projectId, cwd] = parts as [string, string, string];
    return {
      kind: "problems",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      cwd,
    };
  }
  if (key.startsWith(LOCATIONS_PREFIX)) {
    const parts = decodeParts(key.slice(LOCATIONS_PREFIX.length));
    if (parts === null) return null;
    const [environmentId, projectId, cwd, id] = parts as [string, string, string, string];
    return {
      kind: "locations",
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      cwd,
      id,
    };
  }
  if (key.startsWith(LANGUAGE_SERVER_LOGS_PREFIX)) {
    const parts = decodeParts(key.slice(LANGUAGE_SERVER_LOGS_PREFIX.length), [3]);
    if (parts === null) return null;
    const [environmentId, cwd, server] = parts as [string, string, string];
    if (!isLanguageServerId(server)) return null;
    return {
      kind: "language-server-logs",
      environmentId: EnvironmentId.make(environmentId),
      cwd,
      server,
    };
  }
  if (key.startsWith(RUN_PREFIX)) {
    const parts = decodeParts(key.slice(RUN_PREFIX.length), [6]);
    if (parts === null) return null;
    const [environmentId, cwd, directory, path, name, command] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    return {
      kind: "run",
      environmentId: EnvironmentId.make(environmentId),
      cwd,
      directory: directory === ROOT_DIRECTORY ? "" : directory,
      path,
      name,
      command,
    };
  }
  return null;
}

/** A tab's owner, as one string to compare. */
const ownerOf = (tab: ProjectWorktreeOwner) =>
  "wikiId" in tab ? `wiki:${tab.wikiId}` : `project:${tab.projectId}`;

type CheckoutOf = {
  readonly environmentId: EnvironmentId;
  readonly checkout: RepositoryCheckout;
} & ProjectWorktreeOwner;

/** Whether two tabs read the same checkout: one environment's project or wiki, on one branch or folder. */
export const sameCheckout = (left: CheckoutOf, right: CheckoutOf) =>
  left.environmentId === right.environmentId &&
  ownerOf(left) === ownerOf(right) &&
  ("branch" in left.checkout
    ? "branch" in right.checkout && left.checkout.branch === right.checkout.branch
    : "cwd" in right.checkout && left.checkout.cwd === right.checkout.cwd);

/** A file's name, the last part of its path. */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A file's folder within its checkout, or "" at the top. */
export const folderOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
};
