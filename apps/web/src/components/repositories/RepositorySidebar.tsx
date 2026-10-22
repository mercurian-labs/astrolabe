import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  FileDiffIcon,
  FileIcon,
  FolderGit2Icon,
  FolderPlusIcon,
  GitBranchIcon,
  ListIcon,
  ListTreeIcon,
  ListFilterIcon,
  SettingsIcon,
} from "lucide-react";
import {
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { cn, isMacPlatform } from "~/lib/utils";
import { endDrag, startDrag } from "~/panes/drag";
import { useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useProjectPathSearch } from "~/state/queries";
import { reviewEnvironment } from "~/state/review";
import { vcsEnvironment } from "~/state/vcs";
import { rowClickIntent, type RowClick } from "~/tabNavigation.logic";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { changeRequestKindStore } from "../changeRequests/changeRequestKind";
import FileBrowserPanel from "../files/FileBrowserPanel";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProjectFilterIcon } from "../projects/ProjectFilterIcon";
import {
  projectFilterOptions,
  projectFilterValue,
  searchProjectFilterOptions,
  type ProjectFilterOption,
} from "../projects/projectFilter";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { reduceSidebarProjectScopeMenuState } from "../Sidebar.logic";
import { SIDEBAR_ROW_ACTIVE_CLASS, SIDEBAR_ROW_SURFACE_CLASS } from "../sidebar/SidebarCard";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import {
  SidebarHeaderIconButton,
  SidebarPickerAction,
  SidebarPickerFooter,
  SidebarThreadHeader,
} from "../sidebar/SidebarThreadHeader";
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
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarContent, SidebarGroup, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useSectionFocusedKey } from "~/panes/sectionPanes";
import { repositoryPanes } from "./repositoryPanes";
import { repositoryCheckout, repositoryScope, repositoryView } from "./repositoryScope";
import { fileName, folderOf, repositoryTabKey, type RepositoryTab } from "./repositoryTabs";
import { useRepositories } from "./useRepositories";

const repositoryKey = (project: Pick<EnvironmentProject, "environmentId" | "id">) =>
  `${project.environmentId}:${project.id}`;

/** A checkout of a repository: its own, or a thread's working tree. */
interface Checkout {
  readonly cwd: string;
  readonly label: string;
}

/** The repository's checkouts: its own first, then each thread's working tree, newest first. */
function useCheckouts(repository: EnvironmentProject | null): ReadonlyArray<Checkout> {
  const threads = useThreadShells();
  return useMemo(() => {
    if (repository === null) return [];
    const seen = new Set([repository.workspaceRoot]);
    const own: Checkout[] = [{ cwd: repository.workspaceRoot, label: "Repository checkout" }];
    const trees = threads
      .filter(
        (thread) =>
          thread.environmentId === repository.environmentId &&
          thread.projectId === repository.id &&
          thread.worktreePath !== null &&
          thread.archivedAt === null,
      )
      .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    for (const thread of trees) {
      if (thread.worktreePath === null || seen.has(thread.worktreePath)) continue;
      seen.add(thread.worktreePath);
      own.push({
        cwd: thread.worktreePath,
        label: thread.branch ? `${thread.title} · ${thread.branch}` : thread.title,
      });
    }
    return own;
  }, [repository, threads]);
}

/**
 * Astrolabe: the Repositories section's sidebar, built as the Wikis sidebar is: the title row
 * (search, the project filter narrowed to repositories, Add a repository), then the list. The
 * list leads with what is moving (a checkout's uncommitted changes, its branch against its
 * base, its change requests) and then the files its commits changed most recently; the filter's
 * Tree choice shows the whole file tree instead. Search goes to a file by name. A row opens in
 * the focused pane's tab in front, as a document's does; with the modifier, in a new tab.
 */
