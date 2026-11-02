import { useEffect } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import {
  refreshProjectWorktrees,
  worktreeEnvironment,
  worktreeOwner,
  type WorktreesTarget,
} from "~/state/worktrees";

/** Worktrees asked to be numbered in this window, so each tab showing one asks once. */
const numbering = new Set<string>();

/**
 * Astrolabe: numbers the worktree holding what a tab shows, the first time something of it opens
 * (a project's file or changes, a wiki change request's note); the server keeps the number.
 */
export function useNumberWhenOpened(
  target: WorktreesTarget | null,
  holder: {
    readonly path: string;
    readonly isMain: boolean;
    readonly number: number | null;
  } | null,
) {
  const markOpened = useAtomCommand(worktreeEnvironment.markOpened, { reportFailure: false });
  const path = holder !== null && !holder.isMain && holder.number === null ? holder.path : null;
  // oxlint-disable-next-line t3code/react-effect-budget -- a worktree is numbered the first time something of it opens, which the server keeps
  useEffect(() => {
    if (target === null || path === null || numbering.has(path)) return;
    numbering.add(path);
    void markOpened({
      environmentId: target.environmentId,
      input: { ...worktreeOwner(target), path },
    }).then(() => refreshProjectWorktrees(target));
  }, [markOpened, path, target]);
}
