import { useSyncExternalStore } from "react";

import { hasUnsavedEdits } from "~/components/wiki/wikiPanes";
import {
  dropHistoryTarget,
  historyTarget,
  keepHistories,
  parseHistories,
  replaceInHistory,
  stepHistory,
  type HistoryDirection,
  type TabHistories,
} from "~/tabNavigation.logic";
import {
  activateTab,
  allTabs,
  closeTab,
  focusedPane,
  focusPane,
  isEmptyTab,
  openBeside,
  openTab,
  placeTabs,
  replaceTab,
  startingArrangement,
  type Arrangement,
} from "./arrangement";
import type { PaneArrangementSnapshot, PaneArrangementStore } from "./panesHost";
import { isStarting, parseArrangement } from "./persistence";
import { findLeaf, type Side } from "./tree";

const PERSIST_DELAY_MS = 150;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Astrolabe: a section's tabs and splits, one arrangement on the device, kept outside React so
 * its sidebar and links can open tabs into it, as the Wikis area's are (`wikiPanes`). A tab's key
 * names what it shows, so the same thing is the same key; each tab walks back and forward through
 * what it showed. `isKey` says which keys the section keeps across a reload.
 */
export function createSectionPanes({
  storageKey,
  historyStorageKey,
  isKey,
}: {
  readonly storageKey: string;
  readonly historyStorageKey: string;
  readonly isKey: (key: string) => boolean;
}) {
  let snapshot: PaneArrangementSnapshot | null = null;
  let histories: TabHistories | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const current = (): PaneArrangementSnapshot => {
    if (snapshot === null) {
      let arrangement: Arrangement | null = null;
      try {
        const raw = storage()?.getItem(storageKey);
        arrangement = raw
          ? parseArrangement(JSON.parse(raw), (key) => isEmptyTab(key) || isKey(key))
          : null;
      } catch {
        arrangement = null;
      }
      snapshot = { arrangement: arrangement ?? startingArrangement(), hostPaneId: null };
    }
    return snapshot;
  };
  const currentHistories = (): TabHistories => {
    if (histories === null) {
      try {
        const raw = storage()?.getItem(historyStorageKey);
        histories = raw
          ? keepHistories(parseHistories(JSON.parse(raw)), allTabs(current().arrangement))
          : {};
      } catch {
        histories = {};
      }
    }
    return histories;
  };
  const flush = () => {
    if (pending) clearTimeout(pending);
    pending = null;
    if (!snapshot) return;
    try {
      if (isStarting(snapshot.arrangement)) storage()?.removeItem(storageKey);
      else storage()?.setItem(storageKey, JSON.stringify(snapshot.arrangement));
      const kept = currentHistories();
      if (Object.keys(kept).length === 0) storage()?.removeItem(historyStorageKey);
      else storage()?.setItem(historyStorageKey, JSON.stringify(kept));
    } catch {
      // Storage full or blocked: the panes still work until the page goes away.
    }
  };
  const updateWithHistory = (
    change: (arrangement: Arrangement) => Arrangement,
    history?: (histories: TabHistories) => TabHistories,
  ) => {
    const before = current().arrangement;
    const beforeHistories = currentHistories();
    const next = change(before);
    const nextHistories = keepHistories(
      history ? history(beforeHistories) : beforeHistories,
      allTabs(next),
    );
    if (next === before && nextHistories === beforeHistories) return;
    snapshot = { arrangement: next, hostPaneId: null };
    histories = nextHistories;
    pending ??= setTimeout(flush, PERSIST_DELAY_MS);
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const store: PaneArrangementStore & { flush(): void } = {
    update: (change) => updateWithHistory(change),
    getSnapshot: current,
    subscribe,
    flush,
  };

  /** Shows `key`: in front where it is open, else in `paneId` (the focused pane), or beside it. */
  const open = (key: string, placement: "tab" | "beside" = "tab", paneId?: string) =>
    updateWithHistory((arrangement) => {
      const isOpen = allTabs(arrangement).includes(key);
      if (isOpen && placement === "tab") return activateTab(arrangement, key);
      const target = paneId ?? arrangement.focused;
      return placement === "beside"
        ? openBeside(arrangement, key, target, "right")
        : openTab(arrangement, key, target);
    });

  /** Opens tabs dragged from the sidebar where they land, `front` in front (see `placeTabs`). */
  const place = (
    keys: readonly string[],
    front: string,
    paneId: string,
    drop: { readonly side: Side | null; readonly index: number },
  ) => updateWithHistory((arrangement) => placeTabs(arrangement, keys, paneId, drop, front));

  /**
   * Shows `key` as a sidebar row's click does: in the focused pane's tab in front (or `paneId`'s,
   * which takes focus), which remembers what it showed. One open already comes to the front; an
   * empty tab, or one with unsaved edits, makes way for a new tab.
   */
  const show = (key: string, paneId?: string) => {
    const arrangement = current().arrangement;
    const pane =
      (paneId === undefined ? undefined : findLeaf(arrangement.root, paneId)) ??
      focusedPane(arrangement);
    const active = pane.active;
    if (allTabs(arrangement).includes(key) || isEmptyTab(active) || hasUnsavedEdits(active)) {
      open(key, "tab", pane.id);
      return;
    }
    updateWithHistory(
      (before) => focusPane(replaceTab(before, active, key), pane.id),
      (tabHistories) => replaceInHistory(tabHistories, active, key),
    );
  };

  /** Steps the focused pane's tab in front back or forward through what it showed. */
  const step = (direction: HistoryDirection) => {
    const arrangement = current().arrangement;
    const active = focusedPane(arrangement).active;
    let tabHistories = currentHistories();
    let target = historyTarget(tabHistories, active, direction);
    while (target !== null && !isKey(target)) {
      tabHistories = dropHistoryTarget(tabHistories, active, direction);
      target = historyTarget(tabHistories, active, direction);
    }
    const pruned = tabHistories;
    if (target === null || hasUnsavedEdits(active) || allTabs(arrangement).includes(target)) {
      const goTo = target;
      updateWithHistory(
        (before) =>
          goTo === null
            ? before
            : allTabs(before).includes(goTo)
              ? activateTab(before, goTo)
              : openTab(before, goTo, before.focused),
        () => pruned,
      );
      return;
    }
    const stepped = stepHistory(pruned, active, direction);
    if (!stepped) return;
    const to = target;
    updateWithHistory(
      (before) => replaceTab(before, active, to),
      () => stepped.histories,
    );
  };

  const close = (key: string) => updateWithHistory((arrangement) => closeTab(arrangement, key));

  /** Whether the focused pane's tab in front has anything back, or forward, to show. */
  const canStep = (direction: HistoryDirection) =>
    historyTarget(currentHistories(), focusedPane(current().arrangement).active, direction) !==
    null;

  /** The arrangement as it stands. */
  const arrangement = () => current().arrangement;

  return { store, arrangement, open, place, show, step, close, canStep };
}

export type SectionPanes = ReturnType<typeof createSectionPanes>;

// The hooks read a section's panes from outside its factory, so the React Compiler never lifts
// their callbacks away from the panes they read.

/** Whether the focused pane's tab in front has anything back (or forward) to show. */
export function useSectionTabHistory(panes: SectionPanes) {
  const canGoBack = useSyncExternalStore(panes.store.subscribe, () => panes.canStep("back"));
  const canGoForward = useSyncExternalStore(panes.store.subscribe, () => panes.canStep("forward"));
  return { canGoBack, canGoForward };
}

/** The section's arrangement as it stands. */
export function useSectionArrangement(panes: SectionPanes) {
  return useSyncExternalStore(panes.store.subscribe, panes.arrangement);
}

/** Every open tab's key, in pane order. */
export function useSectionOpenKeys(panes: SectionPanes) {
  const arrangement = useSectionArrangement(panes);
  return allTabs(arrangement);
}

/** The key of the focused pane's tab in front. */
export function useSectionFocusedKey(panes: SectionPanes) {
  return useSyncExternalStore(panes.store.subscribe, () => focusedPane(panes.arrangement()).active);
}
