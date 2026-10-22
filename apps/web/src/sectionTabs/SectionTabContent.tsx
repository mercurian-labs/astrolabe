import { ChangeGroupView } from "~/components/changeRequests/groups/ChangeGroupView";
import { parseChangeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import { useChangeGroupTabLabel } from "~/components/changeRequests/groups/useChangeGroupTabLabel";
import { parseRepositoryTabKey } from "~/components/repositories/repositoryTabs";
import {
  RepositoryTabView,
  useRepositoryTabLabel,
} from "~/components/repositories/RepositoryTabView";
import type { EnvironmentChangeGroup } from "@t3tools/client-runtime/changeGroups";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import type { NavigateFn } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import ChatView from "~/components/ChatView";
import { PullRequestDetailPanel } from "~/components/pullRequest/PullRequestDetailPanel";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import {
  pullRequestTargetOfKey,
  type FullPullRequestTarget,
  type PullRequestTarget,
} from "~/components/pullRequest/pullRequestTabs";
import {
  closeAskingFirst,
  useWikiTabLabel,
  WikiTabView,
  type WikiTabNav,
} from "~/components/wiki/WikiTabView";
import { hasUnsavedEdits } from "~/components/wiki/wikiPanes";
import { parseWikiTabKey } from "~/components/wiki/wikiTabs";
import { ChatTabStripContext } from "~/chatTabs/ChatTabStrip";
import { useChatTabsStore } from "~/chatTabs/chatTabsStore";
import { isElectron } from "~/env";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { ensureLocalApi } from "~/localApi";
import {
  activateTab,
  closeTab,
  focusedPane,
  openBeside,
  openTab,
  placeTabs,
  replaceTab,
  surfaceKey,
  type Arrangement,
} from "~/panes/arrangement";
import type { PaneArrangementStore } from "~/panes/panesHost";
import { ThreadPanesProvider } from "~/panes/ThreadPanes";
import { leafWithTab } from "~/panes/tree";
import { pullRequestSurface } from "~/rightPanelStore";
import { useThreadShell } from "~/state/entities";
import { openInSection } from "./openInSection";
import {
  chatTabKey,
  parseChatTabKey,
  SECTION_LABELS,
  tabSection,
  type SectionId,
} from "./sectionTabs";

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

/**
 * Where a wiki tab's links lead in panes other than the Wikis area's: into the same panes. A
 * change request's thread opens beside it as a chat, unless `chats` is off (a thread's own right
 * panel), where its link goes to the thread.
 */
export function paneTabNav(
  store: PaneArrangementStore,
  {
    chats = true,
    openPullRequest,
  }: {
    readonly chats?: boolean;
    readonly openPullRequest?: (target: FullPullRequestTarget) => void;
  } = {},
): WikiTabNav {
  return {
    // A pull request opens beside, named in full so its tab reads on its own.
    openPullRequest:
      openPullRequest ??
      ((target) =>
        store.update((arrangement) =>
          showKeyIn(arrangement, surfaceKey(pullRequestSurface(target).id), "beside"),
        )),
    open: (key, placement) => store.update((arrangement) => showKeyIn(arrangement, key, placement)),
    replace: (from, key) =>
      store.update((arrangement) =>
        leafWithTab(arrangement.root, key)
          ? activateTab(arrangement, key)
          : replaceTab(arrangement, from, key),
      ),
    ...(chats
      ? {
          openThread: (ref: ScopedThreadRef) =>
            store.update((arrangement) => showKeyIn(arrangement, chatTabKey(ref), "beside")),
        }
      : {}),
  };
}

/** Closes a tab from a set of panes, asking first when it holds unsaved edits. */
export function closeSectionTab(store: PaneArrangementStore, key: string) {
  closeAskingFirst(key, () => store.update((arrangement) => closeTab(arrangement, key)));
}

/** "Open in <section>" for a tab outside its own section. */
export interface SectionTabMove {
  readonly label: string;
  readonly run: (navigate: NavigateFn) => void;
}

/**
 * Moving a tab to its own section: it closes here (asking first over unsaved edits) and opens
 * there. Null for a tab already in its section, or one that never leaves its panes.
 */
export function sectionTabMove(
  key: string,
  here: SectionId,
  close: (key: string) => void,
  pullRequest?: PullRequestTarget | null,
): SectionTabMove | null {
  const home = tabSection(key);
  if (home === null || home === here) return null;
  return {
    label: `Open in ${SECTION_LABELS[home]}`,
    run(navigate) {
      const move = () => {
        close(key);
        openInSection(key, navigate, pullRequest ?? undefined);
      };
      if (!hasUnsavedEdits(key)) {
        move();
        return;
      }
      void ensureLocalApi()
        .dialogs.confirm(
          `Open this in ${SECTION_LABELS[home]}? Your unsaved edits here will be lost.`,
          {
            variant: "destructive",
          },
        )
        .then((confirmed) => {
          if (confirmed) move();
        });
    },
  };
}

/** The title and icon of a chat, document or pull request tab; null for any other key. */
export function useSectionTabLabel(key: string): { title: string; icon: ReactNode } | null {
  const chat = parseChatTabKey(key);
  const thread = useThreadShell(chat);
  const wikiLabel = useWikiTabLabel(key);
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
 * A chat, document or pull request shown in another section's panes. `store` is those panes,
 * where a document's links lead. `active` says the tab is its pane's front tab in the focused
 * pane, so its shortcuts listen.
 */
export function SectionTabContent({
  tabKey,
  store,
  active,
  chats = true,
  openPullRequest,
  openAll,
}: {
  readonly tabKey: string;
  readonly store: PaneArrangementStore;
  readonly active: boolean;
  readonly chats?: boolean;
  /** Where a change request's pull request opens, for panes that hold them their own way. */
  readonly openPullRequest?: (target: FullPullRequestTarget) => void;
  /** How tabs open together (a change group's tab group), for panes that hold them their own way. */
  readonly openAll?: (keys: ReadonlyArray<string>, group: EnvironmentChangeGroup) => void;
}) {
  const chat = parseChatTabKey(tabKey);
  if (chat !== null) return chats ? <PaneChat threadRef={chat} /> : null;
  const repository = parseRepositoryTabKey(tabKey);
  if (repository !== null) return <RepositoryTabView tabKey={tabKey} tab={repository} />;
  const group = parseChangeGroupTabKey(tabKey);
  if (group !== null) {
    return (
      <ChangeGroupView
        tab={group}
        open={(key) => {
          // Beside a thread, which holds no chats, a thread opens in the chat tabs after the chat
          // in front, and a pull request as the thread's own.
          const thread = chats ? null : parseChatTabKey(key);
          const pullRequest = chats ? null : pullRequestTargetOfKey(key);
          if (thread !== null) {
            useChatTabsStore.getState().openBesideFront([scopedThreadKey(thread)]);
          } else if (pullRequest !== null && openPullRequest) {
            openPullRequest(pullRequest);
          } else {
            store.update((arrangement) => showKeyIn(arrangement, key, "beside"));
          }
        }}
        openAll={
          openAll ??
          ((keys) =>
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
    return (
      <WikiTabView
        tabKey={tabKey}
        tab={wiki}
        nav={paneTabNav(store, { chats, ...(openPullRequest ? { openPullRequest } : {}) })}
      />
    );
  }
  const pullRequest = pullRequestTargetOfKey(tabKey);
  if (pullRequest !== null) {
    return <PanePullRequest tabKey={tabKey} target={pullRequest} store={store} active={active} />;
  }
  return null;
}

/**
 * A thread's chat in a pane, as Agents shows it but without the chat tabs: the pane's own strip
 * holds the tab. Its right panel is the thread's, as in Agents.
 */
function PaneChat({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  return (
    <ChatTabStripContext.Provider value={null}>
      <ThreadPanesProvider threadRef={threadRef}>
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
          reserveTitleBarControlInset={false}
        />
      </ThreadPanesProvider>
    </ChatTabStripContext.Provider>
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

/** A pull request in a pane outside Change Requests; one picked inside it replaces it. */
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
