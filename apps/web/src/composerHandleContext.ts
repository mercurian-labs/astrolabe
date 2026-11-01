import { createContext, use, useEffect, useRef } from "react";
import type { ChatComposerHandle } from "./components/chat/ChatComposer";
import { focusedPane } from "./panes/arrangement";
import { useChatOwner } from "./panes/PaneSurfaceHost";
import { workspace } from "./panes/workspace";

export type ComposerHandleRef = React.RefObject<ChatComposerHandle | null>;

/** Inside a chat, its own composer; around them all, `focusedChatComposerRef`. */
export const ComposerHandleContext = createContext<ComposerHandleRef | null>(null);

export function useComposerHandleContext(): ComposerHandleRef | null {
  return use(ComposerHandleContext);
}

// Each mounted chat's composer, by its chat tab (null: a ChatView outside the shared panes).
const chatComposers = new Map<string | null, ComposerHandleRef>();

/**
 * A ChatView's own composer ref, which it provides to its tree. Several chats are mounted at
 * once, so one ref shared above them would hold whichever composer mounted last.
 */
export function useChatComposerRef(): ComposerHandleRef {
  const owner = useChatOwner();
  const ref = useRef<ChatComposerHandle | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- lists the composer while the chat shows
  useEffect(() => {
    chatComposers.set(owner, ref);
    return () => {
      if (chatComposers.get(owner) === ref) chatComposers.delete(owner);
    };
  }, [owner]);
  return ref;
}

/** The composer of the chat in front in the focused pane, for what sits outside every chat. */
export const focusedChatComposerRef: ComposerHandleRef = {
  get current() {
    const front = focusedPane(workspace.arrangement()).active;
    return (chatComposers.get(front) ?? chatComposers.get(null))?.current ?? null;
  },
};
