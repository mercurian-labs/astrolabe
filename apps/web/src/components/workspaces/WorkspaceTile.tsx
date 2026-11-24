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
    // Logos are drawn for a light page, so every one sits on white in both themes, edged so a
    // white logo still reads as a tile.
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 overflow-hidden rounded-[25%] border border-black/10 bg-white",
          className,
        )}
      >
        <img alt="" src={workspace.logo} className="size-full object-cover" />
      </span>
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
