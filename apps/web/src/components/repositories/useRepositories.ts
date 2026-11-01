import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { useProjects, useServerConfigs } from "~/state/entities";

/** Astrolabe: the repositories, by name: every project on the connected machines but scratch folders. */
export function useRepositories(): ReadonlyArray<EnvironmentProject> {
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  return projects
    .filter(
      (project) =>
        !isScratchProject(project, serverConfigs.get(project.environmentId)?.scratchWorkspaceRoot),
    )
    .toSorted((a, b) => a.title.localeCompare(b.title));
}
