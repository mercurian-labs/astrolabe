import { create } from "zustand";

import type { PersistentTerminalLaunchContext } from "~/components/PersistentThreadTerminals";
import type { TerminalContextSelection } from "~/lib/terminalContext";
import { parseChatTabKey, parseChatTerminalKey } from "~/sectionTabs/sectionTabs";

/**
 * Astrolabe: what a chat's ChatView lends what renders or acts outside it: its terminal tab, which
 * outlives the chat's `Activity`, and the panes.
 */
export interface ChatBridge {
  /** Where a script asked the thread's new terminals to start. */
  readonly launchContext: PersistentTerminalLaunchContext | null;
  readonly addTerminalContext: (selection: TerminalContextSelection) => void;
  /** Ends the thread's terminals, asking first. */
  readonly endTerminals: () => void;
  /** Opens what Settings says the side pane opens on; false with nothing to open. */
  readonly openSidePane: () => boolean;
  /** Focuses the composer, if the chat holds focus. */
  readonly focusComposer: () => void;
}

export const useChatBridgeStore = create<{
  readonly byChatKey: Readonly<Record<string, ChatBridge>>;
}>(() => ({ byChatKey: {} }));

/** Lends `bridge` for the chat until the returned function is called. */
export function lendChat(chatKey: string, bridge: ChatBridge) {
  const { setState } = useChatBridgeStore;
  setState((state) => ({ byChatKey: { ...state.byChatKey, [chatKey]: bridge } }));
  return () => {
    setState((state) => {
      if (state.byChatKey[chatKey] !== bridge) return state;
      const { [chatKey]: _gone, ...byChatKey } = state.byChatKey;
      return { byChatKey };
    });
  };
}

export const chatBridgeOf = (chatKey: string): ChatBridge | undefined =>
  useChatBridgeStore.getState().byChatKey[chatKey];

/**
 * Hands focus to the chat's composer after the commit under way. A pane closing beside the chat
 * moves the chat's container, which would blur anything focused before it landed.
 */
export function handFocusToComposer(chatKey: string) {
  requestAnimationFrame(() => chatBridgeOf(chatKey)?.focusComposer());
}

/** Ends the terminals of a chat's terminal tab, as its ChatView asks first. */
export function endChatTerminals(tabKey: string) {
  const chatKey = parseChatTerminalKey(tabKey);
  if (chatKey === null || parseChatTabKey(chatKey) === null) return;
  chatBridgeOf(chatKey)?.endTerminals();
}
