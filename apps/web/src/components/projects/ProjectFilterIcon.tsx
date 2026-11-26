import { LayersIcon } from "lucide-react";

import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import type { ProjectFilterOption } from "./projectFilter";

/** A project filter option's icon: All's, or the project's own. */
export function ProjectFilterIcon({
  option,
}: {
  readonly option: ProjectFilterOption<ProjectFaviconProject>;
}) {
  return option.kind === "all" ? (
    <LayersIcon className="size-4 shrink-0" />
  ) : (
    <ProjectFavicon project={option.repository} className="size-4 shrink-0" />
  );
}
