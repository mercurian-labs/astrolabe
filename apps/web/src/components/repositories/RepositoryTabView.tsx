import { FileCodeIcon, FileDiffIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { reviewEnvironment } from "~/state/review";
import { useProjectWorktrees } from "~/state/worktrees";
import { getProjectFileQueryAtom } from "../files/projectFilesQueryState";
import { Button } from "../ui/button";

import { diffPreviewInput, RepositoryDiffView } from "./RepositoryDiffView";
import { RepositoryFileView } from "./RepositoryFileView";
import {
  fileName,
  parseRepositoryTabKey,
  type CheckedOutRepositoryTab,
  type RepositoryTab,
} from "./repositoryTabs";
import { useOpenBranch } from "./worktreeActions";

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
  const holder =
    worktrees?.worktrees.find((worktree) =>
      "branch" in checkout ? worktree.branch === checkout.branch : worktree.path === checkout.cwd,
    ) ?? null;
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
  }, [cwd, revision, tab]);
  if (cwd !== null) return children({ ...tab, cwd });
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

/** A repository tab's title and icon: a file's name, or a checkout's changes. */
export function repositoryTabLabel(tabKey: string): { title: string; icon: ReactNode } | null {
  const tab = parseRepositoryTabKey(tabKey);
  if (tab === null) return null;
  switch (tab.kind) {
    case "file":
      return { title: fileName(tab.path), icon: <FileCodeIcon className="size-3.5 shrink-0" /> };
    case "diff":
      return {
        title:
          tab.source === "working-tree"
            ? "Uncommitted changes"
            : tab.base === undefined
              ? "Branch changes"
              : `Against ${tab.base}`,
        icon: <FileDiffIcon className="size-3.5 shrink-0" />,
      };
  }
}
