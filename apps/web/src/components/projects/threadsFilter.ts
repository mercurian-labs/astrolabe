import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "../Sidebar.logic";
import { storedChoice } from "./storedChoice";

/**
 * Astrolabe: the thread list's filter. Each dimension is a set; values in one dimension widen
 * (any of them), dimensions narrow (all of them), and an empty dimension filters nothing.
 */
export interface ThreadsFilter {
  /** Project group keys. */
  readonly projects: ReadonlyArray<string>;
  readonly statuses: ReadonlyArray<ThreadStatusFilter>;
}

export const THREAD_STATUS_FILTERS = ["needs-you", "working", "errored"] as const;
export type ThreadStatusFilter = (typeof THREAD_STATUS_FILTERS)[number];

export const THREAD_STATUS_FILTER_LABELS: Record<ThreadStatusFilter, string> = {
  "needs-you": "Needs you",
  working: "Working",
  errored: "Errored",
};

export const EMPTY_THREADS_FILTER: ThreadsFilter = { projects: [], statuses: [] };

/** The filter a row's status falls under, as its status dot reads it. */
export function threadStatusFilterOf(status: SidebarThreadStatus): ThreadStatusFilter | null {
  switch (status) {
    case "approval":
    case "input":
    case "request":
      return "needs-you";
    case "working":
    case "waiting":
      return "working";
    case "failed":
    case "limited":
      return "errored";
    case "ready":
      return null;
  }
}

/** Whether a thread passes the status filter; no statuses passes every thread. */
export function threadMatchesStatuses(
  thread: Parameters<typeof resolveSidebarThreadStatus>[0],
  statuses: ReadonlyArray<ThreadStatusFilter>,
): boolean {
  if (statuses.length === 0) return true;
  const status = threadStatusFilterOf(resolveSidebarThreadStatus(thread));
  return status !== null && statuses.includes(status);
}

const threadsFilterIsEmpty = (filter: ThreadsFilter): boolean =>
  filter.projects.length === 0 && filter.statuses.length === 0;

const without = <T>(values: ReadonlyArray<T>, removed: ReadonlyArray<T>) =>
  values.filter((value) => !removed.includes(value));
const toggled = <T>(values: ReadonlyArray<T>, value: T) =>
  values.includes(value) ? without(values, [value]) : [...values, value];

export const toggleFilterStatus = (
  filter: ThreadsFilter,
  status: ThreadStatusFilter,
): ThreadsFilter => ({ ...filter, statuses: toggled(filter.statuses, status) });

/**
 * The project groups the filter keeps, or null for every project. Picks whose project is gone are
 * ignored, so a filter of only those reads as every project and returns with them.
 */
export function filterProjectGroupKeys(
  filter: ThreadsFilter,
  groupKeys: ReadonlyArray<string>,
): ReadonlySet<string> | null {
  const kept = groupKeys.filter((key) => filter.projects.includes(key));
  return kept.length === 0 ? null : new Set(kept);
}

/** A project's checkbox. Every project is in while none is picked, so All projects ticks them all. */
export const filterHasProject = (
  filter: ThreadsFilter,
  key: string,
  groupKeys: ReadonlyArray<string>,
): boolean => filterProjectGroupKeys(filter, groupKeys)?.has(key) ?? true;

/**
 * Ticks or unticks a project from the boxes as shown, so unticking one under All projects keeps
 * the rest. Ticking every project, or unticking the last, is All projects again.
 */
export function toggleFilterProject(
  filter: ThreadsFilter,
  key: string,
  groupKeys: ReadonlyArray<string>,
): ThreadsFilter {
  const projects =
    filterProjectGroupKeys(filter, groupKeys) === null
      ? without(groupKeys, [key])
      : toggled(filter.projects, key);
  const kept = filterProjectGroupKeys({ ...filter, projects }, groupKeys);
  const everyProject = kept === null || groupKeys.every((each) => kept.has(each));
  return { ...filter, projects: everyProject ? [] : projects };
}

/** A filter read back from storage, keeping only what it still understands. */
export function parseThreadsFilter(stored: string): ThreadsFilter | null {
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
    projects: strings(record.projects),
    statuses: strings(record.statuses).filter((status): status is ThreadStatusFilter =>
      (THREAD_STATUS_FILTERS as ReadonlyArray<string>).includes(status),
    ),
  };
}

const threadsFilterStore = storedChoice<ThreadsFilter>({
  storageKey: "astrolabe:threads-filter:v1",
  fallback: EMPTY_THREADS_FILTER,
  parse: parseThreadsFilter,
  serialize: (filter) => JSON.stringify(filter),
});

export const useStoredThreadsFilter = threadsFilterStore.useValue;

export const storeThreadsFilter = (filter: ThreadsFilter) =>
  threadsFilterStore.set(threadsFilterIsEmpty(filter) ? EMPTY_THREADS_FILTER : filter);
