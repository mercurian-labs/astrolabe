import { useCallback, useSyncExternalStore } from "react";

import {
  activateTab,
  allTabs,
  focusedPane,
  isEmptyTab,
  openTab,
  placeTabs,
  replaceTab,
  surfaceIdOf,
  surfaceKey,
  type Arrangement,
} from "~/panes/arrangement";
import { focusedPaneOf, isPaneMaximized, toggleMaximizedPane } from "~/panes/paneCommands";
import type { PanesController } from "~/panes/panesController";
import type { PaneArrangementStore } from "~/panes/panesHost";
import { leafWithTab, leaves, type Side } from "~/panes/tree";
import {
  PULL_REQUESTS_PANEL_REF,
  pullRequestSurface,
  pullRequestSurfaceId,
  selectThreadRightPanelState,
  useRightPanelStore,
  type PullRequestSurface,
} from "~/rightPanelStore";
import {
  dropHistoryTarget,
  historyTarget,
  keepHistories,
  parseHistories,
  replaceInHistory,
  stepHistory,
  type HistoryDirection,
  type RowClickIntent,
  type TabHistories,
} from "~/tabNavigation.logic";

/**
 * Astrolabe: what a click on a Pull Requests sidebar row does to the panes, as a click on a
 * document does in Wikis (see `wikiPanes.ts`). A click shows the pull request in the focused
 * pane's tab in front, which remembers what it showed, for back and forward; Option-click and
 * the middle button open a new tab, as Mod-click does. One open already comes to
 * the front where it is. The tabs mirror the page's right-panel record (`PullRequestPanes`), so
 * every change goes through the record: a replace is one record change that swaps the surface in
 * place.
 */

const HISTORY_STORAGE_KEY = "astrolabe:pull-request-tab-history:v1";

/** The Change Requests area's panes, as their saved arrangement and maximized pane name them. */
export const PULL_REQUEST_PANES_LAYOUT_KEY = "pull-requests";

/** What names a pull request: the server, project, host, repository and number. */
export type PullRequestTarget = Parameters<typeof pullRequestSurface>[0];

/** A pull request named in full, as a tab key that reads on its own names it. */
export type FullPullRequestTarget = PullRequestTarget & {
  readonly environmentId: string;
  readonly host: string;
};

const PULL_REQUEST_ID_PREFIX = "pull-request:";

/**
 * The pull request a tab key names, read from the key alone, so its tab comes back after a reload
 * and can show in any section's panes. Only a key naming its server and host reads: a thread's
 * right panel leaves those out of its own pull requests and takes them from the thread.
 */
export function pullRequestTargetOfKey(key: string): FullPullRequestTarget | null {
  const id = surfaceIdOf(key);
  if (id === null || !id.startsWith(PULL_REQUEST_ID_PREFIX)) return null;
  const parts = id.slice(PULL_REQUEST_ID_PREFIX.length).split(":");
  if (parts.length !== 5) return null;
  try {
    const [environmentId, projectId, host, repository, raw] = parts.map((part) =>
      decodeURIComponent(part),
    );
    const number = Number(raw);
    if (!environmentId || !projectId || !host || !repository) return null;
    if (!Number.isSafeInteger(number) || number <= 0) return null;
    const target = { environmentId, projectId, host, repository, number };
    return pullRequestSurfaceId(target) === id ? target : null;
  } catch {
    return null;
  }
}

/**
 * The pull requests an arrangement shows that the page's record does not hold, in reading
 * order, and the one the focused pane has in front, to bring forward once they are back.
 */
export function pullRequestsToRestore(
  arrangement: Arrangement,
  surfaceIds: readonly string[],
): { readonly targets: readonly PullRequestTarget[]; readonly front: string | null } {
  const held = new Set(surfaceIds);
  const targets = leaves(arrangement.root).flatMap((leaf) =>
    leaf.tabs.flatMap((key) => {
      const target = pullRequestTargetOfKey(key);
      return target && !held.has(surfaceIdOf(key) ?? "") ? [target] : [];
    }),
  );
  const focused = focusedPane(arrangement).active;
  return {
    targets,
    front: pullRequestTargetOfKey(focused) === null ? null : surfaceIdOf(focused),
  };
}

/**
 * Astrolabe: puts the pull requests an arrangement saved on this device back into the page's
 * record, which T3 Code keeps for the session only, so the panes reopen with their tabs.
 */