export function RepositorySidebar() {
  const repositories = useRepositories();
  const scope = repositoryScope.useValue();
  const view = repositoryView.useValue();
  const scoped = repositories.find((repository) => repositoryKey(repository) === scope) ?? null;
  const checkouts = useCheckouts(scoped);
  const storedCheckout = repositoryCheckout.useValue();
  const checkout =
    checkouts.find((candidate) => candidate.cwd === storedCheckout) ?? checkouts[0] ?? null;
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const search = useProjectPathSearch(
    {
      environmentId: scoped?.environmentId ?? null,
      cwd: checkout?.cwd ?? null,
      query: searchQuery,
      kind: "file",
    },
    50,
  );
  const searching = searchQuery.trim().length > 0;
  const results = scoped && searching ? search.entries : [];
  const clearSearch = () => {
    setSearchQuery("");
    setActiveIndex(0);
  };
  const openResult = (path: string) => {
    if (!scoped || !checkout) return;
    repositoryPanes.show(fileKey(scoped, checkout.cwd, path));
    clearSearch();
  };
  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => Math.max(0, Math.min(results.length - 1, index + step)));
    } else if (event.key === "Enter") {
      const result = results[activeIndex];
      if (result) {
        event.preventDefault();
        openResult(result.path);
      }
    } else if (event.key === "Escape" && searchQuery === "") {
      searchInputRef.current?.blur();
    }
  };

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <SidebarThreadHeader
              title="Repositories"
              searchNoun="file"
              hasProjects
              projectScope={<RepositoryFilter repositories={repositories} scoped={scoped} />}
              onNewThread={() => openCommandPalette({ open: "add-project" })}
              newThreadDisabled={false}
              newThreadShortcutLabel={null}
              newThreadInProjectShortcutLabel={null}
              showNewThreadInProjectHint={false}
              newItemLabel="Add a repository"
              searchInputRef={searchInputRef}
              searchQuery={searchQuery}
              onSearchQueryChange={(value) => {
                setSearchQuery(value);
                setActiveIndex(0);
              }}
              onSearchKeyDown={handleSearchKeyDown}
              isSearching={searching}
              searchResultCount={results.length}
              activeSearchResultIndex={activeIndex}
              onClearSearch={clearSearch}
            />
          </SidebarGroup>
        }
      >
        <SidebarGroup className="flex-1" role="presentation">
          <TooltipProvider delay={400} closeDelay={0} timeout={400}>
            {repositories.length === 0 ? (
              <EmptyRepositories />
            ) : searching ? (
              scoped && checkout ? (
                <ul role="presentation" className="flex flex-col gap-px">
                  {results.map((entry, index) => (
                    <FileRow
                      key={entry.path}
                      tab={fileTab(scoped, checkout.cwd, entry.path)}
                      highlighted={index === activeIndex}
                      detail={folderOf(entry.path)}
                      onOpened={clearSearch}
                    />
                  ))}
                  {results.length === 0 ? (
                    <SidebarNote>{search.isPending ? "Searching…" : "No files found"}</SidebarNote>
                  ) : null}
                </ul>
              ) : (
                <SidebarNote>Pick a repository in the filter to find its files.</SidebarNote>
              )
            ) : scoped && checkout ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                {checkouts.length > 1 ? (
                  <CheckoutPicker
                    checkouts={checkouts}
                    value={checkout.cwd}
                    onChange={(cwd) =>
                      repositoryCheckout.set(cwd === scoped.workspaceRoot ? null : cwd)
                    }
                  />
                ) : null}
                {view === "tree" ? (
                  // The tree's virtualized list is `height: 100%`, and the sidebar's scroll area
                  // only gives its content a min-height, so the list collapsed to nothing. The
                  // tree fills an absolutely placed box instead, whose height is definite.
                  <div className="relative -mx-2 min-h-0 flex-1">
                    <div className="absolute inset-0 flex flex-col">
                      <FileBrowserPanel
                        key={`${scoped.environmentId}:${checkout.cwd}`}
                        environmentId={scoped.environmentId}
                        cwd={checkout.cwd}
                        projectName={scoped.title}
                        selectedPath={null}
                        selectedPathRevealId={0}
                        onOpenFile={(path) =>
                          repositoryPanes.show(fileKey(scoped, checkout.cwd, path))
                        }
                        workspaceMutationId={null}
                      />
                    </div>
                  </div>
                ) : (
                  <RepositoryList repository={scoped} cwd={checkout.cwd} showStatus />
                )}
              </div>
            ) : view === "tree" ? (
              <SidebarNote>Pick a repository in the filter to see its files.</SidebarNote>
            ) : (
              <div className="flex flex-col gap-3">
                {repositories.map((repository) => (
                  <RepositoryList
                    key={repositoryKey(repository)}
                    repository={repository}
                    cwd={repository.workspaceRoot}
                    heading
                  />
                ))}
              </div>
            )}
          </TooltipProvider>
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

