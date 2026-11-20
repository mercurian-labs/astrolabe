import { findProjectForChangeRequest } from "@t3tools/client-runtime/change-request-links";
import { threadChangeRequestsTarget } from "@t3tools/client-runtime/changeGroups";
import type { ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";

import { activateTab } from "~/panes/arrangement";
import { openNear } from "~/panes/placement";
import { leafWithTab } from "~/panes/tree";
import { workspace } from "~/panes/workspace";
import { useRightPanelStore } from "~/rightPanelStore";
import { readChangeGroups } from "~/state/changeGroups";
import { readProjects, readThreadShell } from "~/state/entities";
import { changeGroupTabKey, type ChangeGroupTab } from "./changeGroupTabs";

/**
 * Astrolabe: a change group's tab, beside the chat, or in front where it is already open.
 * `ownPane` keeps it out of the focused pane, for a chat about to come to the front there.
 */
export function showChangeGroupTab(group: ChangeGroupTab, { ownPane = false } = {}) {
  const key = changeGroupTabKey(group);
  workspace.update((arrangement) =>
    leafWithTab(arrangement.root, key)
      ? activateTab(arrangement, key)
      : openNear(arrangement, key, arrangement.focused, { ownPane }),
  );
}

/**
 * Astrolabe: opens a thread's change requests (`threadChangeRequestsTarget`): its change group's
 * tab, or its one pull request. False when it has neither.
 */
export function openThreadChangeRequests(
  threadRef: ScopedThreadRef,
  options: { readonly ownPane?: boolean } = {},
): boolean {
  const thread = readThreadShell(threadRef);
  if (thread === null) return false;
  const target = threadChangeRequestsTarget({
    groups: readChangeGroups(),
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    pullRequests: thread.pullRequests,
  });
  if (target === null) return false;
  if (target.kind === "group") {
    showChangeGroupTab(target.group, options);
    return true;
  }
  openThreadPullRequest(threadRef, target.link);
  return true;
}

/** Astrolabe: one of a thread's linked pull requests, in the thread's pull request tab. */
export function openThreadPullRequest(threadRef: ScopedThreadRef, link: ThreadPullRequestLink) {
  const projects = readProjects().filter(
    (project) => project.environmentId === threadRef.environmentId,
  );
  const projectId =
    findProjectForChangeRequest(projects, link)?.id ?? readThreadShell(threadRef)?.projectId;
  if (projectId === undefined) return;
  useRightPanelStore.getState().openPullRequest(threadRef, {
    projectId,
    host: link.host,
    repository: link.repository,
    number: link.number,
    url: link.url,
  });
}
