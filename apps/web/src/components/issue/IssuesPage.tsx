import { useAtomValue } from "@effect/atom-react";
import {
  continueIssuePage,
  groupIssues,
  holdIssuePages,
  issueCursorsForHost,
  issueFilterScopes,
  issueTrackerKey,
  type EnvironmentIssueEntry,
  type HeldIssuePage,
} from "@t3tools/client-runtime/issue-list";
import { issueTrackerDetailText } from "@t3tools/client-runtime/state/issue-trackers";
import { issueEntryKey } from "@t3tools/client-runtime/state/issues";
import type {
  EnvironmentId,
  IssueInvolvement,
  IssueListInput,
  IssueListSort,
  IssueListState,
  IssueTrackerSummary,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowDownUpIcon,
  AtSignIcon,
  CalendarArrowDownIcon,
  CircleCheckIcon,
  ClockIcon,
  LayersIcon,
  PenLineIcon,
  Plug2Icon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  Fragment,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { RefreshIcon } from "~/components/ui/refresh-icon";
import { IssueRow } from "~/components/issue/IssueRow";
import {
  issueListPreferences,
  writeIssueListPreferences,
  type IssueListPreferences,
} from "~/components/issue/issueListPreferences";
import { IssueGlyph, issueTrackerPresentation } from "~/components/issue/issuePresentation";
import { PullRequestListGhost } from "~/components/pullRequest/PullRequestGhosts";
import {
  PullRequestFilterOptionIcon,
  pullRequestProjectKey,
  PullRequestSearchInput,
  type PullRequestFilterOption,
} from "~/components/pullRequest/PullRequestListFilters";
import { m, type MessageResolver } from "~/i18n/messages";
import { resolveFilterOptions } from "../pullRequest/pullRequestListOptions";
import { IssueFiltersMenu } from "./IssueListFilterPickers";
import { IssuesSidebarPortal } from "./IssuesSidebar";
import { issueTabKey, issueTargetOfKey } from "./issueTabs";
import { placeIssue, showIssue } from "./issueWorkspace";
import { issueFilterProjects, issueListTargets, issueProjectKeys } from "./issuesSearch.logic";
import { ISSUE_SAVED_VIEWS } from "./issueSavedViews";
import { SavedViewsMenu } from "~/components/SavedViewsMenu";
import { PullRequestCompactFilterMenu } from "../pullRequest/PullRequestCompactFilterMenu";
import { PullRequestsUnavailableState } from "~/components/pullRequest/PullRequestsUnavailableState";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { useSidebar } from "~/components/ui/sidebar";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { useStableCallback } from "~/hooks/useStableCallback";
import { resolveShortcutCommand } from "~/keybindings";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { startDrag } from "~/panes/drag";
import { useWorkspaceFocusedKey } from "~/panes/workspace";
import { closeWorkspaceTab } from "~/panes/workspaceTabs";
import { rowClickIntent, type RowClick, type RowClickIntent } from "~/tabNavigation.logic";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useProjects } from "~/state/entities";
import { useEnvironments, useIssuesSupported } from "~/state/environments";
import { issueEnvironment, useIssueList } from "~/state/issues";
import { useDebouncedValue } from "~/state/queries";
import { primaryServerKeybindingsAtom } from "~/state/server";

/** Astrolabe: only the list's place; the issues it opens are tabs of the shared panes. */
export type IssuesSearch = IssueListPreferences;

