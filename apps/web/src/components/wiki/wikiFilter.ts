import { storedChoice } from "../projects/storedChoice";

/**
 * Astrolabe: the Wikis list's filter. The wikis widen (any of them, none picked is every wiki) and
 * "has changes" narrows to the documents an open change request touches.
 */
export interface WikiFilter {
  /** Wiki scope keys (`wikiScopeKey`). */
  readonly wikis: ReadonlyArray<string>;
  readonly changed: boolean;
}

export const EMPTY_WIKI_FILTER: WikiFilter = { wikis: [], changed: false };

/**
 * The wikis the filter keeps, or null for every wiki. Picks whose wiki is gone are ignored, and
 * picking every wiki reads as every wiki, so a filter of only those reads as none.
 */
export function filterWikiKeys(
  filter: WikiFilter,
  keys: ReadonlyArray<string>,
): ReadonlySet<string> | null {
  const kept = keys.filter((key) => filter.wikis.includes(key));
  return kept.length === 0 || kept.length === keys.length ? null : new Set(kept);
}

/**
 * Ticks or unticks a wiki from the boxes as shown, every wiki ticked while none is picked, so
 * unticking one keeps the rest. Unticking the last, or ticking every one, is every wiki again.
 */
export function toggleFilterWiki(
  filter: WikiFilter,
  key: string,
  keys: ReadonlyArray<string>,
): WikiFilter {
  const shown = filterWikiKeys(filter, keys) ?? new Set(keys);
  const next = shown.has(key)
    ? keys.filter((each) => each !== key && shown.has(each))
    : keys.filter((each) => each === key || shown.has(each));
  return { ...filter, wikis: next.length === keys.length ? [] : next };
}

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
  return {
    wikis: Array.isArray(record.wikis)
      ? record.wikis.filter((entry): entry is string => typeof entry === "string")
      : [],
    changed: record.changed === true,
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
  wikiFilterStore.set(filter.wikis.length === 0 && !filter.changed ? EMPTY_WIKI_FILTER : filter);
