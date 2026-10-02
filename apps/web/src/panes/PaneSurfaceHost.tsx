import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { PanelProps, PanesController } from "./panesController";

/**
 * What the panes share with everything rendered inside them: the controller, and the two DOM
 * containers that move between panes. The conversation and the active surface each render once
 * into their own container, and a pane takes the container in when it shows them, so moving a
 * tab never remounts ChatView or a surface.
 */
export interface PanesHost {
  readonly controller: PanesController;
  readonly conversation: HTMLDivElement;
  readonly surface: HTMLDivElement;
  /** Moves a container into a pane's slot, unless it is there already, and shows or hides it. */
  place(kind: "conversation" | "surface", slot: HTMLElement, visible: boolean): void;
  /** Hides a container wherever it is. */
  hide(kind: "conversation" | "surface"): void;
}

function makeContainer(kind: "conversation" | "surface") {
  const element = document.createElement("div");
  // ThreadRouteView sizes its frame to the viewport; inside a pane it fills the pane instead.
  element.className =
    "absolute inset-0 flex min-h-0 min-w-0 flex-col [&>main]:h-full [&>main]:min-h-0";
  element.dataset.panesContent = kind;
  return element;
}

export function createPanesHost(controller: PanesController): PanesHost {
  const containers = {
    conversation: makeContainer("conversation"),
    surface: makeContainer("surface"),
  };
  return {
    controller,
    ...containers,
    place(kind, slot, visible) {
      const container = containers[kind];
      // Moving a node that is already in place would still detach and reattach it.
      if (container.parentNode !== slot) slot.appendChild(container);
      container.style.display = visible ? "" : "none";
    },
    hide(kind) {
      containers[kind].style.display = "none";
    },
  };
}

export const PanesHostContext = createContext<PanesHost | null>(null);

export function usePanesHost(): PanesHost {
  const host = useContext(PanesHostContext);
  if (!host) throw new Error("usePanesHost must be used inside the thread's panes.");
  return host;
}

/**
 * Stands in for ChatView's right-panel strip while the panes show the thread: it hands the
 * strip's props to the panes, which draw the surfaces as tabs, and renders the active surface's
 * content into the container of the pane showing it.
 */
export function PaneSurfaceTabs(props: PanelProps) {
  const host = useContext(PanesHostContext);
  useLayoutEffect(() => {
    host?.controller.setPanel(props);
  });
  return host ? createPortal(props.children, host.surface) : null;
}

const PaneSurfaceHostContext = createContext(false);

/**
 * Whether the panes host ChatView's right-panel surfaces. When they do, ChatView renders
 * `PaneSurfaceTabs` in place of its panel and keeps the panel out of its layout; outside the
 * panes it keeps its panel.
 */
export function usePaneSurfaceHost(): boolean {
  return useContext(PaneSurfaceHostContext);
}

export function PaneSurfaceHostProvider({ children }: { children: ReactNode }) {
  return <PaneSurfaceHostContext.Provider value>{children}</PaneSurfaceHostContext.Provider>;
}
