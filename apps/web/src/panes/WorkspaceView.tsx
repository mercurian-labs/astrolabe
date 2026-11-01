import { parseScopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { Activity, memo, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { chatRouteOf, ChatTabWatch } from "~/chatTabs/chatTabLabel";
import { registerThreadTabDrop } from "~/chatTabs/threadTabDrop";
import { BackgroundThreadContext } from "~/components/chat/backgroundThread";
import { changeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import { RepositoryTabView } from "~/components/repositories/RepositoryTabView";
import { parseRepositoryTabKey } from "~/components/repositories/repositoryTabs";
import { SidebarInset } from "~/components/ui/sidebar";
import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { PaneChat, SectionTabContent } from "~/sectionTabs/SectionTabContent";
import { useSidebarPendingFileDropStore } from "~/sidebarPendingFileDropStore";
import { chatTabKey, parseChatSurfaceKey, parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { useChangeGroups } from "~/state/changeGroups";
import { buildThreadRouteParams, type ThreadRouteTarget } from "~/threadRoutes";
import { chatTabsSlot, tabHistorySlot } from "~/whichKey/handles";
import { agentsRoute } from "./agentsRoute";
import { activateTab, allTabs, focusedPane, isEmptyTab, placeTabs } from "./arrangement";
import { insertIndex } from "./drag";
import { PanesHostContext, PanesLayoutKeyContext } from "./panesHost";
import { ChatOwnerContext, PaneTabKeyContext, WorkspaceHostContext } from "./PaneSurfaceHost";
import { PaneTree } from "./PaneTree";
import { recentChats } from "./recentChats";
import { NO_TAB_SELECTION, useTabSelectionStore } from "./tabSelection";
import { findLeaf, leaves } from "./tree";
import {
  focusedChatOf,
  useWorkspaceArrangement,
  useWorkspaceSnapshot,
  useWorkspaceTabHistory,
  workspace,
  WORKSPACE_LAYOUT_KEY,
} from "./workspace";
import { closeWorkspaceTab, createWorkspaceHost } from "./workspaceTabs";

/**
 * The thread a route shows: a server thread's own ref, or the thread a draft reserved, which it
 * still names once the draft became that thread and the route is about to follow.
 */
function useRouteThreadRef(target: ThreadRouteTarget | null): ScopedThreadRef | null {
  const draftId = target?.kind === "draft" ? target.draftId : null;
  const draft = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const promoted = useComposerDraftStore((store) =>
    draftId === null ? null : store.getPromotedDraftRedirect(draftId),
  );
  if (target === null) return null;
  if (target.kind === "server") return target.threadRef;
  return draft ? scopeThreadRef(draft.environmentId, draft.threadId) : promoted;
}

/**
 * Astrolabe: the main area, the same in every section: the shared panes (`workspace.ts`). A
 * thread's route brings its chat to the front; the panes alone decide which chat shows. In
 * Agents (`agents`) the route follows the focused tab's chat (`agentsRoute`), so the sidebar
 * selects its thread, or none. `background`: under Settings or Usage, mounted and inert.
 */
export function WorkspaceView({
  routeTarget,
  agents = routeTarget !== null,
  background = false,
}: {
  readonly routeTarget: ThreadRouteTarget | null;
  readonly agents?: boolean;
  readonly background?: boolean;
}) {
  const [host] = useState(createWorkspaceHost);
  const snapshot = useWorkspaceSnapshot();
  const routeRef = useRouteThreadRef(routeTarget);
  const routeChatKey = routeRef ? chatTabKey(routeRef) : null;
  const navigate = useNavigate();

  // The route's chat comes to the front as the route arrives, as a link followed in a tab.
  const routed = useRef(routeChatKey);
  // The chat (or null, the start page) the route was last asked to follow, until it arrives.
  const asked = useRef<string | null | undefined>(undefined);
  // oxlint-disable-next-line t3code/react-effect-budget -- the route is outside the panes' store
  useLayoutEffect(() => {
    routed.current = routeChatKey;
    asked.current = undefined;
    if (routeChatKey !== null && !background) workspace.openChat(routeChatKey);
  }, [background, routeChatKey]);
  // oxlint-disable-next-line t3code/react-effect-budget -- follows T3 Code's right-panel store
  useLayoutEffect(() => workspace.follow(), []);

  // In Agents, the route follows the focused tab's chat, or leaves for the start page when focus
  // is on anything else; the panes stay as they are.
  const onStartPage = routeTarget === null;
  // oxlint-disable-next-line t3code/react-effect-budget -- the router follows the panes' store
  useEffect(() => {
    if (!agents || background) return;
    const follow = () => {
      const linked = workspace.linked();
      const chat = focusedChatOf(linked);
      // A chat gone leads nowhere; its tab is closing (`ChatTabWatch`).
      if (chat === routed.current) {
        asked.current = undefined;
        return;
      }
      if (chat === asked.current || (chat !== null && chatRouteOf(chat) === null)) return;
      asked.current = chat;
      void navigate(agentsRoute(linked, chatRouteOf));
    };
    if (onStartPage) follow();
    return workspace.store.subscribe(follow);
  }, [agents, background, navigate, onStartPage]);

  // The keyboard menu's history and tab commands act on the focused pane's tabs.
  const { canGoBack, canGoForward } = useWorkspaceTabHistory();
  const arrangement = useWorkspaceArrangement();
  const focused = focusedPane(arrangement);
  // oxlint-disable-next-line t3code/react-effect-budget -- lends handles to the keyboard menu while mounted
  useEffect(() => {
    if (background) return;
    const stopHistory = tabHistorySlot.register({ canGoBack, canGoForward, go: workspace.step });
    const stopTabs = chatTabsSlot.register({
      keys: focused.tabs,
      activeKey: focused.active,
      select: (key) => workspace.update((next) => activateTab(next, key)),
      close: closeWorkspaceTab,
    });
    return () => {
      stopTabs();
      stopHistory();
    };
  }, [background, canGoBack, canGoForward, focused.active, focused.tabs]);

  // Escape clears a selection of tabs, leaving the page saves the panes, and threads dragged
  // from the sidebar open as tabs in the pane they are dropped on.
  const root = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- window and sidebar-drag listeners
  useEffect(() => {
    useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
    const clear = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (useTabSelectionStore.getState().selection.keys.length === 0) return;
      useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
    };
    const save = () => workspace.store.flush();
    window.addEventListener("keydown", clear);
    window.addEventListener("pagehide", save);
    const stopDrop = root.current
      ? registerThreadTabDrop(root.current, { over: () => {}, drop: dropThreads })
      : () => {};
    return () => {
      window.removeEventListener("keydown", clear);
      window.removeEventListener("pagehide", save);
      stopDrop();
      save();
    };
  }, []);

  return (
    <BackgroundThreadContext value={background}>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none" inert={background}>
        <WorkspaceHostContext.Provider value={host}>
          <PanesHostContext.Provider value={host}>
            <PanesLayoutKeyContext.Provider value={WORKSPACE_LAYOUT_KEY}>
              <div
                ref={root}
                className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
              >
                {snapshot ? <PaneTree snapshot={snapshot} panelMaximized /> : null}
              </div>
              <WorkspaceTabContents />
              {routeTarget?.kind === "draft" && !background ? (
                <DraftRouteRedirect draftId={routeTarget.draftId} />
              ) : null}
              <GroupsSync />
            </PanesLayoutKeyContext.Provider>
          </PanesHostContext.Provider>
        </WorkspaceHostContext.Provider>
      </SidebarInset>
    </BackgroundThreadContext>
  );
}

/**
 * Opens threads dropped from the sidebar as chat tabs where they land: among the tabs of the
 * strip under the pointer, else at the end of the pane's tabs, `front` in front.
 */
function dropThreads(threadKeys: readonly string[], x: number, front: string) {
  const toChat = (key: string) => {
    const ref = parseScopedThreadKey(key);
    return ref ? chatTabKey(ref) : null;
  };
  const keys = threadKeys.flatMap((key) => toChat(key) ?? []);
  const frontKey = toChat(front);
  const pane = [...document.querySelectorAll<HTMLElement>("[data-pane-id]")].find((element) => {
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right;
  });
  const paneId = pane?.dataset.paneId ?? workspace.arrangement().focused;
  const leaf = findLeaf(workspace.arrangement().root, paneId);
  if (!leaf || keys.length === 0) return;
  const pills = [...(pane?.querySelectorAll<HTMLElement>("[data-pane-tab]") ?? [])];
  const at = insertIndex(
    pills.map((pill) => {
      const box = pill.getBoundingClientRect();
      return box.left + box.width / 2;
    }),
    x,
  );
  const before = pills[at]?.dataset.key;
  const index = before ? Math.max(0, leaf.tabs.indexOf(before)) : leaf.tabs.length;
  workspace.update((arrangement) =>
    placeTabs(arrangement, keys, paneId, { side: null, index }, frontKey ?? keys[0]),
  );
}

/**
 * A draft's route, once the draft became its thread, gives way to the thread's route; once the
 * draft is gone, to the start page. Its chat's tab stays as it is throughout.
 */
function DraftRouteRedirect({ draftId }: { readonly draftId: DraftId }) {
  const drafting = useComposerDraftStore((store) => store.getDraftSession(draftId) !== null);
  const promoted = useComposerDraftStore((store) => store.getPromotedDraftRedirect(draftId));
  if (drafting) return null;
  return promoted ? (
    <Navigate to="/$environmentId/$threadId" params={buildThreadRouteParams(promoted)} replace />
  ) : (
    <Navigate to="/" replace />
  );
}

/**
 * Every open tab's content, each portaled into its own container, which never changes. A chat
 * renders once it is shown and stays mounted while it is among the most recently shown
 * (`recentChats`), hidden by `Activity` behind other tabs: hiding cleans up its effects, so a chat
 * out of sight never hears the window's keys or pastes.
 */
function WorkspaceTabContents() {
  const host = useHost();
  const arrangement = useWorkspaceArrangement();
  const keys = allTabs(arrangement);
  const panes = leaves(arrangement.root);
  const focusedFront = focusedPane(arrangement).active;
  const fronts = new Set(panes.map((leaf) => leaf.active));
  const onScreen = [...new Set([focusedFront, ...fronts])].filter(
    (key) => parseChatTabKey(key) !== null,
  );
  const [recent, setRecent] = useState<readonly string[]>([]);
  const kept = recentChats(recent, onScreen, new Set(keys));
  if (kept !== recent) setRecent(kept);
  // Containers of closed tabs go.
  // oxlint-disable-next-line t3code/react-effect-budget -- drops DOM nodes the panes render into
  useLayoutEffect(() => {
    host.prune(new Set(keys));
  }, [host, keys]);
  const others = keys.filter(
    (key) => !isEmptyTab(key) && parseChatSurfaceKey(key) === null && parseChatTabKey(key) === null,
  );
  return (
    <>
      {others.map((key) =>
        createPortal(
          // Only a pull request listens to the keys of its tab in front: the rest skip a render
          // as focus moves.
          <TabContent
            tabKey={key}
            active={parseRepositoryTabKey(key) === null && key === focusedFront}
          />,
          host.containerFor(key),
          key,
        ),
      )}
      {kept.map((key) =>
        createPortal(
          <Activity mode={fronts.has(key) ? "visible" : "hidden"}>
            <TabContent tabKey={key} active={false} />
          </Activity>,
          host.containerFor(key),
          key,
        ),
      )}
      {keys.flatMap((key) =>
        parseChatTabKey(key) === null
          ? []
          : [<ChatTabWatch key={key} chatKey={key} onGone={closeGoneChat} />],
      )}
    </>
  );
}

/** One open tab's content: a chat, a repository tab, or a document, group or pull request. */
const TabContent = memo(function TabContent({
  tabKey,
  active,
}: {
  readonly tabKey: string;
  readonly active: boolean;
}) {
  const chat = parseChatTabKey(tabKey);
  const repository = parseRepositoryTabKey(tabKey);
  return (
    <PaneTabKeyContext value={tabKey}>
      {chat !== null ? (
        <ChatOwnerContext value={tabKey}>
          <PaneChat threadRef={chat} />
        </ChatOwnerContext>
      ) : repository !== null ? (
        <RepositoryTabView tabKey={tabKey} tab={repository} />
      ) : (
        <SectionTabContent tabKey={tabKey} store={workspace.store} active={active} />
      )}
    </PaneTabKeyContext>
  );
});

const closeGoneChat = (chatKey: string) => {
  const ref = parseChatTabKey(chatKey);
  if (ref) useSidebarPendingFileDropStore.getState().clearPendingFileDropsForThread(ref);
  workspace.close(chatKey);
};

function useHost() {
  const host = useContext(WorkspaceHostContext);
  if (!host) throw new Error("The workspace's contents render inside its host.");
  return host;
}

/**
 * The change groups' threads, handed to the panes so tabs linked to a group show beside each of
 * its threads. Renders nothing, so the groups, which change with every thread, re-render only it.
 */
function GroupsSync() {
  const groups = useChangeGroups();
  // oxlint-disable-next-line t3code/react-effect-budget -- hands the groups to the panes' store
  useEffect(() => {
    const members = new Map<string, ReadonlySet<string>>();
    for (const group of groups) {
      members.set(
        changeGroupTabKey(group),
        new Set(
          group.threadIds.map((threadId) =>
            chatTabKey(scopeThreadRef(group.environmentId, ThreadId.make(threadId))),
          ),
        ),
      );
    }
    workspace.setGroups(members);
  }, [groups]);
  return null;
}
