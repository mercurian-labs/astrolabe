import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { applyPullRequestDraftFilterChange } from "@t3tools/client-runtime/pull-request-query";
import { Spinner } from "~/components/ui/spinner";
import type { PullRequestSpeedActionResult } from "~/components/pullRequest/PullRequestSpeedActions";
import { usePullRequestCloseBatch } from "~/components/pullRequest/usePullRequestActions";
import { SidebarPointerSensor } from "~/components/Sidebar.pointer";
import { resolveSidebarSweepKeys } from "~/components/Sidebar.logic";
import { sortProjectsByGroupOrder } from "@t3tools/client-runtime/state/project-grouping";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestAction,
  PullRequestInvolvement,
  PullRequestListCursors,
  PullRequestListInput,
  PullRequestListResult,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDownUpIcon, LayersIcon, Plug2Icon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  collectPullRequestListFacets,
  narrowPullRequestsToFilters,
  mergePullRequestDiffStats,
  pullRequestDiffStatKey,
  pullRequestEntryKey,
  rankPullRequestMatches,
  pullRequestStatsRefreshBatches,
  pullRequestStatsRequestBatches,
  retainVisiblePullRequestStatsBatches,
  type EnvironmentPullRequestEntry,
  type MergedPullRequestList,
  type PullRequestDiffStats,
  type PullRequestStatsBatch,
  type PullRequestStatsPolicy,
  type PullRequestStatsScope,
  type PullRequestPartitionsSnapshot,
  type PullRequestListOverride,
  pullRequestOverrideAfterAction,
  reusePullRequestEntries,
  settlePullRequestOverrides,
  largestPullRequestReadCount,
} from "./pullRequestList.logic";
import {
  pullRequestListPreferences,
  type PullRequestListPreferencePatch,
  writePullRequestListPreferences,
} from "./pullRequestListPreferences";
import { environmentMachineIcon } from "../EnvironmentMachineIcon";
import { PullRequestDetailPanel } from "./PullRequestDetailPanel";
import {
  PullRequestFiltersMenu,
  PullRequestSearchInput,
  pullRequestHostLabel,
  pullRequestProjectKey,
  type PullRequestFilterOption,
} from "./PullRequestListFilters";
import { PullRequestCompactFilterMenu } from "./PullRequestCompactFilterMenu";
import { INVOLVEMENT_TABS, SORT_OPTIONS, STATE_TABS } from "./pullRequestListOptions";
import { PullRequestListGroups } from "./PullRequestListGroups";
import {
  usePullRequestDisplayGroups,
  usePullRequestQueryFilters,
  usePullRequestScope,
  type PullRequestsSearch,
} from "./usePullRequestListView";
import { pullRequestGroups, pullRequestListEntryId } from "./pullRequestListGroups.logic";
import { PullRequestListEmptyState } from "./PullRequestListEmptyState";
import { PullRequestListGhost } from "./PullRequestGhosts";
import type { PullRequestRowTarget } from "./PullRequestRow";
import { PullRequestsUnavailableState } from "./PullRequestsUnavailableState";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { resolveShortcutCommand } from "~/keybindings";
import { registerCommands } from "~/shortcuts/dispatcher";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { Button } from "../ui/button";
import { SidebarInset, useSidebar } from "../ui/sidebar";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useOpenPanelPullRequestUrl } from "~/hooks/useOpenPanelPullRequestUrl";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { toastManager } from "../ui/toast";
import {
  PULL_REQUESTS_PANEL_REF,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type PullRequestSurface,
} from "~/rightPanelStore";
import { useSidebarProjectGroups } from "~/hooks/useSidebarProjectGroups";
import {
  pullRequestEnvironment,
  usePullRequestList,
  usePullRequestListStats,
  restoredPullRequestList,
  usePullRequestTurnRefreshes,
  useSharedPullRequestSummary,
  type EnvironmentQueryTarget,
} from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { isMacPlatform } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";
import { PullRequestPanes } from "./PullRequestPanes";
import { maximizeForGuide, placePullRequests, showPullRequest } from "./pullRequestTabs";
import { startDrag } from "../../panes/drag";
import { readLocalApi } from "../../localApi";
import {
  anchorRow,
  rangeToRow,
  rowsActedOn,
  toggleRow,
  useRowSelectionStore,
} from "../../sidebarRowSelection";
import { rowClickIntent, type RowClick } from "../../tabNavigation.logic";
import { PullRequestsSidebarPortal } from "./PullRequestsSidebar";
import { PullRequestRefreshControl, PullRequestsSidebarList } from "./PullRequestsColumn";

