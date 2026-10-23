import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useEffect, useRef, type ReactNode, type RefObject, type ComponentProps } from "react";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { useChangeRequestKind } from "../changeRequests/changeRequestKind";
import { ChangeRequestSourceFilter } from "../changeRequests/ChangeRequestSourceFilter";
import { WikiChangesGroup } from "../changeRequests/WikiChangesGroup";
import { ChangeGroupsSection } from "../changeRequests/groups/ChangeGroupsSection";

/**
 * Astrolabe: the list as the Pull Requests sidebar holds it, under the section's title: the
 * search, sort and filters, then the rows, scrolling on their own.
 */
/**
 * Astrolabe: the Change Requests sidebar's controls and list. The project filter narrows to the
 * repositories' pull requests (all, or one's) or to the wikis' change requests (all, or one's;
 * see `ChangeRequestSourceFilter`); with the wikis picked, the pull requests' sort and filters
 * step aside. One host, from Filters, lists only its pull requests.
 */
export function PullRequestsSidebarList({
  host,
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
  host: string | undefined;
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
  const kind = useChangeRequestKind();
  const wikisOnly = kind === "wikis";
  const controlsRef = useRef<HTMLDivElement | null>(null);
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
          {wikisOnly ? null : sortMenu}
          {wikisOnly ? null : filtersMenu}
        </div>
      </div>
      <div ref={scrollRef} className="@container/pr-list min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <ChangeGroupsSection
          query={searchQuery}
          projectId={projectId}
          projectEnvironmentId={projectEnvironmentId}
        />
        {wikisOnly || (kind === "all" && host === undefined && projectId === undefined) ? (
          <WikiChangesGroup query={searchQuery} alone={wikisOnly} />
        ) : null}
        {wikisOnly ? null : listBody}
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
  return (
    <Button
      size={compact ? "icon-sm" : "icon"}
      variant={compact ? "ghost" : "outline"}
      aria-label="Refresh pull requests"
      onClick={onRefresh}
      disabled={refreshing}
    >
      <RefreshIcon size="md" refreshing={refreshing} />
    </Button>
  );
}
