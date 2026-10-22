import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useMemo } from "react";

import { useProjects, useServerConfigs } from "~/state/entities";
import { wikiCheckoutKeys } from "../projects/projectFilter";
import { useWikiOverviews } from "../wiki/wikiEnvironment";

/**
 * Astrolabe: the repositories, by name: every project on the connected machines that is neither
 * a wiki's checkout (a wiki is the other kind of project) nor a thread's scratch folder.
 */
export function useRepositories(): ReadonlyArray<EnvironmentProject> {
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const { overviews } = useWikiOverviews();
  return useMemo(() => {
    const checkouts = wikiCheckoutKeys(overviews);
    return projects
      .filter(
        (project) =>
          !checkouts.has(`${project.environmentId}:${project.id}`) &&
          !isScratchProject(
            project,
            serverConfigs.get(project.environmentId)?.scratchWorkspaceRoot,
          ),
      )
      .toSorted((a, b) => a.title.localeCompare(b.title));
  }, [overviews, projects, serverConfigs]);
}