export function restorePullRequestTabs(arrangement: Arrangement) {
  const store = useRightPanelStore.getState();
  const record = selectThreadRightPanelState(store.byThreadKey, PULL_REQUESTS_PANEL_REF);
  const { targets, front } = pullRequestsToRestore(
    arrangement,
    record.surfaces.map((surface) => surface.id),
  );
  if (targets.length === 0) return;
  for (const target of targets) store.openPullRequest(PULL_REQUESTS_PANEL_REF, target);
  if (front !== null) store.activateSurface(PULL_REQUESTS_PANEL_REF, front);
}

/** What a row click comes to, for the panes as they stand. */
export type PullRequestOpen =
  | { readonly kind: "front"; readonly key: string }
  | { readonly kind: "replace"; readonly from: string }
  /** Astrolabe: in place of a tab that is not a pull request, such as a wiki's change request. */
  | { readonly kind: "replace-other"; readonly from: string }
  | { readonly kind: "tab"; readonly paneId: string };

export function pullRequestOpenFor(
  arrangement: Arrangement,
  surfaceId: string,
  intent: RowClickIntent,
): PullRequestOpen {
  const key = surfaceKey(surfaceId);
  const pane = focusedPane(arrangement);
  if (leafWithTab(arrangement.root, key)) return { kind: "front", key };
  if (intent === "new-tab" || intent === "mod" || isEmptyTab(pane.active)) {
    return { kind: "tab", paneId: pane.id };
  }
  if (surfaceIdOf(pane.active) === null) return { kind: "replace-other", from: pane.active };
  return { kind: "replace", from: pane.active };
}

interface Stored {
  readonly histories: TabHistories;
  /** What each tab key in a history shows, to open it again. */
  readonly surfaces: Readonly<Record<string, PullRequestSurface>>;
}

const EMPTY: Stored = { histories: {}, surfaces: {} };

/** Stored history as far as it reads: the histories, and the pull requests they name. */
export function parseStoredHistory(value: unknown): Stored {
  if (typeof value !== "object" || value === null) return EMPTY;
  const { histories, surfaces } = value as Record<string, unknown>;
  const read: Record<string, PullRequestSurface> = {};
  if (typeof surfaces === "object" && surfaces !== null) {
    for (const [key, entry] of Object.entries(surfaces)) {
      if (typeof entry !== "object" || entry === null) continue;
      const { projectId, repository, number, environmentId, host, url } = entry as Record<
        string,
        unknown
      >;
      if (typeof projectId !== "string" || typeof repository !== "string") continue;
      if (typeof number !== "number") continue;
      read[key] = pullRequestSurface({
        projectId,
        repository,
        number,
        ...(typeof environmentId === "string" ? { environmentId } : {}),
        ...(typeof host === "string" ? { host } : {}),
        ...(typeof url === "string" ? { url } : {}),
      });
    }
  }
  return { histories: parseHistories(histories), surfaces: read };
}

/** Only the histories of the tabs open now, and the pull requests those still name. */
export function keepStoredHistory(stored: Stored, open: Iterable<string>): Stored {
  const histories = keepHistories(stored.histories, open);
  const named = new Set(
    Object.values(histories).flatMap((history) => [...history.back, ...history.forward]),
  );
  const surfaces = Object.fromEntries(
    Object.entries(stored.surfaces).filter(([key]) => named.has(key)),
  );
  return { histories, surfaces };
}

let controller: PanesController | null = null;
let stored: Stored | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentStored(): Stored {
  if (stored === null) {
    try {
      const raw = storage()?.getItem(HISTORY_STORAGE_KEY);
      stored = raw ? parseStoredHistory(JSON.parse(raw)) : EMPTY;
    } catch {
      stored = EMPTY;
    }
  }
  return stored;
}

function setStored(next: Stored) {
  const arrangement = controller?.getSnapshot()?.arrangement;
  stored = arrangement ? keepStoredHistory(next, allTabs(arrangement)) : next;
  try {
    if (Object.keys(stored.histories).length === 0) storage()?.removeItem(HISTORY_STORAGE_KEY);
    else storage()?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage full or blocked: the history still works until the page goes away.
  }
  for (const listener of listeners) listener();
}

/** Listeners of whichever panes are attached, kept across the page leaving and coming back. */
const paneListeners = new Set<() => void>();
let stopForwarding: (() => void) | null = null;
const notifyPaneListeners = () => {
  for (const listener of paneListeners) listener();
};

/** The panes the clicks act on, while the Pull Requests page shows them. */
export function attachPullRequestPanes(next: PanesController): () => void {
  controller = next;
  stopForwarding?.();
  stopForwarding = next.subscribe(notifyPaneListeners);
  notifyPaneListeners();
  return () => {
    if (controller !== next) return;
    controller = null;
    stopForwarding?.();
    stopForwarding = null;
    notifyPaneListeners();
  };
}

