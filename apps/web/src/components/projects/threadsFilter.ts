import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "../Sidebar.logic";
import { storedChoice } from "./storedChoice";

/**
 * Astrolabe: the thread list's filter. Each dimension is a set; values in one dimension widen
 * (any of them), dimensions narrow (all of them), and an empty dimension filters nothing. A kind
 * stands for every project of that kind, including ones added later, so picking one project
 * under a picked kind turns the kind into the projects it covered.
 */
export interface ThreadsFilter {
  /** Project group keys, a wiki by its checkout's group. */
  readonly projects: ReadonlyArray<string>;
  readonly kinds: ReadonlyArray<ThreadsFilterKind>;
  readonly statuses: ReadonlyArray<ThreadStatusFilter>;
}

export type ThreadsFilterKind = "repositories" | "wikis";

export const THREAD_STATUS_FILTERS = ["needs-you", "working", "errored"] as const;
export type ThreadStatusFilter = (typeof THREAD_STATUS_FILTERS)[number];

export const THREAD_STATUS_FILTER_LABELS: Record<ThreadStatusFilter, string> = {
  "needs-you": "Needs you",
  working: "Working",
  errored: "Errored",
};

export const EMPTY_THREADS_FILTER: ThreadsFilter = { projects: [], kinds: [], statuses: [] };

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
  filter.projects.length === 0 && filter.kinds.length === 0 && filter.statuses.length === 0;

const without = <T>(values: ReadonlyArray<T>, removed: ReadonlyArray<T>) =>
  values.filter((value) => !removed.includes(value));
const toggled = <T>(values: ReadonlyArray<T>, value: T) =>
  values.includes(value) ? without(values, [value]) : [...values, value];

/** A project's checkbox: picked by itself or by its kind. */
export const filterHasProject = (filter: ThreadsFilter, key: string, kind: ThreadsFilterKind) =>
  filter.kinds.includes(kind) || filter.projects.includes(key);

/** A kind's checkbox: the kind itself, or some of its projects. */
export function filterKindState(
  filter: ThreadsFilter,
  kind: ThreadsFilterKind,
  keysOfKind: ReadonlyArray<string>,
): "checked" | "partial" | "unchecked" {
  if (filter.kinds.includes(kind)) return "checked";
  return keysOfKind.some((key) => filter.projects.includes(key)) ? "partial" : "unchecked";
}

export function toggleFilterProject(
  filter: ThreadsFilter,
  key: string,
  kind: ThreadsFilterKind,
  keysOfKind: ReadonlyArray<string>,
): ThreadsFilter {
  if (filter.kinds.includes(kind)) {
    return {
      ...filter,
      kinds: without(filter.kinds, [kind]),
      projects: [...without(filter.projects, keysOfKind), ...without(keysOfKind, [key])],
    };
  }
  return { ...filter, projects: toggled(filter.projects, key) };
}

export function toggleFilterKind(
  filter: ThreadsFilter,
  kind: ThreadsFilterKind,
  keysOfKind: ReadonlyArray<string>,
): ThreadsFilter {
  return {
    ...filter,
    kinds: toggled(filter.kinds, kind),
    projects: without(filter.projects, keysOfKind),
  };
}

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
  groups: ReadonlyArray<{ readonly key: string; readonly kind: ThreadsFilterKind }>,
): ReadonlySet<string> | null {
  const kept = groups.filter(
    (group) => filter.kinds.includes(group.kind) || filter.projects.includes(group.key),
  );
  if (kept.length === 0 && filter.kinds.length === 0) return null;
  return new Set(kept.map((group) => group.key));
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
    kinds: strings(record.kinds).filter(
      (kind): kind is ThreadsFilterKind => kind === "repositories" || kind === "wikis",
    ),
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
