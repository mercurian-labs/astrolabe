import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectWorktree } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  EyeOffIcon,
  FilePenLineIcon,
  FolderGit2Icon,
  FolderPlusIcon,
  GitBranchIcon,
  ListFilterIcon,
  SettingsIcon,
} from "lucide-react";

import { useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { projectWorktrees, useManyProjectWorktrees } from "~/state/worktrees";
import { cn } from "~/lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  FilterPill,
  FilterPills,
  namesOrCount,
  OneTapFilterPill,
  PillIcons,
  ThreadsFilterCheckbox,
} from "../projects/ThreadsFilterParts";
import {
  filterSidebarProjectScopeItems,
  type SidebarProjectScopeMenuAction,
  type SidebarProjectScopeMenuState,
} from "../Sidebar.logic";
import {
  SidebarHeaderIconButton,
  SidebarPickerAction,
  SidebarPickerFooter,
} from "../sidebar/SidebarThreadHeader";
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
import { useSidebar } from "../ui/sidebar";
import {
  EMPTY_REPOSITORY_FILTER,
  setWorktreeHidden,
  storeRepositoryFilter,
  toggleFilterRepository,
  type RepositoryFilter,
} from "./repositoryFilter";
import { worktreeFilesKey } from "./repositoryScope";
import { WorktreeNumber } from "./WorktreeNumber";

const NO_WORKTREES: ReadonlyArray<ProjectWorktree> = [];

/** A repository the filter keeps, with its worktrees as last read. */
export interface RepositoryWorktreeGroup {
  readonly repository: EnvironmentProject;
  readonly key: string;
  readonly all: ReadonlyArray<ProjectWorktree>;
  readonly worktreeKey: (worktree: ProjectWorktree) => string;
}

const CHANGED_VALUE = "changed";
const ALL_VALUE = "all";
const CHANGED_LABEL = "Has changes";
const repositoryValue = (key: string) => `repository:${key}`;
const worktreeValue = (key: string) => `worktree:${key}`;

const worktreeName = (worktree: ProjectWorktree) => worktree.branch ?? worktree.alias;

