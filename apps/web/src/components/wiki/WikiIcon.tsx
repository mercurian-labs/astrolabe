import type { EnvironmentId, WikiSummary } from "@t3tools/contracts";
import { BookOpenIcon } from "lucide-react";

import { ProjectFavicon } from "../ProjectFavicon";

/** A wiki's icon, drawn the way a project's is: a favicon from its folder, else a book. */
export function WikiIcon({
  environmentId,
  wiki,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  readonly className?: string;
}) {
  return (
    <ProjectFavicon
      project={{ environmentId, workspaceRoot: wiki.root, title: wiki.name }}
      className={className}
      fallbackIcon={BookOpenIcon}
    />
  );
}
