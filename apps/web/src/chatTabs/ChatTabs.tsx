import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useLayoutEffect, useMemo } from "react";

import { ThreadRouteView } from "~/components/ThreadRouteView";
import { useComposerDraftStore } from "~/composerDraftStore";
import type { ThreadRouteTarget } from "~/threadRoutes";
import { ThreadPanesProvider } from "../panes/ThreadPanes";
import { ChatTabStrip, ChatTabStripContext, type ChatTabStripSlot } from "./ChatTabStrip";
import { useChatTabsStore } from "./chatTabsStore";

/** The thread a route shows: a server thread's own ref, or the thread a draft reserved. */
function useRouteThreadRef(target: ThreadRouteTarget): ScopedThreadRef | null {
  const draftId = target.kind === "draft" ? target.draftId : null;
  const draft = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const environmentId =
    target.kind === "server" ? target.threadRef.environmentId : draft?.environmentId;
  const threadId = target.kind === "server" ? target.threadRef.threadId : draft?.threadId;
  return useMemo(
    () => (environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null),
    [environmentId, threadId],
  );
}

/**
 * The main area beside T3 Code's sidebar: the chat in front, with the open chats as tabs across
 * the top of its column, and its own header, drawer and right panel. ChatView draws the strip
 * (see `ChatTabStripContext`), so the right panel runs the full height beside it as T3 Code's
 * does. The route's thread is the one in front; showing a thread opens its tab. A draft is keyed
 * by the thread it reserved, so its tab stays put when it is sent.
 */
export function ChatTabs({ target }: { target: ThreadRouteTarget }) {
  const threadRef = useRouteThreadRef(target);
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;
  useLayoutEffect(() => {
    if (threadKey !== null) useChatTabsStore.getState().open(threadKey);
  }, [threadKey]);
  const strip = useCallback<ChatTabStripSlot>(
    ({ atWindowEdge, trailing }) => (
      <ChatTabStrip activeKey={threadKey} atWindowEdge={atWindowEdge} trailing={trailing} />
    ),
    [threadKey],
  );

  return (
    <ChatTabStripContext.Provider value={strip}>
      {threadRef ? (
        <ThreadPanesProvider threadRef={threadRef}>
          <ThreadRouteView target={target} />
        </ThreadPanesProvider>
      ) : (
        <ThreadRouteView target={target} />
      )}
    </ChatTabStripContext.Provider>
  );
}