function ChangedIcon({ className }: { readonly className?: string }) {
  return (
    <FilePenLineIcon
      aria-hidden
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}

/** Worktrees the filter hides among those it could show. */
const hiddenWorktrees = (
  filter: RepositoryFilter,
  groups: ReadonlyArray<RepositoryWorktreeGroup>,
) =>
  groups.flatMap((group) =>
    group.all.filter((worktree) => filter.hidden.includes(group.worktreeKey(worktree))),
  );

/**
 * Astrolabe: the Projects filter, as the thread list's and the Wikis': worktrees with changes, every
 * project or several, each with its worktrees nested under it (folded until opened, or found by a
 * search), each shown or hidden. Picking keeps the list open; Manage and Add a project sit at its
 * foot.
 */
export function RepositoryFilterMenu({
  repositories,
  filter,
  kept,
  changedCount,
  menu,
  dispatchMenu,
}: {
  readonly repositories: ReadonlyArray<EnvironmentProject>;
  readonly filter: RepositoryFilter;
  readonly kept: ReadonlySet<string> | null;
  /** Worktrees with changes, once Has changes has counted them all. */
  readonly changedCount: number | null;
  readonly menu: SidebarProjectScopeMenuState;
  readonly dispatchMenu: (action: SidebarProjectScopeMenuAction) => void;
}) {
  const { isMobile, open: sidebarOpen, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const comboboxFilter = useComboboxFilter();
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const repositoryKeys = repositories.map(
    (repository) => `${repository.environmentId}:${repository.id}`,
  );
  const repositoryByValue = new Map(
    repositories.map((repository, index) => [repositoryValue(repositoryKeys[index]!), repository]),
  );
  const searching = menu.query.trim().length > 0;
  // A search looks through every project's worktrees; otherwise only unfolded ones are read.
  const listedRepositories = repositories.filter(
    (_, index) => searching || unfolded.has(repositoryKeys[index]!),
  );
  const lists = useManyProjectWorktrees(listedRepositories.map(projectWorktrees));
  const worktreeGroups = listedRepositories.map((repository, index) => ({
    key: `${repository.environmentId}:${repository.id}`,
    all: lists[index]?.worktrees ?? NO_WORKTREES,
    worktreeKey: (worktree: ProjectWorktree) =>
      worktreeFilesKey(repository.environmentId, worktree.path),
  }));
  const groupOf = new Map(worktreeGroups.map((group) => [group.key, group]));
  const worktreeByValue = new Map(
    worktreeGroups.flatMap((group) =>
      group.all.map((worktree) => [worktreeValue(group.worktreeKey(worktree)), worktree] as const),
    ),
  );
  const labelOf = (value: string) => {
    if (value === CHANGED_VALUE) return CHANGED_LABEL;
    if (value === ALL_VALUE) return "All projects";
    const repository = repositoryByValue.get(value);
    if (repository) return repository.title;
    const worktree = worktreeByValue.get(value);
    return worktree ? worktreeName(worktree) : value;
  };
  const worktreeValuesOf = (key: string) => {
    const group = groupOf.get(key);
    return group ? group.all.map((worktree) => worktreeValue(group.worktreeKey(worktree))) : [];
  };
  const groups = [
    { label: "Status", values: [CHANGED_VALUE] },
    {
      label: "Projects",
      values: [
        ALL_VALUE,
        ...repositoryKeys.flatMap((key) => [repositoryValue(key), ...worktreeValuesOf(key)]),
      ],
    },
  ];
  const values = groups.flatMap((group) => group.values);
  const found = new Set(
    filterSidebarProjectScopeItems({
      items: values.map((value) => ({ value })),
      query: menu.query,
      matches: (item, query) => comboboxFilter.contains(item.value, query, labelOf),
    }).map((item) => item.value),
  );
  // A project shows its worktrees while unfolded; a search shows the ones it finds, and their
  // project with them.
  const matching = new Set(
    values.filter((value) => {
      if (value.startsWith("repository:")) {
        const key = value.slice("repository:".length);
        return found.has(value) || worktreeValuesOf(key).some((each) => found.has(each));
      }
      if (!value.startsWith("worktree:")) return found.has(value);
      return searching
        ? found.has(value)
        : worktreeGroups.some(
            (group) => unfolded.has(group.key) && worktreeValuesOf(group.key).includes(value),
          );
    }),
  );
  const toggleUnfolded = (key: string) =>
    setUnfolded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // With no repository picked every one is in, so each shows ticked.
  const checked = (value: string) => {
    if (value === CHANGED_VALUE) return filter.changed;
    if (value === ALL_VALUE) return kept === null;
    if (value.startsWith("repository:")) {
      return kept === null || kept.has(value.slice("repository:".length));
    }
    return !filter.hidden.includes(value.slice("worktree:".length));
  };
  const selected = values.filter(checked);
  const toggle = (value: string) => {
    if (value === CHANGED_VALUE) storeRepositoryFilter({ ...filter, changed: !filter.changed });
    else if (value === ALL_VALUE) storeRepositoryFilter({ ...filter, repositories: [] });
    else if (value.startsWith("repository:")) {
      storeRepositoryFilter(
        toggleFilterRepository(filter, value.slice("repository:".length), repositoryKeys),
      );
    } else {
      const key = value.slice("worktree:".length);
      storeRepositoryFilter(setWorktreeHidden(filter, key, !filter.hidden.includes(key)));
    }
  };
  const active = kept !== null || filter.changed || filter.hidden.length > 0;
  const closeAnd = (then: () => void) => {
    dispatchMenu({ type: "open-changed", open: false });
    then();
  };
  return (
    <Combobox<string, true>
      multiple
      items={values}
      filteredItems={values.filter((value) => matching.has(value))}
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
            label={active ? "Filter projects (filtered)" : "Filter projects"}
          />
        }
      >
        <ListFilterIcon className="size-4" />
        {/* The pills name the filter; the dot keeps it seen from the collapsed titlebar. */}
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
          {groups.map((group) => {
            const shown = group.values.filter((value) => matching.has(value));
            return shown.length === 0 ? null : (
              <ComboboxGroup key={group.label}>
                <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
                {shown.map((value) => {
                  const repository = repositoryByValue.get(value);
                  const worktree = worktreeByValue.get(value);
                  const repositoryKey = repository ? value.slice("repository:".length) : null;
                  const open = repositoryKey !== null && unfolded.has(repositoryKey);
                  return (
                    <ComboboxItem key={value} hideIndicator value={value}>
                      {worktree ? <span aria-hidden className="w-4 shrink-0" /> : null}
                      <ThreadsFilterCheckbox checked={checked(value)} />
                      {value === CHANGED_VALUE ? (
                        <ChangedIcon />
                      ) : repository ? (
                        <ProjectFavicon project={repository} className="size-4 shrink-0" />
                      ) : worktree ? (
                        worktree.number === null ? (
                          <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <span className="flex size-4 shrink-0 items-center justify-center">
                            <WorktreeNumber number={worktree.number} />
                          </span>
                        )
                      ) : (
                        <FolderGit2Icon className="size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{labelOf(value)}</span>
                      {value === CHANGED_VALUE ? (
                        changedCount === null ? null : (
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {changedCount}
                          </span>
                        )
                      ) : worktree?.isMain ? (
                        <span className="shrink-0 text-muted-foreground text-xs">
                          main checkout
                        </span>
                      ) : repositoryKey !== null && !searching ? (
                        <button
                          type="button"
                          aria-label={`${open ? "Hide" : "Show"} ${repository?.title ?? ""}'s worktrees`}
                          aria-expanded={open}
                          className="-me-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                          // The row picks the project; the chevron only folds its worktrees.
                          onPointerDown={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleUnfolded(repositoryKey);
                          }}
                        >
                          <ChevronRightIcon
                            className={cn("size-3.5 transition-transform", open && "rotate-90")}
                          />
                        </button>
                      ) : null}
                    </ComboboxItem>
                  );
                })}
              </ComboboxGroup>
            );
          })}
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
            Manage projects
          </SidebarPickerAction>
          <SidebarPickerAction
            icon={FolderPlusIcon}
            onClick={() => closeAnd(() => openCommandPalette({ open: "add-project" }))}
          >
            Add a project
          </SidebarPickerAction>
        </SidebarPickerFooter>
      </ComboboxPopup>
    </Combobox>
  );
}

/** The Projects filter in force: Has changes as one tap, then the repositories picked and the worktrees hidden. */
export function RepositoryFilterPills({
  repositories,
  filter,
  kept,
  worktreeGroups,
  changedCount,
  onOpen,
}: {
  readonly repositories: ReadonlyArray<EnvironmentProject>;
  readonly filter: RepositoryFilter;
  readonly kept: ReadonlySet<string> | null;
  readonly worktreeGroups: ReadonlyArray<RepositoryWorktreeGroup>;
  readonly changedCount: number | null;
  readonly onOpen: () => void;
}) {
  const picked =
    kept === null
      ? []
      : repositories.filter((repository) =>
          kept.has(`${repository.environmentId}:${repository.id}`),
        );
  const hidden = hiddenWorktrees(filter, worktreeGroups);
  // Counting every worktree runs git status in each, so Has changes shows only while it is on.
  const showChanged = filter.changed;
  const count =
    (filter.changed ? 1 : 0) + (picked.length > 0 ? 1 : 0) + (hidden.length > 0 ? 1 : 0);
  if (!showChanged && count === 0) return null;
  return (
    <FilterPills
      label="Project filters"
      count={count}
      onClear={() => storeRepositoryFilter(EMPTY_REPOSITORY_FILTER)}
    >
      {showChanged ? (
        <OneTapFilterPill
          on={filter.changed}
          label={CHANGED_LABEL}
          count={changedCount}
          icon={<ChangedIcon className="size-3.5" />}
          onToggle={() => storeRepositoryFilter({ ...filter, changed: !filter.changed })}
        />
      ) : null}
      {picked.length > 0 ? (
        <FilterPill
          label={namesOrCount(
            picked.map((repository) => repository.title),
            "projects",
          )}
          onOpen={onOpen}
          onRemove={() => storeRepositoryFilter({ ...filter, repositories: [] })}
        >
          <PillIcons>
            {picked.slice(0, 3).map((repository) => (
              <span
                key={`${repository.environmentId}:${repository.id}`}
                className="flex rounded-xs bg-sidebar"
              >
                <ProjectFavicon project={repository} className="size-3.5" />
              </span>
            ))}
          </PillIcons>
        </FilterPill>
      ) : null}
      {hidden.length > 0 ? (
        <FilterPill
          label={`Hiding ${namesOrCount(hidden.map(worktreeName), "worktrees")}`}
          onOpen={onOpen}
          onRemove={() => storeRepositoryFilter({ ...filter, hidden: [] })}
        >
          <EyeOffIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
        </FilterPill>
      ) : null}
    </FilterPills>
  );
}