/** Astrolabe: the key of the focused Change Requests pane's tab in front; null off the page. */
export function useFocusedChangeRequestTabKey(): string | null {
  return useSyncExternalStore(
    (listener) => {
      paneListeners.add(listener);
      return () => {
        paneListeners.delete(listener);
      };
    },
    () => {
      const arrangement = controller?.getSnapshot()?.arrangement;
      return arrangement ? focusedPane(arrangement).active : null;
    },
  );
}

/**
 * Astrolabe: shows a tab that is not a pull request, such as a wiki's change request, as a click
 * on its row asks: in the focused pane's tab in front (one open already comes forward there; an
 * empty tab fills), or in a new tab with `new-tab`. A pull request it replaces leaves the page's
 * record too.
 */
export function showChangeRequestTab(key: string, intent: "replace" | "new-tab") {
  const arrangement = controller?.getSnapshot()?.arrangement;
  if (!controller || !arrangement) return;
  const front = focusedPane(arrangement).active;
  const replacing =
    !leafWithTab(arrangement.root, key) && intent === "replace" && !isEmptyTab(front);
  controller.update((before) => {
    if (leafWithTab(before.root, key)) return activateTab(before, key);
    const pane = focusedPane(before);
    return replacing ? replaceTab(before, pane.active, key) : openTab(before, key, pane.id);
  });
  if (!replacing) return;
  const replaced = surfaceOf(surfaceIdOf(front));
  if (replaced) useRightPanelStore.getState().closeSurface(PULL_REQUESTS_PANEL_REF, replaced.id);
  const before = currentStored();
  setStored({
    histories: replaceInHistory(before.histories, front, key),
    surfaces: replaced ? { ...before.surfaces, [front]: replaced } : before.surfaces,
  });
}

/**
 * Astrolabe: opens tabs that are not pull requests, dragged from the sidebar, where they land on
 * `paneId` (see `placeTabs`).
 */
export function placeChangeRequestTabs(
  keys: readonly string[],
  front: string,
  paneId: string,
  drop: { readonly side: Side | null; readonly index: number },
) {
  controller?.update((arrangement) => placeTabs(arrangement, keys, paneId, drop, front));
}

function surfaceOf(surfaceId: string | null): PullRequestSurface | null {
  if (surfaceId === null) return null;
  const surface = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    PULL_REQUESTS_PANEL_REF,
  ).surfaces.find((entry) => entry.id === surfaceId);
  return surface?.kind === "pull-request" ? surface : null;
}

/** Shows a pull request as a click on its row asks (`intent`, see `rowClickIntent`). */
export function showPullRequest(
  target: Parameters<typeof pullRequestSurface>[0],
  intent: RowClickIntent,
) {
  const store = useRightPanelStore.getState();
  const surface = pullRequestSurface(target);
  const arrangement = controller?.getSnapshot()?.arrangement;
  if (!controller || !arrangement) {
    store.openPullRequest(PULL_REQUESTS_PANEL_REF, target);
    return;
  }
  const open = pullRequestOpenFor(arrangement, surface.id, intent);
  switch (open.kind) {
    case "front":
      controller.update((before) => activateTab(before, open.key));
      return;
    case "tab":
      controller.targetPane(open.paneId);
      store.openPullRequest(PULL_REQUESTS_PANEL_REF, target);
      return;
    case "replace-other": {
      // The tab takes the pull request's key first, so the record's new surface finds it there.
      const to = surfaceKey(surface.id);
      const before = currentStored();
      controller.update((arrangement) => replaceTab(arrangement, open.from, to));
      store.openPullRequest(PULL_REQUESTS_PANEL_REF, target);
      setStored({
        histories: replaceInHistory(before.histories, open.from, to),
        surfaces: before.surfaces,
      });
      return;
    }
    case "replace": {
      const from = surfaceOf(surfaceIdOf(open.from));
      if (!from) return;
      const before = currentStored();
      const to = surfaceKey(surface.id);
      store.replaceSurface(PULL_REQUESTS_PANEL_REF, from.id, surface);
      setStored({
        histories: replaceInHistory(before.histories, open.from, to),
        surfaces: { ...before.surfaces, [open.from]: from },
      });
      return;
    }
  }
}

/**
 * Opens pull requests dragged from the sidebar where they land on `paneId`, in order, the one
 * dragged (`front`) in front (see `placeTabs`); one open already moves there. Each opens in the
 * page's record first, which the panes follow, and then moves into place.
 */
