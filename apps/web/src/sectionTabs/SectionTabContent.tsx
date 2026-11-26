/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { ChangeGroupView } from "~/components/changeRequests/groups/ChangeGroupView";
import {
  changeGroupTabKey,
  parseChangeGroupTabKey,
} from "~/components/changeRequests/groups/changeGroupTabs";
import { useChangeGroupTabLabel } from "~/components/changeRequests/groups/useChangeGroupTabLabel";
import { parseRepositoryTabKey } from "~/components/repositories/repositoryTabs";
import {
  RepositoryTabView,
  useRepositoryTabLabel,
} from "~/components/repositories/RepositoryTabView";
import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Link, useLocation, type NavigateFn } from "@tanstack/react-router";
import { T } from "gt-react";
import { MessageSquareIcon } from "lucide-react";

import ChatView from "~/components/ChatView";
import { HiddenThreadContext } from "~/components/chat/backgroundThread";
import { isAppModalPage } from "~/components/sidebar/mainAppLocation";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { PullRequestDetailPanel } from "~/components/pullRequest/PullRequestDetailPanel";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import {
  guideShown,
  pullRequestActed,
  settlePullRequestTabReveal,
  usePullRequestTabReveals,
} from "~/components/pullRequest/pullRequestWorkspace";
import {
  pullRequestTargetOfKey,
  type FullPullRequestTarget,
} from "~/components/pullRequest/pullRequestTabs";
import { LegacyWikiTab, useLegacyWikiTabLabel } from "~/components/wiki/LegacyWikiTab";
import { parseWikiTabKey } from "~/components/wiki/wikiTabs";
import { isElectron } from "~/env";
import { isTerminalFocused } from "~/lib/terminalFocus";
import {
  activateTab,
  focusedPane,
  openTab,
  placeTabs,
  replaceTab,
  surfaceKey,
  type Arrangement,
} from "~/panes/arrangement";
import type { PaneArrangementStore, PaneTabLabel } from "~/panes/panesHost";
import { openNear } from "~/panes/placement";
import { workspace } from "~/panes/workspace";
import { leafWithTab } from "~/panes/tree";
import { pullRequestSurface } from "~/rightPanelStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useQuietThreadShell, useThreadShell } from "~/state/entities";
import { environmentUnreachableAtom } from "~/state/presentation";
import { useEnvironmentShellStatus } from "~/state/shell";
import { isThreadRouteSnapshotAuthoritative } from "~/threadRoutes";
import { chatTabKey, parseChatTabKey } from "./sectionTabs";
import { useOpenThreadFamily } from "./useOpenThreadFamily";

/** An arrangement showing `key`: brought forward where it is, else opened in the focused pane. */
function showKeyIn(
  arrangement: Arrangement,
  key: string,
  placement: "tab" | "beside" = "tab",
): Arrangement {
  if (leafWithTab(arrangement.root, key)) return activateTab(arrangement, key);
  return placement === "beside"
    ? openNear(arrangement, key, arrangement.focused)
    : openTab(arrangement, key, arrangement.focused);
}

/** "Open in <section>" for a tab whose home section has more to show of it. */
export interface SectionTabMove {
  readonly label: string;
  readonly run: (navigate: NavigateFn) => void;
}

/** The title and icon of a chat, document or pull request tab; null for any other key. */
export function useSectionTabLabel(key: string): PaneTabLabel | null {
  const chat = parseChatTabKey(key);
  const thread = useThreadShell(chat);
  const legacyWikiLabel = useLegacyWikiTabLabel(key);
  const repositoryLabel = useRepositoryTabLabel(key);
  const groupLabel = useChangeGroupTabLabel(key);
  if (repositoryLabel !== null) return repositoryLabel;
  if (groupLabel !== null) return groupLabel;
  if (chat !== null) {
    return {
      title: thread?.title ?? "Thread",
      icon: <MessageSquareIcon className="size-3.5 shrink-0" />,
    };
  }
  if (legacyWikiLabel !== null) return legacyWikiLabel;
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
  openAll,
}: {
  readonly tabKey: string;
  readonly store: PaneArrangementStore;
  readonly active: boolean;
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
          // In the shared panes a thread opens as a sidebar row's does, and the rest beside it.
          const thread = shared ? parseChatTabKey(key) : null;
          if (thread !== null) workspace.openChat(chatTabKey(thread));
          else store.update((arrangement) => showKeyIn(arrangement, key, "beside"));
        }}
        showBeside={(key) =>
          store.update((arrangement) => {
            const groupPane = leafWithTab(arrangement.root, tabKey);
            const pane = leafWithTab(arrangement.root, key);
            // A tab standing alone in a pane of its own is beside the group already.
            if (pane && pane.id !== groupPane?.id && pane.tabs.length === 1) {
              return activateTab(arrangement, key);
            }
            const beside = openNear(arrangement, key, groupPane?.id ?? arrangement.focused);
            // A new chat opens in front of the group first; moving it out leaves the group in
            // front, and with no room it stays in front of the group.
            const together =
              leafWithTab(beside.root, key)?.id === leafWithTab(beside.root, tabKey)?.id;
            return together ? beside : activateTab(beside, tabKey, false);
          })
        }
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
  if (wiki !== null) return <LegacyWikiTab tabKey={tabKey} tab={wiki} store={store} />;
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
    else workspace.open(key, beside ? "near" : "tab");
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
  const shell = useQuietThreadShell(threadRef);
  const shellStatus = useEnvironmentShellStatus(threadRef.environmentId);
  const environmentUnreachable = useAtomValue(environmentUnreachableAtom(threadRef.environmentId));
  const coveredByModal = useLocation({ select: (location) => isAppModalPage(location.pathname) });
  useOpenThreadFamily(
    threadRef,
    isThreadRouteSnapshotAuthoritative(shellStatus) && shell === null && draftId === null,
  );
  // A link to a thread on an environment this app has no connection to says why, not a blank pane.
  if (!draftId && shell === null && environmentUnreachable) return <UnreachableEnvironmentState />;
  // Settings and Usage open over the panes, which stay mounted; their composer menus close.
  return (
    <HiddenThreadContext value={coveredByModal}>
      {draftId ? (
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
      )}
    </HiddenThreadContext>
  );
}

function UnreachableEnvironmentState() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>
          <T>Thread unavailable</T>
        </EmptyTitle>
        <EmptyDescription>
          <T>This thread is on an environment this app is not connected to.</T>
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/settings/connections" />} size="sm">
          <T>Open Environments</T>
        </Button>
      </EmptyContent>
    </Empty>
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
  const revealUrl = usePullRequestTabReveals((state) => state.byTabKey[tabKey]);
  return (
    <PullRequestDetailPanel
      environmentId={target.environmentId as ScopedThreadRef["environmentId"]}
      shortcutsEnabled={active}
      getShortcutContext={shortcutContext}
      tabOnPage
      revealUrl={revealUrl}
      onRevealSettled={(url) => settlePullRequestTabReveal(tabKey, url)}
      onGuideShown={() => guideShown(tabKey)}
      onActed={(action, phase = "done", reply) => pullRequestActed(target, action, phase, reply)}
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
