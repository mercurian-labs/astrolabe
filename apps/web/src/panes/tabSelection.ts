import { create } from "zustand";

import type { Leaf } from "./tree";

/**
 * The tabs selected together, as the sidebar selects threads: ⌘/Ctrl-click toggles one,
 * Shift-click selects from the anchor to it, and a plain click opens a tab and makes it the
 * anchor without selecting it. A selection lives in one pane, whose order its ranges follow;
 * selecting in another pane starts afresh there.
 */
export interface TabSelection {
  readonly paneId: string | null;
  readonly keys: readonly string[];
  readonly anchor: string | null;
}

export const NO_TAB_SELECTION: TabSelection = { paneId: null, keys: [], anchor: null };

/** ⌘/Ctrl-click: adds a tab to its pane's selection, or takes it out. */
export function toggleTab(selection: TabSelection, paneId: string, key: string): TabSelection {
  if (selection.paneId !== paneId) return { paneId, keys: [key], anchor: key };
  if (selection.keys.includes(key)) {
    return { ...selection, keys: selection.keys.filter((selected) => selected !== key) };
  }
  return { paneId, keys: [...selection.keys, key], anchor: key };
}

/**
 * Shift-click: adds every tab from the anchor to `key`, both included, in the pane's order.
 * Without an anchor in that pane, it selects `key` alone and anchors there.
 */
export function selectRange(selection: TabSelection, leaf: Leaf, key: string): TabSelection {
  const anchor = selection.paneId === leaf.id ? selection.anchor : null;
  const from = anchor === null ? -1 : leaf.tabs.indexOf(anchor);
  const to = leaf.tabs.indexOf(key);
  if (from === -1 || to === -1) return toggleTab(selection, leaf.id, key);
  const range = leaf.tabs.slice(Math.min(from, to), Math.max(from, to) + 1);
  const kept = selection.paneId === leaf.id ? selection.keys : [];
  return { paneId: leaf.id, keys: [...new Set([...kept, ...range])], anchor };
}

/** A plain click: the tab opened is the anchor, and nothing stays selected. */
export function anchorAt(paneId: string, key: string): TabSelection {
  return { paneId, keys: [], anchor: key };
}

/** The selected tabs still in `leaf`, in its order. */
export function selectedIn(selection: TabSelection, leaf: Leaf): readonly string[] {
  return selection.paneId === leaf.id
    ? leaf.tabs.filter((key) => selection.keys.includes(key))
    : [];
}

/**
 * The tabs an action on `key` covers: the selection, when `key` is part of one of two or more,
 * else `key` alone.
 */
export function tabsActedOn(selection: TabSelection, leaf: Leaf, key: string): readonly string[] {
  const selected = selectedIn(selection, leaf);
  return selected.length > 1 && selected.includes(key) ? selected : [key];
}

export const useTabSelectionStore = create<{
  readonly selection: TabSelection;
  readonly change: (update: (selection: TabSelection) => TabSelection) => void;
}>((set) => ({
  selection: NO_TAB_SELECTION,
  change: (update) => set((state) => ({ selection: update(state.selection) })),
}));
