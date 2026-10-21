import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ScopedThreadRef } from "@t3tools/contracts";

import type { PanelProps, PanesController } from "./panesController";

/**
 * What the panes share with everything rendered inside them: the controller, and the DOM
 * containers that move between panes. The conversation and the active surface each render once
 * into their own container, and a pane takes the container in when it shows them, so moving a
 * tab never remounts ChatView or a surface.
 */
export interface PanesHost {
  readonly controller: PanesController;
  readonly conversation: HTMLDivElement;
  readonly surface: HTMLDivElement;
  /** A guest thread's conversation container, by its scoped key, made the first time asked. */
  guest(threadKey: string): HTMLDivElement;
  /** Hides every guest container but those of `shown`, as guests whose tabs went or hid. */
  hideGuestsExcept(shown: ReadonlySet<string>): void;
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
  const guests = new Map<string, HTMLDivElement>();
  return {
    controller,
    ...containers,
    guest(threadKey) {
      let container = guests.get(threadKey);
      if (!container) {
        container = makeContainer("conversation");
        container.style.display = "none";
        guests.set(threadKey, container);
      }
      return container;
    },
    hideGuestsExcept(shown) {
      for (const [threadKey, container] of guests) {
        if (!shown.has(threadKey)) container.style.display = "none";
      }
    },
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

/** The thread the panes show; render reads it here rather than from the controller. */
export const PanesThreadContext = createContext<ScopedThreadRef | null>(null);

export function usePanesThreadRef(): ScopedThreadRef | null {
  return useContext(PanesThreadContext);
}

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
  const member = useContext(PaneMemberContext);
  const isHost = member === null || member.role === "host";
  useLayoutEffect(() => {
    if (isHost) host?.controller.setPanel(props);
  });
  // A guest's surfaces stay its own: its panel draws nothing in the host's workspace.
  return host && isHost ? createPortal(props.children, host.surface) : null;
}

/**
 * Which thread a ChatView inside the panes renders for: the workspace's host (the route's
 * thread), or a guest visiting it. `active` says whether the focused pane shows it; only the
 * active one answers the page's keys, paste and focus, so a key acts once, on the thread you
 * are in.
 */
export type PaneMember =
  | { readonly role: "host"; readonly active: boolean }
  | { readonly role: "guest"; readonly threadKey: string; readonly active: boolean };

const PaneMemberContext = createContext<PaneMember | null>(null);

export const PaneMemberProvider = PaneMemberContext.Provider;

export function usePaneMember(): PaneMember | null {
  return useContext(PaneMemberContext);
}

/** Whether this ChatView is in the panes but not the thread the focused pane shows. */
export function usePaneMemberInactive(): boolean {
  const member = useContext(PaneMemberContext);
  return member !== null && !member.active;
}

/** Whether this view renders a guest: it never moves the route, which belongs to the host. */
export function usePaneGuest(): boolean {
  return useContext(PaneMemberContext)?.role === "guest";
}

/** Opens a thread as a guest in the workspace on screen, as a fork or a related thread does. */
export type OpenGuest = (thread: ScopedThreadRef) => void;

const OpenGuestContext = createContext<OpenGuest | null>(null);

export const OpenGuestProvider = OpenGuestContext.Provider;

/**
 * Inside the panes, how a thread made or picked from here (a fork, a thread in Lineage) opens:
 * as a guest beside the conversation. Null outside them, where it opens as T3 Code navigates.
 */
export function usePaneOpenGuest(): OpenGuest | null {
  return useContext(OpenGuestContext);
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
