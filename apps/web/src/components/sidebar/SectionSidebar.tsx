import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isElectron } from "~/env";
import { SidebarChromeFooter, SidebarChromeHeader } from "./SidebarChrome";
import { SidebarSectionTitle } from "./SidebarThreadHeader";

/**
 * Astrolabe: a section's sidebar whose list lives with the page that queries, filters and selects
 * it (Changes, Issues). The sidebar draws the frame (the brand row, the section's title row, the
 * footer); the page portals its controls in, and its rows open tabs of the shared panes.
 */
export function createSectionSidebar() {
  let titleActions: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  function Frame({ title }: { readonly title: ReactNode }) {
    return (
      <>
        <SidebarChromeHeader isElectron={isElectron} />
        <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1">
          <SidebarSectionTitle>{title}</SidebarSectionTitle>
          <div
            ref={(element) => {
              titleActions = element;
              notify();
            }}
            className="flex shrink-0 items-center"
          />
        </div>
        <div
          ref={(element) => {
            body = element;
            notify();
          }}
          className="flex min-h-0 flex-1 flex-col"
        />
        <SidebarChromeFooter />
      </>
    );
  }

  /**
   * Puts the page's controls into the sidebar: `actions` at the end of the title row, `children`
   * beneath it. Renders nothing until the sidebar is mounted.
   */
  function Portal({
    actions,
    children,
  }: {
    readonly actions: ReactNode;
    readonly children: ReactNode;
  }) {
    const actionsSlot = useSyncExternalStore(subscribe, () => titleActions);
    const bodySlot = useSyncExternalStore(subscribe, () => body);
    return (
      <>
        {actionsSlot ? createPortal(actions, actionsSlot) : null}
        {bodySlot ? createPortal(children, bodySlot) : null}
      </>
    );
  }

  return { Frame, Portal };
}
