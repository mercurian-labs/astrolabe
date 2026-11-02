import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectWorktree, ProjectWorktreeListResult } from "@t3tools/contracts";
import { ArrowRightIcon, FileDiffIcon, FileIcon, FolderPlusIcon } from "lucide-react";
import {
  Fragment,
  useEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { readLocalApi } from "~/localApi";
import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn, isMacPlatform } from "~/lib/utils";
import { endDrag, startDrag } from "~/panes/drag";
import { useEnvironmentQuery } from "~/state/query";
import { useProjectPathSearch } from "~/state/queries";
import { reviewEnvironment } from "~/state/review";
import { vcsEnvironment } from "~/state/vcs";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  projectWorktrees,
  useManyProjectWorktrees,
  useManyWorktreeChangedFiles,
  useWorktreeChangedFiles,
} from "~/state/worktrees";
import { rowClickIntent, type RowClick } from "~/tabNavigation.logic";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { reduceSidebarProjectScopeMenuState } from "../Sidebar.logic";
import { SIDEBAR_ROW_ACTIVE_CLASS, SIDEBAR_ROW_SURFACE_CLASS } from "../sidebar/SidebarCard";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { SidebarThreadHeader } from "../sidebar/SidebarThreadHeader";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { SidebarContent, SidebarGroup } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useWorkspaceFocusedKey, useWorkspaceOpenKeys, workspace } from "~/panes/workspace";
import { checkoutTag, foldWorktrees } from "./worktreeFolding";
import { showLocalGraph } from "./repositoryPanes";
import { OutsideFilterMark } from "../projects/ThreadsFilterParts";
import {
  FoldedWorktrees,
  OpenBranchPicker,
  SetAsideRows,
  WorktreeFiles,
  WorktreeHeader,
  WorktreeRows,
} from "./RepositoryWorktrees";
import { RepositoryFilterMenu, RepositoryFilterPills } from "./RepositoryFilterMenu";
import {
  filterRepositoryKeys,
  filterWorktrees,
  setWorktreeHidden,
  storeRepositoryFilter,
  useStoredRepositoryFilter,
} from "./repositoryFilter";
import {
  repositoryWorktreeFiles,
  showWorktreeFiles,
  worktreeFilesKey,
  worktreeFilesShown,
} from "./repositoryScope";
import {
  checkoutOf,
  holderOf,
  fileName,
  folderOf,
  parseRepositoryTabKey,
  repositoryTabKey,
  type RepositoryCheckout,
  type ProjectFileTab,
} from "./repositoryTabs";
import { useRepositories } from "./useRepositories";

const repositoryKey = (project: Pick<EnvironmentProject, "environmentId" | "id">) =>
  `${project.environmentId}:${project.id}`;

/**
 * The Projects sidebar: title row (search, open a branch, the filter, Add), then the repositories the
 * filter keeps, each with its worktrees, main checkout first, each with what is moving there or
 * its file tree. One repository shows its worktrees bare; several each sit under a header, open
 * when it holds the focused tab. What the focused tab is in shows whatever the filter says.
 */
