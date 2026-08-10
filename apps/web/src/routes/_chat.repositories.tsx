import { createFileRoute } from "@tanstack/react-router";

import {
  AddRepositoryHeaderButton,
  RepositoriesPage,
} from "../components/mercurian/RepositoriesPage";
import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "../lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";

/**
 * Repositories: the one surface that answers what code Mercurian can reach,
 * and how. Everything about a repository — how it was added, what scripts are
 * declared on it, which projects it is context for — is managed here.
 */
function RepositoriesRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "flex items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-5 sm:py-3",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <h1 className="truncate text-sm font-medium text-foreground">Repositories</h1>
          <AddRepositoryHeaderButton />
        </header>
        <RepositoriesPage />
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/repositories")({
  component: RepositoriesRouteView,
});
