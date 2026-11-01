import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectWorktree } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  EyeOffIcon,
  FilePenLineIcon,
  FolderGit2Icon,
  FolderPlusIcon,
  GitBranchIcon,
  ListFilterIcon,
  SettingsIcon,
} from "lucide-react";

import { openCommandPalette } from "~/commandPaletteBus";
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
import { WorktreeNumber } from "./WorktreeNumber";

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
 * Astrolabe: the Repos filter, as the thread list's and the Wikis': worktrees with changes, every
 * repository or several, then the worktrees of those kept, each shown or hidden. Picking keeps the
 * list open; Manage and Add a repository sit at its foot.
 */
export function RepositoryFilterMenu({
  repositories,
  filter,
  kept,
  worktreeGroups,
  changedCount,
  menu,
  dispatchMenu,
}: {
  readonly repositories: ReadonlyArray<EnvironmentProject>;
  readonly filter: RepositoryFilter;
  readonly kept: ReadonlySet<string> | null;
  readonly worktreeGroups: ReadonlyArray<RepositoryWorktreeGroup>;
  readonly changedCount: number;
  readonly menu: SidebarProjectScopeMenuState;
  readonly dispatchMenu: (action: SidebarProjectScopeMenuAction) => void;
}) {
  const { isMobile, open: sidebarOpen, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const comboboxFilter = useComboboxFilter();
  const repositoryKeys = repositories.map(
    (repository) => `${repository.environmentId}:${repository.id}`,
  );
  const repositoryByValue = new Map(
    repositories.map((repository, index) => [repositoryValue(repositoryKeys[index]!), repository]),
  );
  const worktreeByValue = new Map(
    worktreeGroups.flatMap((group) =>
      group.all.map((worktree) => [worktreeValue(group.worktreeKey(worktree)), worktree] as const),
    ),
  );
  const labelOf = (value: string) => {
    if (value === CHANGED_VALUE) return CHANGED_LABEL;
    if (value === ALL_VALUE) return "All repositories";
    const repository = repositoryByValue.get(value);
    if (repository) return repository.title;
    const worktree = worktreeByValue.get(value);
    return worktree ? worktreeName(worktree) : value;
  };
  const groups = [
    { label: "Status", values: [CHANGED_VALUE] },
    { label: "Repositories", values: [ALL_VALUE, ...repositoryKeys.map(repositoryValue)] },
    ...worktreeGroups.map((group) => ({
      label: worktreeGroups.length === 1 ? "Worktrees" : `Worktrees · ${group.repository.title}`,
      values: group.all.map((worktree) => worktreeValue(group.worktreeKey(worktree))),
    })),
  ];
  const values = groups.flatMap((group) => group.values);
  const matching = new Set(
    filterSidebarProjectScopeItems({
      items: values.map((value) => ({ value })),
      query: menu.query,
      matches: (item, query) => comboboxFilter.contains(item.value, query, labelOf),
    }).map((item) => item.value),
  );
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
  const active =
    kept !== null || filter.changed || hiddenWorktrees(filter, worktreeGroups).length > 0;
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
            label={active ? "Filter repositories (filtered)" : "Filter repositories"}
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
                  return (
                    <ComboboxItem key={value} hideIndicator value={value}>
                      <ThreadsFilterCheckbox check={checked(value) ? "checked" : "unchecked"} />
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
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {changedCount}
                        </span>
                      ) : worktree?.isMain ? (
                        <span className="shrink-0 text-muted-foreground text-xs">
                          main checkout
                        </span>
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

/** The Repos filter in force: Has changes as one tap, then the repositories picked and the worktrees hidden. */
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
  readonly changedCount: number;
  readonly onOpen: () => void;
}) {
  const picked =
    kept === null
      ? []
      : repositories.filter((repository) =>
          kept.has(`${repository.environmentId}:${repository.id}`),
        );
  const hidden = hiddenWorktrees(filter, worktreeGroups);
  const showChanged = filter.changed || changedCount > 0;
  const count =
    (filter.changed ? 1 : 0) + (picked.length > 0 ? 1 : 0) + (hidden.length > 0 ? 1 : 0);
  if (!showChanged && count === 0) return null;
  return (
    <FilterPills
      label="Repository filters"
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
            "repositories",
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
