import { createContext, useContext, type ReactNode } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";

import type { PanesController } from "./panesController";

/**
 * What the right panel's panes share with everything rendered inside them: the controller, and
 * the DOM container of the active surface. The surface renders once into its container, and the
 * pane showing it takes the container in, so moving its tab never remounts it.
 */
export interface PanesHost {
  readonly controller: PanesController;
  readonly surface: HTMLDivElement;
  /** Moves the surface's container into a pane's slot, unless it is there, and shows or hides it. */
  place(slot: HTMLElement, visible: boolean): void;
  /** Hides the surface's container wherever it is. */
  hide(): void;
}

export function createPanesHost(controller: PanesController): PanesHost {
  const surface = document.createElement("div");
  surface.className = "absolute inset-0 flex min-h-0 min-w-0 flex-col";
  surface.dataset.panesContent = "surface";
  return {
    controller,
    surface,
    place(slot, visible) {
      // Moving a node that is already in place would still detach and reattach it.
      if (surface.parentNode !== slot) slot.appendChild(surface);
      surface.style.display = visible ? "" : "none";
    },
    hide() {
      surface.style.display = "none";
    },
  };
}

export const PanesHostContext = createContext<PanesHost | null>(null);

/** The thread whose right panel the panes show; render reads it here, not from the controller. */
export const PanesThreadContext = createContext<ScopedThreadRef | null>(null);

export function usePanesThreadRef(): ScopedThreadRef | null {
  return useContext(PanesThreadContext);
}

export function usePanesHost(): PanesHost {
  const host = useContext(PanesHostContext);
  if (!host) throw new Error("usePanesHost must be used inside the thread's panes.");
  return host;
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
