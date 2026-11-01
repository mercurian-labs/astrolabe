import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { EnvironmentId, ProjectId, type PullRequestAction } from "@t3tools/contracts";

import { surfaceKey } from "~/panes/arrangement";
import { focusedPaneOf, isPaneMaximized, toggleMaximizedPane } from "~/panes/paneCommands";
import type { PaneArrangementStore } from "~/panes/panesHost";
import type { Side } from "~/panes/tree";
import { workspace, WORKSPACE_LAYOUT_KEY } from "~/panes/workspace";
import { pullRequestSurfaceId } from "~/rightPanelStore";
import { readProject } from "~/state/entities";
import type { RowClickIntent } from "~/tabNavigation.logic";
import type { FullPullRequestTarget, PullRequestTarget } from "./pullRequestTabs";

/**
 * Astrolabe: Changes opens its pull requests and change requests as tabs of the shared panes, as
 * Wikis and Repositories do. A pull request's tab names it in full (server and host), so it reads
 * on its own in any pane and after a reload (`pullRequestTargetOfKey`).
 */

/** A pull request's tab key; null when its server or host cannot be told. */
export function pullRequestTabKey(target: PullRequestTarget): string | null {
  const { environmentId } = target;
  if (!environmentId) return null;
  const host = target.host ?? projectHost(environmentId, target.projectId);
  if (!host) return null;
  return surfaceKey(pullRequestSurfaceId({ ...target, environmentId, host }));
}

function projectHost(environmentId: string, projectId: string): string | null {
  const identity = readProject(
    scopeProjectRef(EnvironmentId.make(environmentId), ProjectId.make(projectId)),
  )?.repositoryIdentity;
  return identity
    ? (sourceControlClients.changeRequestHost(identity, identity.provider) ?? null)
    : null;
}

/**
 * Shows a tab as a sidebar row's click asks: in the focused pane's tab in front (`replace`, which
 * remembers what it showed), else a new tab; one open already comes to the front.
 */
export function showChangeRequestTab(key: string, intent: RowClickIntent) {
  if (intent === "replace") workspace.show(key);
  else workspace.open(key);
}

export function showPullRequest(target: PullRequestTarget, intent: RowClickIntent) {
  const key = pullRequestTabKey(target);
  if (key !== null) showChangeRequestTab(key, intent);
}

/** Opens tabs dragged from the sidebar where they land on `paneId`, `front` in front. */
export function placeChangeRequestTabs(
  keys: readonly string[],
  front: string,
  paneId: string,
  drop: { readonly side: Side | null; readonly index: number },
) {
  workspace.place(keys, front, paneId, drop);
}

export function placePullRequests(
  targets: readonly PullRequestTarget[],
  front: PullRequestTarget,
  paneId: string,
  drop: { readonly side: Side | null; readonly index: number },
) {
  const keys = targets.flatMap((target) => pullRequestTabKey(target) ?? []);
  const frontKey = pullRequestTabKey(front) ?? keys[0];
  if (frontKey !== undefined) placeChangeRequestTabs(keys, frontKey, paneId, drop);
}

/**
 * A review's Guide gets the window for its tour, as T3 Code hid the pull request list for it: when
 * `tabKey` is the focused pane's front tab, `hideList` folds the sidebar away and the pane is
 * maximized if others share the area. As in T3 Code, nothing comes back as the tour leaves.
 */
export function maximizeForGuide(
  tabKey: string,
  hideList: () => void,
  panes: PaneArrangementStore = workspace.store,
) {
  const focused = focusedPaneOf(panes);
  if (!focused || focused.leaf.active !== tabKey) return;
  hideList();
  const paneId = focused.leaf.id;
  if (focused.alone || isPaneMaximized(WORKSPACE_LAYOUT_KEY, paneId)) return;
  toggleMaximizedPane(panes, WORKSPACE_LAYOUT_KEY, paneId);
}

/** What the Changes list lends its pull requests' tabs while it shows. */
export interface ChangesList {
  /** A review in a tab acted on its pull request, so the list's row can follow. */
  readonly acted: (
    target: FullPullRequestTarget,
    action: PullRequestAction | undefined,
    phase: "sent" | "done" | "failed",
  ) => void;
  /** Folds the sidebar away for a review's Guide. */
  readonly foldForGuide: () => void;
}

let list: ChangesList | null = null;

export function attachChangesList(next: ChangesList): () => void {
  list = next;
  return () => {
    if (list === next) list = null;
  };
}

export function pullRequestActed(...args: Parameters<ChangesList["acted"]>) {
  list?.acted(...args);
}

/** A review's Guide showed in the tab `tabKey`; on Changes, the sidebar folds away for it. */
export function guideShown(tabKey: string) {
  maximizeForGuide(tabKey, () => list?.foldForGuide());
}
