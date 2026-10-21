import { useMemo, useSyncExternalStore } from "react";

import {
  activateTab,
  allTabs,
  closeTab,
  focusedPane,
  isEmptyTab,
  openBeside,
  openTab,
  replaceTab,
  startingArrangement,
  type Arrangement,
} from "~/panes/arrangement";
import type { PaneArrangementSnapshot, PaneArrangementStore } from "~/panes/panesHost";
import { isStarting, parseArrangement } from "~/panes/persistence";
import { parseWikiTabKey, sameWikiTab, wikiTabKey, type WikiTab } from "./wikiTabs";

/**
 * The Wikis area's tabs and splits: one arrangement on the device, as Obsidian keeps one
 * workspace, holding documents from every server and wiki. It lives outside React so the
 * sidebar, links and deep links can open documents into it.
 */
const STORAGE_KEY = "astrolabe:wiki-panes:v1";
const PERSIST_DELAY_MS = 150;

const isWikiPaneKey = (key: string) => isEmptyTab(key) || parseWikiTabKey(key) !== null;

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

function save(arrangement: Arrangement) {
  try {
    if (isStarting(arrangement)) storage()?.removeItem(STORAGE_KEY);
    else storage()?.setItem(STORAGE_KEY, JSON.stringify(arrangement));
  } catch {
    // Storage full or blocked: the panes still work until the page goes away.
  }
}

let snapshot: PaneArrangementSnapshot | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function current(): PaneArrangementSnapshot {
  snapshot ??= { arrangement: load(), hostPaneId: null };
  return snapshot;
}

function flush() {
  if (pending) clearTimeout(pending);
  pending = null;
  if (snapshot) save(snapshot.arrangement);
}

export const wikiPanes: PaneArrangementStore & { flush(): void } = {
  update(change) {
    const before = current().arrangement;
    const next = change(before);
    if (next === before) return;
    snapshot = { arrangement: next, hostPaneId: null };
    pending ??= setTimeout(flush, PERSIST_DELAY_MS);
    for (const listener of listeners) listener();
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
 * Shows `next` in `from`'s tab, as following a link does in Obsidian. When `next` is open in
 * another tab already, that tab comes to the front instead.
 */
export function replaceWikiTab(from: string, next: WikiTab) {
  wikiPanes.update((arrangement) => {
    const open = openKeyFor(arrangement, next);
    if (open !== null) return activateTab(arrangement, open);
    return replaceTab(arrangement, from, wikiTabKey(next));
  });
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

/** The document in the focused pane's front tab; null for an empty tab. */
export function useFocusedWikiTab(): WikiTab | null {
  const key = useSyncExternalStore(
    wikiPanes.subscribe,
    () => focusedPane(current().arrangement).active,
  );
  return parseWikiTabKey(key);
}

/** Every open tab's key, in pane order. */
export function useOpenWikiTabKeys(): readonly string[] {
  const arrangement = useSyncExternalStore(wikiPanes.subscribe, () => current().arrangement);
  return useMemo(() => allTabs(arrangement), [arrangement]);
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
