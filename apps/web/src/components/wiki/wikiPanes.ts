import { useSyncExternalStore } from "react";

import {
  activateTab,
  allTabs,
  closeTab,
  focusedPane,
  isEmptyTab,
  openBeside,
  openTab,
  placeTabs,
  replaceTab,
  startingArrangement,
  type Arrangement,
} from "~/panes/arrangement";
import type { Side } from "~/panes/tree";
import type { PaneArrangementSnapshot, PaneArrangementStore } from "~/panes/panesHost";
import { isStarting, parseArrangement } from "~/panes/persistence";
import {
  dropHistoryTarget,
  historyTarget,
  keepHistories,
  parseHistories,
  rekeyHistory,
  replaceInHistory,
  stepHistory,
  type HistoryDirection,
  type TabHistories,
} from "~/tabNavigation.logic";
import { isSectionTabKey } from "~/sectionTabs/sectionTabs";
import { pullRequestTargetOfKey } from "../pullRequest/pullRequestTabs";
import { parseWikiTabKey, sameWikiTab, wikiTabKey, type WikiTab } from "./wikiTabs";

/**
 * The Wikis area's tabs and splits: one device-wide arrangement, like Obsidian's workspace, holding
 * documents from every server and wiki. It lives outside React so the sidebar, links and deep links
 * can open documents into it. Each tab's back/forward history is kept beside the arrangement.
 */
const STORAGE_KEY = "astrolabe:wiki-panes:v1";
const HISTORY_STORAGE_KEY = "astrolabe:wiki-tab-history:v1";
const PERSIST_DELAY_MS = 150;

/** The Wikis area keeps its documents, and the chats and pull requests opened beside them. */
const isWikiPaneKey = (key: string) =>
  isEmptyTab(key) || isSectionTabKey(key) || pullRequestTargetOfKey(key) !== null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function load(): Arrangement {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    return (raw ? parseArrangement(JSON.parse(raw), isWikiPaneKey) : null) ?? startingArrangement();
  } catch {
    return startingArrangement();
  }
}

function save(arrangement: Arrangement, tabHistories: TabHistories) {
  try {
    if (isStarting(arrangement)) storage()?.removeItem(STORAGE_KEY);
    else storage()?.setItem(STORAGE_KEY, JSON.stringify(arrangement));
    if (Object.keys(tabHistories).length === 0) storage()?.removeItem(HISTORY_STORAGE_KEY);
    else storage()?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(tabHistories));
  } catch {
    // Storage full or blocked: the panes still work until the page goes away.
  }
}

function loadHistories(arrangement: Arrangement): TabHistories {
  try {
    const raw = storage()?.getItem(HISTORY_STORAGE_KEY);
    return raw ? keepHistories(parseHistories(JSON.parse(raw)), allTabs(arrangement)) : {};
  } catch {
    return {};
  }
}

let snapshot: PaneArrangementSnapshot | null = null;
let histories: TabHistories | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function current(): PaneArrangementSnapshot {
  snapshot ??= { arrangement: load(), hostPaneId: null };
  return snapshot;
}

function currentHistories(): TabHistories {
  histories ??= loadHistories(current().arrangement);
  return histories;
}

function flush() {
  if (pending) clearTimeout(pending);
  pending = null;
  if (snapshot) save(snapshot.arrangement, currentHistories());
}

/**
 * Changes the arrangement and, with `history`, the tabs' histories with it; a tab that closes
 * forgets its history.
 */
function updateWithHistory(
  change: (arrangement: Arrangement) => Arrangement,
  history?: (histories: TabHistories) => TabHistories,
) {
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
}

export const wikiPanes: PaneArrangementStore & { flush(): void } = {
  update(change) {
    updateWithHistory(change);
  },
  getSnapshot: current,
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  flush,
};

/** The key of an open tab showing `tab`, if one is open. */
function openKeyFor(arrangement: Arrangement, tab: WikiTab): string | null {
  for (const key of allTabs(arrangement)) {
    const open = parseWikiTabKey(key);
    if (open && sameWikiTab(open, tab)) return key;
  }
  return null;
}

type OpenPlacement = "tab" | "beside";

/**
 * Shows a document. One already open comes to the front where it is; otherwise it opens in
 * `paneId` (the focused pane by default), or in a new pane to its right with `beside`.
 */
export function openWikiTab(tab: WikiTab, placement: OpenPlacement = "tab", paneId?: string) {
  wikiPanes.update((arrangement) => {
    const open = openKeyFor(arrangement, tab);
    if (open !== null && placement === "tab") return activateTab(arrangement, open);
    const key = open ?? wikiTabKey(tab);
    const target = paneId ?? arrangement.focused;
    return placement === "beside"
      ? openBeside(arrangement, key, target, "right")
      : openTab(arrangement, key, target);
  });
}

/**
 * Astrolabe: opens documents dragged from the sidebar where they land on `paneId`, in order,
 * the one dragged (`front`) in front (see `placeTabs`); one open already moves there.
 */
export function placeWikiTabs(
  tabs: readonly WikiTab[],
  front: WikiTab,
  paneId: string,
  drop: { readonly side: Side | null; readonly index: number },
) {
  wikiPanes.update((arrangement) => {
    const keyOf = (tab: WikiTab) => openKeyFor(arrangement, tab) ?? wikiTabKey(tab);
    return placeTabs(arrangement, tabs.map(keyOf), paneId, drop, keyOf(front));
  });
}

