import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { type NavigateFn, useNavigate } from "@tanstack/react-router";
import { FolderGit2Icon } from "lucide-react";

import { readProject, readThreadShell } from "~/state/entities";
import type { SectionTabMove } from "~/sectionTabs/SectionTabContent";
import { workspace } from "~/panes/workspace";
import { threadFileInCheckout } from "./fileView";
import { repositoryFileReveal } from "./repositoryFileReveal";
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
  line?: number | null,
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
        const tabKey = repositoryTabKey({ kind: "file", environmentId, projectId, checkout, path });
        workspace.show(tabKey);
        if (line != null) repositoryFileReveal.request(tabKey, line);
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

/**
 * Astrolabe: opens a file of a checkout (a thread's working tree, or the repository's own) in a
 * Projects tab of that folder, asking it to show `line`.
 */
export function openRepositoryFileAtLine(
  target: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly cwd: string;
    readonly path: string;
    readonly line: number;
  },
  navigate: NavigateFn,
) {
  const { environmentId, projectId, cwd, path } = target;
  const tabKey = repositoryTabKey({
    kind: "file",
    environmentId,
    projectId,
    checkout: { cwd },
    path,
  });
  workspace.show(tabKey);
  repositoryFileReveal.request(tabKey, target.line);
  void navigate({ to: "/repositories" });
}

/** Astrolabe: the thread file panel's "Open in Projects", its open-in picker's primary action. */
export function useThreadFileOpen(
  threadRef: ScopedThreadRef,
  draft: boolean,
  cwd: string,
  absolutePath: string | null,
  isFile: boolean,
  line: number | null,
) {
  const navigate = useNavigate();
  const path = threadFileInCheckout(draft, cwd, absolutePath, isFile);
  if (path === null) return null;
  return {
    label: "Projects",
    Icon: FolderGit2Icon,
    open: () => repositoryMoveOfSurface(threadRef, `file:${path}`, line)?.run(navigate),
  };
}
