import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectWorktree } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  FileDiffIcon,
  FileIcon,
  FolderPlusIcon,
  ListFilterIcon,
  SettingsIcon,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn, isMacPlatform } from "~/lib/utils";
import { endDrag, startDrag } from "~/panes/drag";
import { useEnvironmentQuery } from "~/state/query";
import { useProjectPathSearch } from "~/state/queries";
import { reviewEnvironment } from "~/state/review";
import { vcsEnvironment } from "~/state/vcs";
import { useAtomCommand } from "~/state/use-atom-command";
import { useProjectWorktrees } from "~/state/worktrees";
import { rowClickIntent, type RowClick } from "~/tabNavigation.logic";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProjectFilterIcon } from "../projects/ProjectFilterIcon";
import {
  projectFilterOptions,
  projectFilterValue,
  searchProjectFilterOptions,
  type ProjectFilterOption,
} from "../projects/projectFilter";
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
import { SidebarContent, SidebarGroup, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useSectionFocusedKey } from "~/panes/sectionPanes";
import { repositoryPanes } from "./repositoryPanes";
import { BranchCompareRow } from "./BranchCompareRow";
import {
  OpenBranchPicker,
  SetAsideRows,
  WorktreeFiles,
  WorktreeHeader,
  WorktreeRows,
} from "./RepositoryWorktrees";
import {
  repositoryScope,
  repositoryWorktreeFiles,
  showWorktreeFiles,
  worktreeFilesKey,
} from "./repositoryScope";
import {
  checkoutOf,
  fileName,
  folderOf,
  parseRepositoryTabKey,
  repositoryTabKey,
  type RepositoryCheckout,
  type RepositoryTab,
} from "./repositoryTabs";
import { useRepositories } from "./useRepositories";

const repositoryKey = (project: Pick<EnvironmentProject, "environmentId" | "id">) =>
  `${project.environmentId}:${project.id}`;

/**
 * The Repositories sidebar: title row (search, open a branch, repository filter, Add), then the
 * filtered repository's worktrees, main checkout first, each with what is moving there or its file
 * tree. The focused tab's worktree leads: recent files, the open tree, and what search reads.
 */
