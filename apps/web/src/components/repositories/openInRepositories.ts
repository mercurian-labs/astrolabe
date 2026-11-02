import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import type { NavigateFn } from "@tanstack/react-router";

import { readProject, readThreadShell } from "~/state/entities";
import type { SectionTabMove } from "~/sectionTabs/SectionTabContent";
import { workspace } from "~/panes/workspace";
import { repositoryFileReveal } from "./repositoryFileReveal";
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

/**
 * Astrolabe: opens a file of a checkout (a thread's working tree, or the repository's own when
 * `worktreePath` is null) in a Repositories tab, asking it to show `line`.
 */
export function openRepositoryFileAtLine(
  target: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly cwd: string;
    readonly worktreePath: string | null;
    readonly path: string;
    readonly line: number;
  },
  navigate: NavigateFn,
) {
  const { environmentId, projectId, cwd, path } = target;
  const tabKey = repositoryTabKey({ kind: "file", environmentId, projectId, cwd, path });
  repositoryScope.set(`${environmentId}:${projectId}`);
  repositoryCheckout.set(target.worktreePath);
  workspace.show(tabKey);
  repositoryFileReveal.request(tabKey, target.line);
  void navigate({ to: "/repositories" });
}
