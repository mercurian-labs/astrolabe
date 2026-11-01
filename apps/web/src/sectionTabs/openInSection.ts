import type { NavigateFn } from "@tanstack/react-router";

import { readPullRequestListPreferences } from "~/components/pullRequest/pullRequestListPreferences";
import {
  pullRequestTargetOfKey,
  type PullRequestTarget,
} from "~/components/pullRequest/pullRequestTabs";
import { workspace } from "~/panes/workspace";
import { showWikiTab } from "~/components/wiki/wikiPanes";
import { parseWikiTabKey } from "~/components/wiki/wikiTabs";
import { buildThreadRouteParams } from "~/threadRoutes";
import { parseChatTabKey, tabSection } from "./sectionTabs";

/**
 * A tab waiting for the Change Requests panes, which open it as they load: a pull request, by
 * what names it, or a wiki change request by its key.
 */
export type PendingChangeRequestTab =
  | { readonly kind: "pull-request"; readonly target: PullRequestTarget }
  | { readonly kind: "key"; readonly key: string };

let pending: PendingChangeRequestTab[] = [];

/** The tabs asked for since the Change Requests panes last showed, oldest first. */
export function takePendingChangeRequestTabs(): readonly PendingChangeRequestTab[] {
  const taken = pending;
  pending = [];
  return taken;
}

/**
 * Opens a tab in its own section and goes there: a chat in Agents (in the tab in front, as a
 * sidebar click shows it), a document in Wikis, a change request in Change Requests. A pull
 * request beside a thread is named by its thread (`pullRequest`), since its key leaves out the
 * server and host.
 */
export function openInSection(key: string, navigate: NavigateFn, pullRequest?: PullRequestTarget) {
  const chat = parseChatTabKey(key);
  if (chat !== null) {
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(chat) });
    return;
  }
  const wiki = parseWikiTabKey(key);
  if (wiki?.kind === "note") {
    showWikiTab(wiki);
    void navigate({ to: "/wikis" });
    return;
  }
  if (tabSection(key) === "repositories") {
    workspace.show(key);
    void navigate({ to: "/repositories" });
    return;
  }
  if (tabSection(key) !== "change-requests") return;
  const target = pullRequest ?? pullRequestTargetOfKey(key);
  pending.push(target ? { kind: "pull-request", target } : { kind: "key", key });
  void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() });
}
