import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { MemoryPage } from "../components/mercurian/MemoryPage";
import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "../lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";

export type MemoryRouteSearch = Readonly<{ note?: string }>;

export function validateMemorySearch(search: Record<string, unknown>): MemoryRouteSearch {
  return typeof search.note === "string" && search.note.trim() ? { note: search.note } : {};
}

function MemoryRouteView() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "flex items-center border-b border-border px-3 py-2 sm:px-5 sm:py-3",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <h1 className="truncate text-sm font-medium text-foreground">Memory</h1>
        </header>
        <MemoryPage
          noteSearch={search.note}
          onNoteSearchChange={(note) =>
            void navigate({ search: note === undefined ? {} : { note }, replace: true })
          }
        />
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/memory")({
  validateSearch: validateMemorySearch,
  component: MemoryRouteView,
});
