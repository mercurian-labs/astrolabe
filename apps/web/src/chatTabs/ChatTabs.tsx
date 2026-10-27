import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useLayoutEffect } from "react";

import { ThreadRouteView } from "~/components/ThreadRouteView";
import { BackgroundThreadContext } from "~/components/chat/backgroundThread";
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
  return environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null;
}

/**
 * The main area beside T3 Code's sidebar: the chat in front, with the open chats as tabs across
 * the top of its column, and its own header, drawer and right panel. ChatView draws the strip
 * (see `ChatTabStripContext`), so the right panel runs the full height beside it as T3 Code's
 * does. The route's thread is the one in front; showing a thread shows it in the tab in front, or
 * brings forward the tab already showing it (see `chatTabsStore`). A draft is keyed by the thread
 * it reserved, so its tab stays put when it is sent.
 */
export function ChatTabs({
  target,
  background = false,
}: {
  target: ThreadRouteTarget;
  /** Under Settings or Usage: the chats stay mounted and inert, lending the keyboard menu nothing. */
  background?: boolean;
}) {
  const threadRef = useRouteThreadRef(target);
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;
  useLayoutEffect(() => {
    if (threadKey !== null) useChatTabsStore.getState().arrive(threadKey);
  }, [threadKey]);
  const strip: ChatTabStripSlot = ({ atWindowEdge, trailing }) => (
    <ChatTabStrip activeKey={threadKey} atWindowEdge={atWindowEdge} trailing={trailing} />
  );

  return (
    <BackgroundThreadContext value={background}>
      <ChatTabStripContext.Provider value={strip}>
        {threadRef ? (
          <ThreadPanesProvider threadRef={threadRef}>
            <ThreadRouteView target={target} background={background} />
          </ThreadPanesProvider>
        ) : (
          <ThreadRouteView target={target} background={background} />
        )}
      </ChatTabStripContext.Provider>
    </BackgroundThreadContext>
  );
}
