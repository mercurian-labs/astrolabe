import type { ProjectWorktree } from "@t3tools/contracts";

import {
  refreshProjectWorktrees,
  worktreeEnvironment,
  worktreeOwner,
  type WorktreesTarget,
} from "~/state/worktrees";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";
import { openInNewWorktree } from "./repositoryScope";

/** Whether the person asked for a worktree of its own for every branch they open. */
const newWorktree = () => openInNewWorktree.get() === "new";

/**
 * Puts a branch in a worktree (its own, else a free one unless the person asked for a new one,
 * else a new one) and says what became of work it had set aside. The worktree, or null when it
 * could not be opened.
 */
export function useOpenBranch() {
  const open = useAtomCommand(worktreeEnvironment.open);
  return async (repository: WorktreesTarget, branch: string): Promise<ProjectWorktree | null> => {
    const result = await open({
      environmentId: repository.environmentId,
      input: { ...worktreeOwner(repository), branch, newWorktree: newWorktree() },
    });
    refreshProjectWorktrees(repository);
    if (result._tag !== "Success") return null;
    if (result.value.setAside === "restored") {
      toastManager.add({ type: "success", title: `Work set aside on ${branch} is back` });
    } else if (result.value.setAside === "stale") {
      toastManager.add({
        type: "warning",
        title: `${branch} has moved on since its work was set aside`,
        description: "The set-aside work is kept. Find it under the repository's worktrees.",
      });
    }
    return result.value.worktree;
  };
}

/** Makes a new branch from `base` in a free worktree, or a new one (always, when asked). */
export function useCreateWorktree() {
  const create = useAtomCommand(worktreeEnvironment.create);
  return async (repository: WorktreesTarget, branch: string, base: string) => {
    const result = await create({
      environmentId: repository.environmentId,
      input: { ...worktreeOwner(repository), branch, base, newWorktree: newWorktree() },
    });
    refreshProjectWorktrees(repository);
    return result._tag === "Success" ? result.value : null;
  };
}
