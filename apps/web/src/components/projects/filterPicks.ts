/**
 * Astrolabe: what a sidebar filter's checkboxes pick, shared by the Agents, Projects and Wikis
 * filters. `[]` is every key, `null` is none, anything else is the keys picked. Picks whose key is
 * gone are ignored, so picks of only those read as every key again.
 */
export type FilterPicks = ReadonlyArray<string> | null;

/** The keys the picks keep, or null for every key. Picking every key reads as every key. */
export function keptFilterKeys(
  picks: FilterPicks,
  keys: ReadonlyArray<string>,
): ReadonlySet<string> | null {
  if (picks === null) return new Set();
  const kept = keys.filter((key) => picks.includes(key));
  return kept.length === 0 || kept.length === keys.length ? null : new Set(kept);
}

/** Ticks or unticks one key from the boxes as shown, so unticking one under All keeps the rest. */
export function toggleFilterPick(
  picks: FilterPicks,
  key: string,
  keys: ReadonlyArray<string>,
): FilterPicks {
  const shown = keptFilterKeys(picks, keys) ?? new Set(keys);
  const next = keys.filter((each) => (each === key ? !shown.has(each) : shown.has(each)));
  if (next.length === keys.length) return [];
  return next.length === 0 ? null : next;
}

/** The All box: ticking it picks every key, unticking it picks none. */
export const toggleFilterAll = (picks: FilterPicks, keys: ReadonlyArray<string>): FilterPicks =>
  keptFilterKeys(picks, keys) === null ? null : [];

/** Picks read back from storage. */
export const parseFilterPicks = (value: unknown): FilterPicks =>
  value === null
    ? null
    : Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
