import { createContext, useContext } from "react";

import type { PanesHost } from "./panesHost";

/**
 * Astrolabe: the shared panes' host. Each tab renders once into its own container, which moves
 * between panes with its tab, so what it shows never remounts.
 */
export interface WorkspaceHost extends PanesHost {
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

/**
 * The tab, by its key in the shared panes, whose content renders here, so its header's back and
 * forward walk that tab's own history; null outside the shared panes.
 */
export const PaneTabKeyContext = createContext<string | null>(null);
