import {
  keptFilterKeys,
  parseFilterPicks,
  toggleFilterAll,
  toggleFilterPick,
  type FilterPicks,
} from "../projects/filterPicks";
import { storedChoice } from "../projects/storedChoice";

/**
 * Astrolabe: the Wikis list's filter. The wikis widen (any of them, none picked is every wiki),
 * "has changes" narrows to the documents an open change request touches, and hidden worktrees
 * drop out of the file trees.
 */
export interface WikiFilter {
  /** Wiki scope keys (`wikiScopeKey`), as `FilterPicks` reads them. */
  readonly wikis: FilterPicks;
  readonly changed: boolean;
  /** Worktree keys (`environmentId:path`), so a new worktree shows until it is hidden. */
  readonly hidden: ReadonlyArray<string>;
}

export const EMPTY_WIKI_FILTER: WikiFilter = { wikis: [], changed: false, hidden: [] };

/** Hides a wiki's worktree from the file trees, or shows it again. */
export const setWikiWorktreeHidden = (
  filter: WikiFilter,
  key: string,
  hidden: boolean,
): WikiFilter => {
  const rest = filter.hidden.filter((each) => each !== key);
  return { ...filter, hidden: hidden ? [...rest, key] : rest };
};

/** The wikis the filter keeps, or null for every wiki. */
export const filterWikiKeys = (
  filter: WikiFilter,
  keys: ReadonlyArray<string>,
): ReadonlySet<string> | null => keptFilterKeys(filter.wikis, keys);

export const toggleFilterWiki = (
  filter: WikiFilter,
  key: string,
  keys: ReadonlyArray<string>,
): WikiFilter => ({ ...filter, wikis: toggleFilterPick(filter.wikis, key, keys) });

export const toggleFilterAllWikis = (
  filter: WikiFilter,
  keys: ReadonlyArray<string>,
): WikiFilter => ({
  ...filter,
  wikis: toggleFilterAll(filter.wikis, keys),
});

/** Whether a document passes: its wiki is kept, and it has changes when that is asked for. */
export function wikiFilterKeepsDocument(
  filter: WikiFilter,
  kept: ReadonlySet<string> | null,
  document: { readonly wikiKey: string; readonly changes: ReadonlyArray<unknown> },
): boolean {
  if (kept !== null && !kept.has(document.wikiKey)) return false;
  return !filter.changed || document.changes.length > 0;
}

/** A filter read back from storage, keeping only what it still understands. */
export function parseWikiFilter(stored: string): WikiFilter | null {
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
    wikis: parseFilterPicks(record.wikis),
    changed: record.changed === true,
    hidden: strings(record.hidden),
  };
}

const wikiFilterStore = storedChoice<WikiFilter>({
  storageKey: "astrolabe:wiki-filter:v1",
  fallback: EMPTY_WIKI_FILTER,
  parse: parseWikiFilter,
  serialize: (filter) => JSON.stringify(filter),
});

export const useStoredWikiFilter = wikiFilterStore.useValue;

export const storeWikiFilter = (filter: WikiFilter) =>
  wikiFilterStore.set(
    filter.wikis?.length === 0 && !filter.changed && filter.hidden.length === 0
      ? EMPTY_WIKI_FILTER
      : filter,
  );
