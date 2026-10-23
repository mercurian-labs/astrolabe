import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";

import { useWikiOverviews } from "../wiki/wikiEnvironment";
import { wikiScopeKey } from "../wiki/wikiTabs";
import {
  projectFilterChoice,
  projectFilterOptions,
  projectFilterValue,
  projectKindStore,
  type ProjectFilterOption,
} from "./projectFilter";

/** Which kind of project the thread list is narrowed to while no one project is picked. */
const threadsProjectKindStore = projectKindStore("astrolabe:threads-project-kind:v1");
const useThreadsProjectKind = threadsProjectKindStore.useValue;

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

/**
 * Astrolabe: the thread list's project filter as every section has it (`projectFilter`): All
 * projects, then Repositories and each repository, then Wikis and each wiki. A wiki's threads are
 * the ones in its checkout, so picking a wiki picks its checkout's project group, which T3 Code's
 * own scope (`scopeKey`) keeps; the headings are this list's kind, kept beside it.
 */
export function useThreadsProjectFilter<Group extends ProjectGroup>({
  groups,
  scopeKey,
  setScopeKey,
}: {
  readonly groups: ReadonlyArray<Group>;
  readonly scopeKey: string | null;
  readonly setScopeKey: (key: string | null) => void;
}) {
  const { overviews } = useWikiOverviews();
  const kind = useThreadsProjectKind();
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

  const items = projectFilterOptions({
    repositories: groups
      .filter((group) => !wikiOfGroup.has(group.projectKey))
      .map((group) => ({ key: group.projectKey, label: group.displayName, repository: group })),
    wikis: groups.flatMap((group) => {
      const overview = wikiOfGroup.get(group.projectKey);
      return overview === undefined ? [] : [overview];
    }),
  });

  const scoped = scopeKey === null ? null : (groups.find((g) => g.projectKey === scopeKey) ?? null);
  const scopedWiki = scoped === null ? null : (wikiOfGroup.get(scoped.projectKey) ?? null);
  const value =
    scoped === null
      ? projectFilterValue({ kind })
      : scopedWiki !== null
        ? projectFilterValue({
            kind: "wiki",
            key: wikiScopeKey(scopedWiki.environmentId, scopedWiki.wiki.wikiId),
          })
        : projectFilterValue({ kind: "repository", key: scoped.projectKey });
  const selected = items.find((item) => item.value === value) ?? items[0]!;

  const scopedProjectKeys =
    scoped !== null
      ? refKeys([scoped])
      : kind === "all"
        ? null
        : refKeys(
            groups.filter((group) => wikiOfGroup.has(group.projectKey) === (kind === "wikis")),
          );

  /** The project group an option picks, when it picks one. */
  const groupOf = (item: ProjectFilterOption<Group>): Group | null => {
    const choice = projectFilterChoice(item);
    if (item.kind === "repository") return item.repository;
    if (choice.kind === "wiki") return groupOfWiki.get(choice.key) ?? null;
    return null;
  };
  const choose = (item: ProjectFilterOption<Group>) => {
    const group = groupOf(item);
    if (group !== null) {
      threadsProjectKindStore.set("all");
      setScopeKey(group.projectKey);
      return;
    }
    if (item.kind === "all" || item.kind === "repositories" || item.kind === "wikis") {
      threadsProjectKindStore.set(item.kind);
      setScopeKey(null);
    }
  };

  return {
    items,
    selected,
    /** The project group picked, or null for All projects or a kind. */
    scoped,
    scopedProjectKeys,
    /** The list's scope as one key, for state that resets with it. */
    resetKey: scoped?.projectKey ?? kind,
    groupOf,
    choose,
  };
}
