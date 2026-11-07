import type {
  ContextMenuItem,
  EnvironmentId,
  ThreadId,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BookOpenIcon,
  CircleDashedIcon,
  FilePenLineIcon,
  FileTextIcon,
  LinkIcon,
  FolderPlusIcon,
  ListFilterIcon,
  SettingsIcon,
  TableIcon,
  UsersIcon,
} from "lucide-react";
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { cn, isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { NEW_TAB_CLICK, rowClickIntent, type RowClick } from "~/tabNavigation.logic";
import { endDrag, startDrag } from "~/panes/drag";
import {
  anchorRow,
  rangeToRow,
  rowsActedOn,
  toggleRow,
  useRowSelectionStore,
} from "~/sidebarRowSelection";
import { useThreadShell } from "~/state/entities";
import { changeRequestKindStore } from "../changeRequests/changeRequestKind";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { useEnvironmentIdentities, useEnvironmentMachines } from "~/state/environments";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  filterSidebarProjectScopeItems,
  reduceSidebarProjectScopeMenuState,
  type SidebarProjectScopeMenuAction,
  type SidebarProjectScopeMenuState,
} from "../Sidebar.logic";
import {
  SIDEBAR_ROW_ACTIVE_CLASS,
  SIDEBAR_ROW_IDLE_CLASS,
  SIDEBAR_ROW_SELECTED_CLASS,
  SIDEBAR_ROW_SURFACE_CLASS,
  SidebarCardContent,
  SidebarCardFooter,
  SidebarCardHeader,
  SidebarCardItem,
  SidebarCardTitle,
} from "../sidebar/SidebarCard";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import {
  SidebarHeaderIconButton,
  SidebarPickerAction,
  SidebarPickerFooter,
  SidebarThreadHeader,
} from "../sidebar/SidebarThreadHeader";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import {
  FilterPill,
  FilterPills,
  namesOrCount,
  OneTapFilterPill,
  OutsideFilterMark,
  PillIcons,
  ThreadsFilterCheckbox,
} from "../projects/ThreadsFilterParts";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { SidebarContent, SidebarGroup, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { documentTitle, isTurnRunning, noteNameOfFile, wikiTerms } from "./wiki.logic";
import { useWikiOverviews } from "./wikiEnvironment";
import { WikiFinder } from "./WikiFinder";
import { WikiIcon } from "./WikiIcon";
import { useManyProjectWorktrees } from "~/state/worktrees";
import {
  WikiWorktreePicker,
  WikiWorktreeSections,
  wikiWorktreeLabel,
  worktreesOfWiki,
} from "./WikiWorktrees";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import {
  HiddenWorktreesPill,
  WorktreeFilterMark,
  WorktreeFoldButton,
} from "../repositories/RepositoryFilterMenu";
import { worktreeFilesKey } from "../repositories/repositoryScope";
import { openWikiTab, placeWikiTabs, showWikiTab, useFocusedWikiTab } from "./wikiPanes";
import {
  EMPTY_WIKI_FILTER,
  filterWikiKeys,
  setWikiWorktreeHidden,
  storeWikiFilter,
  toggleFilterAllWikis,
  toggleFilterWiki,
  useStoredWikiFilter,
  wikiFilterKeepsDocument,
  type WikiFilter,
} from "./wikiFilter";
import { changeRequestWikiScope } from "./wikiScope";
import {
  searchWikiSidebarItems,
  tabShowsDocument,
  wikiScopeKey,
  wikiSidebarEntryTab,
  wikiSidebarItems,
  wikiTabKey,
  type WikiChangeItem,
  type WikiDocumentItem,
  type WikiSidebarEntry,
  type WikiTab,
} from "./wikiTabs";

/** The Wikis rows' share of the sidebars' row selection (`sidebarRowSelection`). */
const SELECTION_SECTION = "wikis";
const NO_KEYS: readonly string[] = [];

const entryKey = (entry: WikiSidebarEntry) => wikiTabKey(wikiSidebarEntryTab(entry));

/** What a row's drag and menu do, for the rows to share. */
export interface WikiRowActions {
  readonly drag: (tab: WikiTab, event: DragEvent<HTMLElement>) => void;
  readonly openAll: (tab: WikiTab) => void;
  /** How many rows the row's menu acts on: the selection, when the row is in it. */
  readonly count: (tab: WikiTab) => number;
}
const WORKING_CLASS = "text-info-foreground";

function compactTimeLabel(timestamp: string | null): string {
  if (timestamp === null) return "";
  const label = formatRelativeTimeLabel(timestamp);
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

/**
 * The Wikis section's sidebar, built from the thread list's parts: the same title row (search, a
 * filter by wiki in place of the filter by project, new document in place of new thread), and
 * the same cards, a document's in place of a thread's. Open change requests sit on top, as
 * drafts do over threads. Search filters the lists in place, into one list of matches.
 */
export function WikiSidebar() {
  const { overviews, loading } = useWikiOverviews();
  const filter = useStoredWikiFilter();
  const focused = useFocusedWikiTab();
  const { isMobile, setOpenMobile } = useSidebar();
  const [foldedWikis, setFoldedWikis] = useState<ReadonlySet<string>>(() => new Set());
  const [finding, setFinding] = useState(false);
  const navigate = useNavigate();
  const [menu, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  // Astrolabe: the wikis picked, and whether only documents with open changes show.
  const kept = filterWikiKeys(
    filter,
    overviews.map((overview) => wikiScopeKey(overview.environmentId, overview.wiki.wikiId)),
  );
  const filterActive = kept !== null || filter.changed || filter.hidden.length > 0;
  // The one wiki picked, for what still takes a single wiki (Change Requests, a new document).
  const scope = kept?.size === 1 ? [...kept][0]! : null;
  const scoped =
    overviews.find(
      (overview) => wikiScopeKey(overview.environmentId, overview.wiki.wikiId) === scope,
    ) ?? null;
  // A lone wiki can't be picked apart from every wiki, so its worktrees show without picking it.
  const worktreeWiki = scoped ?? (overviews.length === 1 ? overviews[0]! : null);
  const inKeptWiki = (item: { readonly environmentId: EnvironmentId; readonly wikiId: WikiId }) =>
    kept === null || kept.has(wikiScopeKey(item.environmentId, item.wikiId));
  const keeps = (document: WikiDocumentItem) =>
    wikiFilterKeepsDocument(filter, kept, {
      wikiKey: wikiScopeKey(document.environmentId, document.wiki.wikiId),
      changes: document.changes,
    });
  // Change requests live in the Change Requests section; this lists the documents, with the
  // open changes' count as the way there.
  const allLists = wikiSidebarItems(overviews, null);
  const inKeptWikiOf = (item: {
    readonly environmentId: EnvironmentId;
    readonly wiki: { readonly wikiId: WikiId };
  }) => inKeptWiki({ environmentId: item.environmentId, wikiId: item.wiki.wikiId });
  const changes = allLists.changes.filter(inKeptWikiOf);
  const changedCount = allLists.documents.filter(
    (document) => inKeptWikiOf(document) && document.changes.length > 0,
  ).length;
  // Astrolabe: the document in front stays listed while the filter hides it, marked outside it.
  const focusedDocument =
    focused?.kind === "note"
      ? allLists.documents.find((document) =>
          tabShowsDocument(focused, {
            environmentId: document.environmentId,
            wikiId: document.wiki.wikiId,
            name: document.name,
          }),
        )
      : undefined;
  const outsideFilter = focusedDocument !== undefined && !keeps(focusedDocument);
  const lists = {
    ...allLists,
    documents: allLists.documents.filter(
      (document) => keeps(document) || document === focusedDocument,
    ),
    changes: [],
    settled: [],
  };
  const { documents } = lists;
  const setFilter = (next: WikiFilter) => storeWikiFilter(next);

  // Astrolabe: the rows as they show, for Shift-click's ranges and what a selected row carries.
  const shown = useRef<{ keys: readonly string[]; tabs: ReadonlyMap<string, WikiTab> }>({
    keys: [],
    tabs: new Map(),
  });
  const selectedKeys = useRowSelectionStore((store) =>
    store.selection.section === SELECTION_SECTION ? store.selection.keys : NO_KEYS,
  );

  // Astrolabe: a click shows the document in the focused pane's tab in front; Option-click and
  // the middle button open it in a new tab there (the row's menu opens it beside, in a new
  // pane). Cmd/Ctrl-click and Shift-click select rows, as in Agents.
  const open = (tab: WikiTab, event: RowClick | null) => {
    const intent =
      event === null ? "replace" : rowClickIntent(event, isMacPlatform(navigator.platform));
    const key = wikiTabKey(tab);
    const { change } = useRowSelectionStore.getState();
    if (intent === "mod") {
      change((now) => toggleRow(now, SELECTION_SECTION, key));
      return;
    }
    if (intent === "range") {
      change((now) => rangeToRow(now, SELECTION_SECTION, key, shown.current.keys));
      return;
    }
    change(() => anchorRow(SELECTION_SECTION, key));
    if (intent === "new-tab") openWikiTab(tab);
    else showWikiTab(tab);
    if (isMobile) setOpenMobile(false);
  };
  // What a row's drag or menu acts on: the selection when the row is in it.
  const actedOn = (tab: WikiTab) => {
    const { keys, tabs } = shown.current;
    const { selection } = useRowSelectionStore.getState();
    return rowsActedOn(selection, SELECTION_SECTION, wikiTabKey(tab), keys).map(
      (key) => tabs.get(key) ?? tab,
    );
  };
  const rowActions: WikiRowActions = {
    // Dropped on a pane's strip, they open there; on its content, in a new pane.
    drag: (tab, event) => {
      const carried = actedOn(tab);
      startDrag(
        event,
        {
          key: wikiTabKey(tab),
          keys: [],
          place: (paneId, drop) => placeWikiTabs(carried, tab, paneId, drop),
        },
        event.currentTarget.getAttribute("aria-label") ?? "",
        carried.length > 1 ? carried.length : 0,
      );
    },
    openAll: (tab) => {
      for (const each of actedOn(tab)) openWikiTab(each);
    },
    count: (tab) => actedOn(tab).length,
  };
  // Escape lets go of the selection.
  const selecting = selectedKeys.length > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window Escape listener that clears the row selection while rows are selected
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      useRowSelectionStore.getState().change((now) => ({ ...now, keys: [] }));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const isSearching = searchQuery.trim().length > 0;
  const results = searchWikiSidebarItems(lists, searchQuery);
  // The lists refresh under a query, so the highlight holds within whatever matches now.
  const activeIndex = Math.min(activeResultIndex, Math.max(results.length - 1, 0));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the highlighted search result's DOM row into view
  useEffect(() => {
    if (!isSearching) return;
    document
      .getElementById(`sidebar-thread-search-result-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isSearching]);
  const clearSearch = () => {
    setSearchQuery("");
    setActiveResultIndex(0);
  };
  const openResult = (entry: WikiSidebarEntry, event: RowClick | null) => {
    // Selecting among the matches keeps them; opening one puts the lists back.
    const intent =
      event === null ? "replace" : rowClickIntent(event, isMacPlatform(navigator.platform));
    if (intent !== "mod" && intent !== "range") clearSearch();
    open(wikiSidebarEntryTab(entry), event);
  };
  const shownEntries: readonly WikiSidebarEntry[] = isSearching
    ? results
    : documents.map((item) => ({ kind: "document" as const, item }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the shown entries' keys and tabs for range selection in the row handlers
  useLayoutEffect(() => {
    shown.current = {
      keys: shownEntries.map(entryKey),
      tabs: new Map(shownEntries.map((entry) => [entryKey(entry), wikiSidebarEntryTab(entry)])),
    };
  });
  // The thread search's keys: Escape clears, the arrows move the highlight, Enter opens it.
  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && isSearching) {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResultIndex((activeIndex + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResultIndex((activeIndex - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = results[activeIndex];
      if (entry) openResult(entry, null);
    }
  };
  const isActive = (entry: WikiSidebarEntry) =>
    entry.kind === "document"
      ? tabShowsDocument(focused, {
          environmentId: entry.item.environmentId,
          wikiId: entry.item.wiki.wikiId,
          name: entry.item.name,
        })
      : focused?.kind === "change-request" &&
        focused.environmentId === entry.item.environmentId &&
        focused.changeRequestId === entry.item.changeRequest.changeRequestId;

  // Astrolabe: the wikis the filter keeps, and the one the focused tab is in whatever it says.
  const focusedWikiKey = focused ? wikiScopeKey(focused.environmentId, focused.wikiId) : null;
  const shownWikis = overviews.filter((overview) => {
    const key = wikiScopeKey(overview.environmentId, overview.wiki.wikiId);
    return kept === null || kept.has(key) || key === focusedWikiKey;
  });
  const wikiOpen = (key: string) => !foldedWikis.has(key);
  const sameWiki = (
    overview: WikiOverview,
    item: { readonly environmentId: EnvironmentId; readonly wiki: { readonly wikiId: WikiId } },
  ) => item.environmentId === overview.environmentId && item.wiki.wikiId === overview.wiki.wikiId;
  // The main line's rows: the way to its open changes, then its documents as the filter keeps them.
  const mainRows = (overview: WikiOverview) => {
    const wikiChanges = changes.filter((change) => sameWiki(overview, change));
    const wikiDocuments = documents.filter((document) => sameWiki(overview, document));
    return (
      <>
        {wikiChanges.length > 0 ? (
          <li className="mx-0.5 list-none">
            <button
              type="button"
              className="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
              onClick={() => {
                // Into Change Requests narrowed to this wiki.
                changeRequestKindStore.set("wikis");
                changeRequestWikiScope.set(
                  wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
                );
                void navigate({
                  to: "/pull-requests",
                  search: readPullRequestListPreferences(),
                });
              }}
            >
              <PullRequestGlyph.pullRequest aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">
                {`Open changes · ${wikiChanges.length}`}
              </span>
              <ArrowRightIcon aria-hidden className="size-3.5 shrink-0" />
            </button>
          </li>
        ) : null}
        {wikiDocuments.map((document) => (
          <WikiDocumentRow
            key={document.key}
            item={document}
            outsideFilter={outsideFilter && document === focusedDocument}
            active={
              focused?.kind === "note" &&
              focused.changeRequestId === undefined &&
              isActive({ kind: "document", item: document })
            }
            selected={selectedKeys.includes(entryKey({ kind: "document", item: document }))}
            actions={rowActions}
            onOpen={open}
          />
        ))}
        {wikiDocuments.length === 0 && wikiChanges.length === 0 ? (
          <SidebarRowsNote>
            {filterActive ? "No documents match these filters" : "No documents yet"}
          </SidebarRowsNote>
        ) : null}
      </>
    );
  };
  // A change request worktree's rows: the documents its amendments touch, read inside it.
  const changeRequestRows = (overview: WikiOverview, changeRequestId: WikiChangeRequestId) => {
    const changeRequest = overview.changeRequests?.find(
      (entry) => entry.changeRequestId === changeRequestId,
    );
    const files = [
      ...new Set((changeRequest?.amendments ?? []).flatMap((amendment) => amendment.files)),
    ].filter((file) => /\.(md|base)$/i.test(file));
    if (files.length === 0) return <SidebarRowsNote>No documents changed yet</SidebarRowsNote>;
    return files.map((file) => {
      const onMain = allLists.documents.find(
        (document) => sameWiki(overview, document) && document.file === file,
      );
      const name = onMain?.name ?? noteNameOfFile(file);
      const item: WikiDocumentItem = {
        key: `${changeRequestId}:${file}`,
        environmentId: overview.environmentId,
        wiki: overview.wiki,
        name,
        title: documentTitle(name),
        base: file.endsWith(".base"),
        file,
        links: onMain?.links ?? 0,
        backlinks: onMain?.backlinks ?? 0,
        editedAt: changeRequest?.updatedAt ?? onMain?.editedAt ?? null,
        changes: changeRequest ? [changeRequest] : [],
      };
      const tab: WikiTab = {
        kind: "note",
        environmentId: overview.environmentId,
        wikiId: overview.wiki.wikiId,
        name: item.name,
        changeRequestId,
      };
      return (
        <WikiDocumentRow
          key={item.key}
          item={item}
          changeRequestId={changeRequestId}
          active={
            focused?.kind === "note" &&
            focused.changeRequestId === changeRequestId &&
            tabShowsDocument(focused, {
              environmentId: overview.environmentId,
              wikiId: overview.wiki.wikiId,
              name: item.name,
            })
          }
          selected={selectedKeys.includes(wikiTabKey(tab))}
          actions={rowActions}
          onOpen={open}
        />
      );
    });
  };

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <SidebarThreadHeader
              title="Wikis"
              searchNoun="document"
              hasProjects
              projectScope={
                <>
                  {worktreeWiki ? <WikiWorktreePicker overview={worktreeWiki} /> : null}
                  <WikiFilterMenu
                    overviews={overviews}
                    filter={filter}
                    kept={kept}
                    active={filterActive}
                    changedCount={changedCount}
                    menu={menu}
                    dispatchMenu={dispatchMenu}
                    onFilter={setFilter}
                    onSettings={(overview) =>
                      void navigate({
                        to: "/settings/wikis",
                        search: {
                          wiki: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
                        },
                      })
                    }
                  />
                </>
              }
              onNewThread={() => setFinding(true)}
              newThreadDisabled={overviews.length === 0}
              newThreadShortcutLabel={null}
              newThreadInProjectShortcutLabel={null}
              showNewThreadInProjectHint={false}
              newItemLabel="New document"
              searchInputRef={searchInputRef}
              searchQuery={searchQuery}
              onSearchQueryChange={(value) => {
                setSearchQuery(value);
                setActiveResultIndex(0);
              }}
              onSearchKeyDown={handleSearchKeyDown}
              isSearching={isSearching}
              searchResultCount={results.length}
              activeSearchResultIndex={activeIndex}
              onClearSearch={clearSearch}
            />
            {overviews.length > 0 ? (
              <WikiFilterPills
                overviews={overviews}
                filter={filter}
                kept={kept}
                changedCount={changedCount}
                onOpen={() => dispatchMenu({ type: "open-changed", open: true })}
                onFilter={setFilter}
              />
            ) : null}
          </SidebarGroup>
        }
      >
        <SidebarGroup className="flex-1" role="presentation">
          <TooltipProvider delay={150} closeDelay={0} timeout={400}>
            {isSearching ? (
              results.length > 0 ? (
                <ul
                  id="sidebar-thread-search-results"
                  role="listbox"
                  aria-label="Document search results"
                  className="relative flex flex-col gap-px"
                >
                  {results.map((entry, index) => {
                    const option = {
                      id: `sidebar-thread-search-result-${index}`,
                      highlighted: index === activeIndex,
                      onHighlight: () => setActiveResultIndex(index),
                    };
                    return entry.kind === "document" ? (
                      <WikiDocumentRow
                        key={entry.item.key}
                        item={entry.item}
                        active={isActive(entry)}
                        selected={selectedKeys.includes(entryKey(entry))}
                        actions={rowActions}
                        option={option}
                        onOpen={(_tab, event) => openResult(entry, event)}
                      />
                    ) : (
                      <WikiChangeRow
                        key={entry.item.key}
                        item={entry.item}
                        active={isActive(entry)}
                        selected={selectedKeys.includes(entryKey(entry))}
                        actions={rowActions}
                        option={option}
                        onOpen={(_tab, event) => openResult(entry, event)}
                      />
                    );
                  })}
                </ul>
              ) : (
                <p
                  role="status"
                  className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
                >
                  No documents found
                </p>
              )
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-1">
                {shownWikis.map((overview) => {
                  const key = wikiScopeKey(overview.environmentId, overview.wiki.wikiId);
                  const sections = (
                    <WikiWorktreeSections
                      overview={overview}
                      focused={focused}
                      hidden={filter.hidden}
                      renderRows={(_worktree, changeRequestId) =>
                        changeRequestId === null
                          ? mainRows(overview)
                          : changeRequestRows(overview, changeRequestId)
                      }
                    />
                  );
                  if (shownWikis.length === 1) return <Fragment key={key}>{sections}</Fragment>;
                  const open = wikiOpen(key);
                  return (
                    <Fragment key={key}>
                      <ul role="presentation" aria-label={overview.wiki.name}>
                        <li className="mx-0.5 flex h-8 list-none items-center">
                          <CollapsibleSectionHeader
                            onClick={() =>
                              setFoldedWikis((current) => {
                                const next = new Set(current);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                            expanded={open}
                            tone="muted"
                            accessory={
                              kept !== null && !kept.has(key) ? <OutsideFilterMark /> : null
                            }
                          >
                            <span className="flex items-center gap-1.5">
                              <WikiIcon
                                environmentId={overview.environmentId}
                                wiki={overview.wiki}
                                className="size-3.5"
                              />
                              {overview.wiki.name}
                            </span>
                          </CollapsibleSectionHeader>
                        </li>
                      </ul>
                      {open ? <div className="ms-2">{sections}</div> : null}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </TooltipProvider>
          {overviews.length === 0 && !loading && !isSearching ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              <span>No wikis yet</span>
              <EmptyStateButton onClick={() => openCommandPalette({ open: "add-wiki" })}>
                Add a wiki
              </EmptyStateButton>
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
      <WikiFinder
        open={finding}
        onOpenChange={setFinding}
        overviews={overviews}
        scope={scope}
        mode="new"
      />
    </>
  );
}

function EmptyStateButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
    >
      <FolderPlusIcon className="-mx-0.5 size-3" />
      {children}
    </button>
  );
}

const CHANGED_VALUE = "changed";
const ALL_WIKIS_VALUE = "all";
const WORKTREE_PREFIX = "worktree:";
const CHANGED_LABEL = "Has changes";

function ChangedIcon({ className }: { readonly className?: string }) {
  return (
    <FilePenLineIcon
      aria-hidden
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}

/**
 * The Wikis filter, as the thread list's and the Projects': documents with open changes, then every
 * wiki or several, each with its worktrees nested under it (folded until opened, or found by a
 * search) to show or hide in the file trees, each wiki's settings from its row, and adding a wiki
 * from the foot of the list. Picking keeps the list open.
 */
function WikiFilterMenu({
  overviews,
  filter,
  kept,
  active,
  changedCount,
  menu,
  dispatchMenu,
  onFilter,
  onSettings,
}: {
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly filter: WikiFilter;
  readonly kept: ReadonlySet<string> | null;
  readonly active: boolean;
  readonly changedCount: number;
  readonly menu: SidebarProjectScopeMenuState;
  readonly dispatchMenu: (action: SidebarProjectScopeMenuAction) => void;
  readonly onFilter: (next: WikiFilter) => void;
  readonly onSettings: (overview: WikiOverview) => void;
}) {
  const { isMobile, open: sidebarOpen } = useSidebar();
  const comboboxFilter = useComboboxFilter();
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const overviewByKey = new Map(
    overviews.map((overview) => [
      wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
      overview,
    ]),
  );
  const wikiKeys = [...overviewByKey.keys()];
  const searching = menu.query.trim().length > 0;
  // A search looks through every wiki's worktrees; otherwise only unfolded ones are read.
  const listedWikis = overviews.filter(
    (overview) =>
      searching || unfolded.has(wikiScopeKey(overview.environmentId, overview.wiki.wikiId)),
  );
  const lists = useManyProjectWorktrees(listedWikis.map(worktreesOfWiki));
  const worktreeRows = listedWikis.flatMap((overview, index) =>
    (lists[index]?.data?.worktrees ?? []).map((worktree) => ({
      value: `${WORKTREE_PREFIX}${worktreeFilesKey(overview.environmentId, worktree.path)}`,
      wikiKey: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
      overview,
      worktree,
    })),
  );
  const worktreeByValue = new Map(worktreeRows.map((row) => [row.value, row]));
  const worktreeValuesOf = (wikiKey: string) =>
    worktreeRows.filter((row) => row.wikiKey === wikiKey).map((row) => row.value);
  const labelOf = (value: string) => {
    if (value === CHANGED_VALUE) return CHANGED_LABEL;
    if (value === ALL_WIKIS_VALUE) return "All wikis";
    const row = worktreeByValue.get(value);
    if (row) return wikiWorktreeLabel(row.overview, row.worktree);
    return overviewByKey.get(value)?.wiki.name ?? value;
  };
  const values = [
    CHANGED_VALUE,
    ALL_WIKIS_VALUE,
    ...wikiKeys.flatMap((key) => [key, ...worktreeValuesOf(key)]),
  ];
  const found = new Set(
    filterSidebarProjectScopeItems({
      items: values.map((value) => ({ value })),
      query: menu.query,
      matches: (item, query) => comboboxFilter.contains(item.value, query, labelOf),
    }).map((item) => item.value),
  );
  // A wiki shows its worktrees while unfolded; a search shows the ones it finds, and their wiki
  // with them.
  const filtered = values.filter((value) => {
    if (overviewByKey.has(value)) {
      return found.has(value) || worktreeValuesOf(value).some((each) => found.has(each));
    }
    const row = worktreeByValue.get(value);
    if (!row) return found.has(value);
    return searching ? found.has(value) : unfolded.has(row.wikiKey);
  });
  const toggleUnfolded = (key: string) =>
    setUnfolded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // With no wiki picked every wiki is in, so each shows ticked.
  const checked = (value: string) => {
    if (value === CHANGED_VALUE) return filter.changed;
    if (value === ALL_WIKIS_VALUE) return kept === null;
    if (value.startsWith(WORKTREE_PREFIX)) {
      return !filter.hidden.includes(value.slice(WORKTREE_PREFIX.length));
    }
    return kept === null || kept.has(value);
  };
  const selected = values.filter(checked);
  const toggle = (value: string) => {
    if (value === CHANGED_VALUE) onFilter({ ...filter, changed: !filter.changed });
    else if (value === ALL_WIKIS_VALUE) onFilter(toggleFilterAllWikis(filter, wikiKeys));
    else if (value.startsWith(WORKTREE_PREFIX)) {
      const key = value.slice(WORKTREE_PREFIX.length);
      onFilter(setWikiWorktreeHidden(filter, key, !filter.hidden.includes(key)));
    } else onFilter(toggleFilterWiki(filter, value, wikiKeys));
  };
  const closeAnd = (then: () => void) => {
    dispatchMenu({ type: "open-changed", open: false });
    then();
  };
  const groups = [
    { label: "Status", values: filtered.filter((value) => value === CHANGED_VALUE) },
    { label: "Wikis", values: filtered.filter((value) => value !== CHANGED_VALUE) },
  ];
  return (
    <Combobox<string, true>
      multiple
      items={values}
      filteredItems={filtered}
      autoHighlight
      itemToStringLabel={labelOf}
      open={menu.open}
      onOpenChange={(open) => dispatchMenu({ type: "open-changed", open })}
      value={selected}
      onValueChange={(next: string[]) => {
        // A toggle is the one value added or removed.
        const value =
          next.find((candidate) => !selected.includes(candidate)) ??
          selected.find((candidate) => !next.includes(candidate));
        if (value !== undefined) toggle(value);
      }}
    >
      <ComboboxTrigger
        render={
          <SidebarHeaderIconButton
            label={active ? "Filter documents (filtered)" : "Filter documents"}
          />
        }
      >
        <ListFilterIcon className="size-4" />
        {/* Astrolabe: the pills name the filter; the dot keeps it seen from the collapsed titlebar. */}
        {active ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </ComboboxTrigger>
      <ComboboxPopup
        align={!isMobile && !sidebarOpen ? "start" : "end"}
        className="min-w-56 max-w-[min(18rem,var(--available-width))] overflow-hidden"
      >
        <ComboboxSearchInput
          aria-label="Search filters"
          placeholder="Filter..."
          value={menu.query}
          onChange={(event) => dispatchMenu({ type: "query-changed", query: event.target.value })}
        />
        <ComboboxEmpty>No matching filters.</ComboboxEmpty>
        <ComboboxList>
          {groups.map((group) =>
            group.values.length === 0 ? null : (
              <ComboboxGroup key={group.label}>
                <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
                {group.values.map((value) => {
                  const overview = overviewByKey.get(value) ?? null;
                  const row = worktreeByValue.get(value) ?? null;
                  return (
                    <ComboboxItem key={value} hideIndicator value={value}>
                      {row ? <span aria-hidden className="w-4 shrink-0" /> : null}
                      <ThreadsFilterCheckbox checked={checked(value)} />
                      {value === CHANGED_VALUE ? (
                        <ChangedIcon />
                      ) : row ? (
                        <WorktreeFilterMark worktree={row.worktree} />
                      ) : overview ? (
                        <WikiIcon
                          environmentId={overview.environmentId}
                          wiki={overview.wiki}
                          className="size-4 shrink-0"
                        />
                      ) : (
                        <BookOpenIcon className="size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{labelOf(value)}</span>
                      {value === CHANGED_VALUE ? (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {changedCount}
                        </span>
                      ) : null}
                      {row?.worktree.isMain ? (
                        <span className="shrink-0 text-muted-foreground text-xs">
                          main checkout
                        </span>
                      ) : null}
                      {overview && !searching ? (
                        <WorktreeFoldButton
                          open={unfolded.has(value)}
                          ownerTitle={overview.wiki.name}
                          onToggle={() => toggleUnfolded(value)}
                        />
                      ) : null}
                      {overview ? (
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          tabIndex={-1}
                          aria-hidden="true"
                          title={`Settings for ${overview.wiki.name}`}
                          className="ml-auto"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            closeAnd(() => onSettings(overview));
                          }}
                        >
                          <SettingsIcon className="size-3.5" />
                        </Button>
                      ) : null}
                    </ComboboxItem>
                  );
                })}
              </ComboboxGroup>
            ),
          )}
        </ComboboxList>
        <SidebarPickerFooter>
          <SidebarPickerAction
            icon={FolderPlusIcon}
            onClick={() => closeAnd(() => openCommandPalette({ open: "add-wiki" }))}
          >
            Add a wiki
          </SidebarPickerAction>
        </SidebarPickerFooter>
      </ComboboxPopup>
    </Combobox>
  );
}

/** The Wikis filter in force: Has changes as one tap, then the wikis picked and the worktrees hidden. */
function WikiFilterPills({
  overviews,
  filter,
  kept,
  changedCount,
  onOpen,
  onFilter,
}: {
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly filter: WikiFilter;
  readonly kept: ReadonlySet<string> | null;
  readonly changedCount: number;
  readonly onOpen: () => void;
  readonly onFilter: (next: WikiFilter) => void;
}) {
  const picked =
    kept === null
      ? []
      : overviews.filter((overview) =>
          kept.has(wikiScopeKey(overview.environmentId, overview.wiki.wikiId)),
        );
  // Only read while something is hidden, to name it.
  const lists = useManyProjectWorktrees(
    filter.hidden.length === 0 ? [] : overviews.map(worktreesOfWiki),
  );
  const hiddenNames = overviews.flatMap((overview, index) =>
    (lists[index]?.data?.worktrees ?? [])
      .filter((worktree) =>
        filter.hidden.includes(worktreeFilesKey(overview.environmentId, worktree.path)),
      )
      .map((worktree) => wikiWorktreeLabel(overview, worktree)),
  );
  const showChanged = filter.changed || changedCount > 0;
  const count =
    (filter.changed ? 1 : 0) + (kept !== null ? 1 : 0) + (hiddenNames.length > 0 ? 1 : 0);
  if (!showChanged && count === 0) return null;
  return (
    <FilterPills label="Document filters" count={count} onClear={() => onFilter(EMPTY_WIKI_FILTER)}>
      {showChanged ? (
        <OneTapFilterPill
          on={filter.changed}
          label={CHANGED_LABEL}
          count={changedCount}
          icon={<ChangedIcon className="size-3.5" />}
          onToggle={() => onFilter({ ...filter, changed: !filter.changed })}
        />
      ) : null}
      {kept !== null ? (
        <FilterPill
          label={namesOrCount(
            picked.map((overview) => overview.wiki.name),
            "wikis",
          )}
          onOpen={onOpen}
          onRemove={() => onFilter({ ...filter, wikis: [] })}
        >
          <PillIcons>
            {picked.slice(0, 3).map((overview) => (
              <span key={overview.wiki.wikiId} className="flex rounded-xs bg-sidebar">
                <WikiIcon
                  environmentId={overview.environmentId}
                  wiki={overview.wiki}
                  className="size-3.5"
                />
              </span>
            ))}
          </PillIcons>
        </FilterPill>
      ) : null}
      {hiddenNames.length > 0 ? (
        <HiddenWorktreesPill
          names={hiddenNames}
          onOpen={onOpen}
          onRemove={() => onFilter({ ...filter, hidden: [] })}
        />
      ) : null}
    </FilterPills>
  );
}

/** Whether the agent of a change request's thread is mid-turn. */
function useAgentWorking(environmentId: EnvironmentId, threadId: ThreadId | null | undefined) {
  const shell = useThreadShell(
    threadId === null || threadId === undefined ? null : scopeThreadRef(environmentId, threadId),
  );
  return isTurnRunning(shell?.source.status);
}

function WorkingStatus() {
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", WORKING_CLASS)}>
      <CircleDashedIcon aria-hidden className="size-4 shrink-0" />
      <span role="status">Working</span>
    </span>
  );
}

/**
 * A search result's place in the results listbox. Focus and the keys stay on the search field,
 * which points at the highlighted option, as the thread search does.
 */
interface CardRowOption {
  readonly id: string;
  readonly highlighted: boolean;
  readonly onHighlight: () => void;
}

/**
 * A row's shared frame, clickable and keyboard-operable: a card, or the one-line row settled
 * threads use. Open change requests are cards; documents and merged or closed change requests
 * are slim, so the work in flight stands out.
 */
function CardRow({
  label,
  active,
  selected,
  option,
  slim = false,
  details,
  tab,
  actions,
  onOpen,
  children,
}: {
  readonly label: string;
  readonly active: boolean;
  /** In the Cmd/Shift-click selection. */
  readonly selected: boolean;
  readonly option: CardRowOption | undefined;
  readonly slim?: boolean;
  /** The hover card's contents, as the thread rows show. */
  readonly details: ReactNode;
  /** What the row opens, for its drag and menu. */
  readonly tab: WikiTab;
  readonly actions: WikiRowActions;
  readonly onOpen: (event: RowClick) => void;
  readonly children: ReactNode;
}) {
  const highlighted = active || option?.highlighted === true;
  const row = (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            id={option?.id}
            role={option ? "option" : "button"}
            tabIndex={option ? -1 : 0}
            aria-selected={option ? option.highlighted : undefined}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            data-testid={slim ? "wiki-sidebar-row-slim" : "wiki-sidebar-row"}
            draggable
            onDragStart={(event) => actions.drag(tab, event)}
            onDragEnd={endDrag}
            data-selected={selected || undefined}
            className={cn(
              SIDEBAR_ROW_SURFACE_CLASS,
              selected
                ? SIDEBAR_ROW_SELECTED_CLASS
                : highlighted
                  ? SIDEBAR_ROW_ACTIVE_CLASS
                  : slim
                    ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    : SIDEBAR_ROW_IDLE_CLASS,
              slim && "flex h-9 items-center gap-2.5 px-2.5",
            )}
            onMouseMove={option?.onHighlight}
            onClick={onOpen}
            onMouseDown={(event) => {
              // The middle button opens the row in a new tab; keep it from starting autoscroll.
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button === 1) onOpen(event);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              void showRowMenu(event, onOpen, actions.count(tab), () => actions.openAll(tab));
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              const { altKey, metaKey, ctrlKey, shiftKey } = event;
              onOpen({ button: 0, altKey, metaKey, ctrlKey, shiftKey });
            }}
          />
        }
      >
        {slim ? children : <SidebarCardContent>{children}</SidebarCardContent>}
      </TooltipTrigger>
      <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
        {details}
      </ThreadHoverCardPopup>
    </Tooltip>
  );
  return slim ? (
    <li
      role={option ? "presentation" : undefined}
      // Matches the h-9 row so unrendered rows never shift the list when they paint.
      className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_36px]"
    >
      {row}
    </li>
  ) : (
    <SidebarCardItem role={option ? "presentation" : undefined}>{row}</SidebarCardItem>
  );
}

/**
 * A row's context menu: open it in a new tab, or beside in a new pane, as its modified clicks do;
 * on a row of a selection of `count`, open them all in new tabs.
 */
async function showRowMenu(
  event: ReactMouseEvent,
  onOpen: (event: RowClick) => void,
  count: number,
  onOpenAll: () => void,
) {
  const api = readLocalApi();
  if (!api) return;
  if (count > 1) {
    const all: ContextMenuItem<"all">[] = [
      { id: "all", label: `Open ${count} in new tabs`, icon: "square-plus" },
    ];
    const picked = await api.contextMenu.show(all, { x: event.clientX, y: event.clientY });
    if (picked === "all") onOpenAll();
    return;
  }
  const items: ContextMenuItem<"new-tab" | "beside">[] = [
    { id: "new-tab", label: "Open in new tab", icon: "square-plus" },
    { id: "beside", label: "Open to the right" },
  ];
  const picked = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
  if (picked === "new-tab") onOpen(NEW_TAB_CLICK);
  else if (picked === "beside") {
    const mac = isMacPlatform(navigator.platform);
    onOpen({ ...NEW_TAB_CLICK, altKey: false, metaKey: mac, ctrlKey: !mac });
  }
}

/** A hover card line: a muted icon, then its text. */
function DetailLine({
  icon,
  children,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex size-3 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0 truncate text-foreground/75">{children}</div>
    </div>
  );
}

/** The hover card lines every wiki row starts with: its wiki, then the server holding it. */
function WikiPlaceDetails({ item }: { readonly item: WikiDocumentItem | WikiChangeItem }) {
  const environments = useEnvironmentIdentities();
  const machines = useEnvironmentMachines();
  const environmentLabel =
    environments.find((environment) => environment.environmentId === item.environmentId)?.label ??
    null;
  return (
    <>
      <DetailLine
        icon={<WikiIcon environmentId={item.environmentId} wiki={item.wiki} className="size-3" />}
      >
        {item.wiki.name}
      </DetailLine>
      {environmentLabel ? (
        <DetailLine
          icon={
            <EnvironmentMachineIcon
              kind={machines.get(item.environmentId) ?? "server"}
              className="size-3 stroke-muted-foreground"
            />
          }
        >
          {environmentLabel}
        </DetailLine>
      ) : null}
    </>
  );
}

const DETAIL_ICON_CLASS = "size-3 stroke-muted-foreground";
const DOCUMENTS_LISTED = 5;

/** A slim row's parts, as a settled thread's: dimmed wiki icon, title, then the time. */
function SlimIcon({
  item,
  active,
}: {
  readonly item: WikiDocumentItem | WikiChangeItem;
  readonly active: boolean;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center transition-opacity",
        !active &&
          "opacity-40 grayscale group-focus-within/sidebar-row:opacity-100 group-focus-within/sidebar-row:grayscale-0 group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
      )}
    >
      <WikiIcon environmentId={item.environmentId} wiki={item.wiki} className="size-4" />
    </span>
  );
}

function SlimTitle({ active, children }: { readonly active: boolean; readonly children: string }) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm font-normal group-focus-within/sidebar-row:text-foreground group-hover/sidebar-row:text-foreground",
        active ? "text-foreground" : "text-secondary-label/70",
      )}
    >
      {children}
    </span>
  );
}

/** When a row last changed, right-aligned, with any marks (a base, an open change) beside it. */
function SlimTime({
  marks,
  children,
}: {
  readonly marks?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <span className="ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end gap-1.5 text-xs tabular-nums text-secondary-label">
      {marks}
      {children}
    </span>
  );
}

const titleClassName = "min-w-0 flex-1 truncate text-sm font-medium text-foreground/90";

/** A document, slim: its name, whether an open change holds it, and when it last changed. */
const WikiDocumentRow = memo(function WikiDocumentRow({
  item,
  changeRequestId,
  outsideFilter = false,
  active,
  selected,
  actions,
  option,
  onOpen,
}: {
  readonly item: WikiDocumentItem;
  /** The change request it is read inside, under that change request's worktree; else main's. */
  readonly changeRequestId?: WikiChangeRequestId;
  /** Listed only because it is in front, the filter hiding it otherwise. */
  readonly outsideFilter?: boolean;
  readonly active: boolean;
  readonly selected: boolean;
  readonly actions: WikiRowActions;
  readonly option?: CardRowOption;
  readonly onOpen: (tab: WikiTab, event: RowClick) => void;
}) {
  const change = item.changes[0];
  const working = useAgentWorking(item.environmentId, change?.threadId);
  const onMain = wikiSidebarEntryTab({ kind: "document", item });
  const tab = changeRequestId === undefined ? onMain : { ...onMain, changeRequestId };
  return (
    <CardRow
      label={
        changeRequestId === undefined || change === undefined
          ? `${item.title}${item.base ? ", base" : ""}, ${item.wiki.name}`
          : `${item.title}${item.base ? ", base" : ""}, in ${change.title}`
      }
      active={active}
      selected={selected}
      tab={tab}
      actions={actions}
      option={option}
      slim
      details={
        <ThreadHoverCard title={item.title}>
          <WikiPlaceDetails item={item} />
          {item.base ? (
            <DetailLine icon={<TableIcon className={DETAIL_ICON_CLASS} />}>
              A base: a saved question over the wiki's notes
            </DetailLine>
          ) : (
            <DetailLine icon={<LinkIcon className={DETAIL_ICON_CLASS} />}>
              {linkSummary(item)}
            </DetailLine>
          )}
          {item.changes.map((entry) => (
            <DetailLine
              key={entry.changeRequestId}
              icon={<FilePenLineIcon className={DETAIL_ICON_CLASS} />}
            >
              {`In “${entry.title}”`}
            </DetailLine>
          ))}
        </ThreadHoverCard>
      }
      onOpen={(event) => onOpen(tab, event)}
    >
      <SlimIcon item={item} active={active} />
      <SlimTitle active={active}>{item.title}</SlimTitle>
      {outsideFilter ? <OutsideFilterMark /> : null}
      <SlimTime
        marks={
          <>
            {item.base ? (
              <TableIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
            ) : null}
            {change ? (
              <FilePenLineIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
            ) : null}
          </>
        }
      >
        {working ? <WorkingStatus /> : compactTimeLabel(item.editedAt)}
      </SlimTime>
    </CardRow>
  );
});

/** A worktree's rows' note when it has none. */
function SidebarRowsNote({ children }: { readonly children: string }) {
  return (
    <li className="list-none px-2 py-1.5 text-xs text-sidebar-muted-foreground">{children}</li>
  );
}

function linkSummary(item: WikiDocumentItem): string {
  const links = item.links === 1 ? "1 link" : `${item.links} links`;
  return item.backlinks > 0 ? `${links} · linked from ${item.backlinks}` : links;
}

/**
 * A change request. Open, it is a card: its wiki and when it last moved, its title, and what it
 * holds. Merged or closed, it is history, so it recedes to the slim row.
 */
export const WikiChangeRow = memo(function WikiChangeRow({
  item,
  active,
  selected,
  actions,
  option,
  onOpen,
}: {
  readonly item: WikiChangeItem;
  readonly active: boolean;
  readonly selected: boolean;
  readonly actions: WikiRowActions;
  readonly option?: CardRowOption;
  readonly onOpen: (tab: WikiTab, event: RowClick) => void;
}) {
  const { changeRequest } = item;
  const working = useAgentWorking(item.environmentId, changeRequest.threadId);
  const tab = wikiSidebarEntryTab({ kind: "change", item });
  const openTab = (event: RowClick) => onOpen(tab, event);
  const amendments = changeRequest.amendments.length;
  const actors = [...new Set(changeRequest.amendments.map((amendment) => amendment.actor))];
  const details = <WikiChangeDetails item={item} actors={actors} />;
  if (changeRequest.status !== "open") {
    const merged = changeRequest.status === "merged";
    const StatusGlyph = merged ? PullRequestGlyph.merged : PullRequestGlyph.closed;
    return (
      <CardRow
        label={`${changeRequest.title}, ${merged ? "merged" : "closed"} ${wikiTerms(item.wiki).singular} in ${item.wiki.name}`}
        active={active}
        selected={selected}
        tab={tab}
        actions={actions}
        option={option}
        slim
        details={details}
        onOpen={openTab}
      >
        <SlimIcon item={item} active={active} />
        <SlimTitle active={active}>{changeRequest.title}</SlimTitle>
        <StatusGlyph aria-hidden className="size-3 shrink-0 text-muted-foreground/40" />
        <SlimTime>{compactTimeLabel(changeRequest.updatedAt)}</SlimTime>
      </CardRow>
    );
  }
  return (
    <CardRow
      label={`${changeRequest.title}, ${wikiTerms(item.wiki).singular} in ${item.wiki.name}`}
      active={active}
      selected={selected}
      tab={tab}
      actions={actions}
      option={option}
      details={details}
      onOpen={openTab}
    >
      <SidebarCardHeader>
        <WikiIcon environmentId={item.environmentId} wiki={item.wiki} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-label">
          {item.wiki.name}
        </span>
        <span className="ml-auto flex h-5 shrink-0 items-center text-xs tabular-nums text-secondary-label">
          {working ? <WorkingStatus /> : compactTimeLabel(changeRequest.updatedAt)}
        </span>
      </SidebarCardHeader>
      <SidebarCardTitle>
        <span className={titleClassName}>{changeRequest.title}</span>
      </SidebarCardTitle>
      <SidebarCardFooter>
        <PullRequestGlyph.pullRequest
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground/40"
        />
        <span className="min-w-0 flex-1 truncate text-muted-foreground/40">
          {`${amendments} ${amendments === 1 ? "amendment" : "amendments"} · ${item.files.length} ${item.files.length === 1 ? "document" : "documents"}`}
        </span>
        {actors.length > 0 ? (
          <span className="shrink-0 truncate text-sidebar-muted-foreground/70">
            {actors.join(", ")}
          </span>
        ) : null}
      </SidebarCardFooter>
    </CardRow>
  );
});

/** A change request's hover card: where it lives, its state, who wrote it, and what it changes. */
function WikiChangeDetails({
  item,
  actors,
}: {
  readonly item: WikiChangeItem;
  readonly actors: ReadonlyArray<string>;
}) {
  const { changeRequest } = item;
  const amendments = changeRequest.amendments.length;
  const StatusGlyph =
    changeRequest.status === "merged"
      ? PullRequestGlyph.merged
      : changeRequest.status === "closed"
        ? PullRequestGlyph.closed
        : PullRequestGlyph.pullRequest;
  const status =
    changeRequest.status === "merged"
      ? "Merged"
      : changeRequest.status === "closed"
        ? "Closed"
        : "Open";
  const listed = item.files.slice(0, DOCUMENTS_LISTED);
  const more = item.files.length - listed.length;
  return (
    <ThreadHoverCard
      title={changeRequest.title}
      footer={
        listed.length > 0 ? (
          <div className="grid gap-1 border-t border-border/60 pt-2 pl-0.5 text-xs text-muted-foreground">
            {listed.map((file) => (
              <DetailLine
                key={file}
                icon={
                  file.endsWith(".base") ? (
                    <TableIcon className={DETAIL_ICON_CLASS} />
                  ) : (
                    <FileTextIcon className={DETAIL_ICON_CLASS} />
                  )
                }
              >
                {documentTitle(noteNameOfFile(file))}
              </DetailLine>
            ))}
            {more > 0 ? <div className="pl-5">{`${more} more`}</div> : null}
          </div>
        ) : null
      }
    >
      <WikiPlaceDetails item={item} />
      <DetailLine icon={<StatusGlyph className={DETAIL_ICON_CLASS} />}>
        {`${status} · ${amendments} ${amendments === 1 ? "amendment" : "amendments"}`}
      </DetailLine>
      {actors.length > 0 ? (
        <DetailLine icon={<UsersIcon className={DETAIL_ICON_CLASS} />}>
          {actors.join(", ")}
        </DetailLine>
      ) : null}
    </ThreadHoverCard>
  );
}
