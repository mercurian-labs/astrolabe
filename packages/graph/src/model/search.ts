/**
 * Search and the hide toggles. A search narrows the shown notes to those whose
 * names match and their neighbors; the graph is the result list. The hide
 * toggles apply after it, so a hidden kind stays hidden even beside a match.
 */
import { neighborsOf, type MemoryIndex } from "./memory.ts";

export interface GraphFilters {
  readonly search: string;
  readonly hideFrontier: boolean;
  readonly hideOrphans: boolean;
}

export const NO_FILTERS: GraphFilters = { search: "", hideFrontier: false, hideOrphans: false };

export const normalizeQuery = (query: string) => query.trim().toLocaleLowerCase();

/** The candidates whose names contain the query, ignoring case. */
export function searchMatches(
  state: MemoryIndex,
  candidates: Iterable<string>,
  query: string,
): Set<string> {
  const needle = normalizeQuery(query);
  const matches = new Set<string>();
  if (needle.length === 0) return matches;
  for (const id of candidates) {
    if ((state.byId.get(id)?.name ?? id).toLocaleLowerCase().includes(needle)) matches.add(id);
  }
  return matches;
}

/** The notes left shown after the filters, within the candidates a reading offers. */
export function applyFilters(
  state: MemoryIndex,
  candidates: ReadonlySet<string>,
  filters: GraphFilters,
): Set<string> {
  let shown = new Set(candidates);
  if (normalizeQuery(filters.search).length > 0) {
    const matches = searchMatches(state, candidates, filters.search);
    shown = new Set(matches);
    for (const id of matches) {
      for (const neighbor of neighborsOf(state, id))
        if (candidates.has(neighbor)) shown.add(neighbor);
    }
  }
  return new Set(
    [...shown].filter((id) => {
      if (filters.hideFrontier && state.byId.get(id)?.frontier === true) return false;
      // An orphan links to nothing: its degree says so without listing every orphan.
      if (filters.hideOrphans && (state.degree.get(id) ?? 0) === 0) return false;
      return true;
    }),
  );
}
