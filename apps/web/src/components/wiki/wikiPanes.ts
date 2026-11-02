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
  type Arrangement,
} from "~/panes/arrangement";
import type { Side } from "~/panes/tree";
import { hasUnsavedEdits } from "~/panes/unsavedEdits";
import { parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { workspace } from "~/panes/workspace";
import { rekeyHistory, replaceInHistory, type HistoryDirection } from "~/tabNavigation.logic";
import { parseWikiTabKey, sameWikiTab, wikiTabKey, type WikiTab } from "./wikiTabs";

/**
 * Astrolabe: the Wikis section's way into the shared panes (`workspace`), like Obsidian's
 * workspace: documents from every server and wiki open as tabs there, beside chats and files.
 * The sidebar, links and deep links open documents through these.
 */
export const wikiPanes = workspace.store;

const current = () => ({ arrangement: workspace.arrangement() });
const updateWithHistory = workspace.updateWithHistory;

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
 * Shows a document as a click on its sidebar row does, in place of the focused pane's tab in
 * front whatever it shows, as `workspace.show` does for files: that tab remembers what it showed
 * (see `replaceWikiTab`). One open already comes to the front where it is; an empty tab is
 * filled, and a chat, a linked tab or one with unsaved edits makes way for a new tab.
 */
export function showWikiTab(tab: WikiTab) {
  const linked = workspace.linked();
  const active = focusedPane(linked.arrangement).active;
  if (
    openKeyFor(linked.arrangement, tab) !== null ||
    isEmptyTab(active) ||
    hasUnsavedEdits(active) ||
    parseChatTabKey(active) !== null ||
    active in linked.owners
  ) {
    openWikiTab(tab);
    return;
  }
  replaceWikiTab(active, tab);
}

/** Steps the focused pane's tab in front back or forward through what it showed. */
export const stepWikiTab = (direction: HistoryDirection) => workspace.step(direction);

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