export function placePullRequests(
  targets: readonly Parameters<typeof pullRequestSurface>[0][],
  front: Parameters<typeof pullRequestSurface>[0],
  paneId: string,
  drop: { readonly side: Side | null; readonly index: number },
) {
  const store = useRightPanelStore.getState();
  for (const target of targets) store.openPullRequest(PULL_REQUESTS_PANEL_REF, target);
  const keyOf = (target: Parameters<typeof pullRequestSurface>[0]) =>
    surfaceKey(pullRequestSurface(target).id);
  controller?.update((arrangement) =>
    placeTabs(arrangement, targets.map(keyOf), paneId, drop, keyOf(front)),
  );
}

/**
 * Steps the focused pane's tab in front back or forward through what it showed. A pull request
 * open in another tab comes to the front there instead; an entry that no longer reads is passed
 * over and forgotten.
 */
export function stepPullRequestTab(direction: HistoryDirection) {
  const arrangement = controller?.getSnapshot()?.arrangement;
  if (!controller || !arrangement) return;
  const active = focusedPane(arrangement).active;
  const current = surfaceOf(surfaceIdOf(active));
  let { histories } = currentStored();
  const { surfaces } = currentStored();
  // Astrolabe: a history can hold tabs other than pull requests, such as a wiki's change request.
  const isOther = (key: string) => surfaceIdOf(key) === null && !isEmptyTab(key);
  let target = historyTarget(histories, active, direction);
  while (target !== null && surfaces[target] === undefined && !isOther(target)) {
    histories = dropHistoryTarget(histories, active, direction);
    target = historyTarget(histories, active, direction);
  }
  if (target === null || (!current && !isOther(active))) {
    if (histories !== currentStored().histories) setStored({ histories, surfaces });
    return;
  }
  if (leafWithTab(arrangement.root, target)) {
    controller.update((before) => activateTab(before, target));
    return;
  }
  const stepped = stepHistory(histories, active, direction);
  if (!stepped) return;
  const store = useRightPanelStore.getState();
  const surface = surfaces[target];
  if (surface && current) {
    store.replaceSurface(PULL_REQUESTS_PANEL_REF, current.id, surface);
  } else if (surface) {
    controller.update((before) => replaceTab(before, active, target));
    store.openPullRequest(PULL_REQUESTS_PANEL_REF, surface);
  } else {
    controller.update((before) => replaceTab(before, active, target));
    if (current) store.closeSurface(PULL_REQUESTS_PANEL_REF, current.id);
  }
  setStored({
    histories: stepped.histories,
    surfaces: current ? { ...surfaces, [active]: current } : surfaces,
  });
}

/**
 * Astrolabe: a review's Guide gets the window for its tour, as T3 Code hid the pull request list
 * for it. Called as the tour of `surfaceId` comes on screen: when that pull request is the
 * focused pane's tab in front, `hideList` folds the sidebar's list away, and the pane is
 * maximized, as its Maximize pane does, when other panes share the area. As in T3 Code, nothing
 * comes back as the tour leaves. `panes` are the attached ones unless a test passes its own.
 */
export function maximizeForGuide(
  surfaceId: string,
  hideList: () => void,
  panes: PaneArrangementStore | null = controller,
) {
  const focused = panes ? focusedPaneOf(panes) : null;
  if (!panes || !focused || surfaceIdOf(focused.leaf.active) !== surfaceId) return;
  hideList();
  const paneId = focused.leaf.id;
  if (focused.alone || isPaneMaximized(PULL_REQUEST_PANES_LAYOUT_KEY, paneId)) return;
  toggleMaximizedPane(panes, PULL_REQUEST_PANES_LAYOUT_KEY, paneId);
}

/** Whether the focused pane's tab in front has anything back (or forward) to show. */
export function usePullRequestTabHistory(panes: PanesController): {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
} {
  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      const stopPanes = panes.subscribe(listener);
      return () => {
        listeners.delete(listener);
        stopPanes();
      };
    },
    [panes],
  );
  const read = (direction: HistoryDirection) => () => {
    const arrangement = panes.getSnapshot()?.arrangement;
    if (!arrangement) return false;
    return (
      historyTarget(currentStored().histories, focusedPane(arrangement).active, direction) !== null
    );
  };
  const canGoBack = useSyncExternalStore(subscribe, read("back"));
  const canGoForward = useSyncExternalStore(subscribe, read("forward"));
  return { canGoBack, canGoForward };
}
