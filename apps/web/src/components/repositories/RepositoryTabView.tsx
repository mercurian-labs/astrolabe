import { FileCodeIcon, FileDiffIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { reviewEnvironment } from "~/state/review";
import type { PaneTabLabel } from "~/panes/panesHost";
import { useListedProjectWorktrees, useProjectWorktrees } from "~/state/worktrees";
import { getProjectFileQueryAtom } from "../files/projectFilesQueryState";
import { Button } from "../ui/button";

import { diffPreviewInput, RepositoryDiffView } from "./RepositoryDiffView";
import { RepositoryFileView } from "./RepositoryFileView";
import {
  checkoutName,
  fileName,
  holderOf,
  parseRepositoryTabKey,
  type CheckedOutRepositoryTab,
  type RepositoryTab,
} from "./repositoryTabs";
import { useOpenBranch } from "./worktreeActions";
import { WorktreeNumber } from "./WorktreeNumber";

/** A file, or a checkout's changes. */
export function RepositoryTabView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: RepositoryTab;
}) {
  return (
    <CheckedOut tab={tab}>
      {(checkedOut) =>
        checkedOut.kind === "file" ? (
          <RepositoryFileView tabKey={tabKey} tab={checkedOut} />
        ) : (
          <RepositoryDiffView tab={checkedOut} />
        )
      }
    </CheckedOut>
  );
}

/**
 * A branch's tab reads the worktree that holds the branch now. When none does, it says so and
 * offers to open the branch, rather than show a folder that has since taken another branch.
 */
function CheckedOut({
  tab,
  children,
}: {
  readonly tab: RepositoryTab;
  readonly children: (tab: CheckedOutRepositoryTab) => ReactNode;
}) {
  const worktrees = useProjectWorktrees({
    environmentId: tab.environmentId,
    projectId: tab.projectId,
  });
  const openBranch = useOpenBranch();
  const [opening, setOpening] = useState(false);
  const { checkout } = tab;
  const holder = worktrees ? holderOf(worktrees.worktrees, checkout) : null;
  const cwd = "cwd" in checkout ? checkout.cwd : (holder?.path ?? null);
  const revision = holder?.head ?? null;
  const seen = useRef({ cwd, revision });
  // oxlint-disable-next-line t3code/react-effect-budget -- a reused worktree changes files under the same folder; its new commit re-reads what this tab shows
  useEffect(() => {
    const before = seen.current;
    seen.current = { cwd, revision };
    if (cwd === null || before.cwd !== cwd || before.revision === revision) return;
    if (tab.kind === "file") {
      appAtomRegistry.refresh(getProjectFileQueryAtom(tab.environmentId, cwd, tab.path));
    } else {
      appAtomRegistry.refresh(
        reviewEnvironment.diffPreview({
          environmentId: tab.environmentId,
          input: diffPreviewInput(cwd, tab.base),
        }),
      );
    }
  }, [cwd, revision, seen, tab]);
  if (cwd !== null) return children({ ...tab, cwd, checkoutName: checkoutName(checkout, holder) });
  if (worktrees === null || "cwd" in checkout) return null;
  const named = checkout.branch;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <p role="status">{named} is not checked out in any worktree.</p>
      <Button
        size="sm"
        variant="outline"
        disabled={opening}
        onClick={async () => {
          setOpening(true);
          await openBranch(tab, named);
          setOpening(false);
        }}
      >
        <GitBranchIcon />
        {opening ? "Opening…" : `Open ${named}`}
      </Button>
    </div>
  );
}

/**
 * A repository tab's title and icon, a file's name or a checkout's changes, with the number of the
 * worktree holding it now; hovering it names the checkout.
 */
export function useRepositoryTabLabel(tabKey: string): PaneTabLabel | null {
  const tab = parseRepositoryTabKey(tabKey);
  const listed = useListedProjectWorktrees(
    tab === null ? null : { environmentId: tab.environmentId, projectId: tab.projectId },
  );
  if (tab === null) return null;
  const holder = listed ? holderOf(listed.worktrees, tab.checkout) : null;
  const label =
    tab.kind === "file"
      ? { title: fileName(tab.path), icon: <FileCodeIcon className="size-3.5 shrink-0" /> }
      : {
          title:
            tab.source === "working-tree"
              ? "Uncommitted changes"
              : tab.base === undefined
                ? "Branch changes"
                : `Against ${tab.base}`,
          icon: <FileDiffIcon className="size-3.5 shrink-0" />,
        };
  const place =
    holder === null
      ? listed === null
        ? null
        : "not in a worktree"
      : holder.number === null
        ? "main checkout"
        : `worktree ${holder.number}`;
  return {
    ...label,
    ...(holder?.number ? { accessory: <WorktreeNumber number={holder.number} /> } : {}),
    tooltip: (
      <div className="flex flex-col">
        <span className={tab.kind === "file" ? "font-mono" : undefined}>
          {tab.kind === "file" ? tab.path : label.title}
        </span>
        <span className="text-muted-foreground">
          {[checkoutName(tab.checkout, holder), place].filter(Boolean).join(" · ")}
        </span>
      </div>
    ),
  };
}
