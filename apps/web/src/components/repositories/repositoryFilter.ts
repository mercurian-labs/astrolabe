import { storedChoice } from "../projects/storedChoice";

/**
 * Astrolabe: the Repos sidebar's filter. The repositories widen (any of them, none picked is every
 * repository), hidden worktrees drop out, and "has changes" narrows to worktrees with uncommitted
 * files. What the focused tab is in shows whatever the filter says.
 */
export interface RepositoryFilter {
  /** Repository keys (`environmentId:projectId`). */
  readonly repositories: ReadonlyArray<string>;
  /** Worktree keys (`environmentId:path`), so a new worktree shows until it is hidden. */
  readonly hidden: ReadonlyArray<string>;
  readonly changed: boolean;
}

export const EMPTY_REPOSITORY_FILTER: RepositoryFilter = {
  repositories: [],
  hidden: [],
  changed: false,
};

/**
 * The repositories the filter keeps, or null for every one. Picks whose repository is gone are
 * ignored, and picking every repository reads as every repository.
 */
export function filterRepositoryKeys(
  filter: RepositoryFilter,
  keys: ReadonlyArray<string>,
): ReadonlySet<string> | null {
  const kept = keys.filter((key) => filter.repositories.includes(key));
  return kept.length === 0 || kept.length === keys.length ? null : new Set(kept);
}

/**
 * Ticks or unticks a repository from the boxes as shown, every one ticked while none is picked,
 * so unticking one keeps the rest. Unticking the last, or ticking every one, is every repository.
 */
export function toggleFilterRepository(
  filter: RepositoryFilter,
  key: string,
  keys: ReadonlyArray<string>,
): RepositoryFilter {
  const shown = filterRepositoryKeys(filter, keys) ?? new Set(keys);
  const next = shown.has(key)
    ? keys.filter((each) => each !== key && shown.has(each))
    : keys.filter((each) => each === key || shown.has(each));
  return { ...filter, repositories: next.length === keys.length ? [] : next };
}

/** Hides a worktree, or shows it again. */
export const setWorktreeHidden = (
  filter: RepositoryFilter,
  key: string,
  hidden: boolean,
): RepositoryFilter => {
  const rest = filter.hidden.filter((each) => each !== key);
  return { ...filter, hidden: hidden ? [...rest, key] : rest };
};

/**
 * A repository's worktrees as the filter shows them: those not hidden, with uncommitted files
 * when that is asked for, and the one holding the focused tab whatever the filter says, marked
 * as outside it.
 */
export function filterWorktrees<Worktree extends { readonly changedFiles: number }>(
  filter: RepositoryFilter,
  worktrees: ReadonlyArray<{ readonly key: string; readonly worktree: Worktree }>,
  focusedKey: string | null,
): ReadonlyArray<{ readonly worktree: Worktree; readonly outside: boolean }> {
  return worktrees.flatMap(({ key, worktree }): { worktree: Worktree; outside: boolean }[] => {
    const passes = !filter.hidden.includes(key) && (!filter.changed || worktree.changedFiles > 0);
    if (passes) return [{ worktree, outside: false }];
    return key === focusedKey ? [{ worktree, outside: true }] : [];
  });
}

/** A filter read back from storage, keeping only what it still understands. */
export function parseRepositoryFilter(stored: string): RepositoryFilter | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    repositories: strings(record.repositories),
    hidden: strings(record.hidden),
    changed: record.changed === true,
  };
}

const repositoryFilterStore = storedChoice<RepositoryFilter>({
  storageKey: "astrolabe:repository-filter:v1",
  fallback: EMPTY_REPOSITORY_FILTER,
  parse: parseRepositoryFilter,
  serialize: (filter) => JSON.stringify(filter),
});

export const useStoredRepositoryFilter = repositoryFilterStore.useValue;

export const storeRepositoryFilter = (filter: RepositoryFilter) =>
  repositoryFilterStore.set(
    filter.repositories.length === 0 && filter.hidden.length === 0 && !filter.changed
      ? EMPTY_REPOSITORY_FILTER
      : filter,
  );

/**
 * Makes sure a repository's worktree shows, for what opens its file tree with no tab of its own:
 * the repository joins the picks when others are picked, and the worktree is no longer hidden.
 * The rest of the filter stays.
 */
export function revealInRepositoryFilter(repositoryKey: string, worktreeKey: string) {
  const filter = repositoryFilterStore.get();
  storeRepositoryFilter({
    ...filter,
    repositories:
      filter.repositories.length === 0 || filter.repositories.includes(repositoryKey)
        ? filter.repositories
        : [...filter.repositories, repositoryKey],
    hidden: filter.hidden.filter((key) => key !== worktreeKey),
  });
}
