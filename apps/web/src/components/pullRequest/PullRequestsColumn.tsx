import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useEffect, useRef, type ReactNode, type RefObject, type ComponentProps } from "react";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { ChangeRequestSourceFilter } from "../changeRequests/ChangeRequestSourceFilter";
import { ChangeGroupsSection } from "../changeRequests/groups/ChangeGroupsSection";

/**
 * Astrolabe: the list as the Pull Requests sidebar holds it, under the section's title: the
 * search, sort and filters, then the rows, scrolling on their own.
 */
/**
 * Astrolabe: the Changes sidebar's controls and list: the change groups, then the pull requests
 * of every project or the one the project filter picks (`ChangeRequestSourceFilter`). One host,
 * from Filters, lists only its pull requests (`listBody`).
 */
export function PullRequestsSidebarList({
  searchQuery,
  projects,
  projectId,
  projectEnvironmentId,
  onProject,
  searchInput,
  sortMenu,
  filtersMenu,
  listBody,
  scrollRef,
  searchFocusPending,
  onSearchFocused,
}: {
  searchQuery: string;
  projects: ComponentProps<typeof ChangeRequestSourceFilter>["projects"];
  projectId: ProjectId | undefined;
  projectEnvironmentId: EnvironmentId | undefined;
  onProject: (projectId: ProjectId | undefined, environmentId?: EnvironmentId) => void;
  searchInput: ReactNode;
  sortMenu: ReactNode;
  filtersMenu: ReactNode;
  listBody: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Find asked for the search field; it takes focus, with its query selected, once mounted. */
  searchFocusPending: boolean;
  onSearchFocused: () => void;
}) {
  const controlsRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the search input DOM node when a shortcut asks for it
  useEffect(() => {
    if (!searchFocusPending) return;
    const input = controlsRef.current?.querySelector<HTMLInputElement>("input[type='search']");
    // The sidebar may still be sliding in; focusing must not scroll it.
    input?.focus({ preventScroll: true });
    input?.select();
    onSearchFocused();
  }, [searchFocusPending, onSearchFocused]);
  return (
    <>
      <div ref={controlsRef} className="flex shrink-0 flex-col gap-2 px-2 pb-2">
        {searchInput}
        <div className="flex flex-wrap items-center gap-1.5">
          <ChangeRequestSourceFilter
            projects={projects}
            projectId={projectId}
            projectEnvironmentId={projectEnvironmentId}
            onProject={onProject}
          />
          {sortMenu}
          {filtersMenu}
        </div>
      </div>
      <div ref={scrollRef} className="@container/pr-list min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <ChangeGroupsSection
          query={searchQuery}
          projectId={projectId}
          projectEnvironmentId={projectEnvironmentId}
        />
        {listBody}
      </div>
    </>
  );
}

export function PullRequestRefreshControl({
  compact = false,
  refreshing,
  onRefresh,
}: {
  compact?: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const gt = useGT();
  return (
    <Button
      size={compact ? "icon-sm" : "icon"}
      variant={compact ? "ghost" : "outline"}
      aria-label={gt("Refresh pull requests")}
      onClick={onRefresh}
      disabled={refreshing}
    >
      <RefreshIcon size="md" refreshing={refreshing} />
    </Button>
  );
}
