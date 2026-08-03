import { createFileRoute } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "../lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";

/**
 * Repositories is a destination before it is a feature: the Workspace group
 * needs somewhere to land, and repository-set management arrives with the
 * issue that owns it.
 */
function RepositoriesRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "border-b border-border px-3 py-2 sm:px-5 sm:py-3",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <h1 className="truncate text-sm font-medium text-foreground">Repositories</h1>
        </header>
        <Empty className="flex-1">
          <EmptyHeader className="max-w-md">
            <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
              <GitBranchIcon className="size-5" />
            </div>
            <EmptyTitle className="text-foreground text-xl">No repositories yet</EmptyTitle>
            <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
              Repositories are the context a project’s plans ground in. Managing them lands here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/repositories")({
  component: RepositoriesRouteView,
});
