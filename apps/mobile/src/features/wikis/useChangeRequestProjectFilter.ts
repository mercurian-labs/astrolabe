import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { wikiScopeKey } from "@t3tools/client-runtime/wikiList";
import { useMemo } from "react";

import { changeRequestProjectKindAtom, changeRequestWikiScopeAtom } from "../../state/wiki";
import { useWorkspaceState } from "../../state/workspace";
import { useWikiOverviews } from "./useWikiOverviews";
import { resolveWikiScope } from "./wikisList";

/** The filter's value for every wiki at once; one wiki is its `wikiScopeKey`. */
export const ALL_WIKIS = "wikis";

/**
 * Astrolabe: the Change requests tab's project filter, as every section's is: All, then Projects
 * and each project, then Wikis and each wiki. A project is the list's own project control; this
 * keeps the kind and the tab's own wiki. `selected` is the wiki choice in force, or null while
 * the pull requests show.
 */
export function useChangeRequestProjectFilter() {
  const kind = useAtomValue(changeRequestProjectKindAtom);
  const setKind = useAtomSet(changeRequestProjectKindAtom);
  const storedScope = useAtomValue(changeRequestWikiScopeAtom);
  const setScope = useAtomSet(changeRequestWikiScopeAtom);
  const { environments } = useWorkspaceState();
  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connectionState === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const { overviews } = useWikiOverviews(environmentIds);
  const scope = resolveWikiScope(overviews, storedScope);
  const choices = useMemo(
    () =>
      overviews.length === 0
        ? []
        : [
            { value: ALL_WIKIS, title: "Wikis" },
            ...overviews.map((overview) => ({
              value: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
              title: `${overview.wiki.name} · Wiki`,
            })),
          ],
    [overviews],
  );
  return {
    kind,
    wikisOnly: kind === "wikis",
    repositoriesOnly: kind === "repositories",
    /** The wiki in force: one wiki's scope key, or `ALL_WIKIS`. */
    scope,
    choices,
    selected: kind === "wikis" ? (scope ?? ALL_WIKIS) : null,
    /** Every kind (`"all"`), every repository, or a wiki choice (`ALL_WIKIS` or one wiki). */
    select(value: "all" | "repositories" | string) {
      if (value === "all" || value === "repositories") {
        setKind(value);
        setScope(null);
        return;
      }
      setKind("wikis");
      setScope(value === ALL_WIKIS ? null : value);
    },
  };
}
