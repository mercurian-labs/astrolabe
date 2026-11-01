import { createContext, useContext, type ReactNode } from "react";

/**
 * Draws a strip of chat tabs where ChatView puts them, across the top of its chat column.
 * Astrolabe's chats are tabs of the shared panes now, whose strips hold them, so nothing provides
 * one; ChatView still reads it.
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
