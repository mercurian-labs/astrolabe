import { focusedPane } from "~/panes/arrangement";
import { focusedChatOf, workspace } from "~/panes/workspace";
import { parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { readProject, readThreadShell } from "~/state/entities";
import { parseRepositoryTabKey, repositoryTabKey } from "../repositories/repositoryTabs";

/**
 * Astrolabe: the Git tab for the focused tab's checkout: a project tab's own, or the worktree a
 * chat (or a tab linked to it) works in. Null when the focused tab has none, as a wiki's has not.
 */
function focusedGitTabKey(): string | null {
  const linked = workspace.linked();
  const repository = parseRepositoryTabKey(focusedPane(linked.arrangement).active);
  if (repository !== null && "projectId" in repository) {
    const { environmentId, projectId } = repository;
    if ("checkout" in repository) {
      return repositoryTabKey({
        kind: "git",
        environmentId,
        projectId,
        checkout: repository.checkout,
      });
    }
    if ("cwd" in repository) {
      return repositoryTabKey({
        kind: "git",
        environmentId,
        projectId,
        checkout: { cwd: repository.cwd },
      });
    }
  }
  const chat = focusedChatOf(linked);
  const ref = chat === null ? null : parseChatTabKey(chat);
  const thread = ref === null ? null : readThreadShell(ref);
  if (thread === null) return null;
  const { environmentId, projectId } = thread;
  const cwd = thread.worktreePath ?? readProject({ environmentId, projectId })?.workspaceRoot;
  if (!cwd) return null;
  return repositoryTabKey({
    kind: "git",
    environmentId,
    projectId,
    checkout:
      thread.worktreePath !== null && thread.branch !== null ? { branch: thread.branch } : { cwd },
  });
}

/** Opens the focused tab's Git tab as a sidebar row would; null when it has no checkout. */
export function gitTabOpener(): (() => void) | null {
  const key = focusedGitTabKey();
  return key === null ? null : () => workspace.show(key);
}