const STATE_TABS = [
  { value: "open", label: msg("Open", { $context: "issue state" }), Icon: IssueGlyph.issue },
  { value: "closed", label: msg("Closed", { $context: "issue state" }), Icon: CircleCheckIcon },
  { value: "all", label: msg("All", { $context: "issue filter" }), Icon: LayersIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListState>>;

const INVOLVEMENT_TABS = [
  { value: "all", label: msg("Everyone", { $context: "issue filter" }), Icon: UsersIcon },
  { value: "assigned", label: msg("Assigned to me"), Icon: UserCheckIcon },
  { value: "authored", label: msg("Opened by me"), Icon: PenLineIcon },
  { value: "mentioned", label: msg("Mentioning me"), Icon: AtSignIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueInvolvement>>;

const SORT_OPTIONS = [
  { value: "updated", label: msg("Recently updated"), Icon: ClockIcon },
  {
    value: "created",
    label: msg("Newest", { $context: "sort order" }),
    Icon: CalendarArrowDownIcon,
  },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListSort>>;

const PAGE_SIZE = 50;

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

function hostOptionsFor(
  trackers: ReadonlyArray<IssueTrackerSummary>,
  chosen: string | undefined,
  resolve: MessageResolver,
) {
  const hosts = new Map<string, IssueTrackerSummary>();
  const ordered = [...trackers].sort((a, b) =>
    issueTrackerKey(a).localeCompare(issueTrackerKey(b)),
  );
  for (const tracker of ordered) {
    const existing = hosts.get(tracker.host);
    if (existing === undefined || (!existing.configured && tracker.configured))
      hosts.set(tracker.host, tracker);
  }
  return [
    { value: "", label: resolve(msg("All", { $context: "issue filter" })), Icon: Plug2Icon },
    // A remembered host no project is on any more stays listed, so the filter can be taken off.
    ...(chosen !== undefined && !hosts.has(chosen)
      ? [{ value: chosen, label: chosen, Icon: Plug2Icon }]
      : []),
    ...[...hosts.values()].map((tracker) => ({
      value: tracker.host,
      label:
        hosts.size > 1 && issueTrackerPresentation(tracker.tracker).providerName === tracker.host
          ? tracker.host
          : `${issueTrackerPresentation(tracker.tracker).providerName} (${tracker.host})`,
      Icon: issueTrackerPresentation(tracker.tracker).Icon,
      ...(tracker.configured
        ? {}
        : {
            unavailable:
              tracker.detail === null
                ? resolve(msg("Unavailable"))
                : issueTrackerDetailText(tracker.detail, resolve),
          }),
    })),
  ];
}

export function IssuesPage() {
  const gt = useGT();
  const resolve = useMessages();
  const navigate = useNavigate({ from: "/issues" });
  const search = useSearch({ from: "/_chat/issues" });
  const { environments } = useEnvironments();
  const projects = useProjects();
  const issuesSupported = useIssuesSupported();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { isMobile, open: sidebarOpen, setOpen: setSidebarOpen, setOpenMobile } = useSidebar();

  const capableEnvironments = environments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.issues === true,
  );
  const environmentLabels = new Map(environments.map((e) => [e.environmentId, e.label] as const));
  const filterProjects = issueFilterProjects(
    projects.filter((project) =>
      capableEnvironments.some((e) => e.environmentId === project.environmentId),
    ),
    environmentLabels,
  );
  const hiddenProjects = issueProjectKeys(search.hideProjects);

  const debouncedQuery = useDebouncedValue(search.q ?? "", 300);
  const listInput: IssueListInput = {
    state: search.status,
    involvement: search.who,
    limit: PAGE_SIZE,
    ...(search.host ? { host: search.host } : {}),
    ...(debouncedQuery ? { query: debouncedQuery } : {}),
    ...(search.label?.length ? { labels: search.label } : {}),
    ...(search.assignee ? { assignee: search.assignee } : {}),
    ...(search.order ? { sort: search.order } : {}),
  };
  const everyProjectHidden =
    filterProjects.length > 0 &&
    filterProjects.every((project) => hiddenProjects.has(pullRequestProjectKey(project)));
  const targets = everyProjectHidden
    ? []
    : issueListTargets(
        capableEnvironments.map((e) => e.environmentId),
        filterProjects,
        search.hideProjects,
        listInput,
      );
  const list = useIssueList(targets);
  // Refreshing a list still loading would cancel it and start over, losing the scopes already read.
  useLiveRefresh(
    () => {
      if (!list.isPending) list.reload();
    },
    { key: JSON.stringify(targets) },
  );

  const [pages, setPages] = useState<ReadonlyMap<EnvironmentId, HeldIssuePage>>(new Map());
  const held = holdIssuePages(list.answers, pages);
  const loadPage = useAtomCommand(issueEnvironment.listPage, { reportFailure: false });
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  // One tracker group's button carries on that tracker's scopes only.
  const loadMore = async (environmentId: EnvironmentId, host: string) => {
    const page = held.get(environmentId);
    const cursors = page ? issueCursorsForHost(page.nextCursors, host) : {};
    if (!page || Object.keys(cursors).length === 0 || loadingMore !== null) return;
    setLoadingMore(`${environmentId} ${host}`);
    const input = targets.find((target) => target.environmentId === environmentId)?.input;
    if (!input) return;
    const result = await loadPage({ environmentId, input: { ...input, cursors } });
    setLoadingMore(null);
    const failure = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
    setPages((current) => {
      const next = new Map(current);
      next.set(
        environmentId,
        continueIssuePage(
          page,
          result._tag === "Failure"
            ? {
                failure:
                  failure instanceof Error ? failure.message : m(msg("The next page failed.")),
              }
            : result.value,
          cursors,
        ),
      );
      return next;
    });
  };

  // Rows grouped per tracker account, so a tracker that cannot be read says so where its rows
  // would be, and each tracker's rows carry on from their own cursors.
  // The server names every tracker so the menu can switch hosts, but reads only the chosen one.
  const chosenHost = search.host?.toLowerCase();
  // A server older than `excludeProjectIds` still answers for hidden projects.
  const shown =
    chosenHost || hiddenProjects.size > 0
      ? new Map(
          [...held].map(([environmentId, page]) => [
            environmentId,
            {
              ...page,
              entries: page.entries.filter(
                (entry) =>
                  !hiddenProjects.has(
                    pullRequestProjectKey({ environmentId, id: entry.projectId }),
                  ),
              ),
              errors: page.errors.filter(
                (error) =>
                  !hiddenProjects.has(
                    pullRequestProjectKey({ environmentId, id: error.projectId }),
                  ),
              ),
              answer: {
                ...page.answer,
                scopes: page.answer.scopes?.filter(
                  (scope) =>
                    !hiddenProjects.has(
                      pullRequestProjectKey({ environmentId, id: scope.projectId }),
                    ),
                ),
                trackers: chosenHost
                  ? page.answer.trackers.filter(
                      (tracker) => tracker.host.toLowerCase() === chosenHost,
                    )
                  : page.answer.trackers,
              },
            },
          ]),
        )
      : held;
  const groups = groupIssues(shown, debouncedQuery, projects, search.order ?? "updated");
  const filterScopes = issueFilterScopes(
    shown,
    projects.filter((project) => !hiddenProjects.has(pullRequestProjectKey(project))),
  );

  const hostOptions = hostOptionsFor(
    [...held.values()].flatMap((page) => page.answer.trackers),
    search.host,
    resolve,
  );

  const updateSearch = (patch: { [Key in keyof IssuesSearch]?: IssuesSearch[Key] | undefined }) => {
    const merged = { ...search, ...patch };
    const next: IssuesSearch = {
      who: merged.who ?? search.who,
      status: merged.status ?? search.status,
      ...(merged.hideProjects?.length ? { hideProjects: merged.hideProjects } : {}),
      ...(merged.host ? { host: merged.host } : {}),
      q: merged.q || undefined,
      ...(merged.label?.length ? { label: merged.label } : {}),
      ...(merged.assignee ? { assignee: merged.assignee } : {}),
      ...(merged.order ? { order: merged.order } : {}),
    };
    writeIssueListPreferences(issueListPreferences(next));
    void navigate({ search: next });
  };
  // Astrolabe: the row the focused pane's tab shows is the one marked.
  const focusedKey = useWorkspaceFocusedKey();
  const focusedIssue = issueTargetOfKey(focusedKey) === null ? null : focusedKey;
  const showRow = (entry: EnvironmentIssueEntry, intent: RowClickIntent) => {
    showIssue(entry, intent, entry);
    if (isMobile) setOpenMobile(false);
  };
  const selectEntry = useStableCallback((entry: EnvironmentIssueEntry, click: RowClick) =>
    showRow(entry, rowClickIntent(click, isMacPlatform(navigator.platform))),
  );
  const dragRow = useStableCallback(
    (entry: EnvironmentIssueEntry, event: DragEvent<HTMLElement>) => {
      startDrag(
        event,
        {
          key: issueTabKey(entry),
          keys: [],
          place: (paneId, drop) => placeIssue(entry, paneId, drop, entry),
        },
        event.currentTarget.getAttribute("aria-label") ?? "",
        0,
      );
    },
  );
  const showRowMenu = useStableCallback(
    (entry: EnvironmentIssueEntry, event: ReactMouseEvent<HTMLElement>) => {
      const api = readLocalApi();
      if (!api) return;
      void api.contextMenu
        .show([{ id: "new-tab" as const, label: gt("Open in new tab"), icon: "square-plus" }], {
          x: event.clientX,
          y: event.clientY,
        })
        .then((picked) => {
          if (picked === "new-tab") showRow(entry, "new-tab");
        });
    },
  );

  // Astrolabe: find (Mod+F) searches the list, opening the sidebar first when it is closed; the
  // field takes focus once it is on screen (`SidebarControls`).
  const [searchFocusPending, setSearchFocusPending] = useState(false);
  const onSearchFocused = useStableCallback(() => setSearchFocusPending(false));
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isCommandPaletteOpen()) return;
    const command = resolveShortcutCommand(event, keybindings, { context: getShortcutContext() });
    // Closes the focused pane's issue, as T3 Code's shortcut closed its panel.
    if (command === "rightPanel.close" && focusedIssue !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) closeWorkspaceTab(focusedIssue);
    }
    // A chat shown in these panes takes find for itself first (`ChatView`).
    if (command === "chat.find") {
      event.preventDefault();
      event.stopPropagation();
      if (isMobile) setOpenMobile(true);
      else if (!sidebarOpen) void setSidebarOpen(true);
      setSearchFocusPending(true);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document keydown listener for the close and find shortcuts
  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const showTracker = groups.length > 1;
  const noneAnswered = list.answers.length === 0;

  const listBody: ReactNode = !issuesSupported ? (
    <PullRequestsUnavailableState
      title={gt("Issues unavailable")}
      error={gt("Update this environment's Astrolabe server to browse issues.")}
    />
  ) : noneAnswered && list.isPending ? (
    <PullRequestListGhost />
  ) : noneAnswered && list.error ? (
    <PullRequestsUnavailableState
      error={list.error}
      onRetry={list.retry}
      refreshing={list.isPending}
    />
  ) : everyProjectHidden ? (
    <Empty>
      <EmptyMedia variant="icon">
        <IssueGlyph.issue />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>
          <T>Every project is hidden</T>
        </EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => updateSearch({ hideProjects: undefined })}>
          <T>Show all projects</T>
        </Button>
      </EmptyContent>
    </Empty>
  ) : groups.length === 0 ? (
    <Empty>
      <EmptyMedia variant="icon">
        <IssueGlyph.issue />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>
          <T>No trackers to read</T>
        </EmptyTitle>
        <EmptyDescription>
          <T>Add a project whose remote is on a supported tracker.</T>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : (
    <div className="flex flex-col gap-6">
      {list.error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs">
          <span>
            <T>
              <Var>{list.error}</Var> Showing the issues that loaded.
            </T>
          </span>
          <Button size="xs" variant="outline" onClick={list.retry}>
            <T>Retry</T>
          </Button>
        </div>
      ) : null}
      {groups.map((group) => {
        const presentation = issueTrackerPresentation(group.tracker.tracker);
        return (
          <section key={issueTrackerKey(group.tracker)} className="flex flex-col gap-1">
            <h2 className="flex items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground">
              <presentation.Icon aria-hidden className="size-3.5" />
              {presentation.providerName}
              {presentation.providerName.toLowerCase() !== group.tracker.host ? (
                <span className="font-normal">· {group.tracker.host}</span>
              ) : null}
              <span className="font-normal">
                ·{" "}
                {gt("{count, plural, one {{count} project} other {{count} projects}}", {
                  count: group.tracker.projectCount,
                })}
              </span>
            </h2>
            {!group.tracker.configured ? (
              <p className="px-3 text-sm text-muted-foreground">
                {group.tracker.detail === null
                  ? gt("This tracker cannot be read right now.")
                  : issueTrackerDetailText(group.tracker.detail, resolve)}
              </p>
            ) : null}
            {group.errors.map((error) => (
              <p
                key={`${error.environmentId}:${error.projectTitle}`}
                className="px-3 text-xs text-destructive"
              >
                {error.projectTitle}: {error.message}
              </p>
            ))}
            {group.tracker.configured && group.rows.length === 0 && group.errors.length === 0 ? (
              <p className="px-3 text-sm text-muted-foreground">
                {debouncedQuery ? (
                  <T>Nothing matches that.</T>
                ) : (
                  <T>No issues under these filters.</T>
                )}
              </p>
            ) : null}
            {group.rows.map((row) => (
              <IssueRow
                key={`${row.environmentId}:${issueEntryKey(row)}`}
                entry={row}
                selected={focusedIssue === issueTabKey(row)}
                showTracker={showTracker}
                {...(capableEnvironments.length > 1 && environmentLabels.has(row.environmentId)
                  ? { environmentLabel: environmentLabels.get(row.environmentId) }
                  : {})}
                onSelect={selectEntry}
                onDragRow={dragRow}
                onRowMenu={showRowMenu}
              />
            ))}
            {group.more.map((environmentId) => {
              const moreFailure = held.get(environmentId)?.moreFailure ?? null;
              return (
                <Fragment key={environmentId}>
                  {moreFailure === null ? null : (
                    <p className="px-3 text-xs text-destructive">{moreFailure}</p>
                  )}
                  <Button
                    size="sm"
                    variant="ghost-muted"
                    className="self-start"
                    disabled={loadingMore !== null}
                    onClick={() => void loadMore(environmentId, group.tracker.host)}
                  >
                    {loadingMore === `${environmentId} ${group.tracker.host}` ? (
                      <T>Loading…</T>
                    ) : moreFailure === null ? (
                      <T>Load more</T>
                    ) : (
                      <T>Retry</T>
                    )}
                  </Button>
                </Fragment>
              );
            })}
          </section>
        );
      })}
    </div>
  );

  // Astrolabe: the list and its controls live in the section's sidebar; its issues open in the
  // shared panes, which `_chat` renders.
  return (
    <IssuesSidebarPortal
      actions={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={gt("Refresh issues")}
          onClick={list.refresh}
          disabled={list.isPending}
        >
          <RefreshIcon size="md" refreshing={list.isPending} />
        </Button>
      }
    >
      <SidebarControls focusPending={searchFocusPending} onFocused={onSearchFocused}>
        <PullRequestSearchInput
          value={search.q ?? ""}
          label={gt("Search issues")}
          placeholder={gt("Search issues")}
          busy={
            (search.q ?? "") !== debouncedQuery || (debouncedQuery.length > 0 && list.isPending)
          }
          onChange={(q) => updateSearch({ q: q || undefined })}
          onSubmit={(q) => updateSearch({ q: q || undefined })}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <PullRequestCompactFilterMenu
            label={gt("Sort issues")}
            triggerIcon={<ArrowDownUpIcon aria-hidden className="size-4" />}
            triggerLabel={gt("Sort", { $context: "verb, button that sorts a list" })}
            outlined
            value={search.order ?? "updated"}
            options={resolveFilterOptions(SORT_OPTIONS, resolve)}
            onChange={(order) =>
              updateSearch({ order: order === "created" ? "created" : undefined })
            }
          />
          <IssueFiltersMenu
            state={search.status}
            stateOptions={resolveFilterOptions(STATE_TABS, resolve)}
            onState={(status) => updateSearch({ status })}
            involvement={search.who}
            involvementOptions={resolveFilterOptions(INVOLVEMENT_TABS, resolve)}
            onInvolvement={(who) => updateSearch({ who })}
            scopes={filterScopes}
            labels={search.label ?? []}
            onLabels={(label) => updateSearch({ label })}
            assignee={search.assignee}
            onAssignee={(assignee) => updateSearch({ assignee })}
            projects={filterProjects}
            hiddenProjects={hiddenProjects}
            onHiddenProjects={(hideProjects) => updateSearch({ hideProjects })}
          />
          <SavedViewsMenu
            kind={ISSUE_SAVED_VIEWS}
            preferences={search}
            onApply={(view) =>
              // Explicit clears replace the old list scope.
              updateSearch({
                who: view.who,
                status: view.status,
                hideProjects: view.hideProjects,
                host: view.host,
                q: view.q,
                label: view.label,
                assignee: view.assignee,
                order: view.order,
              })
            }
          />
          {hostOptions.length > 1 ? (
            <FilterMenu
              label={gt("Filter by tracker")}
              value={search.host ?? ""}
              options={hostOptions}
              onChange={(host) => updateSearch({ host: host || undefined })}
            />
          ) : null}
        </div>
      </SidebarControls>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">{listBody}</div>
    </IssuesSidebarPortal>
  );
}

/** The search and filters above the list; find's focus lands once they are on screen. */
function SidebarControls({
  focusPending,
  onFocused,
  children,
}: {
  readonly focusPending: boolean;
  readonly onFocused: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the search input DOM node when a shortcut asks for it
  useEffect(() => {
    if (!focusPending) return;
    const input = ref.current?.querySelector<HTMLInputElement>("input[type='search']");
    // The sidebar may still be sliding in; focusing must not scroll it.
    input?.focus({ preventScroll: true });
    input?.select();
    onFocused();
  }, [focusPending, onFocused]);
  return (
    <div ref={ref} className="flex shrink-0 flex-col gap-2 px-2 pb-2">
      {children}
    </div>
  );
}

function FilterMenu<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  return (
    <Menu>
      <MenuTrigger aria-label={`${label}: ${current.label}`} render={<Button variant="outline" />}>
        <PullRequestFilterOptionIcon option={current} />
        <span className="truncate">{current.label}</span>
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as Value)}>
          {options.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              disabled={option.unavailable !== undefined}
            >
              <span className="flex min-w-0 items-center gap-2">
                <PullRequestFilterOptionIcon option={option} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
