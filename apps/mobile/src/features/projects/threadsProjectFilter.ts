import type { HomeProjectScope } from "../home/homeThreadList";

/** The thread list's choice of every repository. */
export const REPOSITORIES_SCOPE_KEY = "kind:repositories";

/**
 * Astrolabe: the thread list's project menu as every section's project filter has it, after
 * All projects: Repositories and each repository. Threads run in repositories, never in wikis.
 */
export function threadsProjectFilterOptions(
  scopes: ReadonlyArray<Pick<HomeProjectScope, "key" | "title">>,
): ReadonlyArray<{ readonly key: string; readonly label: string }> {
  return scopes.length === 0
    ? []
    : [
        { key: REPOSITORIES_SCOPE_KEY, label: "Repositories" },
        ...scopes.map((scope) => ({ key: scope.key, label: scope.title })),
      ];
}

/**
 * The scope a menu choice narrows the thread list to: one project's, as `find` reads it, or every
 * repository's as one scope, so the list filters and names it as it does a project. Null for All
 * projects, or when there are no repositories.
 */
export function findThreadsProjectScope(
  scopes: ReadonlyArray<HomeProjectScope>,
  key: string | null,
  find: (scopes: ReadonlyArray<HomeProjectScope>, key: string | null) => HomeProjectScope | null,
): HomeProjectScope | null {
  if (key !== REPOSITORIES_SCOPE_KEY) return find(scopes, key);
  const [first] = scopes;
  if (first === undefined) return null;
  return {
    key,
    title: "your repositories",
    representative: first.representative,
    projects: scopes.flatMap((scope) => scope.projects),
    projectRefs: scopes.flatMap((scope) => scope.projectRefs),
  };
}
