import { workspaceColor, workspaceInitials } from "@t3tools/client-runtime/workspaces";
import type { WorkspaceRow } from "@t3tools/shared/mercurianWorkspaces";

import { cn } from "~/lib/utils";
import { ProjectMonogram } from "../ProjectMonogram";

/** A workspace's logo, else its initials on its colour, at a row icon's size. */
export function WorkspaceTile({
  workspace,
  className,
}: {
  readonly workspace: WorkspaceRow;
  readonly className?: string;
}) {
  if (workspace.logo) {
    return (
      <img
        alt=""
        src={workspace.logo}
        className={cn("size-4 shrink-0 rounded-[25%] object-cover", className)}
      />
    );
  }
  return (
    <ProjectMonogram
      text={workspaceInitials(workspace.name)}
      color={workspaceColor(workspace.id)}
      className={className}
    />
  );
}
