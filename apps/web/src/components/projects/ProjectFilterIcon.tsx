import { BookOpenIcon, FolderGit2Icon, LayersIcon } from "lucide-react";

import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { WikiIcon } from "../wiki/WikiIcon";
import type { ProjectFilterOption } from "./projectFilter";

/** A project filter option's icon: the kind's for a heading, the project's own otherwise. */
export function ProjectFilterIcon({
  option,
}: {
  readonly option: ProjectFilterOption<ProjectFaviconProject>;
}) {
  switch (option.kind) {
    case "all":
      return <LayersIcon className="size-4 shrink-0" />;
    case "repositories":
      return <FolderGit2Icon className="size-4 shrink-0" />;
    case "wikis":
      return <BookOpenIcon className="size-4 shrink-0" />;
    case "repository":
      return <ProjectFavicon project={option.repository} className="size-4 shrink-0" />;
    case "wiki":
      return (
        <WikiIcon
          environmentId={option.overview.environmentId}
          wiki={option.overview.wiki}
          className="size-4 shrink-0"
        />
      );
  }
}
