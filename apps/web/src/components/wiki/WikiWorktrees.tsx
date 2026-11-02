import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import type { ProjectWorktree, WikiChangeRequestId } from "@t3tools/contracts";
import { GitBranchPlusIcon, SaveIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { openTab } from "~/panes/arrangement";
import { useAtomCommand } from "~/state/use-atom-command";
import { wikiEnvironment } from "~/state/wiki";
import {
  refreshProjectWorktrees,
  refreshWorktreeChangedFilesSoon,
  useProjectWorktrees,
  type WorktreesTarget,
} from "~/state/worktrees";
import { storedName } from "../projects/storedChoice";
import { repositoryTabKey } from "../repositories/repositoryTabs";
import {
  NewWorktreeSwitch,
  SetAsideRows,
  WorktreeFiles,
  WorktreeHeader,
} from "../repositories/RepositoryWorktrees";
import { useOpenBranch } from "../repositories/worktreeActions";
import {
  SidebarHeaderIconButton,
  SidebarPickerAction,
  SidebarPickerFooter,
} from "../sidebar/SidebarThreadHeader";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { MenuItem } from "../ui/menu";
import { noteNameOfFile } from "./wiki.logic";
import { showWikiTab, wikiPanes } from "./wikiPanes";
import type { WikiTab } from "./wikiTabs";

/** Astrolabe: whether the Wikis sidebar lists documents or shows each worktree's file tree. */
export const wikiView = storedName("astrolabe:wiki-view:v1", ["list", "tree"] as const);

const CHANGE_REQUEST_BRANCH = /^cr\/(.+)$/;
const NOT_NOTES = new Set(["readme.md", "agents.md", "claude.md"]);

/** The change request a worktree's branch is, if it is one. */
const changeRequestOf = (branch: string | null) =>
  branch === null
    ? null
    : ((CHANGE_REQUEST_BRANCH.exec(branch)?.[1] as WikiChangeRequestId | undefined) ?? null);

/** A wiki's worktrees: those of the repository in its own folder. */
const worktreesOfWiki = (overview: WikiOverview): WorktreesTarget => ({
  environmentId: overview.environmentId,
  wikiId: overview.wiki.wikiId,
});

/**
 * A wiki's worktrees, each under its change request's title (its main line under the main
 * branch), with its file tree. A note opens as the wiki's own tab, read from that worktree's
 * change request; any other file opens as a file. The focused tab's worktree opens on its own.
 */
export function WikiWorktreeTrees({
  overview,
  focused,
}: {
  readonly overview: WikiOverview;
  readonly focused: WikiTab | null;
}) {
  const owner = worktreesOfWiki(overview);
  const listed = useProjectWorktrees(owner);
  const saveWorktree = useAtomCommand(wikiEnvironment.saveWorktree);
  // Sections someone opened or closed; a worktree that takes the focus opens again.
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  if (listed === null) return <Note>Reading worktrees…</Note>;
  const { wiki } = overview;
  const titleOf = (branch: string) => {
    const changeRequestId = changeRequestOf(branch);
    const changeRequest = overview.changeRequests?.find(
      (candidate) => candidate.changeRequestId === changeRequestId,
    );
    return changeRequest ? changeRequest.title : branch;
  };
  const focusedHere =
    focused !== null &&
    focused.environmentId === overview.environmentId &&
    focused.wikiId === wiki.wikiId
      ? focused
      : null;
  const focusedWorktree = focusedHere
    ? (listed.worktrees.find((worktree) =>
        focusedHere.changeRequestId === undefined
          ? worktree.isMain
          : changeRequestOf(worktree.branch) === focusedHere.changeRequestId,
      ) ?? null)
    : null;
  const active = focusedWorktree ?? listed.worktrees.find((worktree) => worktree.isMain) ?? null;
  if ((active?.path ?? null) !== focusedPath) {
    setFocusedPath(active?.path ?? null);
    if (active && chosen.has(active.path)) {
      const next = new Map(chosen);
      next.delete(active.path);
      setChosen(next);
    }
  }
  const expanded = (worktree: ProjectWorktree) =>
    chosen.get(worktree.path) ?? (listed.worktrees.length === 1 || worktree.path === active?.path);
  const toggle = (worktree: ProjectWorktree) =>
    setChosen((current) => new Map(current).set(worktree.path, !expanded(worktree)));
  const selectedPath =
    focusedHere?.kind === "note"
      ? (overview.index?.notes.find((note) => note.name === focusedHere.name)?.file ??
        `${focusedHere.name}.md`)
      : null;
  const openFile = (worktree: ProjectWorktree, file: string) => {
    const changeRequestId = changeRequestOf(worktree.branch) ?? undefined;
    const onMainLine = worktree.isMain || worktree.branch === wiki.mainBranch;
    const isNote =
      /^[^/]+\.md$/i.test(file) &&
      !NOT_NOTES.has(file.toLowerCase()) &&
      !/\.skillmap\.md$/i.test(file);
    if (isNote && (onMainLine || changeRequestId !== undefined)) {
      showWikiTab({
        kind: "note",
        environmentId: overview.environmentId,
        wikiId: wiki.wikiId,
        name: noteNameOfFile(file),
        changeRequestId,
      });
      return;
    }
    const key = repositoryTabKey({
      kind: "file",
      environmentId: overview.environmentId,
      wikiId: wiki.wikiId,
      checkout:
        worktree.isMain || worktree.branch === null
          ? { cwd: worktree.path }
          : { branch: worktree.branch },
      path: file,
    });
    wikiPanes.update((arrangement) => openTab(arrangement, key, arrangement.focused));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {listed.worktrees.map((worktree) => {
        const changeRequestId = changeRequestOf(worktree.branch);
        const label = worktree.isMain
          ? wiki.mainBranch
          : worktree.branch
            ? titleOf(worktree.branch)
            : worktree.alias;
        return (
          <Fragment key={worktree.path}>
            <ul role="presentation">
              <WorktreeHeader
                repository={owner}
                worktree={worktree}
                label={label}
                expanded={expanded(worktree)}
                onToggle={() => toggle(worktree)}
                renderMenuItems={(changedFiles) =>
                  changeRequestId !== null && changedFiles !== null && changedFiles > 0 ? (
                    <MenuItem
                      onClick={async () => {
                        await saveWorktree({
                          environmentId: overview.environmentId,
                          input: {
                            wikiId: wiki.wikiId,
                            changeRequestId,
                            message: "Edits from the worktree",
                          },
                        });
                        refreshProjectWorktrees(owner);
                        refreshWorktreeChangedFilesSoon(owner, worktree.path);
                      }}
                    >
                      <SaveIcon />
                      Save edits to the change request
                    </MenuItem>
                  ) : null
                }
              />
            </ul>
            {expanded(worktree) ? (
              <WorktreeFiles
                key={`${overview.environmentId}:${worktree.path}`}
                owner={owner}
                worktree={worktree}
                projectName={`${wiki.name} · ${label}`}
                selectedPath={worktree.path === focusedWorktree?.path ? selectedPath : null}
                onOpenFile={(file) => openFile(worktree, file)}
              />
            ) : null}
          </Fragment>
        );
      })}
      <ul role="presentation" className="flex flex-col gap-px">
        <SetAsideRows repository={owner} setAside={listed.setAside} branchLabel={titleOf} />
      </ul>
    </div>
  );
}

/**
 * Puts one of a wiki's open change requests in a worktree, or opens a new change request there,
 * so several can be worked on side by side.
 */
export function WikiWorktreePicker({ overview }: { readonly overview: WikiOverview }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const openBranch = useOpenBranch();
  const openChangeRequest = useAtomCommand(wikiEnvironment.openChangeRequest);
  const target = worktreesOfWiki(overview);
  const changeRequests = (overview.changeRequests ?? []).filter(
    (changeRequest) => changeRequest.status === "open",
  );
  const needle = query.trim().toLowerCase();
  const shown = changeRequests.filter((changeRequest) =>
    changeRequest.title.toLowerCase().includes(needle),
  );
  const title = query.trim();
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const placeIn = async (changeRequestId: string) => {
    await openBranch(target, `cr/${changeRequestId}`);
    wikiView.set("tree");
  };
  return (
    <Combobox
      items={shown}
      filteredItems={shown}
      itemToStringLabel={(item: (typeof shown)[number]) => item.title}
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      value={null}
      onValueChange={(item: (typeof shown)[number] | null) => {
        if (!item) return;
        close();
        void placeIn(item.changeRequestId);
      }}
    >
      <ComboboxTrigger
        render={<SidebarHeaderIconButton label="Work on a change request in a worktree" />}
      >
        <GitBranchPlusIcon className="size-4" />
      </ComboboxTrigger>
      <ComboboxPopup align="end" className="min-w-56 max-w-[min(18rem,var(--available-width))]">
        <ComboboxSearchInput
          aria-label="Find or name a change request"
          placeholder="Find or name a change request..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No open change requests.</ComboboxEmpty>
        <ComboboxList>
          {(item: (typeof shown)[number]) => (
            <ComboboxItem key={item.changeRequestId} hideIndicator value={item}>
              <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
        <NewWorktreeSwitch />
        {title.length > 0 ? (
          <SidebarPickerFooter>
            <SidebarPickerAction
              icon={GitBranchPlusIcon}
              onClick={async () => {
                close();
                const opened = await openChangeRequest({
                  environmentId: overview.environmentId,
                  input: { wikiId: overview.wiki.wikiId, title },
                });
                if (opened._tag === "Success") await placeIn(opened.value.changeRequestId);
              }}
            >
              {`New change request “${title}” in a worktree`}
            </SidebarPickerAction>
          </SidebarPickerFooter>
        ) : null}
      </ComboboxPopup>
    </Combobox>
  );
}

function Note({ children }: { readonly children: string }) {
  return (
    <p role="status" className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
      {children}
    </p>
  );
}
