import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";

import type { HomeProjectScope } from "../home/homeThreadList";

/** The thread list's choice of every repository, or of every wiki. */
export const REPOSITORIES_SCOPE_KEY = "kind:repositories";
export const WIKIS_SCOPE_KEY = "kind:wikis";

/** The wikis by their checkout's `environmentId:projectId`. */
export type WikiCheckouts = ReadonlyMap<string, WikiOverview>;

export function wikiCheckouts(overviews: ReadonlyArray<WikiOverview>): WikiCheckouts {
  return new Map(
    overviews.flatMap((overview) =>
      overview.wiki.projectId === null
        ? []
        : [[`${overview.environmentId}:${overview.wiki.projectId}`, overview] as const],
    ),
  );
}

const wikiOf = (
  scope: Pick<HomeProjectScope, "projectRefs">,
  checkouts: WikiCheckouts,
): WikiOverview | undefined =>
  scope.projectRefs
    .map((ref) => checkouts.get(`${ref.environmentId}:${ref.projectId}`))
    .find((overview) => overview !== undefined);

/**
 * Astrolabe: the thread list's project menu as every section's project filter has it, after
 * All projects: Repositories and each repository, then Wikis and each wiki. A wiki's threads are
 * the ones in its checkout, so a wiki's choice is its checkout's scope, named for the wiki.
 */
export function threadsProjectFilterOptions(
  scopes: ReadonlyArray<Pick<HomeProjectScope, "key" | "title" | "projectRefs">>,
  checkouts: WikiCheckouts,
): ReadonlyArray<{ readonly key: string; readonly label: string }> {
  const repositories = scopes.filter((scope) => wikiOf(scope, checkouts) === undefined);
  const wikis = scopes.flatMap((scope) => {
    const overview = wikiOf(scope, checkouts);
    return overview === undefined
      ? []
      : [{ key: scope.key, label: `${overview.wiki.name} · Wiki` }];
  });
  return [
    ...(repositories.length > 0
      ? [
          { key: REPOSITORIES_SCOPE_KEY, label: "Repositories" },
          ...repositories.map((scope) => ({ key: scope.key, label: scope.title })),
        ]
      : []),
    ...(wikis.length > 0 ? [{ key: WIKIS_SCOPE_KEY, label: "Wikis" }, ...wikis] : []),
  ];
}

/**
 * The scope a menu choice narrows the thread list to: one project's, as `find` reads it (a wiki's
 * named for the wiki), or every repository's or every wiki's as one scope, so the list filters
 * and names it as it does a project. Null for All projects, or a kind with nothing in it.
 */
export function findThreadsProjectScope(
  scopes: ReadonlyArray<HomeProjectScope>,
  key: string | null,
  checkouts: WikiCheckouts,
  find: (scopes: ReadonlyArray<HomeProjectScope>, key: string | null) => HomeProjectScope | null,
): HomeProjectScope | null {
  if (key === REPOSITORIES_SCOPE_KEY || key === WIKIS_SCOPE_KEY) {
    const wikis = key === WIKIS_SCOPE_KEY;
    const members = scopes.filter((scope) => (wikiOf(scope, checkouts) !== undefined) === wikis);
    const [first] = members;
    if (first === undefined) return null;
    return {
      key,
      title: wikis ? "your wikis" : "your repositories",
      representative: first.representative,
      projects: members.flatMap((scope) => scope.projects),
      projectRefs: members.flatMap((scope) => scope.projectRefs),
    };
  }
  const found = find(scopes, key);
  const overview = found === null ? undefined : wikiOf(found, checkouts);
  return found !== null && overview !== undefined ? { ...found, title: overview.wiki.name } : found;
}
