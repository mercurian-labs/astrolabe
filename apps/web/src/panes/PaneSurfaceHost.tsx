import { createContext, useContext, type ReactNode } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";

import type { PanesController } from "./panesController";
import type { PanesHost } from "./panesHost";

/**
 * The right panel's panes, as everything rendered inside them shares them: the controller, and
 * the DOM container of the active surface. The surface renders once into its container, and the
 * pane showing it takes the container in, so moving its tab never remounts it.
 */
export interface RightPanelHost extends PanesHost {
  readonly controller: PanesController;
  readonly surface: HTMLDivElement;
  /** Moves the surface's container into a pane's slot, unless it is there, and shows or hides it. */
  place(slot: HTMLElement, visible: boolean): void;
  /** Hides the surface's container wherever it is. */
  hide(): void;
}

export const RightPanelHostContext = createContext<RightPanelHost | null>(null);

export function useRightPanelHost(): RightPanelHost {
  const host = useContext(RightPanelHostContext);
  if (!host) throw new Error("useRightPanelHost must be used inside the thread's panes.");
  return host;
}

/** The thread whose right panel the panes show; render reads it here, not from the controller. */
export const PanesThreadContext = createContext<ScopedThreadRef | null>(null);

export function usePanesThreadRef(): ScopedThreadRef | null {
  return useContext(PanesThreadContext);
}

const PaneSurfaceHostContext = createContext(false);

/**
 * Whether the panes draw ChatView's right panel. When they do, ChatView renders
 * `RightPanelPanes` in place of its panel's strip.
 */
export function usePaneSurfaceHost(): boolean {
  return useContext(PaneSurfaceHostContext);
}

export function PaneSurfaceHostProvider({ children }: { children: ReactNode }) {
  return <PaneSurfaceHostContext.Provider value>{children}</PaneSurfaceHostContext.Provider>;
}
