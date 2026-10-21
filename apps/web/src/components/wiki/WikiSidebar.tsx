import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import {
  BookOpenIcon,
  CircleDashedIcon,
  FilePenLineIcon,
  FileTextIcon,
  LinkIcon,
  FolderPlusIcon,
  ListFilterIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { isElectron } from "~/env";
import { cn, isMacPlatform } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentIdentities, useEnvironmentMachines } from "~/state/environments";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  filterSidebarProjectScopeItems,
  reduceSidebarProjectScopeMenuState,
} from "../Sidebar.logic";
import {
  SIDEBAR_ROW_ACTIVE_CLASS,
  SIDEBAR_ROW_IDLE_CLASS,
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
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { SidebarContent, SidebarGroup, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { isTurnRunning, noteNameOfFile } from "./wiki.logic";
import { AddWikiFolderDialog, NewWikiDialog } from "./WikiDialogs";
import { useWikiEnvironment, useWikiOverviews } from "./wikiEnvironment";
import { WikiFinder } from "./WikiFinder";
import { WikiIcon } from "./WikiIcon";
import { openWikiTab, useFocusedWikiTab } from "./wikiPanes";
import { WikiSettingsDialog } from "./WikiSettingsDialog";
import {
  searchWikiSidebarItems,
  tabShowsDocument,
  wikiScopeKey,
  wikiSidebarEntryTab,
  wikiSidebarItems,
  type WikiChangeItem,
  type WikiDocumentItem,
  type WikiSidebarEntry,
  type WikiTab,
} from "./wikiTabs";

const SCOPE_STORAGE_KEY = "astrolabe:wiki-scope:v1";
const WORKING_CLASS = "text-info-foreground";

function compactTimeLabel(timestamp: string | null): string {
  if (timestamp === null) return "";
  const label = formatRelativeTimeLabel(timestamp);
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

/** The wiki the sidebar is filtered to, kept on the device as the project filter is. */
function useWikiScope(overviews: ReadonlyArray<WikiOverview>) {
  const [stored, setStored] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(SCOPE_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const setScope = useCallback((next: string | null) => {
    setStored(next);
    try {
      if (next === null) window.localStorage.removeItem(SCOPE_STORAGE_KEY);
      else window.localStorage.setItem(SCOPE_STORAGE_KEY, next);
    } catch {
      // Blocked storage: the filter still holds for this page.
    }
  }, []);
  // A filter on a wiki that is gone reads as no filter.
  const exists =
    stored !== null &&
    overviews.some(
      (overview) => wikiScopeKey(overview.environmentId, overview.wiki.wikiId) === stored,
    );
  return [exists ? stored : null, setScope] as const;
}

/**
 * The Wikis section's sidebar, built from the thread list's parts: the same title row (search, a
 * filter by wiki in place of the filter by project, new document in place of new thread), and
 * the same cards, a document's in place of a thread's. Open change requests sit on top, as
 * drafts do over threads. Search filters the lists in place, into one list of matches.
 */
export function WikiSidebar() {
  const { overviews, loading } = useWikiOverviews();
  const [scope, setScope] = useWikiScope(overviews);
  const focused = useFocusedWikiTab();
  const { isMobile, setOpenMobile } = useSidebar();
  const [finding, setFinding] = useState(false);
  const [adding, setAdding] = useState<"folder" | "new" | null>(null);
  const [settingsFor, setSettingsFor] = useState<WikiOverview | null>(null);
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [documentsExpanded, setDocumentsExpanded] = useState(true);
  // Merged and closed change requests wait on a shelf, as settled threads do, folded at first.
  const [settledExpanded, setSettledExpanded] = useState(false);
  const { environmentId: addEnvironmentId } = useWikiEnvironment(undefined);
  const lists = useMemo(() => wikiSidebarItems(overviews, scope), [overviews, scope]);
  const { changes, documents, settled } = lists;
  const scoped =
    overviews.find(
      (overview) => wikiScopeKey(overview.environmentId, overview.wiki.wikiId) === scope,
    ) ?? null;

  const open = useCallback(
    (tab: WikiTab, event: ReactMouseEvent | null) => {
      const beside =
        event !== null && (isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey);
      openWikiTab(tab, beside ? "beside" : "tab");
      if (isMobile) setOpenMobile(false);
    },
    [isMobile, setOpenMobile],
  );

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const isSearching = searchQuery.trim().length > 0;
  const results = useMemo(() => searchWikiSidebarItems(lists, searchQuery), [lists, searchQuery]);
  // The lists refresh under a query, so the highlight holds within whatever matches now.
  const activeIndex = Math.min(activeResultIndex, Math.max(results.length - 1, 0));
  useEffect(() => {
    if (!isSearching) return;
    document
      .getElementById(`sidebar-thread-search-result-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isSearching]);
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setActiveResultIndex(0);
  }, []);
  const openResult = useCallback(
    (entry: WikiSidebarEntry, event: ReactMouseEvent | null) => {
      clearSearch();
      open(wikiSidebarEntryTab(entry), event);
    },
    [clearSearch, open],
  );
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
                <WikiScopeFilter
                  overviews={overviews}
                  scope={scope}
                  scoped={scoped}
                  onScope={setScope}
                  onSettings={setSettingsFor}
                  onAdd={setAdding}
                />
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
                        option={option}
                        onOpen={(_tab, event) => openResult(entry, event)}
                      />
                    ) : (
                      <WikiChangeRow
                        key={entry.item.key}
                        item={entry.item}
                        active={isActive(entry)}
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
              <ul role="presentation" className="relative flex flex-col gap-px">
                {changes.length > 0 ? (
                  <>
                    <li className="mx-0.5 h-8 list-none">
                      <CollapsibleSectionHeader
                        onClick={() => setChangesExpanded((expanded) => !expanded)}
                        expanded={changesExpanded}
                        tone="muted"
                      >
                        {`Open changes · ${changes.length}`}
                      </CollapsibleSectionHeader>
                    </li>
                    {changesExpanded
                      ? changes.map((change) => (
                          <WikiChangeRow
                            key={change.key}
                            item={change}
                            active={isActive({ kind: "change", item: change })}
                            onOpen={open}
                          />
                        ))
                      : null}
                    <li className="mx-0.5 h-8 list-none">
                      <CollapsibleSectionHeader
                        onClick={() => setDocumentsExpanded((expanded) => !expanded)}
                        expanded={documentsExpanded}
                        tone="muted"
                      >
                        Documents
                      </CollapsibleSectionHeader>
                    </li>
                  </>
                ) : null}
                {(changes.length === 0 || documentsExpanded ? documents : []).map((document) => (
                  <WikiDocumentRow
                    key={document.key}
                    item={document}
                    active={isActive({ kind: "document", item: document })}
                    onOpen={open}
                  />
                ))}
                {settled.length > 0 ? (
                  <>
                    <li className="mx-0.5 h-8 list-none">
                      <CollapsibleSectionHeader
                        onClick={() => setSettledExpanded((expanded) => !expanded)}
                        expanded={settledExpanded}
                        tone="muted"
                      >
                        {`Merged and closed · ${settled.length}`}
                      </CollapsibleSectionHeader>
                    </li>
                    {settledExpanded
                      ? settled.map((change) => (
                          <WikiChangeRow
                            key={change.key}
                            item={change}
                            active={isActive({ kind: "change", item: change })}
                            onOpen={open}
                          />
                        ))
                      : null}
                  </>
                ) : null}
              </ul>
            )}
          </TooltipProvider>
          {documents.length === 0 && changes.length === 0 && !loading && !isSearching ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {overviews.length === 0 ? (
                <>
                  <span>No wikis yet</span>
                  <div className="flex gap-1.5">
                    <EmptyStateButton onClick={() => setAdding("folder")}>
                      Add a folder
                    </EmptyStateButton>
                    <EmptyStateButton onClick={() => setAdding("new")}>New wiki</EmptyStateButton>
                  </div>
                </>
              ) : scoped ? (
                `No documents in ${scoped.wiki.name} yet`
              ) : (
                "No documents yet"
              )}
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
      {addEnvironmentId !== null ? (
        <>
          <AddWikiFolderDialog
            environmentId={addEnvironmentId}
            open={adding === "folder"}
            onOpenChange={(next) => setAdding(next ? "folder" : null)}
            onAdded={(wiki) => setScope(wikiScopeKey(addEnvironmentId, wiki.wikiId))}
          />
          <NewWikiDialog
            environmentId={addEnvironmentId}
            open={adding === "new"}
            onOpenChange={(next) => setAdding(next ? "new" : null)}
            onCreated={(wiki) => setScope(wikiScopeKey(addEnvironmentId, wiki.wikiId))}
          />
        </>
      ) : null}
      {settingsFor ? (
        <WikiSettingsDialog
          environmentId={settingsFor.environmentId}
          wiki={settingsFor.wiki}
          onClose={() => setSettingsFor(null)}
        />
      ) : null}
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
      <PlusIcon className="-mx-0.5 size-3" />
      {children}
    </button>
  );
}

/**
 * The filter by wiki, as the thread list's filter by project: all wikis or one, each wiki's
 * settings from its row, and adding a wiki from the foot of the list.
 */
function WikiScopeFilter({
  overviews,
  scope,
  scoped,
  onScope,
  onSettings,
  onAdd,
}: {
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly scope: string | null;
  readonly scoped: WikiOverview | null;
  readonly onScope: (scope: string | null) => void;
  readonly onSettings: (overview: WikiOverview) => void;
  readonly onAdd: (kind: "folder" | "new") => void;
}) {
  const { isMobile, open: sidebarOpen } = useSidebar();
  const [menu, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  const filter = useComboboxFilter();
  const items = useMemo(
    () => [
      { value: "all", label: "All wikis" },
      ...overviews.map((overview) => ({
        value: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
        label: overview.wiki.name,
      })),
    ],
    [overviews],
  );
  const filtered = useMemo(
    () =>
      filterSidebarProjectScopeItems({
        items,
        query: menu.query,
        matches: (item, query) => filter.contains(item, query, (candidate) => candidate.label),
      }),
    [filter, items, menu.query],
  );
  const overviewByKey = useMemo(
    () =>
      new Map(
        overviews.map((overview) => [
          wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
          overview,
        ]),
      ),
    [overviews],
  );
  const selected = items.find((item) => item.value === (scope ?? "all")) ?? items[0];
  const closeAnd = (then: () => void) => {
    dispatchMenu({ type: "open-changed", open: false });
    then();
  };
  return (
    <Combobox
      items={items}
      filteredItems={filtered}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={menu.open}
      onOpenChange={(open) => dispatchMenu({ type: "open-changed", open })}
      value={selected}
      onValueChange={(item) => {
        if (!item) return;
        onScope(item.value === "all" ? null : item.value);
      }}
    >
      <ComboboxTrigger
        render={
          <SidebarHeaderIconButton
            label={
              scoped ? `Filter documents by wiki: ${scoped.wiki.name}` : "Filter documents by wiki"
            }
          />
        }
      >
        {scoped ? (
          <span className="flex shrink-0">
            <WikiIcon environmentId={scoped.environmentId} wiki={scoped.wiki} className="size-4" />
          </span>
        ) : (
          <ListFilterIcon className="size-4" />
        )}
      </ComboboxTrigger>
      <ComboboxPopup
        align={!isMobile && !sidebarOpen ? "start" : "end"}
        className="min-w-56 max-w-[min(18rem,var(--available-width))] overflow-hidden"
      >
        <ComboboxSearchInput
          aria-label="Search wikis"
          placeholder="Search wikis..."
          value={menu.query}
          onChange={(event) => dispatchMenu({ type: "query-changed", query: event.target.value })}
        />
        <ComboboxEmpty>No matching wikis.</ComboboxEmpty>
        <ComboboxList>
          {(item: (typeof items)[number]) => {
            const overview = overviewByKey.get(item.value) ?? null;
            return (
              <ComboboxItem key={item.value} hideIndicator value={item}>
                {overview ? (
                  <WikiIcon
                    environmentId={overview.environmentId}
                    wiki={overview.wiki}
                    className="size-4 shrink-0"
                  />
                ) : (
                  <BookOpenIcon className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
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
          }}
        </ComboboxList>
        <SidebarPickerFooter>
          <SidebarPickerAction
            icon={FolderPlusIcon}
            onClick={() => closeAnd(() => onAdd("folder"))}
          >
            Add a folder
          </SidebarPickerAction>
          <SidebarPickerAction icon={PlusIcon} onClick={() => closeAnd(() => onAdd("new"))}>
            New wiki
          </SidebarPickerAction>
        </SidebarPickerFooter>
      </ComboboxPopup>
    </Combobox>
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
  option,
  slim = false,
  details,
  onOpen,
  children,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly option: CardRowOption | undefined;
  readonly slim?: boolean;
  /** The hover card's contents, as the thread rows show. */
  readonly details: ReactNode;
  readonly onOpen: (event: ReactMouseEvent) => void;
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
            className={cn(
              SIDEBAR_ROW_SURFACE_CLASS,
              highlighted
                ? SIDEBAR_ROW_ACTIVE_CLASS
                : slim
                  ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  : SIDEBAR_ROW_IDLE_CLASS,
              slim && "flex h-9 items-center gap-2.5 px-2.5",
            )}
            onMouseMove={option?.onHighlight}
            onClick={onOpen}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen(event as unknown as ReactMouseEvent);
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

function SlimTime({ children }: { readonly children: ReactNode }) {
  return (
    <span className="ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end text-xs tabular-nums text-secondary-label">
      {children}
    </span>
  );
}

const titleClassName = "min-w-0 flex-1 truncate text-sm font-medium text-foreground/90";

/** A document, slim: its name, whether an open change holds it, and when it last changed. */
const WikiDocumentRow = memo(function WikiDocumentRow({
  item,
  active,
  option,
  onOpen,
}: {
  readonly item: WikiDocumentItem;
  readonly active: boolean;
  readonly option?: CardRowOption;
  readonly onOpen: (tab: WikiTab, event: ReactMouseEvent) => void;
}) {
  const change = item.changes[0];
  const working = useAgentWorking(item.environmentId, change?.threadId);
  return (
    <CardRow
      label={`${item.name}, ${item.wiki.name}`}
      active={active}
      option={option}
      slim
      details={
        <ThreadHoverCard title={item.name}>
          <WikiPlaceDetails item={item} />
          <DetailLine icon={<LinkIcon className={DETAIL_ICON_CLASS} />}>
            {linkSummary(item)}
          </DetailLine>
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
      onOpen={(event) =>
        onOpen(
          {
            kind: "note",
            environmentId: item.environmentId,
            wikiId: item.wiki.wikiId,
            name: item.name,
            changeRequestId: undefined,
          },
          event,
        )
      }
    >
      <SlimIcon item={item} active={active} />
      <SlimTitle active={active}>{item.name}</SlimTitle>
      {change ? (
        <FilePenLineIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
      ) : null}
      <SlimTime>{working ? <WorkingStatus /> : compactTimeLabel(item.editedAt)}</SlimTime>
    </CardRow>
  );
});

function linkSummary(item: WikiDocumentItem): string {
  const links = item.links === 1 ? "1 link" : `${item.links} links`;
  return item.backlinks > 0 ? `${links} · linked from ${item.backlinks}` : links;
}

/**
 * A change request. Open, it is a card: its wiki and when it last moved, its title, and what it
 * holds. Merged or closed, it is history, so it recedes to the slim row.
 */
const WikiChangeRow = memo(function WikiChangeRow({
  item,
  active,
  option,
  onOpen,
}: {
  readonly item: WikiChangeItem;
  readonly active: boolean;
  readonly option?: CardRowOption;
  readonly onOpen: (tab: WikiTab, event: ReactMouseEvent) => void;
}) {
  const { changeRequest } = item;
  const working = useAgentWorking(item.environmentId, changeRequest.threadId);
  const openTab = (event: ReactMouseEvent) =>
    onOpen(
      {
        kind: "change-request",
        environmentId: item.environmentId,
        wikiId: item.wiki.wikiId,
        changeRequestId: changeRequest.changeRequestId,
      },
      event,
    );
  const amendments = changeRequest.amendments.length;
  const actors = [...new Set(changeRequest.amendments.map((amendment) => amendment.actor))];
  const details = <WikiChangeDetails item={item} actors={actors} />;
  if (changeRequest.status !== "open") {
    const merged = changeRequest.status === "merged";
    const StatusGlyph = merged ? PullRequestGlyph.merged : PullRequestGlyph.closed;
    return (
      <CardRow
        label={`${changeRequest.title}, ${merged ? "merged" : "closed"} change request in ${item.wiki.name}`}
        active={active}
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
      label={`${changeRequest.title}, change request in ${item.wiki.name}`}
      active={active}
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
  const listed = item.files.slice(0, DOCUMENTS_LISTED).map(noteNameOfFile);
  const more = item.files.length - listed.length;
  return (
    <ThreadHoverCard
      title={changeRequest.title}
      footer={
        listed.length > 0 ? (
          <div className="grid gap-1 border-t border-border/60 pt-2 pl-0.5 text-xs text-muted-foreground">
            {listed.map((name) => (
              <DetailLine key={name} icon={<FileTextIcon className={DETAIL_ICON_CLASS} />}>
                {name}
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
