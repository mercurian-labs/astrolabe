import { ChangeGroupView } from "~/components/changeRequests/groups/ChangeGroupView";
import {
  changeGroupTabKey,
  parseChangeGroupTabKey,
} from "~/components/changeRequests/groups/changeGroupTabs";
import { useChangeGroupTabLabel } from "~/components/changeRequests/groups/useChangeGroupTabLabel";
import { parseRepositoryTabKey } from "~/components/repositories/repositoryTabs";
import { RepositoryTabView, repositoryTabLabel } from "~/components/repositories/RepositoryTabView";
import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import type { NavigateFn } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import ChatView from "~/components/ChatView";
import { PullRequestDetailPanel } from "~/components/pullRequest/PullRequestDetailPanel";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { guideShown, pullRequestActed } from "~/components/pullRequest/pullRequestWorkspace";
import {
  pullRequestTargetOfKey,
  type FullPullRequestTarget,
} from "~/components/pullRequest/pullRequestTabs";
import { useWikiTabLabel, WikiTabView, type WikiTabNav } from "~/components/wiki/WikiTabView";
import { parseWikiTabKey } from "~/components/wiki/wikiTabs";
import { isElectron } from "~/env";
import { isTerminalFocused } from "~/lib/terminalFocus";
import {
  activateTab,
  focusedPane,
  openBeside,
  openTab,
  placeTabs,
  replaceTab,
  surfaceKey,
  type Arrangement,
} from "~/panes/arrangement";
import type { PaneArrangementStore } from "~/panes/panesHost";
import { workspace } from "~/panes/workspace";
import { leafWithTab } from "~/panes/tree";
import { pullRequestSurface } from "~/rightPanelStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useThreadShell } from "~/state/entities";
import { chatTabKey, parseChatTabKey } from "./sectionTabs";

/** An arrangement showing `key`: brought forward where it is, else opened in the focused pane. */
export function showKeyIn(
  arrangement: Arrangement,
  key: string,
  placement: "tab" | "beside" = "tab",
): Arrangement {
  if (leafWithTab(arrangement.root, key)) return activateTab(arrangement, key);
  return placement === "beside"
    ? openBeside(arrangement, key, arrangement.focused, "right")
    : openTab(arrangement, key, arrangement.focused);
}

/** Where a wiki tab's links lead: into the same panes, each tab standing on its own. */
function paneTabNav(
  store: PaneArrangementStore,
  openPullRequest?: (target: FullPullRequestTarget) => void,
): WikiTabNav {
  const open = (key: string, placement: "tab" | "beside" = "tab") =>
    store.update((arrangement) => showKeyIn(arrangement, key, placement));
  return {
    // A pull request opens beside, named in full so its tab reads on its own.
    openPullRequest:
      openPullRequest ?? ((target) => open(surfaceKey(pullRequestSurface(target).id), "beside")),
    open,
    replace: (from, key) =>
      store.update((arrangement) =>
        leafWithTab(arrangement.root, key)
          ? activateTab(arrangement, key)
          : replaceTab(arrangement, from, key),
      ),
    openThread: (ref: ScopedThreadRef) =>
      store === workspace.store
        ? workspace.openChatsBesideFront([chatTabKey(ref)])
        : store.update((arrangement) => showKeyIn(arrangement, chatTabKey(ref), "beside")),
  };
}

/** "Open in <section>" for a tab whose home section has more to show of it. */
export interface SectionTabMove {
  readonly label: string;
  readonly run: (navigate: NavigateFn) => void;
}

/** The title and icon of a chat, document or pull request tab; null for any other key. */
export function useSectionTabLabel(key: string): { title: string; icon: ReactNode } | null {
  const chat = parseChatTabKey(key);
  const thread = useThreadShell(chat);
  const wikiLabel = useWikiTabLabel(key);
  const repositoryLabel = repositoryTabLabel(key);
  const groupLabel = useChangeGroupTabLabel(key);
  if (repositoryLabel !== null) return repositoryLabel;
  if (groupLabel !== null) return groupLabel;
  if (chat !== null) {
    return {
      title: thread?.title ?? "Thread",
      icon: <MessageSquareIcon className="size-3.5 shrink-0" />,
    };
  }
  if (parseWikiTabKey(key) !== null) return wikiLabel;
  const pullRequest = pullRequestTargetOfKey(key);
  if (pullRequest !== null) {
    return {
      title: `#${pullRequest.number} ${pullRequest.repository}`,
      icon: <PullRequestGlyph.pullRequest className="size-3.5 shrink-0" />,
    };
  }
  return null;
}

/**
 * A chat, document, change group or pull request in a set of panes. `store` is those panes, where
 * a document's links lead. `active` says the tab is its pane's front tab in the focused pane, so
 * its shortcuts listen.
 */
