import type { SidebarThreadSummary } from "../../types";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";
import { projectFilterOptions, type ProjectFilterOption } from "./projectFilter";
import {
  filterHasProject,
  filterProjectGroupKeys,
  storeThreadsFilter,
  THREAD_STATUS_FILTER_LABELS,
  THREAD_STATUS_FILTERS,
  threadMatchesStatuses,
  toggleFilterProject,
  toggleFilterStatus,
  useStoredThreadsFilter,
  type ThreadsFilter,
  type ThreadStatusFilter,
} from "./threadsFilter";

interface ProjectGroup {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjectRefs: ReadonlyArray<{
    readonly environmentId: string;
    readonly projectId: string;
  }>;
}

const refKeys = (groups: ReadonlyArray<ProjectGroup>): ReadonlySet<string> =>
  new Set(
    groups.flatMap((group) =>
      group.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`),
    ),
  );

export type ThreadsFilterItem<Group> =
  | ProjectFilterOption<Group>
  | {
      readonly value: string;
      readonly kind: "status";
      readonly label: string;
      readonly status: ThreadStatusFilter;
    };

const statusValue = (status: ThreadStatusFilter) => `status:${status}`;

/**
 * Astrolabe: the thread list's filter (`threadsFilter`) as the sidebar offers it: statuses, then
 * All projects and each project.
 */
export function useThreadsFilter<Group extends ProjectGroup>({
  groups,
  threads,
  onChange,
}: {
  readonly groups: ReadonlyArray<Group>;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  /** Called before the filter changes, as a selection made under one filter may hide under the next. */
  readonly onChange: () => void;
}) {
  const filter = useStoredThreadsFilter();
  const groupKeys = groups.map((group) => group.projectKey);

  const projectItems = projectFilterOptions({
    repositories: groups.map((group) => ({
      key: group.projectKey,
      label: group.displayName,
      repository: group,
    })),
    wikis: [],
  });
  const statusItems: ReadonlyArray<ThreadsFilterItem<Group>> = THREAD_STATUS_FILTERS.map(
    (status) => ({
      value: statusValue(status),
      kind: "status",
      label: THREAD_STATUS_FILTER_LABELS[status],
      status,
    }),
  );

  const scopedGroupKeys = filterProjectGroupKeys(filter, groupKeys);
  const scopedProjectKeys =
    scopedGroupKeys === null
      ? null
      : refKeys(groups.filter((group) => scopedGroupKeys.has(group.projectKey)));

  const statusCounts = (() => {
    const counts: Record<ThreadStatusFilter, number> = { "needs-you": 0, working: 0, errored: 0 };
    for (const thread of filterSidebarV2VisibleThreads(threads, scopedProjectKeys)) {
      for (const status of THREAD_STATUS_FILTERS) {
        if (threadMatchesStatuses(thread, [status])) counts[status] += 1;
      }
    }
    return counts;
  })();

  const isChecked = (item: ThreadsFilterItem<Group>): boolean => {
    switch (item.kind) {
      case "status":
        return filter.statuses.includes(item.status);
      case "all":
        return scopedGroupKeys === null;
      case "repository":
        return filterHasProject(filter, item.repository.projectKey, groupKeys);
      default:
        return false;
    }
  };

  const update = (next: ThreadsFilter) => {
    onChange();
    storeThreadsFilter(next);
  };
  const toggle = (item: ThreadsFilterItem<Group>) => {
    switch (item.kind) {
      case "status":
        return update(toggleFilterStatus(filter, item.status));
      case "all":
        return update({ ...filter, projects: [] });
      case "repository":
        return update(toggleFilterProject(filter, item.repository.projectKey, groupKeys));
    }
  };

  const items = [...statusItems, ...projectItems];
  const isOnlyProject = (groupKey: string) =>
    filter.projects.length === 1 && filter.projects[0] === groupKey;

  return {
    items,
    /** The values Base UI reads as selected: every checked row. */
    selectedValues: items.filter(isChecked).map((item) => item.value),
    isChecked,
    toggle,
    scopedProjectKeys,
    statuses: filter.statuses,
    statusCounts,
    /** What the project pill names: each picked project. */
    pickedProjectItems:
      scopedGroupKeys === null
        ? []
        : projectItems.filter((item) => item.kind === "repository" && isChecked(item)),
    isActive: scopedGroupKeys !== null || filter.statuses.length > 0,
    /** The filter as one key, for state that resets with it. */
    resetKey: JSON.stringify(filter),
    clear: () => update({ projects: [], statuses: [] }),
    clearProjects: () => update({ ...filter, projects: [] }),
    /** Removes the statuses the Needs you pill does not show on its own. */
    clearOtherStatuses: () =>
      update({ ...filter, statuses: filter.statuses.filter((status) => status === "needs-you") }),
    toggleStatus: (status: ThreadStatusFilter) => update(toggleFilterStatus(filter, status)),
    /** The thread menu's "Filter by" a project: that project alone, or back to every project. */
    isOnlyProject,
    toggleOnlyProject: (groupKey: string) =>
      update({ ...filter, projects: isOnlyProject(groupKey) ? [] : [groupKey] }),
  };
}
