import type { ScopedThreadRef } from "@t3tools/contracts";

import { readProject, readThreadShell } from "~/state/entities";
import type { SectionTabMove } from "~/sectionTabs/SectionTabContent";
import { repositoryPanes } from "./repositoryPanes";
import { repositoryScope, repositoryView } from "./repositoryScope";
import { repositoryTabKey, type RepositoryCheckout } from "./repositoryTabs";

/**
 * Astrolabe: "Open in Repositories" for a thread's Files and Diffs, whose home is the
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
    label: "Open in Repositories",
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
      repositoryScope.set(`${environmentId}:${projectId}`);
      if (path !== null) {
        repositoryPanes.show(
          repositoryTabKey({ kind: "file", environmentId, projectId, checkout, path }),
        );
      } else if (surfaceId === "diff") {
        repositoryPanes.show(
          repositoryTabKey({
            kind: "diff",
            environmentId,
            projectId,
            checkout,
            source: "working-tree",
          }),
        );
      } else {
        repositoryView.set("tree");
      }
      void navigate({ to: "/repositories" });
    },
  };
}