export function SectionTabContent({
  tabKey,
  store,
  active,
  openPullRequest,
  openAll,
}: {
  readonly tabKey: string;
  readonly store: PaneArrangementStore;
  readonly active: boolean;
  /** Where a change request's pull request opens, for panes that hold them their own way. */
  readonly openPullRequest?: (target: FullPullRequestTarget) => void;
  /** How tabs open together (a change group's tab group), for panes that hold them their own way. */
  readonly openAll?: (keys: ReadonlyArray<string>, group: EnvironmentChangeGroup) => void;
}) {
  const chat = parseChatTabKey(tabKey);
  if (chat !== null) return <PaneChat threadRef={chat} />;
  const repository = parseRepositoryTabKey(tabKey);
  if (repository !== null) return <RepositoryTabView tabKey={tabKey} tab={repository} />;
  const group = parseChangeGroupTabKey(tabKey);
  if (group !== null) {
    const shared = store === workspace.store;
    return (
      <ChangeGroupView
        tab={group}
        open={(key) => {
          // In the shared panes a thread opens after the chat in front, and the rest beside it.
          const thread = shared ? parseChatTabKey(key) : null;
          if (thread !== null) workspace.openChatsBesideFront([chatTabKey(thread)]);
          else store.update((arrangement) => showKeyIn(arrangement, key, "beside"));
        }}
        openAll={
          openAll ??
          (shared
            ? openTabGroup
            : (keys) =>
                store.update((arrangement) => {
                  const pane = focusedPane(arrangement);
                  const [front] = keys;
                  if (front === undefined) return arrangement;
                  const index = Math.max(0, pane.tabs.indexOf(front));
                  return placeTabs(arrangement, keys, pane.id, { side: null, index }, front);
                }))
        }
      />
    );
  }
  const wiki = parseWikiTabKey(tabKey);
  if (wiki !== null) {
    return <WikiTabView tabKey={tabKey} tab={wiki} nav={paneTabNav(store, openPullRequest)} />;
  }
  const pullRequest = pullRequestTargetOfKey(tabKey);
  if (pullRequest !== null) {
    return <PanePullRequest tabKey={tabKey} target={pullRequest} store={store} active={active} />;
  }
  return null;
}

/**
 * A change group's **Open as a tab group** in the shared panes. Its threads open as chats after
 * the chat in front, which stays in front; the rest open linked to the group beside it, so they
 * show beside every thread of the group and none other. Beside a chat outside the group they
 * stand on their own, together in one pane beside it.
 */
function openTabGroup(keys: ReadonlyArray<string>, group: EnvironmentChangeGroup) {
  const chats = keys.flatMap((key) => {
    const ref = parseChatTabKey(key);
    return ref ? [chatTabKey(ref)] : [];
  });
  if (chats.length > 0) workspace.openChatsBesideFront(chats);
  const front = workspace.linked().front;
  const groupKey = changeGroupTabKey(group);
  const inGroup =
    front !== null &&
    group.threadIds.some(
      (threadId) =>
        chatTabKey(scopeThreadRef(group.environmentId, ThreadId.make(threadId))) === front,
    );
  let beside = true;
  for (const key of keys) {
    if (parseChatTabKey(key) !== null) continue;
    if (inGroup) workspace.openLinked(key, groupKey);
    else workspace.open(key, beside ? "beside" : "tab");
    beside = false;
  }
}

/**
 * A thread's chat in a pane: its tab is the pane's, and its surfaces are tabs linked to it
 * (`LinkedPanel`). A thread with a draft shows the draft, as the draft's route does, until the
 * draft becomes the thread; one unkeyed ChatView carries the chat through that change.
 */
export function PaneChat({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const draftId = useComposerDraftStore((store) => store.getDraftIdByRef(threadRef));
  return draftId ? (
    <ChatView
      draftId={draftId}
      environmentId={threadRef.environmentId}
      threadId={threadRef.threadId}
      routeKind="draft"
      reserveTitleBarControlInset={false}
      forceExpandedMobileComposer
    />
  ) : (
    <ChatView
      environmentId={threadRef.environmentId}
      threadId={threadRef.threadId}
      routeKind="server"
      reserveTitleBarControlInset={false}
    />
  );
}

function shortcutContext() {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    modelPickerOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

/**
 * A pull request in a pane; one picked inside it replaces it. Its Guide's tour takes the window
 * (`guideShown`), and what it does to the pull request reaches the Changes list.
 */
function PanePullRequest({
  tabKey,
  target,
  store,
  active,
}: {
  readonly tabKey: string;
  readonly target: FullPullRequestTarget;
  readonly store: PaneArrangementStore;
  readonly active: boolean;
}) {
  return (
    <PullRequestDetailPanel
      environmentId={target.environmentId as ScopedThreadRef["environmentId"]}
      shortcutsEnabled={active}
      getShortcutContext={shortcutContext}
      tabOnPage
      onGuideShown={() => guideShown(tabKey)}
      onActed={(action, phase = "done") => pullRequestActed(target, action, phase)}
      reference={{
        projectId: target.projectId as ProjectId,
        repository: target.repository,
        number: target.number,
        host: target.host,
      }}
      onSelectPullRequest={(reference) => {
        const next = surfaceKey(
          pullRequestSurface({
            environmentId: target.environmentId,
            projectId: reference.projectId,
            host: reference.host ?? target.host,
            repository: reference.repository,
            number: reference.number,
          }).id,
        );
        store.update((arrangement) =>
          leafWithTab(arrangement.root, next)
            ? activateTab(arrangement, next)
            : replaceTab(arrangement, tabKey, next),
        );
      }}
    />
  );
}