type FileTab = Extract<RepositoryTab, { kind: "file" }>;

const fileTab = (repository: EnvironmentProject, cwd: string, path: string): FileTab => ({
  kind: "file",
  environmentId: repository.environmentId,
  projectId: repository.id,
  cwd,
  path,
});
const fileKey = (repository: EnvironmentProject, cwd: string, path: string) =>
  repositoryTabKey(fileTab(repository, cwd, path));

function SidebarNote({ children }: { readonly children: string }) {
  return (
    <p role="status" className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
      {children}
    </p>
  );
}

function EmptyRepositories() {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
      <span>No repositories yet</span>
      <button
        type="button"
        onClick={() => openCommandPalette({ open: "add-project" })}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <FolderPlusIcon className="-mx-0.5 size-3" />
        Add a repository
      </button>
    </div>
  );
}

/** Which checkout the list and tree read: the repository's own, or a thread's working tree. */
function CheckoutPicker({
  checkouts,
  value,
  onChange,
}: {
  readonly checkouts: ReadonlyArray<Checkout>;
  readonly value: string;
  readonly onChange: (cwd: string) => void;
}) {
  const items = checkouts.map((checkout) => ({ value: checkout.cwd, label: checkout.label }));
  return (
    <Select items={items} value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger size="sm" aria-label="Checkout" className="mx-0.5 w-auto">
        <GitBranchIcon className="size-3.5 shrink-0 opacity-70" />
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/**
 * One repository's list: with `showStatus`, its checkout's uncommitted changes and its branch
 * against its base; a row into its change requests; then the files its commits changed most
 * recently. With `heading`, under the repository's name, as in the list of every repository.
 */
function RepositoryList({
  repository,
  cwd,
  heading = false,
  showStatus = false,
}: {
  readonly repository: EnvironmentProject;
  readonly cwd: string;
  readonly heading?: boolean;
  readonly showStatus?: boolean;
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);
  const status = useEnvironmentQuery(
    showStatus
      ? vcsEnvironment.status({ environmentId: repository.environmentId, input: { cwd } })
      : null,
  );
  const recent = useEnvironmentQuery(
    reviewEnvironment.recentFiles({
      environmentId: repository.environmentId,
      input: { cwd, limit: heading ? 8 : 40 },
    }),
  );
  const uncommitted = status.data?.workingTree.files ?? [];
  const uncommittedPaths = new Set(uncommitted.map((file) => file.path));
  const recentFiles = (recent.data?.files ?? []).filter((file) => !uncommittedPaths.has(file.path));
  const branch = status.data?.branchChanges;
  const diffKey = (source: "working-tree" | "branch-range") =>
    repositoryTabKey({
      kind: "diff",
      environmentId: repository.environmentId,
      projectId: repository.id,
      cwd,
      source,
    });
  const openChangeRequests = () => {
    changeRequestKindStore.set("repositories");
    void navigate({
      to: "/pull-requests",
      search: {
        ...readPullRequestListPreferences(),
        projectId: repository.id,
        environmentId: repository.environmentId,
      },
    });
  };
  return (
    <ul role="presentation" aria-label={repository.title} className="flex flex-col gap-px">
      {heading ? (
        <li className="mx-0.5 flex h-8 list-none items-center gap-1">
          <CollapsibleSectionHeader
            onClick={() => setExpanded((open) => !open)}
            expanded={expanded}
            tone="muted"
          >
            {repository.title}
          </CollapsibleSectionHeader>
        </li>
      ) : null}
      {heading && !expanded ? null : (
        <>
          <LinkRow icon={FolderGit2Icon} label="Changes" onClick={openChangeRequests} />
          {showStatus && uncommitted.length > 0 ? (
            <>
              <SectionLabel>{`Uncommitted · ${uncommitted.length}`}</SectionLabel>
              <LinkRow
                icon={FileDiffIcon}
                label="Review uncommitted changes"
                onClick={() => repositoryPanes.show(diffKey("working-tree"))}
              />
              {uncommitted.map((file) => (
                <FileRow
                  key={file.path}
                  tab={fileTab(repository, cwd, file.path)}
                  detail={folderOf(file.path)}
                  trailing={`+${file.insertions} −${file.deletions}`}
                />
              ))}
            </>
          ) : null}
          {showStatus &&
          status.data?.isDefaultRef === false &&
          branch &&
          (branch.insertions > 0 || branch.deletions > 0) ? (
            <LinkRow
              icon={GitBranchIcon}
              label={`Changes against ${branch.baseRef ?? "the base"}`}
              onClick={() => repositoryPanes.show(diffKey("branch-range"))}
            />
          ) : null}
          {recentFiles.length > 0 ? (
            <>
              {heading ? null : <SectionLabel>Recently changed</SectionLabel>}
              {recentFiles.map((file) => (
                <FileRow
                  key={file.path}
                  tab={fileTab(repository, cwd, file.path)}
                  detail={folderOf(file.path)}
                  note={file.subject}
                  trailing={compactTime(file.changedAt)}
                />
              ))}
            </>
          ) : recent.isPending ? (
            <SidebarNote>Reading recent changes…</SidebarNote>
          ) : null}
        </>
      )}
    </ul>
  );
}

function SectionLabel({ children }: { readonly children: string }) {
  return (
    <li className="mx-2.5 mt-2 list-none text-2xs font-medium text-sidebar-muted-foreground/70">
      {children}
    </li>
  );
}

function compactTime(timestamp: string): string {
  const label = formatRelativeTimeLabel(timestamp);
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function LinkRow({
  icon: Icon,
  label,
  onClick,
}: {
  readonly icon: typeof FileIcon;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <li className="mx-0.5 list-none">
      <button
        type="button"
        className="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        onClick={onClick}
      >
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ArrowRightIcon aria-hidden className="size-3.5 shrink-0" />
      </button>
    </li>
  );
}

/**
 * A file's row: its name, with its folder or the commit that last changed it beside. A click
 * shows it in the focused pane's tab in front; the modifier or the middle button, in a new tab;
 * dragging places it in the panes.
 */
function FileRow({
  tab,
  detail,
  note,
  trailing,
  highlighted = false,
  onOpened,
}: {
  readonly tab: FileTab;
  readonly detail: string;
  /** More about the file, for its tooltip: the commit that last changed it. */
  readonly note?: string;
  readonly trailing?: string;
  readonly highlighted?: boolean;
  readonly onOpened?: () => void;
}) {
  const key = repositoryTabKey(tab);
  const focused = useSectionFocusedKey(repositoryPanes);
  const active = focused === key;
  const open = (event: RowClick) => {
    const intent = rowClickIntent(event, isMacPlatform(navigator.platform));
    if (intent === "new-tab" || intent === "mod") repositoryPanes.open(key, "tab");
    else repositoryPanes.show(key);
    onOpened?.();
  };
  const drag = (event: DragEvent<HTMLElement>) =>
    startDrag(
      event,
      { key, keys: [], place: (paneId, drop) => repositoryPanes.place([key], key, paneId, drop) },
      fileName(tab.path),
      0,
    );
  return (
    <li className="list-none">
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              role="button"
              tabIndex={0}
              aria-label={tab.path}
              aria-current={active ? "page" : undefined}
              draggable
              onDragStart={drag}
              onDragEnd={endDrag}
              className={cn(
                SIDEBAR_ROW_SURFACE_CLASS,
                "flex h-8 items-center gap-2 px-2.5",
                active || highlighted
                  ? SIDEBAR_ROW_ACTIVE_CLASS
                  : "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              )}
              onClick={open}
              onAuxClick={(event) => {
                if (event.button === 1) open(event);
              }}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                const { altKey, metaKey, ctrlKey, shiftKey } = event;
                open({ button: 0, altKey, metaKey, ctrlKey, shiftKey });
              }}
            />
          }
        >
          <FileIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
          <span className="min-w-0 shrink truncate text-sm text-foreground/85">
            {fileName(tab.path)}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-sidebar-muted-foreground/70">
            {detail}
          </span>
          {trailing ? (
            <span className="shrink-0 text-xs tabular-nums text-secondary-label">{trailing}</span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right" align="start" className="max-w-80">
          <div className="font-mono text-xs">{tab.path}</div>
          {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
        </TooltipPopup>
      </Tooltip>
    </li>
  );
}

type FilterOption = ProjectFilterOption<EnvironmentProject>;

/**
 * The filter: every repository or one, as every section's project filter offers repositories,
 * with how the list shows (as a list, or the whole file tree), Manage repositories and Add a
 * repository at its foot.
 */
function RepositoryFilter({
  repositories,
  scoped,
}: {
  readonly repositories: ReadonlyArray<EnvironmentProject>;
  readonly scoped: EnvironmentProject | null;
}) {
  const { isMobile, open: sidebarOpen } = useSidebar();
  const [menu, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  const filter = useComboboxFilter();
  const view = repositoryView.useValue();
  const items = useMemo(
    () =>
      projectFilterOptions({
        repositories: repositories.map((repository) => ({
          key: repositoryKey(repository),
          label: repository.title,
          repository,
        })),
        wikis: [],
        kinds: "repositories",
      }),
    [repositories],
  );
  const filtered = useMemo(
    () =>
      searchProjectFilterOptions(items, menu.query, (item, query) =>
        filter.contains(item, query, (candidate) => candidate.label),
      ),
    [filter, items, menu.query],
  );
  const value = scoped
    ? projectFilterValue({ kind: "repository", key: repositoryKey(scoped) })
    : projectFilterValue({ kind: "repositories" });
  const selected = items.find((item) => item.value === value) ?? items[0];
  const closeAnd = (then: () => void) => {
    dispatchMenu({ type: "open-changed", open: false });
    then();
  };
  return (
    <Combobox
      items={items}
      filteredItems={filtered}
      autoHighlight
      itemToStringLabel={(item: FilterOption) => item.label}
      isItemEqualToValue={(a: FilterOption, b: FilterOption) => a.value === b.value}
      open={menu.open}
      onOpenChange={(open) => dispatchMenu({ type: "open-changed", open })}
      value={selected ?? null}
      onValueChange={(item: FilterOption | null) => {
        if (!item) return;
        repositoryScope.set(item.kind === "repository" ? repositoryKey(item.repository) : null);
        repositoryCheckout.set(null);
      }}
    >
      <ComboboxTrigger
        render={
          <SidebarHeaderIconButton
            label={scoped ? `Filter by repository: ${scoped.title}` : "Filter by repository"}
          />
        }
      >
        {scoped ? (
          <span className="flex shrink-0">
            <ProjectFavicon project={scoped} className="size-4" />
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
          aria-label="Search repositories"
          placeholder="Search repositories..."
          value={menu.query}
          onChange={(event) => dispatchMenu({ type: "query-changed", query: event.target.value })}
        />
        <ComboboxEmpty>No matching repositories.</ComboboxEmpty>
        <ComboboxList>
          {(item: FilterOption) => (
            <ComboboxItem key={item.value} hideIndicator value={item}>
              <ProjectFilterIcon option={item} />
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
        <SidebarPickerFooter>
          <SidebarPickerAction
            icon={view === "tree" ? ListIcon : ListTreeIcon}
            onClick={() => closeAnd(() => repositoryView.set(view === "tree" ? "list" : "tree"))}
          >
            {view === "tree" ? "Show as list" : "Show the file tree"}
          </SidebarPickerAction>
          <SidebarPickerAction
            icon={SettingsIcon}
            onClick={() =>
              closeAnd(() => repositoryPanes.show(repositoryTabKey({ kind: "manage" })))
            }
          >
            Manage repositories
          </SidebarPickerAction>
          <SidebarPickerAction
            icon={FolderPlusIcon}
            onClick={() => closeAnd(() => openCommandPalette({ open: "add-project" }))}
          >
            Add a repository
          </SidebarPickerAction>
        </SidebarPickerFooter>
      </ComboboxPopup>
    </Combobox>
  );
}