function getShortcutContext() {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    modelPickerOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

/**
 * One whole page from the host and no more: every provider asks for one row beyond the page as
 * its "is there more" probe, and GitHub serves a hundred per request — so asking for ninety-nine
 * costs one round trip where a hundred costs two.
 */
const PAGE_SIZE = 99;
const MAX_PAGE_SIZE = 500;
const EMPTY_VIEWERS: PullRequestListResult["viewers"] = {};
const EMPTY_PARTITIONS: PullRequestPartitionsSnapshot = { authored: [], reviewing: [] };
const NO_LIST_TARGETS: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>> = [];
/** The pull request rows' share of the sidebars' row selection (`sidebarRowSelection`). */
const PULL_REQUEST_SELECTION = "pull-requests";
const NO_ROW_KEYS: readonly string[] = [];

export function PullRequestsPage() {
  const search = useSearch({ from: "/_chat/pull-requests" });
  const sort = search.sort ?? "ready";
  const statsPolicy: PullRequestStatsPolicy =
    sort === "ready" || sort === "largest" || sort === "smallest" ? "eager" : "visible";
  const navigate = useNavigate({ from: "/pull-requests" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  // Astrolabe: the list lives in the sidebar, a sheet over the review on narrow windows.
  const { isMobile, open: sidebarOpen, setOpen: setSidebarOpen, setOpenMobile } = useSidebar();
  const {
    capableEnvironments,
    scopedEnvironmentId,
    environmentKey,
    capabilityKnown,
    pullRequestsSupported,
    projects,
    environmentLabels,
    scopedProjectId,
    scopedProject,
    scopedProjects,
    selectedProject,
    queryEnvironmentIds,
    environmentQueries,
    assignmentKey,
    linkedSelection,
    expectedHosts,
    projectsKnown,
  } = usePullRequestScope(search);
  const rightPanelRef = capableEnvironments.length === 0 ? null : PULL_REQUESTS_PANEL_REF;
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(rightPanelRef);
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, rightPanelRef),
  );
  const selectedRightPanelSurface = useRightPanelStore((state) =>
    selectSelectedRightPanelSurface(state.byThreadKey, rightPanelRef),
  );
  const selectedPullRequestSurface =
    selectedRightPanelSurface?.kind === "pull-request" ? selectedRightPanelSurface : null;
  const activePullRequestSurface = rightPanelState.isOpen ? selectedPullRequestSurface : null;
  const panelEnvironmentId =
    (selectedPullRequestSurface?.environmentId as EnvironmentId | undefined) ??
    selectedProject?.environmentId ??
    null;
  const panelSummary = useSharedPullRequestSummary(
    panelEnvironmentId,
    selectedPullRequestSurface === null
      ? null
      : {
          ...selectedPullRequestSurface,
          projectId: selectedPullRequestSurface.projectId as ProjectId,
        },
  );
  const updateSearch = (patch: {
    [Key in keyof PullRequestsSearch]?: PullRequestsSearch[Key] | undefined;
  }) =>
    void navigate({
      search: (previous: PullRequestsSearch): PullRequestsSearch => {
        const next = { ...previous, ...patch };
        return {
          involvement: next.involvement ?? previous.involvement,
          state: next.state ?? previous.state,
          ...(next.sort && next.sort !== "ready" ? { sort: next.sort } : {}),
          ...(next.repository ? { repository: next.repository } : {}),
          ...(next.number ? { number: next.number } : {}),
          ...(next.projectId ? { projectId: next.projectId } : {}),
          ...(next.environmentId ? { environmentId: next.environmentId } : {}),
          ...(next.host ? { host: next.host } : {}),
          ...(next.selectedHost ? { selectedHost: next.selectedHost } : {}),
          ...(next.selectedProjectId ? { selectedProjectId: next.selectedProjectId } : {}),
          ...(next.selectedEnvironmentId
            ? { selectedEnvironmentId: next.selectedEnvironmentId }
            : {}),
          ...(next.q ? { q: next.q } : {}),
          ...(next.draft ? { draft: next.draft } : {}),
          ...(next.review ? { review: next.review } : {}),
          ...(next.checks ? { checks: next.checks } : {}),
          ...(next.author ? { author: next.author } : {}),
          ...(next.labels && next.labels.length > 0 ? { labels: next.labels } : {}),
        };
      },
      replace: true,
    });

  const clearedSelection = {
    repository: undefined,
    number: undefined,
    selectedProjectId: undefined,
    selectedEnvironmentId: undefined,
    selectedHost: undefined,
  };
  const updateListScope = (patch: PullRequestListPreferencePatch) => {
    const currentPreferences = pullRequestListPreferences({
      ...search,
      ...patch,
      involvement: patch.involvement ?? search.involvement,
      state: patch.state ?? search.state,
    });
    writePullRequestListPreferences(currentPreferences);
    updateSearch(patch);
  };

  const typedQuery = (search.q ?? "").trim();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const {
    sentQuery,
    submitQuery,
    querySettled,
    typedParsed,
    sentParsed,
    menuFilters,
    menuFiltered,
    filters,
    hasFilters,
    localFilters,
    hasLocalFilters,
  } = usePullRequestQueryFilters(search, typedQuery);
  const turnRefreshes = usePullRequestTurnRefreshes(
    environmentQueries.map(({ environmentId }) => environmentId),
  );
  const turnRefreshToken = turnRefreshes
    .map(([environmentId, revision]) => `${environmentId}:${revision}`)
    .join("|");
  const scopeKey = `${environmentKey}:${assignmentKey}:${search.state}:${search.involvement}:${scopedProjectId ?? ""}:${search.host ?? ""}:${search.draft ?? ""}:${search.review ?? ""}:${search.checks ?? ""}:${search.author ?? ""}:${search.labels?.join("\u0000") ?? ""}`;
  const filterKey = `${scopeKey}:${sentQuery}`;
  const statsScope: PullRequestStatsScope = { key: filterKey, policy: statsPolicy };
  const [page, setPage] = useState<{
    key: string;
    size: number;
    cursors: Readonly<Record<string, PullRequestListCursors>> | null;
    /**
     * An environment can say it has more without saying where to carry on from — its provider has
     * no cursor to give — and a continuation naming only the others would strand its rows on the
     * host forever.
     */
    regrown: ReadonlyArray<string>;
    /** The turn refreshes a continuation was read under; a later turn makes its cursors stale. */
    turn: string;
  }>({ key: filterKey, size: PAGE_SIZE, cursors: null, regrown: [], turn: turnRefreshToken });
  const pageSize = page.key === filterKey ? page.size : PAGE_SIZE;
  const sentCursors = page.key === filterKey ? page.cursors : null;
  const sentRegrown = page.key === filterKey ? page.regrown : [];

  if (page.key !== filterKey) {
    setPage({
      key: filterKey,
      size: PAGE_SIZE,
      cursors: null,
      regrown: [],
      turn: turnRefreshToken,
    });
  }

  const listTargets = environmentQueries.flatMap(({ environmentId, projectIds }) => {
    const cursors = sentCursors?.[environmentId];
    if (sentCursors !== null && cursors === undefined && !sentRegrown.includes(environmentId)) {
      return [];
    }
    return [
      {
        environmentId,
        input: {
          state: search.state,
          involvement: search.involvement,
          limit: pageSize,
          ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          ...(projectIds ? { projectIds } : {}),
          ...(search.host ? { host: search.host } : {}),
          ...(hasFilters ? { filters } : {}),
          ...(sentParsed.text ? { query: sentParsed.text } : {}),
          ...(cursors === undefined ? {} : { cursors }),
        } satisfies PullRequestListInput,
      },
    ];
  });
  const listQuery = usePullRequestList(listTargets);

  /**
   * Kept as its own read rather than remembered from an earlier answer because an answer cannot
   * say which question it belongs to: mid-switch the text has already changed and the data has
   * not, and a search's answer would file itself under the workspace.
   */
  const baselineTargets = environmentQueries.map(({ environmentId, projectIds }) => ({
    environmentId,
    input: {
      state: search.state,
      involvement: search.involvement,
      limit: PAGE_SIZE,
      ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
      ...(projectIds ? { projectIds } : {}),
      ...(search.host ? { host: search.host } : {}),
      ...(menuFiltered ? { filters: menuFilters } : {}),
    } satisfies PullRequestListInput,
  }));
  const baselineQuery = usePullRequestList(baselineTargets);
  const baselineEmpty =
    baselineQuery.data?.entries.length === 0 &&
    baselineQuery.data.errors.length === 0 &&
    !baselineQuery.isPending &&
    baselineQuery.error === null;
  const facetTargets = (() => {
    if (!filtersOpen) return NO_LIST_TARGETS;
    return environmentQueries.map(({ environmentId, projectIds }) => ({
      environmentId,
      input: {
        state: "all",
        involvement: search.involvement,
        limit: PAGE_SIZE,
        ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
        ...(projectIds ? { projectIds } : {}),
        ...(search.host ? { host: search.host } : {}),
      } satisfies PullRequestListInput,
    }));
  })();
  const facetQuery = usePullRequestList(facetTargets);
  const filterOptionScope = environmentQueries.map(({ environmentId, projectIds }) => ({
    environmentId,
    input: {
      ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
      ...(projectIds ? { projectIds } : {}),
      ...(search.host ? { host: search.host } : {}),
    },
  }));
  const partitionsWanted = search.involvement === "all" && typedQuery.length === 0;
  const partitionTargets = (() => {
    // The main list goes first. Besides putting the visible rows on screen sooner, it proves
    // which repositories the host search indexes, so an empty partition does not trigger the
    // expensive per-repository fallback.
    if (
      !partitionsWanted ||
      baselineQuery.data === null ||
      baselineQuery.data.entries.length === 0
    ) {
      return { authored: NO_LIST_TARGETS, reviewing: NO_LIST_TARGETS };
    }
    const targetsFor = (involvement: PullRequestInvolvement) =>
      environmentQueries.map(({ environmentId, projectIds }) => ({
        environmentId,
        input: {
          state: search.state,
          involvement,
          limit: PAGE_SIZE,
          ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          ...(projectIds ? { projectIds } : {}),
          ...(search.host ? { host: search.host } : {}),
          ...(menuFiltered ? { filters: menuFilters } : {}),
        } satisfies PullRequestListInput,
      }));
    return { authored: targetsFor("authored"), reviewing: targetsFor("reviewing") };
  })();
  const authoredQuery = usePullRequestList(partitionTargets.authored);
  const reviewingQuery = usePullRequestList(partitionTargets.reviewing);
  const invalidate = useAtomCommand(pullRequestEnvironment.invalidate, { reportFailure: false });
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const [invalidating, setInvalidating] = useState(false);
  const refreshing = invalidating || listQuery.isPending;

  const [loaded, setLoaded] = useState<{
    environmentKey: string;
    scope: string;
    query: string;
    /** The answer this was built from, so a re-render with the same answer leaves it alone. */
    source: MergedPullRequestList | null;
    data: MergedPullRequestList;
    partitions?: PullRequestPartitionsSnapshot;
  } | null>(null);
  const [ordered, setOrdered] = useState<{
    key: string;
    source: MergedPullRequestList;
    entries: ReadonlyArray<EnvironmentPullRequestEntry>;
  } | null>(null);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, PullRequestListOverride>>(
    () => new Map(),
  );
  const overrideToken = useRef(0);
  const overrideEntry = (
    entry: EnvironmentPullRequestEntry,
    action: PullRequestAction,
  ): number | null => {
    const token = ++overrideToken.current;
    const override = pullRequestOverrideAfterAction(entry, action, new Date(), token);
    if (override === null) return null;
    setOverrides((current) => new Map(current).set(pullRequestEntryKey(entry), override));
    return token;
  };
  const revertOverride = (key: string, token: number | null) => {
    if (token === null) return;
    setOverrides((current) => {
      if (current.get(key)?.token !== token) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };
  const detailOverrideTokens = useRef(new Map<string, number | null>());
  const onSpeedAction = useStableCallback(({ entry, action }: PullRequestSpeedActionResult) => {
    // Some hosts accept a merge before it completes. Let the next host read declare it merged.
    if (action !== "merge") overrideEntry(entry, action);
  });
  const onBatchClosed = useStableCallback((entry: EnvironmentPullRequestEntry) => {
    onSpeedAction({ entry, action: "close" });
  });
  const { close: closeBatch, closingKeys } = usePullRequestCloseBatch(onBatchClosed);
  const [snapshotEnvironmentKey, setSnapshotEnvironmentKey] = useState("");
  if (environmentKey.length > 0 && snapshotEnvironmentKey !== environmentKey) {
    setSnapshotEnvironmentKey(environmentKey);
    if (loaded?.environmentKey !== environmentKey) {
      const restored = restoredPullRequestList(baselineTargets);
      const restoredPartition = (involvement: PullRequestInvolvement) =>
        restoredPullRequestList(
          baselineTargets.map((target) => ({ ...target, input: { ...target.input, involvement } })),
        )?.entries;
      const authored = partitionsWanted ? restoredPartition("authored") : undefined;
      const reviewing = partitionsWanted ? restoredPartition("reviewing") : undefined;
      setLoaded(
        restored === null
          ? null
          : {
              environmentKey,
              scope: scopeKey,
              query: "",
              source: null,
              data: restored,
              ...(authored === undefined || reviewing === undefined
                ? {}
                : { partitions: { authored, reviewing } }),
            },
      );
    }
  }
  const settledList = listQuery.data !== null && !listQuery.isPending ? listQuery.data : null;
  const answeredPartitions =
    partitionsWanted && baselineEmpty
      ? EMPTY_PARTITIONS
      : partitionsWanted && authoredQuery.data !== null && reviewingQuery.data !== null
        ? { authored: authoredQuery.data.entries, reviewing: reviewingQuery.data.entries }
        : null;
  const heldPartitions =
    loaded !== null && loaded.environmentKey === environmentKey && loaded.scope === scopeKey
      ? loaded.partitions
      : undefined;
  const nextPartitions = answeredPartitions ?? heldPartitions;
  const loadedEntries =
    settledList === null
      ? null
      : ordered?.key === filterKey
        ? ordered.entries
        : settledList.entries;
  if (
    settledList !== null &&
    loadedEntries !== null &&
    (loaded === null ||
      loaded.source !== settledList ||
      loaded.environmentKey !== environmentKey ||
      loaded.scope !== scopeKey ||
      loaded.query !== sentQuery ||
      loaded.data.entries !== loadedEntries ||
      loaded.partitions?.authored !== nextPartitions?.authored ||
      loaded.partitions?.reviewing !== nextPartitions?.reviewing)
  ) {
    setLoaded({
      environmentKey,
      scope: scopeKey,
      query: sentQuery,
      source: settledList,
      data: { ...settledList, entries: loadedEntries },
      ...(nextPartitions === undefined ? {} : { partitions: nextPartitions }),
    });
  }
  const narrowed = (() => {
    if (loaded === null || loaded.environmentKey !== environmentKey || loaded.scope === scopeKey) {
      return null;
    }
    const entries = narrowPullRequestsToFilters(loaded.data.entries, {
      state: search.state,
      projectId: scopedProjectId,
      host: search.host,
    });
    return entries.length === 0 ? null : { ...loaded.data, entries };
  })();
  // A grown page is read by the list and nothing else: the baseline always asks for one page, so
  // a host with no cursor to continue from — where "more" means asking for a longer page — would
  // have its extra rows thrown away for the ninety-nine the baseline keeps answering with.
  const answered =
    (sentQuery.length === 0 && sentCursors === null && pageSize === PAGE_SIZE
      ? baselineQuery.data
      : listQuery.data) ??
    (loaded?.scope === scopeKey && loaded.query === sentQuery ? loaded.data : null);
  const carried =
    (sentQuery.length === 0 ? baselineQuery.data : undefined) ??
    (loaded?.scope === scopeKey ? loaded.data : null) ??
    narrowed;
  const listData = answered ?? carried;
  const showingCarried = answered === null && carried !== null;
  const loadingMore = listQuery.isPending && listData !== null;
  const firstLoad = listQuery.isPending && listData === null;

  if (
    answered !== null &&
    !listQuery.isPending &&
    !(listQuery.error && listQuery.data === null) &&
    (ordered === null || ordered.key !== filterKey || ordered.source !== answered)
  ) {
    if (ordered === null || ordered.key !== filterKey) {
      setOrdered({
        key: filterKey,
        source: answered,
        entries: rankPullRequestMatches(answered.entries, sentParsed.text),
      });
    } else if (sentCursors !== null) {
      const held = new Set(ordered.entries.map(pullRequestEntryKey));
      const arrived = answered.entries.filter((entry) => !held.has(pullRequestEntryKey(entry)));
      const appended = rankPullRequestMatches(
        arrived.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        sentParsed.text,
      );
      setOrdered({ key: filterKey, source: answered, entries: [...ordered.entries, ...appended] });
    } else {
      setOrdered({
        key: filterKey,
        source: answered,
        entries: reusePullRequestEntries(
          ordered.entries,
          rankPullRequestMatches(answered.entries, sentParsed.text),
          pullRequestEntryKey,
        ),
      });
    }
    const answeredEntries = answered.entries;
    setOverrides((current) =>
      settlePullRequestOverrides(current, answeredEntries, pullRequestEntryKey, Date.now()),
    );
  }

  // From this question's own answer, never from the rows being held while it travels: a
  // continuation is a boundary in one listing, and carrying one across a search would ask the new
  // question to start where the old one stopped — skipping its newest matches entirely.
  const nextCursors = answered?.nextCursors ?? {};
  const regrown = (answered?.truncatedEnvironments ?? []).filter(
    (environmentId) => nextCursors[environmentId] === undefined,
  );
  const canContinue = !showingCarried && Object.keys(nextCursors).length > 0;
  const loadMore = () => {
    if (canContinue) {
      setPage({
        key: filterKey,
        size: regrown.length === 0 ? pageSize : Math.min(pageSize + PAGE_SIZE, MAX_PAGE_SIZE),
        cursors: nextCursors,
        regrown,
        turn: turnRefreshToken,
      });
      return;
    }
    setPage({
      key: filterKey,
      size: Math.min(pageSize + PAGE_SIZE, MAX_PAGE_SIZE),
      cursors: null,
      regrown: [],
      turn: turnRefreshToken,
    });
  };

  const collapsedPage = () => {
    const loadedCount =
      ordered?.key === filterKey ? largestPullRequestReadCount(ordered.entries) : pageSize;
    return {
      key: filterKey,
      regrown: [],
      size: Math.min(
        Math.max(pageSize, Math.ceil(loadedCount / PAGE_SIZE) * PAGE_SIZE),
        MAX_PAGE_SIZE,
      ),
      cursors: null,
      turn: turnRefreshToken,
    };
  };
  // Every list read refetches itself when a turn completes, but a continuation would refetch only
  // its later page and strand the rows before it, so the whole loaded list is asked for again.
  if (sentCursors !== null && page.turn !== turnRefreshToken) setPage(collapsedPage());

  const refreshList = (includeRelated = false, actedEnvironmentId?: EnvironmentId) => {
    const related = (
      includeRelated
        ? [
            ...baselineTargets,
            ...facetTargets,
            ...partitionTargets.authored,
            ...partitionTargets.reviewing,
          ]
        : []
    ).filter(
      ({ environmentId }) =>
        actedEnvironmentId === undefined || environmentId === actedEnvironmentId,
    );
    if (sentCursors === null) {
      listQuery.refresh([
        ...listTargets.filter(
          ({ environmentId }) =>
            actedEnvironmentId === undefined || environmentId === actedEnvironmentId,
        ),
        ...related,
      ]);
      return;
    }
    if (related.length > 0) listQuery.refresh(related);
    setPage(collapsedPage());
  };

  useLiveRefresh(
    () => {
      refreshList(true);
    },
    { enabled: pullRequestsSupported },
  );

  const viewers = baselineQuery.data?.viewers ?? listData?.viewers ?? EMPTY_VIEWERS;
  const listErrors = baselineQuery.data?.errors ?? listData?.errors ?? [];
  const facets = collectPullRequestListFacets(
    [
      ...(facetQuery.data?.entries ?? []),
      ...(baselineQuery.data?.entries ?? listData?.entries ?? []),
    ],
    search.state,
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    entries,
    listedPullRequestTabStatuses,
    groups,
    entriesByStatsKey,
    heldPullRequestsBySurface,
  } = pullRequestGroups({
    known: ordered?.key === filterKey ? ordered.entries : (listData?.entries ?? []),
    providers: baselineQuery.data?.providers ?? listData?.providers ?? [],
    viewers,
    involvement: search.involvement,
    localFilters,
    hasLocalFilters,
    text: typedParsed.text,
    answeredLocally: querySettled && !showingCarried,
    baselineEmpty,
    held:
      loaded !== null && loaded.environmentKey === environmentKey && loaded.scope === scopeKey
        ? loaded.partitions
        : undefined,
    authored: partitionsWanted ? authoredQuery.data?.entries : undefined,
    reviewing: partitionsWanted ? reviewingQuery.data?.entries : undefined,
    partitionsWanted,
  });

  const visibleStatsKeys = useRef({ key: filterKey, values: new Set<string>() });
  const [statsByRow, setStatsByRow] = useState<PullRequestDiffStats>(() => new Map());
  if (
    panelEnvironmentId !== null &&
    panelSummary?.additions !== undefined &&
    panelSummary.deletions !== undefined
  ) {
    const stat = {
      ...panelSummary,
      environmentId: panelEnvironmentId,
      additions: panelSummary.additions,
      deletions: panelSummary.deletions,
    };
    const previous = statsByRow.get(pullRequestDiffStatKey(stat));
    if (previous?.additions !== stat.additions || previous.deletions !== stat.deletions) {
      setStatsByRow(mergePullRequestDiffStats(statsByRow, [stat]));
    }
  }
  const [statsTargetState, setStatsTargetState] = useState<{
    readonly key: string;
    readonly batches: ReadonlyArray<PullRequestStatsBatch>;
  }>({ key: filterKey, batches: [] });
  const statsBatches = statsTargetState.key === filterKey ? statsTargetState.batches : [];
  const statsTargets = statsBatches.map(({ environmentId, input }) => ({
    environmentId,
    input,
  }));
  const statsQuery = usePullRequestListStats(statsTargets);
  const statsObserver = useRef<IntersectionObserver | null>(null);
  const statsRows = useRef(new Set<HTMLDivElement>());
  // Called from a row's ref cleanup, which keeps the render it attached in; this reads the latest.
  const releaseStatsRow = useStableCallback((key: string | undefined) => {
    const visible = visibleStatsKeys.current;
    if (
      statsPolicy !== "visible" ||
      key === undefined ||
      !visible.values.delete(key) ||
      statsQuery.isPending
    ) {
      return;
    }
    setStatsTargetState((current) => {
      if (current.key !== visible.key) return current;
      const batches = retainVisiblePullRequestStatsBatches(current.batches, visible.values);
      return batches.length === current.batches.length ? current : { key: current.key, batches };
    });
  });
  // Every row takes this as its ref, so a new identity would detach and reattach them all.
  const registerStatsRow = useStableCallback((node: HTMLDivElement | null) => {
    if (node === null || typeof IntersectionObserver === "undefined") return;
    statsRows.current.add(node);
    statsObserver.current?.observe(node);
    return () => {
      statsRows.current.delete(node);
      statsObserver.current?.unobserve(node);
      releaseStatsRow(node.dataset.pullRequestStatsKey);
    };
  });
  // Arriving stats must not re-run the effects that ask for them.
  const readStatsProgress = useEffectEvent(() => ({
    statsByRow,
    pending: statsQuery.isPending,
  }));
  useEffect(() => {
    if (statsPolicy !== "eager") return;
    const { statsByRow: known } = readStatsProgress();
    const candidateKeys = visibleStatsKeys.current.values;
    setStatsTargetState((current) => {
      const batches = current.key === filterKey ? current.batches : [];
      const added = pullRequestStatsRequestBatches({
        entriesByKey: entriesByStatsKey,
        candidateKeys,
        policy: statsPolicy,
        activeBatches: batches,
        statsByRow: known,
      });
      if (added.length === 0 && current.key === filterKey) return current;
      return { key: filterKey, batches: [...batches, ...added] };
    });
  }, [filterKey, entriesByStatsKey, statsPolicy]);
  // The observer outlives the rows it watches, so it reads the rows held at the time it fires.
  const readStatsRows = useEffectEvent(() => entriesByStatsKey);
  useEffect(() => {
    if (statsPolicy !== "visible" || typeof IntersectionObserver === "undefined") return;
    visibleStatsKeys.current = { key: filterKey, values: new Set() };
    const observer = new IntersectionObserver(
      (observed) => {
        const visible = visibleStatsKeys.current;
        if (visible.key !== filterKey) return;
        let changed = false;
        const entered = new Set<string>();
        const entriesByKey = readStatsRows();
        for (const item of observed) {
          const key = (item.target as HTMLElement).dataset.pullRequestStatsKey;
          if (key === undefined) continue;
          const wasVisible = visible.values.has(key);
          if (item.isIntersecting && entriesByKey.has(key)) {
            visible.values.add(key);
            if (!wasVisible) entered.add(key);
          } else {
            visible.values.delete(key);
          }
          if (wasVisible !== visible.values.has(key)) changed = true;
        }
        if (!changed) return;
        const progress = readStatsProgress();
        setStatsTargetState((current) => {
          const batches = current.key === filterKey ? current.batches : [];
          const retained = progress.pending
            ? batches
            : retainVisiblePullRequestStatsBatches(batches, visible.values);
          const added = pullRequestStatsRequestBatches({
            entriesByKey,
            candidateKeys: entered,
            policy: statsPolicy,
            activeBatches: batches,
            statsByRow: progress.statsByRow,
          });
          if (added.length === 0 && retained.length === batches.length) return current;
          return { key: filterKey, batches: [...retained, ...added] };
        });
      },
      { root: scrollRef.current, rootMargin: "480px" },
    );
    statsObserver.current = observer;
    for (const row of statsRows.current) observer.observe(row);
    return () => {
      observer.disconnect();
      if (statsObserver.current === observer) statsObserver.current = null;
    };
  }, [filterKey, statsPolicy]);
  useEffect(() => {
    if (statsPolicy !== "visible" || statsQuery.isPending) return;
    const visible = visibleStatsKeys.current;
    setStatsTargetState((current) => {
      if (current.key !== filterKey || visible.key !== filterKey) return current;
      const batches = retainVisiblePullRequestStatsBatches(current.batches, visible.values);
      return batches.length === current.batches.length ? current : { key: current.key, batches };
    });
  }, [filterKey, statsPolicy, statsQuery.isPending]);
  const [mergedStats, setMergedStats] = useState<typeof statsQuery.stats>(null);
  if (statsQuery.stats !== null && statsQuery.stats !== mergedStats) {
    const stats = statsQuery.stats;
    setMergedStats(stats);
    setStatsByRow((previous) => mergePullRequestDiffStats(previous, stats));
  }
  // Stable so a refresh that resumes after awaiting the host compares against the scope on screen
  // by then, not the one it started from.
  const refreshListAndStats = useStableCallback(
    (
      requestedStatsScope: PullRequestStatsScope = statsScope,
      actedEnvironmentId?: EnvironmentId,
    ) => {
      refreshList(true, actedEnvironmentId);
      const visible = visibleStatsKeys.current;
      const batches = pullRequestStatsRefreshBatches({
        requestedScope: requestedStatsScope,
        currentScope: statsScope,
        entriesByKey: entriesByStatsKey,
        candidateKeys: visible.key === requestedStatsScope.key ? visible.values : new Set(),
        statsByRow,
      });
      if (batches !== null) {
        setStatsTargetState({ key: requestedStatsScope.key, batches });
        statsQuery.refresh(
          batches
            .filter(({ environmentId }) =>
              actedEnvironmentId === undefined ? true : environmentId === actedEnvironmentId,
            )
            .map(({ environmentId, input }) => ({ environmentId, input })),
        );
      }
    },
  );
  const refreshFromHost = async () => {
    const requestedStatsScope = statsScope;
    setInvalidating(true);
    // Atom commands settle into results rather than throwing.
    await Promise.all(
      queryEnvironmentIds.map((environmentId) => invalidate({ environmentId, input: {} })),
    );
    setInvalidating(false);
    refreshListAndStats(requestedStatsScope);
    setDetailRefreshToken((token) => token + 1);
  };
  const {
    hosts,
    displayGroups,
    shownCount,
    hostActionsOf,
    closeSweepRows,
    listedPullRequestsBySurface,
  } = usePullRequestDisplayGroups({
    answered,
    host: search.host,
    groups,
    statsByRow,
    overrides,
    state: search.state,
    localFilters,
    hasLocalFilters,
    viewers,
    sort,
    text: typedParsed.text,
    involvement: search.involvement,
  });
  const showProvider = hosts.length > 1;
  const [closeSweepKeys, setCloseSweepKeys] = useState<ReadonlySet<string>>(() => new Set());
  const closeSensorRef = useRef<SidebarPointerSensor | null>(null);
  // A sweep spans many renders; each step reads the rows on screen at that moment.
  const readCloseSweep = useStableCallback(() => ({
    displayGroups,
    closeSweepRows,
    closingKeys,
    closeBatch,
    hostActionsOf,
  }));
  useEffect(
    () => () => closeSensorRef.current?.cancel(),
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The pointer sensor lives outside React; a new list under a sweep in progress must end it.
    [filterKey, search.q, sort],
  );
  const startCloseSweep = useStableCallback(
    (entry: EnvironmentPullRequestEntry, event: PointerEvent) => {
      closeSensorRef.current?.cancel();
      const originKey = pullRequestEntryKey(entry);
      const group = readCloseSweep().displayGroups.find((candidate) =>
        candidate.entries.some((row) => pullRequestEntryKey(row) === originKey),
      );
      if (!group || readCloseSweep().closingKeys.has(originKey)) return;
      const orderedKeys = readCloseSweep().displayGroups.flatMap((candidate) =>
        candidate.entries.map(pullRequestEntryKey),
      );
      const canClose = (key: string) => {
        const row = readCloseSweep().closeSweepRows.get(key);
        return (
          row?.groupKey === group.key &&
          row.entry.state === "open" &&
          readCloseSweep().hostActionsOf(row.entry).has("close") &&
          !readCloseSweep().closingKeys.has(key) &&
          !scrollRef.current?.querySelector(
            `[data-pull-request-key="${CSS.escape(key)}"] [data-pull-request-action-pending="true"]`,
          )
        );
      };
      let sweptKeys: string[] = [];
      let targetKey: string | null = null;
      const sweepTo = (key: string) => {
        if (key === targetKey) return;
        targetKey = key;
        sweptKeys = resolveSidebarSweepKeys(orderedKeys, originKey, key, canClose);
        setCloseSweepKeys(new Set(sweptKeys));
      };
      // Only while a sweep runs: Escape ends it, ahead of any other scope that would also take it.
      const releaseEscape = registerCommands(
        {},
        {
          capture: true,
          onKeyDown: (keyEvent) => {
            if (keyEvent.key !== "Escape") return false;
            keyEvent.preventDefault();
            sensor.cancel();
          },
        },
      );
      const sensor = new SidebarPointerSensor({
        active: originKey,
        event,
        options: {
          distance: 6,
          onAttach: () => {},
          onFinish: () => {
            releaseEscape();
            if (closeSensorRef.current === sensor) closeSensorRef.current = null;
            setCloseSweepKeys(new Set());
          },
        },
        onPending: () => {},
        onStart: () => sweepTo(originKey),
        onMove: ({ y }) => {
          const viewport = scrollRef.current;
          if (!viewport) return;
          const bounds = viewport.getBoundingClientRect();
          const visibleY = Math.min(Math.max(y, bounds.top), bounds.bottom - 1);
          let key: string | null = null;
          for (const row of viewport.querySelectorAll<HTMLElement>("[data-pull-request-key]")) {
            if (key !== null && row.getBoundingClientRect().top > visibleY) break;
            key = row.dataset.pullRequestKey ?? null;
          }
          if (key !== null) sweepTo(key);
        },
        onEnd: () => {
          const batch = sweptKeys.filter(canClose).flatMap((key) => {
            const row = readCloseSweep().closeSweepRows.get(key);
            return row ? [row.entry] : [];
          });
          void readCloseSweep().closeBatch(batch);
        },
        onCancel: () => {},
        onAbort: () => {},
      });
      closeSensorRef.current = sensor;
    },
  );
  useEffect(() => {
    if (!pullRequestsSupported || rightPanelRef === null || linkedSelection === null) return;
    useRightPanelStore.getState().openPullRequest(rightPanelRef, linkedSelection);
  }, [linkedSelection, pullRequestsSupported, rightPanelRef]);

  const selected =
    rightPanelState.isOpen && activePullRequestSurface !== null
      ? {
          environmentId: activePullRequestSurface.environmentId,
          repository: activePullRequestSurface.repository,
          number: activePullRequestSurface.number,
          projectId: activePullRequestSurface.projectId as ProjectId,
          host:
            activePullRequestSurface.host ??
            (selectedProject?.repositoryIdentity
              ? sourceControlClients.changeRequestHost(
                  selectedProject.repositoryIdentity,
                  selectedProject.repositoryIdentity.provider,
                )
              : undefined),
        }
      : null;

  const selectSurfaceInUrl = (surface: PullRequestSurface | null) =>
    updateSearch(
      surface === null
        ? clearedSelection
        : {
            repository: surface.repository,
            number: surface.number,
            selectedProjectId: surface.projectId as ProjectId,
            selectedHost: surface.host,
            ...(surface.environmentId === undefined
              ? {}
              : { selectedEnvironmentId: surface.environmentId as EnvironmentId }),
          },
    );

  const unavailableProjects = new Map(
    listErrors.map(
      (error) =>
        [
          pullRequestProjectKey({ id: error.projectId, environmentId: error.environmentId }),
          error.message,
        ] as const,
    ),
  );

  // Astrolabe: Cmd/Ctrl-click and Shift-click select rows, as in Agents; a drag or the menu on a
  // selected row carries the selection, in the list's order. The rows' handlers read the list as
  // it is now, and stay stable so a list change does not re-render every memoized row.
  const selectedRowKeys = useRowSelectionStore((store) =>
    store.selection.section === PULL_REQUEST_SELECTION ? store.selection.keys : NO_ROW_KEYS,
  );
  const rowsFrom = (entry: PullRequestRowTarget) => {
    const keys = rowsActedOn(
      useRowSelectionStore.getState().selection,
      PULL_REQUEST_SELECTION,
      pullRequestEntryKey(entry),
      [...entriesByStatsKey.keys()],
    );
    return keys.map((key) => entriesByStatsKey.get(key) ?? entry);
  };
  const dragRow = useStableCallback(
    (entry: EnvironmentPullRequestEntry, event: DragEvent<HTMLElement>) => {
      const carried = rowsFrom(entry);
      startDrag(
        event,
        {
          key: pullRequestEntryKey(entry),
          keys: [],
          place: (paneId, drop) => placePullRequests(carried, entry, paneId, drop),
        },
        event.currentTarget.getAttribute("aria-label") ?? "",
        carried.length > 1 ? carried.length : 0,
      );
    },
  );
  const showRowMenu = useStableCallback(
    (entry: EnvironmentPullRequestEntry, event: ReactMouseEvent<HTMLElement>) => {
      const api = readLocalApi();
      if (!api) return;
      const carried = rowsFrom(entry);
      const label = carried.length > 1 ? `Open ${carried.length} in new tabs` : "Open in new tab";
      void api.contextMenu
        .show([{ id: "new-tab" as const, label, icon: "square-plus" }], {
          x: event.clientX,
          y: event.clientY,
        })
        .then((picked) => {
          if (picked !== "new-tab") return;
          for (const each of carried) showPullRequest(each, "new-tab");
          if (isMobile) setOpenMobile(false);
        });
    },
  );

  const selectEntry = useStableCallback((entry: PullRequestRowTarget, click?: RowClick) => {
    if (rightPanelRef === null) return;
    const intent = click ? rowClickIntent(click, isMacPlatform(navigator.platform)) : "replace";
    const key = pullRequestEntryKey(entry);
    const { change } = useRowSelectionStore.getState();
    if (intent === "mod") {
      change((now) => toggleRow(now, PULL_REQUEST_SELECTION, key));
      return;
    }
    if (intent === "range") {
      const ordered = [...entriesByStatsKey.keys()];
      change((now) => rangeToRow(now, PULL_REQUEST_SELECTION, key, ordered));
      return;
    }
    change(() => anchorRow(PULL_REQUEST_SELECTION, key));
    // Astrolabe: in the tab in front, or as the click asks (see `pullRequestTabs`); the narrow
    // sheet steps aside for it, as it does for a thread or a document.
    showPullRequest(entry, intent);
    if (isMobile) setOpenMobile(false);
    updateSearch({
      repository: entry.repository,
      number: entry.number,
      selectedProjectId: entry.projectId,
      selectedEnvironmentId: entry.environmentId,
      selectedHost: entry.host,
    });
  });

  const searchInput = (
    <PullRequestSearchInput
      value={search.q ?? ""}
      busy={typedQuery.length > 0 && (!querySettled || showingCarried)}
      onChange={(query) => updateListScope({ q: query || undefined })}
      onSubmit={submitQuery}
    />
  );
  // Astrolabe: find (Mod+F) searches the list, opening the sidebar first when it is closed; the
  // field takes focus once it is on screen (`PullRequestsSidebarList`).
  const [searchFocusPending, setSearchFocusPending] = useState(false);
  const onSearchFocused = useStableCallback(() => setSearchFocusPending(false));
  const carriedToNothing =
    shownCount === 0 &&
    typedQuery.length === 0 &&
    (!querySettled || (showingCarried && listQuery.isPending));
  // Astrolabe: in the sidebar's list and in the main area, so a closed sidebar or the narrow
  // sheet does not leave a blank page.
  const unsupportedState = (
    <PullRequestsUnavailableState
      title="Pull requests unavailable"
      error="Update your Astrolabe servers to browse pull requests."
    />
  );
  const listBody = (
    <>
      {!capabilityKnown ? (
        <PullRequestListGhost rows={7} caption="Loading pull requests…" />
      ) : !pullRequestsSupported ? (
        unsupportedState
      ) : firstLoad ? (
        <PullRequestListGhost rows={7} caption="Loading pull requests…" />
      ) : listQuery.error && shownCount === 0 ? (
        <PullRequestsUnavailableState
          error={listQuery.error}
          refreshing={listQuery.isPending}
          onRetry={() => listQuery.refresh()}
        />
      ) : carriedToNothing ? (
        <PullRequestListGhost rows={7} />
      ) : shownCount === 0 ? (
        <PullRequestListEmptyState
          hasProjects={!projectsKnown || projects.length > 0}
          refreshing={refreshing}
          onRefresh={() => void refreshFromHost()}
          query={typedQuery}
          filtered={
            menuFiltered ||
            search.state !== "open" ||
            search.involvement !== "all" ||
            scopedProjectId !== undefined ||
            search.host !== undefined
          }
          searching={typedQuery.length > 0 && (!querySettled || showingCarried)}
          canLoadMore={listData?.truncated === true && (canContinue || pageSize < MAX_PAGE_SIZE)}
          loadingMore={loadingMore}
          onClearQuery={() => updateListScope({ q: undefined })}
          onLoadMore={loadMore}
        />
      ) : (
        <PullRequestListGroups
          groups={displayGroups}
          environmentLabels={capableEnvironments.length > 1 ? environmentLabels : null}
          query={typedParsed.text}
          selected={selected}
          showProvider={showProvider}
          statsRef={registerStatsRow}
          onSelect={selectEntry}
          hostActionsOf={hostActionsOf}
          onActed={onSpeedAction}
          closingKeys={closingKeys}
          sweepingKeys={closeSweepKeys}
          onCloseSweepStart={startCloseSweep}
          selectedRowKeys={selectedRowKeys}
          onDragRow={dragRow}
          onRowMenu={showRowMenu}
          // Astrolabe: drawn as the sidebar's cards, where the list now lives.
          layout="card"
        />
      )}

      {listQuery.error && shownCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs">
          <span>{listQuery.error} Showing the last pull requests loaded.</span>
          <Button size="xs" variant="outline" onClick={() => listQuery.refresh()}>
            Retry
          </Button>
        </div>
      ) : null}
      {listData?.truncated && entries.length > 0 ? (
        <div className="flex justify-center py-3 text-xs text-muted-foreground">
          {loadingMore ? (
            <span className="flex items-center gap-2">
              <Spinner aria-hidden size="sm" />
              {sentCursors === null ? "Updating pull requests" : "Loading more"}
            </span>
          ) : canContinue || pageSize < MAX_PAGE_SIZE ? (
            <Button
              size="sm"
              variant="outline"
              onClick={loadMore}
              disabled={listQuery.isPending || showingCarried}
            >
              Load more pull requests
            </Button>
          ) : (
            <span>Narrow your search to find more pull requests.</span>
          )}
        </div>
      ) : null}
    </>
  );
  const hostEntries = hosts.length > 0 ? hosts : expectedHosts;
  const hostMenuOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: "", label: "All", Icon: Plug2Icon },
    ...hostEntries.map((entry) => {
      const summary = hosts.find((host) => host.host === entry.host);
      return {
        value: entry.host,
        label: pullRequestHostLabel(hostEntries, entry),
        Icon: getSourceControlPresentationForKind(entry.kind).Icon,
        ...(summary === undefined || summary.configured
          ? {}
          : { unavailable: summary.detail ?? "This host could not be read." }),
      };
    }),
  ];
  const serverMenuOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: "", label: "All servers", Icon: LayersIcon },
    ...capableEnvironments.map((environment) => ({
      value: environment.environmentId,
      label: environment.label,
      Icon: environmentMachineIcon(resolveEnvironmentMachineKind(environment.serverConfig)),
    })),
  ];
  const sortMenu = (
    <PullRequestCompactFilterMenu
      label="Sort pull requests"
      triggerIcon={<ArrowDownUpIcon aria-hidden className="size-4" />}
      triggerLabel="Sort"
      outlined
      value={sort}
      options={SORT_OPTIONS}
      onChange={(next) => updateListScope({ sort: next })}
    />
  );
  const filtersMenu = (
    <PullRequestFiltersMenuInSidebarOrder
      onOpenChange={setFiltersOpen}
      state={search.state}
      stateOptions={STATE_TABS}
      onState={(state) => updateListScope({ state })}
      involvement={search.involvement}
      involvementOptions={INVOLVEMENT_TABS}
      onInvolvement={(involvement) => updateListScope({ involvement })}
      filters={
        typedParsed.filters.draft
          ? { ...menuFilters, draft: typedParsed.filters.draft }
          : menuFilters
      }
      onFilters={(value) => {
        const { query, filters: next } = applyPullRequestDraftFilterChange(
          typedQuery,
          menuFilters,
          value,
        );
        updateListScope({
          ...(query === typedQuery ? {} : { q: query || undefined }),
          draft: next.draft,
          review: next.review,
          checks: next.checks,
          author: next.author,
          labels: next.labels?.flatMap((group) => group),
        });
      }}
      authorOptions={facets.authors}
      labelOptions={facets.labels}
      optionScope={filterOptionScope}
      host={search.host}
      hostOptions={hostMenuOptions}
      onHost={(host) => updateListScope({ host })}
      server={scopedEnvironmentId ?? undefined}
      serverOptions={serverMenuOptions}
      onServer={(server) => updateListScope({ environmentId: server, projectId: undefined })}
      projects={scopedProjects}
      projectId={scopedProjectId}
      projectEnvironmentId={scopedProject?.environmentId}
      unavailable={unavailableProjects}
      onProject={(projectId, environmentId) =>
        updateListScope(environmentId === undefined ? { projectId } : { projectId, environmentId })
      }
    />
  );
  const columnProps = {
    host: search.host,
    searchQuery: search.q ?? "",
    projects: scopedProjects,
    projectId: scopedProjectId,
    projectEnvironmentId: scopedProject?.environmentId,
    onProject: (projectId: ProjectId | undefined, environmentId?: EnvironmentId) =>
      updateListScope(environmentId === undefined ? { projectId } : { projectId, environmentId }),
    searchInput,
    sortMenu,
    filtersMenu,
    listBody,
    scrollRef,
    searchFocusPending,
    onSearchFocused,
  };

  const closeSurface = (surface: PullRequestSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeSurface(rightPanelRef, surface.id);
    const next = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      rightPanelRef,
    );
    selectSurfaceInUrl(next?.kind === "pull-request" ? next : null);
  };

  const copyPullRequestFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!openPanelPullRequestUrl) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const url = openPanelPullRequestUrl;
    const { shortLabel, singular } = (
      sourceControlClients.findByChangeRequestUrl(url) ?? sourceControlClients.get(undefined)
    ).changeRequest;
    void writeTextToClipboard(url, `${singular} link`).then(
      (didCopy) => {
        if (didCopy)
          toastManager.add({
            type: "success",
            title: `${shortLabel} link copied`,
            description: url,
          });
      },
      (error) => {
        toastManager.add({
          type: "error",
          title: `Failed to copy ${shortLabel} link`,
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      },
    );
  });
  const closeActiveSurfaceFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (activePullRequestSurface === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) closeSurface(activePullRequestSurface);
  });
  // Astrolabe: a review's Guide folds the sidebar's list away (`maximizeForGuide`), as T3 Code
  // hid its list for the tour. The sidebar is every section's, so leaving Changes opens it again
  // unless it was opened by hand since.
  const sidebarFoldedForGuide = useRef(false);
  const foldSidebarForGuide = () => {
    if (isMobile || !sidebarOpen) return;
    sidebarFoldedForGuide.current = true;
    void setSidebarOpen(false);
  };
  useEffect(() => {
    if (sidebarOpen) sidebarFoldedForGuide.current = false;
  }, [sidebarOpen]);
  const reopenSidebarFoldedForGuide = useEffectEvent(() => {
    if (sidebarFoldedForGuide.current) void setSidebarOpen(true);
  });
  useEffect(() => () => reopenSidebarFoldedForGuide(), []);
  const focusSearchFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isMobile) setOpenMobile(true);
    else if (!sidebarOpen) void setSidebarOpen(true);
    setSearchFocusPending(true);
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: getShortcutContext(),
      });
      if (command === "rightPanel.close") closeActiveSurfaceFromShortcut(event);
      if (command === "thread.copyReference") copyPullRequestFromShortcut(event);
      // A chat shown in these panes takes find for itself first (`ChatView`).
      if (command === "chat.find") focusSearchFromShortcut(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [keybindings]);

  // Astrolabe: the URL follows the focused pane's pull request. Stable, since the panes call it
  // from an effect keyed on it.
  const onPanesFocus = useStableCallback((surface: PullRequestSurface | null) =>
    selectSurfaceInUrl(surface),
  );

  // Astrolabe: each open pull request's detail, as a tab in the panes beside the sidebar.
  const renderPullRequestDetail = (surface: PullRequestSurface, active: boolean) => {
    const environmentId =
      (surface.environmentId as EnvironmentId | undefined) ??
      selectedProject?.environmentId ??
      null;
    if (environmentId === null) return null;
    return (
      <PullRequestDetailPanel
        getShortcutContext={getShortcutContext}
        shortcutsEnabled={active}
        environmentId={environmentId}
        onSelectPullRequest={(reference) => {
          if (rightPanelRef === null) return;
          // Astrolabe: a pull request picked from within a review replaces that review's tab.
          showPullRequest(
            {
              projectId: reference.projectId,
              repository: reference.repository,
              number: reference.number,
              ...(reference.host ? { host: reference.host } : {}),
              environmentId,
            },
            "replace",
          );
          updateSearch({
            repository: reference.repository,
            number: reference.number,
            selectedHost: reference.host,
            selectedProjectId: reference.projectId,
            selectedEnvironmentId: environmentId,
          });
        }}
        reference={{
          projectId: surface.projectId as ProjectId,
          repository: surface.repository,
          number: surface.number,
          ...(surface.host ? { host: surface.host } : {}),
        }}
        listEntry={listedPullRequestsBySurface.get(pullRequestListEntryId(surface)) ?? null}
        refreshToken={detailRefreshToken}
        tabOnPage
        // Astrolabe: the Guide's tour gets the window, as T3 Code maximized the review for it.
        onGuideShown={() => maximizeForGuide(surface.id, foldSidebarForGuide)}
        onActed={(action, phase = "done") => {
          // From every row held, not the ones on screen: a pull request closed from an open
          // list has left the screen, and reopening it has to find it anyway.
          const acted = heldPullRequestsBySurface.get(pullRequestListEntryId(surface));
          const stateOnly =
            action !== undefined &&
            acted !== undefined &&
            pullRequestOverrideAfterAction(acted, action, new Date(), 0) !== null;
          if (stateOnly) {
            const key = pullRequestEntryKey(acted);
            if (phase === "sent" && action !== "merge") {
              detailOverrideTokens.current.set(key, overrideEntry(acted, action));
            }
            if (phase === "failed" && action !== "merge") {
              revertOverride(key, detailOverrideTokens.current.get(key) ?? null);
            }
            if (phase !== "sent") detailOverrideTokens.current.delete(key);
            if (phase === "done" && action === "merge") {
              overrideEntry(acted, action);
              refreshListAndStats(undefined, environmentId);
            }
            return;
          }
          if (phase === "done") refreshListAndStats(undefined, environmentId);
        }}
      />
    );
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {/* Astrolabe: the list and its controls live in the section's sidebar. */}
      <PullRequestsSidebarPortal
        actions={
          <PullRequestRefreshControl
            compact
            refreshing={refreshing}
            onRefresh={() => void refreshFromHost()}
          />
        }
      >
        <PullRequestsSidebarList {...columnProps} />
      </PullRequestsSidebarPortal>
      {pullRequestsSupported ? (
        <PullRequestPanes
          renderDetail={renderPullRequestDetail}
          titleOf={(surface) =>
            listedPullRequestsBySurface.get(pullRequestListEntryId(surface))?.title ?? null
          }
          statusSeeds={listedPullRequestTabStatuses}
          environmentId={panelEnvironmentId}
          onClose={closeSurface}
          onFocus={onPanesFocus}
        />
      ) : capabilityKnown ? (
        unsupportedState
      ) : null}
    </SidebarInset>
  );
}

function PullRequestFiltersMenuInSidebarOrder(
  props: ComponentProps<typeof PullRequestFiltersMenu>,
) {
  const sidebarProjectGroups = useSidebarProjectGroups();
  const projects = sortProjectsByGroupOrder(props.projects, sidebarProjectGroups);
  return <PullRequestFiltersMenu {...props} projects={projects} />;
}
