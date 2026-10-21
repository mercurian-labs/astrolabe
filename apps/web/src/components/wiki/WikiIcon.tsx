import type { EnvironmentId, WikiSummary } from "@t3tools/contracts";
import { BookOpenIcon } from "lucide-react";
import { useMemo } from "react";

import { useProjects } from "~/state/entities";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";

/**
 * A wiki's icon, as a project's is drawn in the thread list: its project's own icon when the
 * wiki's folder is a project, else the same lettered fallback a project without one gets.
 */
export function WikiIcon({
  environmentId,
  wiki,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  readonly className?: string;
}) {
  const projects = useProjects();
  const project = useMemo<ProjectFaviconProject>(
    () =>
      projects.find(
        (candidate) => candidate.environmentId === environmentId && candidate.id === wiki.projectId,
      ) ?? { environmentId, workspaceRoot: wiki.root, title: wiki.name },
    [environmentId, projects, wiki.name, wiki.projectId, wiki.root],
  );
  return <ProjectFavicon project={project} className={className} fallbackIcon={BookOpenIcon} />;
}