export function RepositorySidebar() {
  const repositories = useRepositories();
  const scope = repositoryScope.useValue();
  const filesShown = repositoryWorktreeFiles.useValue();
  const scoped = repositories.find((repository) => repositoryKey(repository) === scope) ?? null;
  const listed = useProjectWorktrees(
    scoped ? { environmentId: scoped.environmentId, projectId: scoped.id } : null,
  );
  const worktrees = listed?.worktrees ?? NO_WORKTREES;
  const focusedKey = useSectionFocusedKey(repositoryPanes);
  const focusedTab = focusedKey === null ? null : parseRepositoryTabKey(focusedKey);
  const focused =
    scoped && focusedTab && focusedTab.projectId === scoped.id
      ? (worktrees.find((worktree) => holdsCheckout(worktree, focusedTab.checkout)) ?? null)
      : null;
  const active = focused ?? worktrees.find((worktree) => worktree.isMain) ?? worktrees[0] ?? null;
  // Sections someone opened or closed; a worktree that takes the focus opens again.
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [focusedPath, setFocusedPath] = useState(active?.path ?? null);
  if ((active?.path ?? null) !== focusedPath) {
    setFocusedPath(active?.path ?? null);
    if (active && chosen.has(active.path)) {
      const next = new Map(chosen);
      next.delete(active.path);
      setChosen(next);
    }
  }
  const expanded = (worktree: ProjectWorktree) => chosen.get(worktree.path) ?? true;
  const toggle = (worktree: ProjectWorktree) =>
    setChosen((current) => new Map(current).set(worktree.path, !expanded(worktree)));
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const search = useProjectPathSearch(
    {
      environmentId: scoped?.environmentId ?? null,
      cwd: active?.path ?? null,
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
    if (!scoped || !active) return;
    repositoryPanes.show(fileKey(scoped, checkoutOf(active), path));
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
              title="Repos"
              searchNoun="file"
              hasProjects
              projectScope={
                <>
                  {scoped ? (
                    <OpenBranchPicker
                      repository={scoped}
                      worktrees={worktrees}
                      onOpened={(worktree) =>
                        setChosen((current) => new Map(current).set(worktree.path, true))
                      }
                    />
                  ) : null}
                  <RepositoryFilter repositories={repositories} scoped={scoped} />
                </>
              }
              onNewThread={() => openCommandPalette({ open: "add-repository" })}
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
              scoped && active ? (
                <ul role="presentation" className="flex flex-col gap-px">
                  {results.map((entry, index) => (
                    <FileRow
                      key={entry.path}
                      tab={fileTab(scoped, checkoutOf(active), entry.path)}
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
            ) : scoped ? (
              <div className="flex min-h-0 flex-1 flex-col gap-1">
                {worktrees.map((worktree) => {
                  const filesKey = worktreeFilesKey(scoped.environmentId, worktree.path);
                  const files = filesShown.includes(filesKey);
                  return (
                    <Fragment key={worktree.path}>
                      <ul role="presentation" className="flex flex-col gap-px">
                        <WorktreeHeader
                          repository={scoped}
                          worktree={worktree}
                          expanded={expanded(worktree)}
                          onToggle={() => toggle(worktree)}
                          filesShown={files}
                          onToggleFiles={() => {
                            showWorktreeFiles(filesKey, !files);
                            setChosen((current) => new Map(current).set(worktree.path, true));
                          }}
                        />
                        {expanded(worktree) && !files ? (
                          <WorktreeRows>
                            <RepositoryList
                              repository={scoped}
                              cwd={worktree.path}
                              checkout={checkoutOf(worktree)}
                              showStatus
                              showRecent
                              changedFiles={worktree.changedFiles}
                              head={worktree.head}
                            />
                          </WorktreeRows>
                        ) : null}
                      </ul>
                      {expanded(worktree) && files ? (
                        <WorktreeFiles
                          key={filesKey}
                          owner={scoped}
                          worktree={worktree}
                          projectName={`${scoped.title} · ${worktree.alias}`}
                          selectedPath={
                            worktree.path === focused?.path && focusedTab?.kind === "file"
                              ? focusedTab.path
                              : null
                          }
                          onOpenFile={(path) =>
                            repositoryPanes.show(fileKey(scoped, checkoutOf(worktree), path))
                          }
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
                {listed ? (
                  <ul role="presentation" className="flex flex-col gap-px">
                    <SetAsideRows repository={scoped} setAside={listed.setAside} />
                  </ul>
                ) : (
                  <SidebarNote>Reading worktrees…</SidebarNote>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {repositories.map((repository) => (
                  <ul
                    key={repositoryKey(repository)}
                    role="presentation"
                    aria-label={repository.title}
                    className="flex flex-col gap-px"
                  >
                    <RepositoryList
                      repository={repository}
                      cwd={repository.workspaceRoot}
                      checkout={{ cwd: repository.workspaceRoot }}
                      heading
                      showRecent
                    />
                  </ul>
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

const NO_WORKTREES: ReadonlyArray<ProjectWorktree> = [];

/** Whether a worktree holds what a tab reads: its branch, or its folder. */
const holdsCheckout = (worktree: ProjectWorktree, checkout: RepositoryCheckout) =>
  "branch" in checkout ? worktree.branch === checkout.branch : worktree.path === checkout.cwd;

type FileTab = Extract<RepositoryTab, { kind: "file" }>;

const fileTab = (
  repository: EnvironmentProject,
  checkout: RepositoryCheckout,
  path: string,
): FileTab => ({
  kind: "file",
  environmentId: repository.environmentId,
  projectId: repository.id,
  checkout,
  path,
});
const fileKey = (repository: EnvironmentProject, checkout: RepositoryCheckout, path: string) =>
  repositoryTabKey(fileTab(repository, checkout, path));

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
        onClick={() => openCommandPalette({ open: "add-repository" })}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <FolderPlusIcon className="-mx-0.5 size-3" />
        Add a repository
      </button>
    </div>
  );
}

/**
 * One checkout's rows: with `showStatus`, its uncommitted changes and its branch against a base;
 * with `showRecent`, the files its commits changed most recently. With `heading`, under the
 * repository's name, as in the list of every repository.
 */
function RepositoryList({
  repository,
  cwd,
  checkout,
  heading = false,
  showStatus = false,
  showRecent = false,
  changedFiles,
  head,
}: {
  readonly repository: EnvironmentProject;
  readonly cwd: string;
  readonly checkout: RepositoryCheckout;
  readonly heading?: boolean;
  readonly showStatus?: boolean;
  readonly showRecent?: boolean;
  /** The worktree list's count and commit; when either moves, the status and recent files reread. */
  readonly changedFiles?: number;
  readonly head?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const status = useEnvironmentQuery(
    showStatus
      ? vcsEnvironment.status({ environmentId: repository.environmentId, input: { cwd } })
      : null,
  );
  const recent = useEnvironmentQuery(
    showRecent
      ? reviewEnvironment.recentFiles({
          environmentId: repository.environmentId,
          input: { cwd, limit: heading ? 8 : 20 },
        })
      : null,
  );
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const reread = useStableCallback(() => {
    void refreshStatus({
      environmentId: repository.environmentId,
      input: { cwd, localOnly: true },
    });
    recent.refresh();
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- the server's cached status misses edits made outside the app and branch switches; reread when the worktree list sees either
  useEffect(() => {
    if (showStatus && changedFiles !== undefined && head !== undefined) reread();
  }, [showStatus, changedFiles, head, reread]);
  const uncommitted = status.data?.workingTree.files ?? [];
  const uncommittedPaths = new Set(uncommitted.map((file) => file.path));
  const recentFiles = (recent.data?.files ?? []).filter((file) => !uncommittedPaths.has(file.path));
  const branch = status.data?.branchChanges;
  const diffKey = (source: "working-tree" | "branch-range", base?: string) =>
    repositoryTabKey({
      kind: "diff",
      environmentId: repository.environmentId,
      projectId: repository.id,
      checkout,
      source,
      ...(base === undefined ? {} : { base }),
    });
  return (
    <>
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
                  tab={fileTab(repository, checkout, file.path)}
                  detail={folderOf(file.path)}
                  trailing={`+${file.insertions} −${file.deletions}`}
                />
              ))}
            </>
          ) : null}
          {showStatus && status.data ? (
            <BranchCompareRow
              environmentId={repository.environmentId}
              cwd={cwd}
              defaultBase={branch?.baseRef ?? null}
              onOpen={(base) => repositoryPanes.show(diffKey("branch-range", base))}
            />
          ) : null}
          {showRecent && recentFiles.length > 0 ? (
            <>
              {heading ? null : <SectionLabel>Recently changed</SectionLabel>}
              {recentFiles.map((file) => (
                <FileRow
                  key={file.path}
                  tab={fileTab(repository, checkout, file.path)}
                  detail={folderOf(file.path)}
                  note={file.subject}
                  trailing={compactTime(file.changedAt)}
                />
              ))}
            </>
          ) : showRecent && recent.isPending ? (
            <SidebarNote>Reading recent changes…</SidebarNote>
          ) : null}
        </>
      )}
    </>
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
 * with Manage repositories and Add a repository at its foot.
 */
function RepositoryFilter({
  repositories,
  scoped,
}: {
  readonly repositories: ReadonlyArray<EnvironmentProject>;
  readonly scoped: EnvironmentProject | null;
}) {
  const { isMobile, open: sidebarOpen, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const [menu, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  const filter = useComboboxFilter();
  const items = projectFilterOptions({
    repositories: repositories.map((repository) => ({
      key: repositoryKey(repository),
      label: repository.title,
      repository,
    })),
    wikis: [],
    kinds: "repositories",
  });
  const filtered = searchProjectFilterOptions(items, menu.query, (item, query) =>
    filter.contains(item, query, (candidate) => candidate.label),
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
            icon={SettingsIcon}
            onClick={() =>
              closeAnd(() => {
                setOpenMobile(false);
                void navigate({ to: "/settings/projects" });
              })
            }
          >
            Manage repositories
          </SidebarPickerAction>
          <SidebarPickerAction
            icon={FolderPlusIcon}
            onClick={() => closeAnd(() => openCommandPalette({ open: "add-repository" }))}
          >
            Add a repository
          </SidebarPickerAction>
        </SidebarPickerFooter>
      </ComboboxPopup>
    </Combobox>
  );
}
