import { parseScopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { chatRouteOf, ChatTabWatch, type ChatRoute } from "~/chatTabs/chatTabLabel";
import { registerThreadTabDrop } from "~/chatTabs/threadTabDrop";
import { BackgroundThreadContext } from "~/components/chat/backgroundThread";
import { changeGroupTabKey } from "~/components/changeRequests/groups/changeGroupTabs";
import { RepositoryTabView } from "~/components/repositories/RepositoryTabView";
import { parseRepositoryTabKey } from "~/components/repositories/repositoryTabs";
import { ThreadRouteView } from "~/components/ThreadRouteView";
import { SidebarInset } from "~/components/ui/sidebar";
import { useComposerDraftStore } from "~/composerDraftStore";
import { PaneChat, SectionTabContent } from "~/sectionTabs/SectionTabContent";
import { chatTabKey, parseChatSurfaceKey, parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { useChangeGroups } from "~/state/changeGroups";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  type ThreadRouteTarget,
} from "~/threadRoutes";
import { chatTabsSlot, tabHistorySlot } from "~/whichKey/handles";
import { activateTab, allTabs, focusedPane, isEmptyTab, placeTabs } from "./arrangement";
import { insertIndex } from "./drag";
import { PanesHostContext, PanesLayoutKeyContext } from "./panesHost";
import { ChatOwnerContext, WorkspaceHostContext } from "./PaneSurfaceHost";
import { PaneTree } from "./PaneTree";
import { NO_TAB_SELECTION, useTabSelectionStore } from "./tabSelection";
import { findLeaf, leaves } from "./tree";
import {
  useWorkspaceArrangement,
  useWorkspaceFront,
  useWorkspaceSnapshot,
  useWorkspaceTabHistory,
  workspace,
  WORKSPACE_LAYOUT_KEY,
} from "./workspace";
import { closeWorkspaceTab, createWorkspaceHost } from "./workspaceTabs";

/** The thread a route shows: a server thread's own ref, or the thread a draft reserved. */
function useRouteThreadRef(target: ThreadRouteTarget | null): ScopedThreadRef | null {
  const draftId = target?.kind === "draft" ? target.draftId : null;
  const draft = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  if (target === null) return null;
  const environmentId =
    target.kind === "server" ? target.threadRef.environmentId : draft?.environmentId;
  const threadId = target.kind === "server" ? target.threadRef.threadId : draft?.threadId;
  return environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null;
}

function routeParams(route: ChatRoute) {
  return route.kind === "draft"
    ? ({ to: "/draft/$draftId", params: buildDraftThreadRouteParams(route.draftId) } as const)
    : ({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(route.ref) } as const);
}

/**
 * Astrolabe: the main area, the same in every section: the shared panes (`workspace.ts`). A
 * thread's route puts its chat in front, drawn by T3 Code's route view so one ChatView stays
 * mounted across thread switches. `background`: under Settings or Usage, mounted and inert.
 */
export function WorkspaceView({
  routeTarget,
  background = false,
}: {
  readonly routeTarget: ThreadRouteTarget | null;
  readonly background?: boolean;
}) {
  const [host] = useState(createWorkspaceHost);
  const snapshot = useWorkspaceSnapshot();
  const routeRef = useRouteThreadRef(routeTarget);
  const routeChatKey = routeRef ? chatTabKey(routeRef) : null;
  const navigate = useNavigate();

  // The route's chat comes to the front as the route arrives, as a link followed in a tab.
  const routed = useRef(routeChatKey);
  // oxlint-disable-next-line t3code/react-effect-budget -- the route is outside the panes' store
  useLayoutEffect(() => {
    routed.current = routeChatKey;
    if (routeChatKey !== null && !background) workspace.arriveChat(routeChatKey);
  }, [background, routeChatKey]);
  // oxlint-disable-next-line t3code/react-effect-budget -- follows T3 Code's right-panel store
  useLayoutEffect(() => workspace.follow(), []);

  // On a thread's route, the route follows a chat brought to the front in the panes, and leaves
  // for the start page once its chat closes.
  const onThreadRoute = routeTarget !== null;
  // oxlint-disable-next-line t3code/react-effect-budget -- the router follows the panes' store
  useEffect(() => {
    if (!onThreadRoute || background) return;
    const follow = () => {
      const { front, arrangement } = workspace.linked();
      const shown = routed.current;
      if (front !== null && front !== shown) {
        const route = chatRouteOf(front);
        if (route) void navigate(routeParams(route));
        return;
      }
      if (shown !== null && !allTabs(arrangement).includes(shown)) void navigate({ to: "/" });
    };
    return workspace.store.subscribe(follow);
  }, [background, navigate, onThreadRoute]);

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
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        <WorkspaceHostContext.Provider value={host}>
          <PanesHostContext.Provider value={host}>
            <PanesLayoutKeyContext.Provider value={WORKSPACE_LAYOUT_KEY}>
              <div
                ref={root}
                className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
              >
                {snapshot ? <PaneTree snapshot={snapshot} panelMaximized /> : null}
              </div>
              <WorkspaceTabContents
                routeTarget={routeTarget}
                routeChatKey={routeChatKey}
                background={background}
              />
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
 * Every open tab's content, each portaled into its container. A chat mounts only while its tab
 * is in front, since a conversation listens to the whole window's keys and pastes; the route's
 * chat stays mounted behind other tabs, inert, so switching back never remounts it.
 */
function WorkspaceTabContents({
  routeTarget,
  routeChatKey,
  background,
}: {
  readonly routeTarget: ThreadRouteTarget | null;
  readonly routeChatKey: string | null;
  readonly background: boolean;
}) {
  const host = useHost();
  const arrangement = useWorkspaceArrangement();
  const front = useWorkspaceFront();
  const keys = allTabs(arrangement);
  const fronts = new Set(leaves(arrangement.root).map((leaf) => leaf.active));
  const focusedFront = focusedPane(arrangement).active;
  // Containers of closed tabs go; the route's chat renders into one node, which moves into its
  // tab's container.
  // oxlint-disable-next-line t3code/react-effect-budget -- moves DOM nodes the panes render into
  useLayoutEffect(() => {
    host.prune(new Set(keys));
    if (routeChatKey === null || !keys.includes(routeChatKey)) return;
    const container = host.containerFor(routeChatKey);
    if (host.routeNode.parentNode !== container) container.appendChild(host.routeNode);
  }, [host, keys, routeChatKey]);
  const shown = keys.filter(
    (key) =>
      !isEmptyTab(key) &&
      parseChatSurfaceKey(key) === null &&
      (fronts.has(key) || parseChatTabKey(key) === null),
  );
  return (
    <>
      {shown.map((key) => {
        const chat = parseChatTabKey(key);
        if (chat !== null) {
          // The route's chat renders below; one brought to the front leads the route to it.
          if (routeTarget !== null && (key === routeChatKey || key === front)) return null;
          return createPortal(
            <ChatOwnerContext value={key}>
              <PaneChat threadRef={chat} />
            </ChatOwnerContext>,
            host.containerFor(key),
            key,
          );
        }
        const repository = parseRepositoryTabKey(key);
        return createPortal(
          repository ? (
            <RepositoryTabView tabKey={key} tab={repository} />
          ) : (
            <SectionTabContent tabKey={key} store={workspace.store} active={key === focusedFront} />
          ),
          host.containerFor(key),
          key,
        );
      })}
      {routeTarget !== null
        ? createPortal(
            <BackgroundThreadContext value={background || !fronts.has(routeChatKey ?? "")}>
              <ChatOwnerContext value={routeChatKey}>
                <ThreadRouteView
                  target={routeTarget}
                  background={background || !fronts.has(routeChatKey ?? "")}
                />
              </ChatOwnerContext>
            </BackgroundThreadContext>,
            host.routeNode,
          )
        : null}
      {keys.flatMap((key) =>
        parseChatTabKey(key) === null
          ? []
          : [<ChatTabWatch key={key} chatKey={key} onGone={closeGoneChat} />],
      )}
    </>
  );
}

const closeGoneChat = (chatKey: string) => workspace.close(chatKey);

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
