import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";

import type { SidebarThreadSummary } from "../../types";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";
import { useWikiOverviews } from "../wiki/wikiEnvironment";
import { wikiScopeKey } from "../wiki/wikiTabs";
import { projectFilterOptions, type ProjectFilterOption } from "./projectFilter";
import {
  filterAsShown,
  filterHasProject,
  filterKindState,
  filterProjectGroupKeys,
  storeThreadsFilter,
  THREAD_STATUS_FILTER_LABELS,
  THREAD_STATUS_FILTERS,
  threadMatchesStatuses,
  toggleFilterPick,
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

export type ThreadsFilterCheck = "checked" | "partial" | "unchecked";

const statusValue = (status: ThreadStatusFilter) => `status:${status}`;

/**
 * Astrolabe: the thread list's filter (`threadsFilter`) as the sidebar offers it: statuses, then
 * All projects, Repositories and each repository, Wikis and each wiki. A wiki's threads are the
 * ones in its checkout, so a wiki is picked by its checkout's project group.
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
  const { overviews } = useWikiOverviews();
  const { wikiOfGroup, groupOfWiki } = (() => {
    const checkouts = new Map<string, WikiOverview>();
    for (const overview of overviews) {
      if (overview.wiki.projectId === null) continue;
      checkouts.set(`${overview.environmentId}:${overview.wiki.projectId}`, overview);
    }
    const wikiOfGroup = new Map<string, WikiOverview>();
    const groupOfWiki = new Map<string, Group>();
    for (const group of groups) {
      const overview = group.memberProjectRefs
        .map((ref) => checkouts.get(`${ref.environmentId}:${ref.projectId}`))
        .find((found) => found !== undefined);
      if (overview === undefined) continue;
      wikiOfGroup.set(group.projectKey, overview);
      groupOfWiki.set(wikiScopeKey(overview.environmentId, overview.wiki.wikiId), group);
    }
    return { wikiOfGroup, groupOfWiki };
  })();
  const repositoryGroups = groups.filter((group) => !wikiOfGroup.has(group.projectKey));
  const wikiGroups = groups.filter((group) => wikiOfGroup.has(group.projectKey));
  const keysOf = {
    repositories: repositoryGroups.map((group) => group.projectKey),
    wikis: wikiGroups.map((group) => group.projectKey),
  };

  const projectItems = projectFilterOptions({
    repositories: repositoryGroups.map((group) => ({
      key: group.projectKey,
      label: group.displayName,
      repository: group,
    })),
    wikis: wikiGroups.map((group) => wikiOfGroup.get(group.projectKey)!),
  });
  const statusItems: ReadonlyArray<ThreadsFilterItem<Group>> = THREAD_STATUS_FILTERS.map(
    (status) => ({
      value: statusValue(status),
      kind: "status",
      label: THREAD_STATUS_FILTER_LABELS[status],
      status,
    }),
  );

  const filterGroups = [
    ...keysOf.repositories.map((key) => ({ key, kind: "repositories" as const })),
    ...keysOf.wikis.map((key) => ({ key, kind: "wikis" as const })),
  ];
  const scopedGroupKeys = filterProjectGroupKeys(filter, filterGroups);
  const shown = filterAsShown(filter, filterGroups);
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

  const groupOf = (item: ThreadsFilterItem<Group>): Group | null => {
    if (item.kind === "repository") return item.repository;
    if (item.kind === "wiki") {
      return (
        groupOfWiki.get(wikiScopeKey(item.overview.environmentId, item.overview.wiki.wikiId)) ??
        null
      );
    }
    return null;
  };
  const checkOf = (item: ThreadsFilterItem<Group>): ThreadsFilterCheck => {
    const checked = (value: boolean): ThreadsFilterCheck => (value ? "checked" : "unchecked");
    switch (item.kind) {
      case "status":
        return checked(filter.statuses.includes(item.status));
      case "all":
        return checked(scopedGroupKeys === null);
      case "repositories":
      case "wikis":
        return filterKindState(shown, item.kind, keysOf[item.kind]);
      case "repository":
      case "wiki": {
        const group = groupOf(item);
        const kind = item.kind === "repository" ? "repositories" : "wikis";
        return checked(group !== null && filterHasProject(shown, group.projectKey, kind));
      }
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
        return update({ ...filter, projects: [], kinds: [] });
      case "repositories":
      case "wikis":
        return update(
          toggleFilterPick(filter, { kind: "kind", projectKind: item.kind }, filterGroups),
        );
      case "repository":
      case "wiki": {
        const group = groupOf(item);
        if (group === null) return;
        const kind = item.kind === "repository" ? "repositories" : "wikis";
        return update(
          toggleFilterPick(
            filter,
            { kind: "project", projectKind: kind, key: group.projectKey },
            filterGroups,
          ),
        );
      }
    }
  };

  const items = [...statusItems, ...projectItems];
  // What the project pill names: each picked kind, then each picked project outside one.
  const pickedProjectItems =
    scopedGroupKeys === null
      ? []
      : projectItems.filter((item) => {
          if (item.kind === "repositories" || item.kind === "wikis") {
            return filter.kinds.includes(item.kind);
          }
          if (item.kind === "repository")
            return !filter.kinds.includes("repositories") && checkOf(item) === "checked";
          if (item.kind === "wiki")
            return !filter.kinds.includes("wikis") && checkOf(item) === "checked";
          return false;
        });
  const isOnlyProject = (groupKey: string) =>
    filter.kinds.length === 0 && filter.projects.length === 1 && filter.projects[0] === groupKey;

  return {
    items,
    /** The values Base UI reads as selected: every checked row. */
    selectedValues: items.filter((item) => checkOf(item) === "checked").map((item) => item.value),
    checkOf,
    toggle,
    scopedProjectKeys,
    statuses: filter.statuses,
    statusCounts,
    pickedProjectItems,
    isActive: scopedGroupKeys !== null || filter.statuses.length > 0,
    /** The filter as one key, for state that resets with it. */
    resetKey: JSON.stringify(filter),
    clear: () => update({ projects: [], kinds: [], statuses: [] }),
    clearProjects: () => update({ ...filter, projects: [], kinds: [] }),
    /** Removes the statuses the Needs you pill does not show on its own. */
    clearOtherStatuses: () =>
      update({ ...filter, statuses: filter.statuses.filter((status) => status === "needs-you") }),
    toggleStatus: (status: ThreadStatusFilter) => update(toggleFilterStatus(filter, status)),
    /** The thread menu's "Filter by" a project: that project alone, or back to every project. */
    isOnlyProject,
    toggleOnlyProject: (groupKey: string) =>
      update({ ...filter, kinds: [], projects: isOnlyProject(groupKey) ? [] : [groupKey] }),
  };
}
