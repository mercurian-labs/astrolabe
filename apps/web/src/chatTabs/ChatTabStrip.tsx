import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { environmentShell } from "~/state/shell";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  isThreadRouteSnapshotAuthoritative,
} from "~/threadRoutes";
import { neighbourOf } from "../titlebarTabs/tabListStore";
import { TitlebarTab, TitlebarTabStrip, type TitlebarTabSlot } from "../titlebarTabs/TitlebarTabs";
import { useChatTabsStore } from "./chatTabsStore";

/** Where a chat's tab leads: its server thread, or its draft while it is one. */
type ChatRoute =
  | { readonly kind: "thread"; readonly key: string }
  | { readonly kind: "draft"; readonly draftId: DraftId };

/**
 * Draws the chat tabs where ChatView puts them: across the top of its chat column, above its
 * header. `atWindowEdge` is whether the strip reaches the window's right edge, as it does while
 * the right panel is closed. `trailing` ends the strip: the chat's own controls.
 */
export type ChatTabStripSlot = (options: {
  readonly atWindowEdge: boolean;
  readonly trailing: ReactNode;
}) => ReactNode;

export const ChatTabStripContext = createContext<ChatTabStripSlot | null>(null);

/** The chat tabs for ChatView to draw; null outside the chat tabs. */
export function useChatTabStrip(): ChatTabStripSlot | null {
  return useContext(ChatTabStripContext);
}

/** The open chats, as tabs; the route's thread is the one in front (see `TitlebarTabStrip`). */
export function ChatTabStrip({
  activeKey,
  atWindowEdge,
  trailing,
}: {
  activeKey: string | null;
  atWindowEdge: boolean;
  trailing: ReactNode;
}) {
  const keys = useChatTabsStore((store) => store.keys);
  const navigate = useNavigate();
  // Each tab reports where it leads, so closing the tab in front can go to its neighbour.
  const routes = useRef(new Map<string, ChatRoute>());

  const go = (route: ChatRoute | undefined) => {
    if (!route) return void navigate({ to: "/" });
    if (route.kind === "draft") {
      return void navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(route.draftId),
      });
    }
    const ref = parseScopedThreadKey(route.key);
    if (ref)
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  const close = (key: string) => {
    const store = useChatTabsStore.getState();
    if (key === activeKey) {
      const next = neighbourOf(store.keys, key);
      go(next === null ? undefined : routes.current.get(next));
    }
    store.close(key);
  };

  return (
    <TitlebarTabStrip
      id="chats"
      label="Open chats"
      keys={keys}
      activeKey={activeKey}
      atWindowEdge={atWindowEdge}
      trailing={trailing}
      onMove={(key, index) => useChatTabsStore.getState().move(key, index)}
      renderTab={(key, slot) => (
        <ChatTab
          key={key}
          tabKey={key}
          slot={slot}
          onRoute={(route) => {
            if (route) routes.current.set(key, route);
            else routes.current.delete(key);
          }}
          onOpen={(route) => {
            if (route) go(route);
            // A chat that is neither a thread nor a draft any more has nothing to show.
            else useChatTabsStore.getState().close(key);
          }}
          onClose={() => close(key)}
        />
      )}
    />
  );
}

function ChatTab({
  tabKey,
  slot,
  onRoute,
  onOpen,
  onClose,
}: {
  tabKey: string;
  slot: TitlebarTabSlot;
  onRoute: (route: ChatRoute | null) => void;
  onOpen: (route: ChatRoute | null) => void;
  onClose: () => void;
}) {
  const { active } = slot;
  const ref = useMemo(() => parseScopedThreadKey(tabKey), [tabKey]);
  const shell = useThreadShell(ref);
  const draftId = useComposerDraftStore((store) =>
    shell || !ref ? null : store.getDraftIdByRef(ref),
  );
  const live = isThreadRouteSnapshotAuthoritative(
    useEnvironmentQuery(ref ? environmentShell.stateAtom(ref.environmentId) : null).data?.status,
  );
  const exists = shell !== null && shell.deletedAt == null;
  const route = useMemo<ChatRoute | null>(
    () => (exists ? { kind: "thread", key: tabKey } : draftId ? { kind: "draft", draftId } : null),
    [draftId, exists, tabKey],
  );
  useEffect(() => onRoute(route), [onRoute, route]);
  // A chat deleted, or a draft discarded, closes its tab once its environment's threads are known.
  // The chat in front leaves through ThreadRouteView's own redirect first.
  const gone = live && route === null;
  useEffect(() => {
    if (gone && !active) useChatTabsStore.getState().close(tabKey);
  }, [active, gone, tabKey]);

  return (
    <TitlebarTab
      tabKey={tabKey}
      // A thread not yet sent has no title of its own.
      title={shell?.title ?? "New thread"}
      icon={<MessagesSquare />}
      slot={slot}
      onSelect={() => onOpen(route)}
      onClose={onClose}
    />
  );
}
