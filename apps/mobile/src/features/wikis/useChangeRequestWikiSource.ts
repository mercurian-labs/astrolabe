import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { wikiScopeKey } from "@t3tools/client-runtime/wikiList";
import { useMemo } from "react";

import { changeRequestWikisOnlyAtom } from "../../state/wiki";
import { useWorkspaceState } from "../../state/workspace";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { useWikiOverviews } from "./useWikiOverviews";
import { resolveWikiScope } from "./wikisList";

/** The filter's value for every wiki at once; one wiki is its `wikiScopeKey`. */
export const ALL_WIKIS = "wikis";

/**
 * Astrolabe: the wikis as the Change requests tab's filter offers them beside its projects:
 * every wiki, or one, each listing only the wikis' change requests. `selected` is the wiki
 * choice in force, or null while the pull requests show; `select(null)` goes back to them.
 */
export function useChangeRequestWikiSource() {
  const workspace = useWorkspaceTabs()!;
  const wikisOnly = useAtomValue(changeRequestWikisOnlyAtom);
  const setWikisOnly = useAtomSet(changeRequestWikisOnlyAtom);
  const { environments } = useWorkspaceState();
  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connectionState === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const { overviews } = useWikiOverviews(environmentIds);
  const scope = resolveWikiScope(overviews, workspace.wikiScope);
  const choices = useMemo(
    () =>
      overviews.length === 0
        ? []
        : [
            { value: ALL_WIKIS, title: "All wikis" },
            ...overviews.map((overview) => ({
              value: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
              title: `${overview.wiki.name} · Wiki`,
            })),
          ],
    [overviews],
  );
  // A wiki's folder is a project too; the filter lists it once, as the wiki.
  const wikiProjects = useMemo(
    () =>
      new Set(
        overviews.flatMap((overview) =>
          overview.wiki.projectId === null
            ? []
            : [`${overview.environmentId}:${overview.wiki.projectId}`],
        ),
      ),
    [overviews],
  );
  return {
    wikisOnly,
    choices,
    withoutWikiProjects: <Project extends { id: string; environmentId: string }>(
      projects: ReadonlyArray<Project>,
    ) => projects.filter((project) => !wikiProjects.has(`${project.environmentId}:${project.id}`)),
    selected: wikisOnly ? (scope ?? ALL_WIKIS) : null,
    select(value: string | null) {
      if (value === null) {
        setWikisOnly(false);
        return;
      }
      setWikisOnly(true);
      workspace.setWikiScope(value === ALL_WIKIS ? null : value);
    },
  };
}
