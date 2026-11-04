import {
  filterSidebarV2VisibleThreads,
  resolveSidebarThreadStatus,
  type SidebarThreadStatus,
} from "../Sidebar.logic";
import {
  keptFilterKeys,
  parseFilterPicks,
  toggleFilterAll,
  toggleFilterPick,
  type FilterPicks,
} from "./filterPicks";
import { storedChoice } from "./storedChoice";

/**
 * Astrolabe: the thread list's filter. Each dimension is a set; values in one dimension widen
 * (any of them), dimensions narrow (all of them), and an empty dimension filters nothing.
 */
export interface ThreadsFilter {
  /** Project group keys, as `FilterPicks` reads them. */
  readonly projects: FilterPicks;
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
  filter.projects !== null && filter.projects.length === 0 && filter.statuses.length === 0;

type ListableThread = Parameters<typeof filterSidebarV2VisibleThreads>[0][number] &
  Parameters<typeof threadMatchesStatuses>[0];

/**
 * The threads the filter lists, plus the open one while the filter hides it, named as
 * `outsideKey` so its row can say so. Opening a thread never changes the filter.
 */
export function listFilteredThreads<Thread extends ListableThread>(
  threads: ReadonlyArray<Thread>,
  {
    scopedProjectKeys,
    delegatedUnderParent,
    statuses,
    openKey,
    keyOf,
  }: {
    readonly scopedProjectKeys: ReadonlySet<string> | null;
    readonly delegatedUnderParent: ReadonlySet<string>;
    readonly statuses: ReadonlyArray<ThreadStatusFilter>;
    readonly openKey: string | null;
    readonly keyOf: (thread: Thread) => string;
  },
): { readonly listed: ReadonlyArray<Thread>; readonly outsideKey: string | null } {
  const listed = filterSidebarV2VisibleThreads(
    threads,
    scopedProjectKeys,
    delegatedUnderParent,
  ).filter((thread) => threadMatchesStatuses(thread, statuses));
  if (openKey === null || listed.some((thread) => keyOf(thread) === openKey)) {
    return { listed, outsideKey: null };
  }
  const open = threads.find(
    (thread) =>
      keyOf(thread) === openKey &&
      filterSidebarV2VisibleThreads([thread], null, delegatedUnderParent).length === 1,
  );
  return open === undefined
    ? { listed, outsideKey: null }
    : { listed: [...listed, open], outsideKey: openKey };
}

const toggled = <T>(values: ReadonlyArray<T>, value: T) =>
  values.includes(value) ? values.filter((each) => each !== value) : [...values, value];

export const toggleFilterStatus = (
  filter: ThreadsFilter,
  status: ThreadStatusFilter,
): ThreadsFilter => ({ ...filter, statuses: toggled(filter.statuses, status) });

/** The project groups the filter keeps, or null for every project. */
export const filterProjectGroupKeys = (
  filter: ThreadsFilter,
  groupKeys: ReadonlyArray<string>,
): ReadonlySet<string> | null => keptFilterKeys(filter.projects, groupKeys);

/** A project's checkbox. Every project is in while none is picked, so All projects ticks them all. */
export const filterHasProject = (
  filter: ThreadsFilter,
  key: string,
  groupKeys: ReadonlyArray<string>,
): boolean => filterProjectGroupKeys(filter, groupKeys)?.has(key) ?? true;

export const toggleFilterProject = (
  filter: ThreadsFilter,
  key: string,
  groupKeys: ReadonlyArray<string>,
): ThreadsFilter => ({ ...filter, projects: toggleFilterPick(filter.projects, key, groupKeys) });

export const toggleFilterAllProjects = (
  filter: ThreadsFilter,
  groupKeys: ReadonlyArray<string>,
): ThreadsFilter => ({ ...filter, projects: toggleFilterAll(filter.projects, groupKeys) });

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
    projects: parseFilterPicks(record.projects),
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
