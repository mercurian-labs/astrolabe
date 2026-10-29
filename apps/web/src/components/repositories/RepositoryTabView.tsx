import { FileCodeIcon, FileDiffIcon, GitBranchIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useProjectWorktrees } from "~/state/worktrees";
import { Button } from "../ui/button";

import { RepositoryDiffView } from "./RepositoryDiffView";
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
  const branch = "branch" in tab.checkout ? tab.checkout.branch : null;
  const worktrees = useProjectWorktrees(
    branch === null ? null : { environmentId: tab.environmentId, projectId: tab.projectId },
  );
  const openBranch = useOpenBranch();
  const [opening, setOpening] = useState(false);
  if ("cwd" in tab.checkout) return children({ ...tab, cwd: tab.checkout.cwd });
  if (worktrees === null) return null;
  const named = tab.checkout.branch;
  const holder = worktrees.worktrees.find((worktree) => worktree.branch === named);
  if (holder) return children({ ...tab, cwd: holder.path });
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
        title: tab.source === "working-tree" ? "Uncommitted changes" : "Branch changes",
        icon: <FileDiffIcon className="size-3.5 shrink-0" />,
      };
  }
}