/**
 * Shows `next` in `from`'s tab, as following a link does in Obsidian: `from` joins the tab's back
 * history. `rekey` keeps the history as it is instead, for the same page under a new key (a note
 * saved into a change request). When `next` is open in another tab already, that tab comes to
 * the front instead.
 */
export function replaceWikiTab(from: string, next: WikiTab, { rekey = false } = {}) {
  const key = wikiTabKey(next);
  let replaced = false;
  updateWithHistory(
    (arrangement) => {
      const open = openKeyFor(arrangement, next);
      if (open !== null) return activateTab(arrangement, open);
      replaced = true;
      return replaceTab(arrangement, from, key);
    },
    (tabHistories) =>
      !replaced
        ? tabHistories
        : rekey
          ? rekeyHistory(tabHistories, from, key)
          : replaceInHistory(tabHistories, from, key),
  );
}

/**
 * Shows a document as a click on its sidebar row does, in the focused pane's tab in front, which
 * remembers what it showed (see `replaceWikiTab`). One open already comes to the front where it
 * is; an empty tab, or one with unsaved edits, makes way for a new tab instead.
 */
export function showWikiTab(tab: WikiTab) {
  const arrangement = current().arrangement;
  const active = focusedPane(arrangement).active;
  if (openKeyFor(arrangement, tab) !== null || isEmptyTab(active) || hasUnsavedEdits(active)) {
    openWikiTab(tab);
    return;
  }
  replaceWikiTab(active, tab);
}

/**
 * Steps the focused pane's tab in front back or forward through what it showed. A document open
 * in another tab comes to the front there; with unsaved edits in the tab, the step opens in a new
 * tab rather than drop them, as following a link does.
 */
export function stepWikiTab(direction: HistoryDirection) {
  const arrangement = current().arrangement;
  const active = focusedPane(arrangement).active;
  let tabHistories = currentHistories();
  let target = historyTarget(tabHistories, active, direction);
  // An entry that no longer reads as a wiki tab is passed over and forgotten.
  while (target !== null && parseWikiTabKey(target) === null) {
    tabHistories = dropHistoryTarget(tabHistories, active, direction);
    target = historyTarget(tabHistories, active, direction);
  }
  const tab = target === null ? null : parseWikiTabKey(target);
  if (target === null || tab === null || hasUnsavedEdits(active) || openKeyFor(arrangement, tab)) {
    const pruned = tabHistories;
    updateWithHistory(
      (before) => (tab ? openTabOrFront(before, tab) : before),
      () => pruned,
    );
    return;
  }
  const stepped = stepHistory(tabHistories, active, direction);
  if (!stepped) return;
  updateWithHistory(
    (before) => replaceTab(before, active, target),
    () => stepped.histories,
  );
}

function openTabOrFront(arrangement: Arrangement, tab: WikiTab): Arrangement {
  const open = openKeyFor(arrangement, tab);
  return open !== null
    ? activateTab(arrangement, open)
    : openTab(arrangement, wikiTabKey(tab), arrangement.focused);
}

/** Whether the focused pane's tab in front has anything back (or forward) to show. */
export function useWikiTabHistory(): {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
} {
  const read = (direction: HistoryDirection) => () =>
    historyTarget(currentHistories(), focusedPane(current().arrangement).active, direction) !==
    null;
  const canGoBack = useSyncExternalStore(wikiPanes.subscribe, read("back"));
  const canGoForward = useSyncExternalStore(wikiPanes.subscribe, read("forward"));
  return { canGoBack, canGoForward };
}

/** Closes the tabs showing anything of a wiki, as when it is removed. */
export function closeWikiTabs(match: (tab: WikiTab) => boolean) {
  wikiPanes.update((arrangement) =>
    allTabs(arrangement).reduce((next, key) => {
      const tab = parseWikiTabKey(key);
      return tab && match(tab) ? closeTab(next, key) : next;
    }, arrangement),
  );
}

/** The focused pane's front tab, read outside React. */
export const focusedWikiTabKey = () => focusedPane(current().arrangement).active;

/** The document in the focused pane's front tab; null for an empty tab. */
export function useFocusedWikiTab(): WikiTab | null {
  const key = useSyncExternalStore(wikiPanes.subscribe, focusedWikiTabKey);
  return parseWikiTabKey(key);
}

/** The Wikis area's arrangement as it stands. */
export function useWikiArrangement(): Arrangement {
  return useSyncExternalStore(wikiPanes.subscribe, () => current().arrangement);
}

/** Every open tab's key, in pane order. */
export function useOpenWikiTabKeys(): readonly string[] {
  const arrangement = useWikiArrangement();
  return allTabs(arrangement);
}

/**
 * Asks before a tab with unsaved edits closes. A note view registers how to tell whether its
 * edits are unsaved, under its tab's key, while it is mounted.
 */
const unsaved = new Map<string, () => boolean>();

export function registerUnsavedCheck(key: string, check: () => boolean) {
  unsaved.set(key, check);
  return () => {
    if (unsaved.get(key) === check) unsaved.delete(key);
  };
}

export function hasUnsavedEdits(key: string): boolean {
  return unsaved.get(key)?.() ?? false;
}
