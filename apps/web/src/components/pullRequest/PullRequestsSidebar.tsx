import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isElectron } from "~/env";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { SidebarSectionTitle } from "../sidebar/SidebarThreadHeader";

/**
 * Astrolabe: the Change Requests section's sidebar (pull requests and the wikis' change
 * requests), as Threads and Wikis have theirs. The sidebar
 * draws the frame (the brand row, the section's title row, the footer); the list and its
 * controls stay with the page that queries, filters and selects them, which portals them in.
 */

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

export function PullRequestsSidebar() {
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1">
        <SidebarSectionTitle>Changes</SidebarSectionTitle>
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
export function PullRequestsSidebarPortal({
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
