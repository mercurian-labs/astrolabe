import { createTabListStore } from "../titlebarTabs/tabListStore";

/**
 * The chats open as tabs across the top of the chat column, by scoped thread key. Opening a
 * thread anywhere (the sidebar, the command palette, a fork) adds its tab.
 */
export const CHAT_TABS_STORAGE_KEY = "t3code:chat-tabs:v1";

export const useChatTabsStore = createTabListStore(CHAT_TABS_STORAGE_KEY);
