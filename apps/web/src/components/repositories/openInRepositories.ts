import type { ScopedThreadRef } from "@t3tools/contracts";

import { readProject, readThreadShell } from "~/state/entities";
import type { SectionTabMove } from "~/sectionTabs/SectionTabContent";
import { workspace } from "~/panes/workspace";
import { repositoryCheckout, repositoryScope, repositoryView } from "./repositoryScope";
import { repositoryTabKey } from "./repositoryTabs";

/**
 * Astrolabe: "Open in Projects" for a thread's Files and Diffs, whose home is the
 * Repositories section: an open file opens there, on the thread's checkout; Diffs opens the
 * checkout's uncommitted changes; the file explorer opens the checkout's file tree. The thread
 * keeps its own tab, as its views are its own. Null for the panel's other surfaces.
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
      repositoryScope.set(`${environmentId}:${projectId}`);
      repositoryCheckout.set(thread.worktreePath);
      if (path !== null) {
        workspace.show(repositoryTabKey({ kind: "file", environmentId, projectId, cwd, path }));
      } else if (surfaceId === "diff") {
        workspace.show(
          repositoryTabKey({ kind: "diff", environmentId, projectId, cwd, source: "working-tree" }),
        );
      } else {
        repositoryView.set("tree");
      }
      void navigate({ to: "/repositories" });
    },
  };
}