export function RepositorySidebar() {
  const repositories = useRepositories();
  const filter = useStoredRepositoryFilter();
  const filesShown = repositoryWorktreeFiles.useValue();
  const focusedKey = useWorkspaceFocusedKey();
  const focusedTab = focusedKey === null ? null : parseRepositoryTabKey(focusedKey);
  const focusedRepository =
    focusedTab && "projectId" in focusedTab
      ? repositoryKey({ environmentId: focusedTab.environmentId, id: focusedTab.projectId })
      : null;
  const kept = filterRepositoryKeys(filter, repositories.map(repositoryKey));
  const candidates = repositories.filter(
    (repository) =>
      kept === null ||
      kept.has(repositoryKey(repository)) ||
      repositoryKey(repository) === focusedRepository,
  );
  const lists = useManyProjectWorktrees(
    candidates.map((repository) => projectWorktrees(repository)),
  );
  // A list leaves worktrees uncounted; Has changes counts every worktree of the projects kept.
  const counted = filter.changed
    ? candidates.flatMap((repository, index) =>
        kept !== null && !kept.has(repositoryKey(repository))
          ? []
          : (lists[index]?.worktrees ?? NO_WORKTREES).map((worktree) => ({
              target: projectWorktrees(repository),
              path: worktree.path,
            })),
      )
    : [];
  const counts = useManyWorktreeChangedFiles(counted);
  const countOf = new Map(
    counted.map((entry, index) => [
      worktreeFilesKey(entry.target.environmentId, entry.path),
      counts[index] ?? null,
    ]),
  );
  const countedSoFar = counts.filter((count) => count !== null).length;
  const stillCounting = countedSoFar < counts.length;
  const openKeys = useWorkspaceOpenKeys();
  const read = candidates.map((repository, index) => {
    const key = repositoryKey(repository);
    const listed = lists[index] ?? null;
    const all = (listed?.worktrees ?? NO_WORKTREES).map((worktree) => {
      const count = countOf.get(worktreeFilesKey(repository.environmentId, worktree.path));
      return count === undefined ? worktree : { ...worktree, changedFiles: count };
    });
    const focused =
      focusedTab && "checkout" in focusedTab && key === focusedRepository
        ? holderOf(all, focusedTab.checkout)
        : null;
    return {
      repository,
      key,
      listed,
      all,
      focused,
      outside: kept !== null && !kept.has(key),
      worktreeKey: (worktree: ProjectWorktree) =>
        worktreeFilesKey(repository.environmentId, worktree.path),
      openCheckouts: new Set(
        openKeys.flatMap((openKey) => {
          const tab = parseRepositoryTabKey(openKey);
          return tab !== null &&
            "checkout" in tab &&
            "projectId" in tab &&
            tab.projectId === repository.id &&
            tab.environmentId === repository.environmentId
            ? [checkoutTag(tab.checkout)]
            : [];
        }),
      ),
    };
  });
  const views = read.flatMap((entry) => {
    const focusedWorktreeKey = entry.focused ? entry.worktreeKey(entry.focused) : null;
    const worktrees = entry.outside
      ? entry.focused
        ? [{ worktree: entry.focused, outside: true }]
        : []
      : filterWorktrees(
          filter,
          entry.all.map((worktree) => ({ key: entry.worktreeKey(worktree), worktree })),
          focusedWorktreeKey,
        );
    // A repository the filter leaves nothing of drops out once its worktrees are read.
    if (entry.listed !== null && worktrees.length === 0) return [];
    return [{ ...entry, worktrees }];
  });
  // Known only once Has changes has counted every worktree.
  const changedCount =
    !filter.changed || stillCounting
      ? null
      : read
          .filter((entry) => !entry.outside)
          .flatMap((entry) =>
            entry.all.filter(
              (worktree) =>
                (worktree.changedFiles ?? 0) > 0 &&
                !filter.hidden.includes(entry.worktreeKey(worktree)),
            ),
          ).length;
  const single = views.length === 1 ? views[0]! : null;
  const focused = views.find((view) => view.focused !== null)?.focused ?? null;
  // Sections someone opened or closed; a worktree or repository that takes the focus opens again.
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [focusedPath, setFocusedPath] = useState(focused?.path ?? null);
  if ((focused?.path ?? null) !== focusedPath) {
    setFocusedPath(focused?.path ?? null);
    const reopened = [focused?.path, focusedRepository].filter(
      (key): key is string => key != null && chosen.has(key),
    );
    if (reopened.length > 0) {
      const next = new Map(chosen);
      for (const key of reopened) next.delete(key);
      setChosen(next);
    }
  }
  const open = (key: string, fallback: boolean) => chosen.get(key) ?? fallback;
  const toggle = (key: string, fallback: boolean) =>
    setChosen((current) => new Map(current).set(key, !open(key, fallback)));
  const reveal = (key: string) => setChosen((current) => new Map(current).set(key, true));
  const searched = single?.repository ?? null;
  const searchedIn =
    single?.focused ?? single?.all.find((worktree) => worktree.isMain) ?? single?.all[0] ?? null;
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [menu, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  const search = useProjectPathSearch(
    {
      environmentId: searched?.environmentId ?? null,
      cwd: searchedIn?.path ?? null,
      query: searchQuery,
      kind: "file",
    },
    50,
  );
  const searching = searchQuery.trim().length > 0;
  const results = searched && searching ? search.entries : [];
  const clearSearch = () => {
    setSearchQuery("");
    setActiveIndex(0);
  };
  const openResult = (path: string) => {
    if (!searched || !searchedIn) return;
    workspace.show(fileKey(searched, checkoutOf(searchedIn), path));
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
  const worktreeSections = (view: (typeof views)[number]) => (
    <WorktreeSections
      repository={view.repository}
      worktrees={view.worktrees}
      openCheckouts={view.openCheckouts}
      setAside={view.listed?.setAside ?? null}
      expanded={(worktree, fallback) => open(worktree.path, fallback)}
      onToggle={(worktree, fallback) => toggle(worktree.path, fallback)}
      onReveal={(worktree) => reveal(worktree.path)}
      filesShown={filesShown}
      focusedPath={view.focused?.path ?? null}
      selectedPath={(worktree) =>
        worktree.path === focused?.path && focusedTab?.kind === "file" ? focusedTab.path : null
      }
    />
  );

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <SidebarThreadHeader
              title="Projects"
              searchNoun="file"
              hasProjects
              projectScope={
                <>
                  {single ? (
                    <OpenBranchPicker
                      repository={single.repository}
                      worktrees={single.all}
                      onOpened={(worktree) => {
                        reveal(worktree.path);
                        storeRepositoryFilter(
                          setWorktreeHidden(filter, single.worktreeKey(worktree), false),
                        );
                      }}
                    />
                  ) : null}
                  <RepositoryFilterMenu
                    repositories={repositories}
                    filter={filter}
                    kept={kept}
                    changedCount={changedCount}
                    menu={menu}
                    dispatchMenu={dispatchMenu}
                  />
                </>
              }
              onNewThread={() => openCommandPalette({ open: "add-project" })}
              newThreadDisabled={false}
              newThreadShortcutLabel={null}
              newThreadInProjectShortcutLabel={null}
              showNewThreadInProjectHint={false}
              newItemLabel="Add a project"
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
            {repositories.length > 0 ? (
              <RepositoryFilterPills
                repositories={repositories}
                filter={filter}
                kept={kept}
                worktreeGroups={read.filter((entry) => !entry.outside)}
                changedCount={changedCount}
                onOpen={() => dispatchMenu({ type: "open-changed", open: true })}
              />
            ) : null}
            {stillCounting ? (
              // Counting runs git status in each worktree, a second or more apiece.
              <p role="status" className="px-2 pt-1 text-2xs text-sidebar-muted-foreground">
                {`Counting changes… ${countedSoFar} of ${counts.length}`}
              </p>
            ) : null}
          </SidebarGroup>
        }
      >
        <SidebarGroup className="flex-1" role="presentation">
          <TooltipProvider delay={400} closeDelay={0} timeout={400}>
            {repositories.length === 0 ? (
              <EmptyRepositories />
            ) : searching ? (
              searched && searchedIn ? (
                <ul role="presentation" className="flex flex-col gap-px">
                  {results.map((entry, index) => (
                    <FileRow
                      key={entry.path}
                      tab={fileTab(searched, checkoutOf(searchedIn), entry.path)}
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
                <SidebarNote>Pick one project in the filter to find its files.</SidebarNote>
              )
            ) : views.length === 0 ? (
              <SidebarNote>
                {stillCounting ? "Counting changes…" : "Nothing here matches the filter."}
              </SidebarNote>
            ) : single && !single.outside ? (
              worktreeSections(single)
            ) : (
              <div className="flex flex-col gap-1">
                {views.map((view) => {
                  const fallback = views.length === 1 || view.key === focusedRepository;
                  const expanded = open(view.key, fallback);
                  return (
                    <Fragment key={view.key}>
                      <ul role="presentation" aria-label={view.repository.title}>
                        <li className="mx-0.5 flex h-8 list-none items-center gap-1">
                          <CollapsibleSectionHeader
                            onClick={() => toggle(view.key, fallback)}
                            expanded={expanded}
                            tone="muted"
                            accessory={view.outside ? <OutsideFilterMark /> : null}
                          >
                            <span className="flex items-center gap-1.5">
                              <ProjectFavicon project={view.repository} className="size-3.5" />
                              {view.repository.title}
                            </span>
                          </CollapsibleSectionHeader>
                        </li>
                      </ul>
                      {expanded ? <div className="ms-2">{worktreeSections(view)}</div> : null}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </TooltipProvider>
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

/**
 * A repository's worktrees as the filter shows them, each a header over its changes and recent
 * files or its file tree, then the work its branches set aside.
 */
function WorktreeSections({
  repository,
  worktrees,
  openCheckouts,
  setAside,
  expanded,
  onToggle,
  onReveal,
  filesShown,
  selectedPath,
  focusedPath,
}: {
  readonly repository: EnvironmentProject;
  readonly worktrees: ReadonlyArray<{
    readonly worktree: ProjectWorktree;
    readonly outside: boolean;
  }>;
  /** The checkouts of the project's open tabs, whose worktrees stay listed. */
  readonly openCheckouts: ReadonlySet<string>;
  /** Null while the worktrees are being read. */
  readonly setAside: ProjectWorktreeListResult["setAside"] | null;
  /** Whether a worktree is open; `fallback` until someone opens or closes it. */
  readonly expanded: (worktree: ProjectWorktree, fallback: boolean) => boolean;
  readonly onToggle: (worktree: ProjectWorktree, fallback: boolean) => void;
  readonly onReveal: (worktree: ProjectWorktree) => void;
  readonly filesShown: Readonly<Record<string, boolean>>;
  readonly selectedPath: (worktree: ProjectWorktree) => string | null;
  /** The worktree of the focused tab, which opens on its own. */
  readonly focusedPath: string | null;
}) {
  const owner = projectWorktrees(repository);
  const [now] = useState(() => Date.now());
  const { listed, rest } = foldWorktrees(worktrees, { openCheckouts, now });
  const worktreeSection = (
    { worktree, outside }: { readonly worktree: ProjectWorktree; readonly outside: boolean },
    folded: boolean,
  ) => {
    const filesKey = worktreeFilesKey(repository.environmentId, worktree.path);
    const files = worktreeFilesShown(filesShown, filesKey, worktree.isMain);
    // Only the main checkout and the focused tab's start open: an open one reads its status and
    // recent commits.
    const fallback = !folded && (worktree.isMain || outside || worktree.path === focusedPath);
    const open = expanded(worktree, fallback);
    return (
      <Fragment key={worktree.path}>
        <ul role="presentation" className="flex flex-col gap-px">
          <WorktreeHeader
            repository={owner}
            worktree={worktree}
            expanded={open}
            onToggle={() => onToggle(worktree, fallback)}
            outsideFilter={outside}
            folded={folded}
            filesShown={files}
            onToggleFiles={() => {
              showWorktreeFiles(filesKey, !files);
              onReveal(worktree);
            }}
            onCompare={() =>
              workspace.show(
                repositoryTabKey({
                  kind: "diff",
                  environmentId: repository.environmentId,
                  projectId: repository.id,
                  checkout: checkoutOf(worktree),
                  source: "branch-range",
                }),
              )
            }
          />
          {open && !files ? (
            <WorktreeRows>
              <RepositoryList
                repository={repository}
                cwd={worktree.path}
                checkout={checkoutOf(worktree)}
                head={worktree.head}
              />
            </WorktreeRows>
          ) : null}
        </ul>
        {open && files ? (
          <WorktreeFiles
            key={filesKey}
            owner={owner}
            worktree={worktree}
            projectName={`${repository.title} · ${worktree.alias}`}
            selectedPath={selectedPath(worktree)}
            onOpenFile={(path) => workspace.show(fileKey(repository, checkoutOf(worktree), path))}
            fileMenuActions={[
              {
                id: "local-graph",
                label: "Open local graph",
                run: (path) => showLocalGraph(fileTab(repository, checkoutOf(worktree), path)),
              },
            ]}
          />
        ) : null}
      </Fragment>
    );
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {listed.map((entry) => worktreeSection(entry, false))}
      <FoldedWorktrees
        ownerTitle={repository.title}
        rest={rest}
        renderEntry={(entry) => worktreeSection(entry, true)}
      />
      {setAside ? (
        <ul role="presentation" className="flex flex-col gap-px">
          <SetAsideRows repository={owner} setAside={setAside} />
        </ul>
      ) : (
        <SidebarNote>Reading worktrees…</SidebarNote>
      )}
    </div>
  );
}

const NO_WORKTREES: ReadonlyArray<ProjectWorktree> = [];

type FileTab = ProjectFileTab;

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
      <span>No projects yet</span>
      <button
        type="button"
        onClick={() => openCommandPalette({ open: "add-project" })}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <FolderPlusIcon className="-mx-0.5 size-3" />
        Add a project
      </button>
    </div>
  );
}

/**
 * One worktree's rows: its uncommitted changes, its branch against a base, and the files its
 * commits changed most recently.
 */
function RepositoryList({
  repository,
  cwd,
  checkout,
  head,
}: {
  readonly repository: EnvironmentProject;
  readonly cwd: string;
  readonly checkout: RepositoryCheckout;
  /** The worktree list's commit; when it or the count moves, the status and recent files reread. */
  readonly head: string | null;
}) {
  const changedFiles = useWorktreeChangedFiles(projectWorktrees(repository), cwd);
  const status = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId: repository.environmentId, input: { cwd } }),
  );
  const recent = useEnvironmentQuery(
    reviewEnvironment.recentFiles({
      environmentId: repository.environmentId,
      input: { cwd, limit: 20 },
    }),
  );
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  // What the list and the count last saw of it; when either moves, the status and files reread.
  const revision = `${head ?? ""}:${changedFiles ?? ""}`;
  const reread = useStableCallback((_revision: string) => {
    void refreshStatus({
      environmentId: repository.environmentId,
      input: { cwd, localOnly: true },
    });
    recent.refresh();
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- the server's cached status misses edits made outside the app and branch switches; reread when the worktree list sees either
  useEffect(() => {
    reread(revision);
  }, [revision, reread]);
  const uncommitted = status.data?.workingTree.files ?? [];
  const uncommittedPaths = new Set(uncommitted.map((file) => file.path));
  const recentFiles = (recent.data?.files ?? []).filter((file) => !uncommittedPaths.has(file.path));
  const uncommittedKey = repositoryTabKey({
    kind: "diff",
    environmentId: repository.environmentId,
    projectId: repository.id,
    checkout,
    source: "working-tree",
  });
  return (
    <>
      {uncommitted.length > 0 ? (
        <>
          <SectionLabel>{`Uncommitted · ${uncommitted.length}`}</SectionLabel>
          <LinkRow
            icon={FileDiffIcon}
            label="Review uncommitted changes"
            onClick={() => workspace.show(uncommittedKey)}
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
      {recentFiles.length > 0 ? (
        <>
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
      ) : recent.isPending ? (
        <SidebarNote>Reading recent changes…</SidebarNote>
      ) : null}
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
  const { resolvedTheme } = useTheme();
  const focused = useWorkspaceFocusedKey();
  const active = focused === key;
  const open = (event: RowClick) => {
    const intent = rowClickIntent(event, isMacPlatform(navigator.platform));
    if (intent === "new-tab" || intent === "mod") workspace.open(key, "tab");
    else workspace.show(key);
    onOpened?.();
  };
  const showMenu = (event: MouseEvent<HTMLElement>) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    void api.contextMenu
      .show([{ id: "local-graph", label: "Open local graph" }], {
        x: event.clientX,
        y: event.clientY,
      })
      .then((clicked) => {
        if (clicked === "local-graph") showLocalGraph(tab);
      });
  };
  const drag = (event: DragEvent<HTMLElement>) =>
    startDrag(
      event,
      { key, keys: [], place: (paneId, drop) => workspace.place([key], key, paneId, drop) },
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
              onContextMenu={showMenu}
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
          <PierreEntryIcon
            pathValue={tab.path}
            kind="file"
            theme={resolvedTheme}
            className="size-3.5"
          />
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
