import type { ScopedThreadRef } from "@t3tools/contracts";

import { readProject, readThreadShell } from "~/state/entities";
import type { SectionTabMove } from "~/sectionTabs/SectionTabContent";
import { workspace } from "~/panes/workspace";
import { revealInRepositoryFilter } from "./repositoryFilter";
import { showWorktreeFiles, worktreeFilesKey } from "./repositoryScope";
import { repositoryTabKey, type RepositoryCheckout } from "./repositoryTabs";

/**
 * Astrolabe: "Open in Projects" for a thread's Files and Diffs, whose home is the
 * Repositories section: an open file opens there, on the thread's branch (in whichever worktree
 * holds it); Diffs opens its uncommitted changes; the file explorer opens the file trees. The
 * thread keeps its own tab, as its views are its own. Null for the panel's other surfaces.
 */
export function repositoryMoveOfSurface(
  threadRef: ScopedThreadRef | null,
  surfaceId: string | null,
): SectionTabMove | null {
  if (threadRef === null || surfaceId === null) return null;
  const path = surfaceId.startsWith("file:") ? surfaceId.slice("file:".length) : null;
  if (path === null && surfaceId !== "files" && surfaceId !== "diff") return null;
  return {
    label: "Open in Projects",
    run(navigate) {
      const thread = readThreadShell(threadRef);
      if (thread === null) return;
      const { environmentId, projectId } = thread;
      const cwd = thread.worktreePath ?? readProject({ environmentId, projectId })?.workspaceRoot;
      if (!cwd) return;
      const checkout: RepositoryCheckout =
        thread.worktreePath !== null && thread.branch !== null
          ? { branch: thread.branch }
          : { cwd };
      if (path !== null) {
        workspace.show(
          repositoryTabKey({ kind: "file", environmentId, projectId, checkout, path }),
        );
      } else if (surfaceId === "diff") {
        workspace.show(
          repositoryTabKey({
            kind: "diff",
            environmentId,
            projectId,
            checkout,
            source: "working-tree",
          }),
        );
      } else {
        // The tree has no tab to bring its worktree into view, so the filter makes room for it.
        revealInRepositoryFilter(
          `${environmentId}:${projectId}`,
          worktreeFilesKey(environmentId, cwd),
        );
        showWorktreeFiles(worktreeFilesKey(environmentId, cwd), true);
      }
      void navigate({ to: "/repositories" });
    },
  };
}
