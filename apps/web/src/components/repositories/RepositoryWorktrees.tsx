import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectWorktree, ProjectWorktreeListResult } from "@t3tools/contracts";
import {
  EllipsisIcon,
  EyeOffIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  ListIcon,
  ListTreeIcon,
  PinIcon,
  Trash2Icon,
  UndoIcon,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import {
  refreshProjectWorktrees,
  refreshProjectWorktreesSoon,
  useWorktreeWatch,
  worktreeEnvironment,
} from "~/state/worktrees";
import FileBrowserPanel from "../files/FileBrowserPanel";
import {
  SidebarHeaderIconButton,
  SidebarPickerAction,
  SidebarPickerFooter,
} from "../sidebar/SidebarThreadHeader";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { openInNewWorktree } from "./repositoryScope";
import { useCreateWorktree, useOpenBranch } from "./worktreeActions";
import { WorktreeNumber } from "./WorktreeNumber";

/** What the worktree controls need of a project: a repository's or a wiki's. */
type WorktreeOwner = Pick<EnvironmentProject, "environmentId" | "id">;

const target = (repository: WorktreeOwner) => ({
  environmentId: repository.environmentId,
  projectId: repository.id,
});

/** Marks what shows only because the focused tab is in it, the filter hiding it otherwise. */
export function OutsideFilterMark() {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="text-3xs text-sidebar-muted-foreground/70" />}>
        hidden
      </TooltipTrigger>
      <TooltipPopup side="right" className="max-w-64">
        <div className="text-xs">
          The filter hides this. It shows while a tab of it is in front.
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * A worktree's header: its number and branch (or commit), how many files it has uncommitted, what
 * holds it, whether it shows its changes or its files, and Keep and Delete. Its contents collapse
 * under it.
 */
export function WorktreeHeader({
  repository,
  worktree,
  expanded,
  onToggle,
  label = worktree.alias,
  menuItems,
  filesShown = false,
  onToggleFiles,
  outsideFilter = false,
}: {
  readonly repository: WorktreeOwner;
  readonly worktree: ProjectWorktree;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** What to call it, when its branch says less than something else (a change request's title). */
  readonly label?: string;
  /** More actions for its menu, above Keep and Delete. */
  readonly menuItems?: ReactNode;
  /** Whether it shows its file tree in place of its changes, and the switch between them. */
  readonly filesShown?: boolean;
  readonly onToggleFiles?: () => void;
  /** Whether the filter hides it, so it shows only while the focused tab is in it. */
  readonly outsideFilter?: boolean;
}) {
  const holds = worktree.holds.filter((hold) => hold.kind !== "main");
  const watch = useWorktreeWatch(repository.environmentId, repository.id, worktree.path);
  const changes = watch?.changes ?? 0;
  // oxlint-disable-next-line t3code/react-effect-budget -- its count and branch follow changes on disk
  useEffect(() => {
    if (changes > 0) refreshProjectWorktreesSoon(repository.environmentId, repository.id);
  }, [changes, repository.environmentId, repository.id]);
  const accessory = (
    <span className="flex shrink-0 items-center gap-1.5 text-3xs text-sidebar-muted-foreground/70">
      {watch?.unwatched ? (
        <Tooltip>
          <TooltipTrigger render={<span />}>
            <EyeOffIcon aria-label="Not watched for changes" className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="right" className="max-w-64">
            <div className="text-xs">{`Not watched for changes: ${watch.unwatched}`}</div>
            <div className="text-xs text-muted-foreground">
              It reads its files again when you come back to the window.
            </div>
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {outsideFilter ? <OutsideFilterMark /> : null}
      {worktree.isMain ? <span>main checkout</span> : null}
      {worktree.changedFiles > 0 ? (
        <span className="tabular-nums">{`${worktree.changedFiles} changed`}</span>
      ) : null}
      {holds.length > 0 ? (
        <Tooltip>
          <TooltipTrigger render={<span />}>
            <PinIcon aria-label="Held" className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="right">
            {holds.map((hold) => (
              <div key={hold.kind + hold.label} className="text-xs">
                {hold.label}
              </div>
            ))}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
  return (
    <li className="mx-0.5 flex h-8 list-none items-center gap-1">
      <CollapsibleSectionHeader
        onClick={onToggle}
        expanded={expanded}
        tone="muted"
        accessory={accessory}
      >
        <span className="flex items-center gap-1.5">
          {worktree.number === null ? (
            <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
          ) : (
            <WorktreeNumber number={worktree.number} />
          )}
          {label}
        </span>
      </CollapsibleSectionHeader>
      {onToggleFiles ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={filesShown ? "Show its changes" : "Show its files"}
                aria-pressed={filesShown}
                onClick={onToggleFiles}
                className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
              />
            }
          >
            {filesShown ? <ListIcon className="size-3.5" /> : <ListTreeIcon className="size-3.5" />}
          </TooltipTrigger>
          <TooltipPopup side="top">
            {filesShown ? "Show its changes" : "Show its files"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {worktree.isMain ? null : (
        <WorktreeMenu repository={repository} worktree={worktree} label={label}>
          {menuItems}
        </WorktreeMenu>
      )}
    </li>
  );
}

/** A worktree section's rows, set in under its header along a guide line from its branch icon. */
export function WorktreeRows({ children }: { readonly children: ReactNode }) {
  return (
    <li className="list-none">
      <ul
        role="presentation"
        className="ms-4 flex flex-col gap-px border-s border-sidebar-border ps-1"
      >
        {children}
      </ul>
    </li>
  );
}

/** A tree grows with its open folders, then scrolls. */
const WORKTREE_TREE_SIZE = { maxRows: 20 } as const;

/**
 * A worktree section's file tree, set in under its header as its rows are. Its open folders are
 * read again when the watch reports one changing; unwatched, when its commit or count of changed
 * files moves.
 */
export function WorktreeFiles({
  owner,
  worktree,
  projectName,
  selectedPath,
  onOpenFile,
}: {
  readonly owner: WorktreeOwner;
  readonly worktree: ProjectWorktree;
  readonly projectName: string;
  readonly selectedPath: string | null;
  readonly onOpenFile: (path: string) => void;
}) {
  const watch = useWorktreeWatch(owner.environmentId, owner.id, worktree.path);
  return (
    <div className="ms-4 border-s border-sidebar-border ps-1">
      <FileBrowserPanel
        environmentId={owner.environmentId}
        cwd={worktree.path}
        projectName={projectName}
        selectedPath={selectedPath}
        selectedPathRevealId={0}
        onOpenFile={onOpenFile}
        workspaceMutationId={
          watch?.unwatched
            ? `${worktree.head}:${worktree.changedFiles}`
            : String(watch?.listings ?? 0)
        }
        sidebar={WORKTREE_TREE_SIZE}
      />
    </div>
  );
}

function WorktreeMenu({
  repository,
  worktree,
  label,
  children,
}: {
  readonly repository: WorktreeOwner;
  readonly worktree: ProjectWorktree;
  readonly label: string;
  readonly children?: ReactNode;
}) {
  const setKept = useAtomCommand(worktreeEnvironment.setKept);
  const remove = useRemoveWorktree();
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`${label} worktree actions`}
            className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          />
        }
      >
        <EllipsisIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        {children}
        <MenuItem
          onClick={async () => {
            await setKept({
              environmentId: repository.environmentId,
              input: { projectId: repository.id, path: worktree.path, kept: !worktree.kept },
            });
            refreshProjectWorktrees(repository.environmentId, repository.id);
          }}
        >
          <PinIcon />
          {worktree.kept ? "Stop keeping" : "Keep for this branch"}
        </MenuItem>
        <MenuItem variant="destructive" onClick={() => void remove(repository, worktree, label)}>
          <Trash2Icon />
          Delete worktree…
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** Deletes a worktree, asking first when the server names something it would cost. */
function useRemoveWorktree() {
  const remove = useAtomCommand(worktreeEnvironment.remove);
  return async (repository: WorktreeOwner, worktree: ProjectWorktree, label: string) => {
    const run = (confirmed: boolean) =>
      remove({
        environmentId: repository.environmentId,
        input: { projectId: repository.id, path: worktree.path, confirmed },
      });
    const asked = await run(false);
    if (asked._tag === "Success" && !asked.value.removed) {
      const confirmed = await requestConfirmDialog(
        [`Delete the ${label} worktree?`, ...asked.value.warnings].join("\n"),
        { variant: "destructive" },
      );
      if (confirmed === true) await run(true);
    }
    refreshProjectWorktrees(repository.environmentId, repository.id);
  };
}

/**
 * Work branches set aside when their worktree took another branch: open the branch to have it
 * back, or discard it. When the branch has moved on, it stays until someone decides.
 */
export function SetAsideRows({
  repository,
  setAside,
  branchLabel = (branch) => branch,
}: {
  readonly repository: WorktreeOwner;
  /** What to call a branch, when something else says more (a change request's title). */
  readonly branchLabel?: (branch: string) => string;
  readonly setAside: ProjectWorktreeListResult["setAside"];
}) {
  const openBranch = useOpenBranch();
  const discard = useAtomCommand(worktreeEnvironment.discardSetAside);
  if (setAside.length === 0) return null;
  return (
    <>
      {setAside.map((entry) => (
        <li
          key={entry.ref}
          className="mx-0.5 flex h-8 list-none items-center gap-1.5 px-2 text-xs text-sidebar-muted-foreground"
        >
          <UndoIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{`Set-aside work on ${branchLabel(entry.branch)}`}</span>
          <button
            type="button"
            className="cursor-pointer rounded px-1 hover:text-sidebar-foreground"
            onClick={() => void openBranch(target(repository), entry.branch)}
          >
            Open
          </button>
          <button
            type="button"
            className="cursor-pointer rounded px-1 hover:text-destructive-foreground"
            onClick={async () => {
              const confirmed = await requestConfirmDialog(
                `Discard the work set aside on ${branchLabel(entry.branch)}?`,
                { variant: "destructive" },
              );
              if (confirmed !== true) return;
              await discard({
                environmentId: repository.environmentId,
                input: { projectId: repository.id, branch: entry.branch },
              });
              refreshProjectWorktrees(repository.environmentId, repository.id);
            }}
          >
            Discard
          </button>
        </li>
      ))}
    </>
  );
}

/**
 * Opens a branch in a worktree (its own, a free one, or a new one), or makes a new branch from
 * the main checkout's branch. Each branch says where it is checked out already.
 */
export function OpenBranchPicker({
  repository,
  worktrees,
  onOpened,
}: {
  readonly repository: EnvironmentProject;
  readonly worktrees: ReadonlyArray<ProjectWorktree>;
  readonly onOpened: (worktree: ProjectWorktree) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const refs = useEnvironmentQuery(
    open
      ? vcsEnvironment.listRefs({
          environmentId: repository.environmentId,
          input: {
            cwd: repository.workspaceRoot,
            refKind: "local",
            limit: 100,
            ...(query.trim() ? { query: query.trim() } : {}),
          },
        })
      : null,
  );
  const openBranch = useOpenBranch();
  const createWorktree = useCreateWorktree();
  const branches = (refs.data?.refs ?? []).map((ref) => ref.name);
  const base = worktrees.find((worktree) => worktree.isMain)?.branch ?? "HEAD";
  const name = query.trim();
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const placedOn = (branch: string) => {
    const holder = worktrees.find((worktree) => worktree.branch === branch);
    if (holder === undefined) return null;
    return holder.number === null ? "main checkout" : `worktree ${holder.number}`;
  };
  return (
    <Combobox
      items={branches}
      filteredItems={branches}
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      value={null}
      onValueChange={async (branch: string | null) => {
        if (!branch) return;
        close();
        const worktree = await openBranch(target(repository), branch);
        if (worktree) onOpened(worktree);
      }}
    >
      <ComboboxTrigger render={<SidebarHeaderIconButton label="Open a branch in a worktree" />}>
        <GitBranchPlusIcon className="size-4" />
      </ComboboxTrigger>
      <ComboboxPopup align="end" className="min-w-56 max-w-[min(18rem,var(--available-width))]">
        <ComboboxSearchInput
          aria-label="Find or name a branch"
          placeholder="Find or name a branch..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>{refs.isPending ? "Reading branches…" : "No such branch."}</ComboboxEmpty>
        <ComboboxList>
          {(branch: string) => (
            <ComboboxItem key={branch} hideIndicator value={branch}>
              <GitBranchIcon className="size-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate text-sm">{branch}</span>
              {placedOn(branch) === null ? null : <BranchNote>{placedOn(branch)}</BranchNote>}
            </ComboboxItem>
          )}
        </ComboboxList>
        <NewWorktreeSwitch />
        {name.length > 0 && !branches.includes(name) ? (
          <SidebarPickerFooter>
            <SidebarPickerAction
              icon={GitBranchPlusIcon}
              onClick={async () => {
                close();
                const worktree = await createWorktree(target(repository), name, base);
                if (worktree) onOpened(worktree);
              }}
            >
              {`New branch ${name} from ${base}`}
            </SidebarPickerAction>
          </SidebarPickerFooter>
        ) : null}
      </ComboboxPopup>
    </Combobox>
  );
}

/**
 * Whether a branch opened from a picker gets a worktree of its own even when one is free, kept on
 * the device for every picker (and the set-aside rows' and tabs' Open).
 */
export function NewWorktreeSwitch() {
  const id = useId();
  const choice = openInNewWorktree.useValue();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center justify-between gap-3 border-t border-border/60 px-3 py-2 text-xs"
    >
      <span className="flex min-w-0 items-center gap-1.5 font-medium text-muted-foreground">
        <GitBranchPlusIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">In a new worktree</span>
      </span>
      <Switch
        id={id}
        size="sm"
        checked={choice === "new"}
        aria-label="Open in a new worktree"
        onCheckedChange={(checked) => openInNewWorktree.set(checked ? "new" : "reuse")}
      />
    </label>
  );
}

function BranchNote({ children }: { readonly children: ReactNode }) {
  return <span className="shrink-0 text-xs text-muted-foreground">{children}</span>;
}
