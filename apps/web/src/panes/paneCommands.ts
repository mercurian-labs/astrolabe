import { focusPane, focusedPane, isEmptyTab, splitTab } from "./arrangement";
import { useMaximizedPaneStore } from "./maximize";
import type { PaneArrangementStore, PaneTabs } from "./panesHost";
import { leaves, type Leaf } from "./tree";

/**
 * What acts on a whole pane, shared by its strip's controls and the keyboard menu: splitting the
 * tab in front into a new pane beside it, closing the pane, and maximizing it. Each says whether
 * it can act, as the strip disables its controls.
 */

/** A pane's only tab stays: splitting it off would leave its pane empty. */
export function canSplitPane(leaf: Leaf) {
  return leaf.tabs.length > 1;
}

/**
 * Moves the tab in front into a new pane beside it, and focus with it, as Vim's `:vs` puts you in
 * the new window. Otherwise focus falls to the page when the tab re-renders in its new pane, and
 * what acts on the focused pane next (the keyboard menu's `:q`) can no longer tell it was there.
 */
export function splitPane(controller: PaneArrangementStore, leaf: Leaf, side: "right" | "bottom") {
  const key = leaf.active;
  controller.update((arrangement) => splitTab(arrangement, key, side));
  // Outside a page (the registry's tests) there is no focus to move.
  if (typeof document === "undefined") return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const pill = [...document.querySelectorAll<HTMLElement>("[data-pane-tab]")].find(
      (element) => element.dataset.key === key,
    );
    pill?.focus({ preventScroll: true });
  });
}

/** A lone pane of empty tabs has nothing to close. */
export function canClosePane(leaf: Leaf, alone: boolean) {
  return !(alone && leaf.tabs.every(isEmptyTab));
}

/** Closes each of the pane's tabs, each of which may ask first. */
export function closePane(tabs: PaneTabs, leaf: Leaf) {
  for (const key of leaf.tabs) tabs.close(key);
}

/** Whether `paneId` fills its arrangement (`layoutKey`) now. */
export function isPaneMaximized(layoutKey: string | null, paneId: string) {
  const { maximized } = useMaximizedPaneStore.getState();
  return maximized !== null && maximized.layoutKey === layoutKey && maximized.paneId === paneId;
}

/** Fills the panes' room with the pane, focusing it, or puts the others back while it does. */
export function toggleMaximizedPane(
  controller: PaneArrangementStore,
  layoutKey: string | null,
  paneId: string,
) {
  if (layoutKey === null) return;
  if (!isPaneMaximized(layoutKey, paneId)) {
    controller.update((arrangement) => focusPane(arrangement, paneId));
  }
  useMaximizedPaneStore.getState().toggle(layoutKey, paneId);
}

/** The focused pane, and whether it is the only one; null before the panes load. */
export function focusedPaneOf(controller: PaneArrangementStore) {
  const snapshot = controller.getSnapshot();
  if (!snapshot) return null;
  return {
    leaf: focusedPane(snapshot.arrangement),
    alone: leaves(snapshot.arrangement.root).length === 1,
  };
}
