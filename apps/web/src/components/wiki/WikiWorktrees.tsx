import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import type { ProjectWorktree, WikiChangeRequestId } from "@t3tools/contracts";
import { GitBranchPlusIcon, SaveIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { openTab } from "~/panes/arrangement";
import { useWorkspaceOpenKeys } from "~/panes/workspace";
import { useAtomCommand } from "~/state/use-atom-command";
import { wikiEnvironment } from "~/state/wiki";
import {
  refreshProjectWorktrees,
  refreshWorktreeChangedFilesSoon,
  useProjectWorktrees,
  type WorktreesTarget,
} from "~/state/worktrees";
import { parseRepositoryTabKey, repositoryTabKey } from "../repositories/repositoryTabs";
import {
  FoldedWorktrees,
  NewWorktreeSwitch,
  SetAsideRows,
  WorktreeFiles,
  WorktreeHeader,
  WorktreeRows,
  WorktreesUnread,
} from "../repositories/RepositoryWorktrees";
import {
  storedWorktreeFiles,
  worktreeFilesKey,
  worktreeFilesShown,
} from "../repositories/repositoryScope";
import { checkoutTag, foldWorktrees } from "../repositories/worktreeFolding";
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
import { isCanvasName, isDocumentFile, wikiTerms } from "./wiki.logic";
import { showWikiTab, wikiPanes } from "./wikiPanes";
import { changeRequestBranch, parseWikiTabKey, type WikiTab } from "./wikiTabs";

/** Astrolabe: each wiki worktree shows its documents unless someone switched it to its files. */
const wikiWorktreeFiles = storedWorktreeFiles("astrolabe:wiki-worktree-files:v1");

const CHANGE_REQUEST_BRANCH = /^cr\/(.+)$/;

/** The change request a worktree's branch is, if it is one. */
const changeRequestOf = (branch: string | null) =>
  branch === null
    ? null
    : ((CHANGE_REQUEST_BRANCH.exec(branch)?.[1] as WikiChangeRequestId | undefined) ?? null);

/** A wiki's worktree as its sidebar names it: the main branch, else its change request's title. */
export function wikiWorktreeLabel(overview: WikiOverview, worktree: ProjectWorktree): string {
  if (worktree.isMain) return overview.wiki.mainBranch;
  if (worktree.branch === null) return worktree.alias;
  const changeRequestId = changeRequestOf(worktree.branch);
  return (
    overview.changeRequests?.find((entry) => entry.changeRequestId === changeRequestId)?.title ??
    worktree.branch
  );
}

/** A wiki's worktrees: those of the repository in its own folder. */
export const worktreesOfWiki = (overview: WikiOverview): WorktreesTarget => ({
  environmentId: overview.environmentId,
  wikiId: overview.wiki.wikiId,
});

/**
 * A wiki's worktrees as Projects lists a repository's: each under its change request's title (its
 * main line under the main branch), showing its documents (`renderRows`) or its file tree. A note
 * clicked in a tree opens as the wiki's own tab, read from that worktree's change request; any
 * other file opens as a file. The main line and the focused tab's worktree start open.
 */
export function WikiWorktreeSections({
  overview,
  focused,
  hidden,
  showHidden,
  renderRows,
}: {
  readonly overview: WikiOverview;
  readonly focused: WikiTab | null;
  /** Worktree keys the filter hides; the focused tab's shows anyway, marked. */
  readonly hidden: ReadonlyArray<string>;
  /** Whether files and folders starting with a dot show, here as in the document tree. */
  readonly showHidden: boolean;
  /** A worktree's documents: the main line's notes, or those its change request touches. */
  readonly renderRows: (
    worktree: ProjectWorktree,
    changeRequestId: WikiChangeRequestId | null,
  ) => ReactNode;
}) {
  const owner = worktreesOfWiki(overview);
  const { data: listed, error: readError } = useProjectWorktrees(owner);
  const filesChoices = wikiWorktreeFiles.useValue();
  const saveWorktree = useAtomCommand(wikiEnvironment.saveWorktree);
  const [now] = useState(() => Date.now());
  const openKeys = useWorkspaceOpenKeys();
  // Sections someone opened or closed; a worktree that takes the focus opens again.
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  if (listed === null) {
    return readError === null ? (
      <Note>Reading worktrees…</Note>
    ) : (
      <WorktreesUnread owner={owner} error={readError} />
    );
  }
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
    chosen.get(worktree.path) ?? (worktree.isMain || worktree.path === active?.path);
  const selectedPath = focusedHere?.kind === "note" ? focusedHere.file : null;
  const openFile = (worktree: ProjectWorktree, file: string) => {
    const changeRequestId = changeRequestOf(worktree.branch) ?? undefined;
    const onMainLine = worktree.isMain || worktree.branch === wiki.mainBranch;
    const opens = (/\.md$/i.test(file) || isCanvasName(file)) && isDocumentFile(file);
    if (opens && (onMainLine || changeRequestId !== undefined)) {
      showWikiTab({
        kind: "note",
        environmentId: overview.environmentId,
        wikiId: wiki.wikiId,
        file,
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
  // What the wiki's open tabs read: a change request's branch, or a file's checkout.
  const openCheckouts = new Set(
    openKeys.flatMap((key) => {
      const wikiTab = parseWikiTabKey(key);
      if (wikiTab !== null) {
        return wikiTab.environmentId === overview.environmentId &&
          wikiTab.wikiId === wiki.wikiId &&
          wikiTab.changeRequestId !== undefined
          ? [`branch:${changeRequestBranch(wikiTab.changeRequestId)}`]
          : [];
      }
      const fileTab = parseRepositoryTabKey(key);
      return fileTab !== null &&
        "wikiId" in fileTab &&
        fileTab.wikiId === wiki.wikiId &&
        fileTab.environmentId === overview.environmentId
        ? [checkoutTag(fileTab.checkout)]
        : [];
    }),
  );
  const shown = listed.worktrees.flatMap(
    (worktree): Array<{ readonly worktree: ProjectWorktree; readonly outside: boolean }> => {
      const outside = hidden.includes(worktreeFilesKey(overview.environmentId, worktree.path));
      return !outside || worktree.path === active?.path ? [{ worktree, outside }] : [];
    },
  );
  const { listed: listedEntries, rest } = foldWorktrees(shown, { openCheckouts, now });
  const section = (
    { worktree, outside }: { readonly worktree: ProjectWorktree; readonly outside: boolean },
    folded: boolean,
  ) => {
    const changeRequestId = changeRequestOf(worktree.branch);
    const label = wikiWorktreeLabel(overview, worktree);
    const open = folded ? (chosen.get(worktree.path) ?? false) : expanded(worktree);
    const filesKey = worktreeFilesKey(overview.environmentId, worktree.path);
    const files = worktreeFilesShown(filesChoices, filesKey, false);
    return (
      <Fragment key={worktree.path}>
        <ul role="presentation">
          <WorktreeHeader
            repository={owner}
            worktree={worktree}
            label={label}
            expanded={open}
            onToggle={() => setChosen((current) => new Map(current).set(worktree.path, !open))}
            outsideFilter={outside}
            folded={folded}
            filesShown={files}
            onToggleFiles={() => {
              wikiWorktreeFiles.set({ ...wikiWorktreeFiles.get(), [filesKey]: !files });
              setChosen((current) => new Map(current).set(worktree.path, true));
            }}
            rowsLabel="documents"
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
                  {`Save edits to the ${wikiTerms(wiki).singular}`}
                </MenuItem>
              ) : null
            }
          />
          {open && !files ? (
            <WorktreeRows>{renderRows(worktree, changeRequestId)}</WorktreeRows>
          ) : null}
        </ul>
        {open && files ? (
          <WorktreeFiles
            key={`${overview.environmentId}:${worktree.path}`}
            owner={owner}
            worktree={worktree}
            projectName={`${wiki.name} · ${label}`}
            selectedPath={worktree.path === focusedWorktree?.path ? selectedPath : null}
            onOpenFile={(file) => openFile(worktree, file)}
            hideDotFiles={!showHidden}
          />
        ) : null}
      </Fragment>
    );
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {listedEntries.map((entry) => section(entry, false))}
      <FoldedWorktrees
        ownerTitle={wiki.name}
        rest={rest}
        renderEntry={(entry) => section(entry, true)}
      />
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
  const terms = wikiTerms(overview.wiki);
  const changeRequests = (overview.changeRequests ?? []).filter(
    (changeRequest) => changeRequest.status === "open" && !changeRequest.draft,
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
        render={<SidebarHeaderIconButton label={`Work on a ${terms.singular} in a worktree`} />}
      >
        <GitBranchPlusIcon className="size-4" />
      </ComboboxTrigger>
      <ComboboxPopup align="end" className="min-w-56 max-w-[min(18rem,var(--available-width))]">
        <ComboboxSearchInput
          aria-label={`Find or name a ${terms.singular}`}
          placeholder={`Find or name a ${terms.singular}...`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>{`No open ${terms.plural}.`}</ComboboxEmpty>
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
              {`New ${terms.singular} “${title}” in a worktree`}
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
