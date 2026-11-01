import { createContext, useContext } from "react";

import type { PanesHost } from "./panesHost";

/**
 * Astrolabe: the shared panes' host, as what renders inside them shares it. Each open tab renders
 * once into its own container (`containerFor`), which the pane showing the tab takes in. Two
 * things render in one place only and move between containers instead, so they never remount:
 * the front chat's live surface (`surface`, which T3 Code's ChatView renders), and the chat the
 * route shows (`routeNode`, one ChatView kept across thread switches as in T3 Code).
 */
export interface WorkspaceHost extends PanesHost {
  readonly surface: HTMLDivElement;
  readonly routeNode: HTMLDivElement;
  readonly containerFor: (key: string) => HTMLDivElement;
  /** Drops the containers of tabs no longer open. */
  readonly prune: (open: ReadonlySet<string>) => void;
}

export const WorkspaceHostContext = createContext<WorkspaceHost | null>(null);

/** The shared panes' host; null outside them (Changes' panes, a sheet). */
export function useWorkspaceHost(): WorkspaceHost | null {
  return useContext(WorkspaceHostContext);
}

/** The chat (by its tab key) a ChatView inside the shared panes shows. */
export const ChatOwnerContext = createContext<string | null>(null);

export function useChatOwner(): string | null {
  return useContext(ChatOwnerContext);
}
