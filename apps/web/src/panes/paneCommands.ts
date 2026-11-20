import { focusPane, focusedPane, isEmptyTab, resizePanes, splitTab } from "./arrangement";
import { useMaximizedPaneStore } from "./maximize";
import type { PaneArrangementStore, PaneTabs } from "./panesHost";
import {
  leaves,
  MIN_SPLIT_PX,
  neighbourLeaf,
  parentOf,
  swapLeafTabs,
  type Leaf,
  type Side,
} from "./tree";

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

/** Astrolabe: the pane beside the focused one that its tabs would trade places with. */
export function paneToward(controller: PaneArrangementStore, leaf: Leaf, side: Side) {
  const snapshot = controller.getSnapshot();
  return snapshot ? neighbourLeaf(snapshot.arrangement.root, leaf.id, side) : null;
}

/** Trades the pane's tabs with its neighbour's on `side`; focus, and maximizing, move with them. */
export function movePane(
  controller: PaneArrangementStore,
  layoutKey: string | null,
  leaf: Leaf,
  side: Side,
) {
  const target = paneToward(controller, leaf, side);
  if (!target) return;
  controller.update((arrangement) =>
    focusPane(
      { ...arrangement, root: swapLeafTabs(arrangement.root, leaf.id, target.id) },
      target.id,
    ),
  );
  if (layoutKey !== null && isPaneMaximized(layoutKey, leaf.id)) {
    useMaximizedPaneStore.getState().toggle(layoutKey, target.id);
  }
}

/** The shares a pane steps through, as T3 Code's column width presets do. */
const SIZE_STEPS = [1 / 3, 1 / 2, 2 / 3];

/** Whether the pane divides room with another, so it has a size to change. */
export function canResizePane(controller: PaneArrangementStore, leaf: Leaf) {
  const snapshot = controller.getSnapshot();
  return snapshot ? parentOf(snapshot.arrangement.root, leaf.id) !== null : false;
}

/**
 * Weights giving child `index` its next share (a third, a half, two thirds, then a third again),
 * the rest keeping their proportions, skipping one that leaves a pane under `MIN_SPLIT_PX` of
 * `extentPx`. The weights as they were when none fits.
 */
export function cycledWeights(
  weights: readonly number[],
  index: number,
  extentPx = Number.POSITIVE_INFINITY,
): readonly number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const own = weights[index] ?? 0;
  const others = total - own || 1;
  const next = SIZE_STEPS.findIndex((step) => step > own / total + 0.01);
  const start = next === -1 ? 0 : next;
  const order = [...SIZE_STEPS.slice(start), ...SIZE_STEPS.slice(0, start)];
  for (const share of order) {
    const sized = weights.map((weight, at) =>
      at === index ? share : ((1 - share) * weight) / others,
    );
    if (sized.every((weight) => weight * extentPx >= MIN_SPLIT_PX)) return sized;
  }
  return weights;
}

/** Steps the pane's share of the room it divides with its siblings. */
export function cyclePaneSize(controller: PaneArrangementStore, leaf: Leaf) {
  controller.update((arrangement) => {
    const parent = parentOf(arrangement.root, leaf.id);
    if (!parent) return arrangement;
    const { branch, index } = parent;
    // The room the branch divides: the pane's size on screen over its share of it.
    const box =
      typeof document === "undefined"
        ? null
        : document.querySelector(`[data-pane-id="${leaf.id}"]`)?.getBoundingClientRect();
    const total = branch.weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const share = (branch.weights[index] ?? 0) / total;
    const size = box ? (branch.direction === "row" ? box.width : box.height) : 0;
    const extent = size > 0 && share > 0 ? size / share : Number.POSITIVE_INFINITY;
    return resizePanes(arrangement, branch.id, cycledWeights(branch.weights, index, extent));
  });
}
