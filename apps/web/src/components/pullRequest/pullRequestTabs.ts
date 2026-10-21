import { useCallback, useSyncExternalStore } from "react";

import {
  activateTab,
  allTabs,
  focusedPane,
  isEmptyTab,
  placeTabs,
  surfaceIdOf,
  surfaceKey,
  type Arrangement,
} from "~/panes/arrangement";
import type { PanesController } from "~/panes/panesController";
import { leafWithTab, type Side } from "~/panes/tree";
import {
  PULL_REQUESTS_PANEL_REF,
  pullRequestSurface,
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

/** What a row click comes to, for the panes as they stand. */
export type PullRequestOpen =
  | { readonly kind: "front"; readonly key: string }
  | { readonly kind: "replace"; readonly from: string }
  | { readonly kind: "tab"; readonly paneId: string };

export function pullRequestOpenFor(
  arrangement: Arrangement,
  surfaceId: string,
  intent: RowClickIntent,
): PullRequestOpen {
  const key = surfaceKey(surfaceId);
  const pane = focusedPane(arrangement);
  if (leafWithTab(arrangement.root, key)) return { kind: "front", key };
  if (
    intent === "new-tab" ||
    intent === "mod" ||
    isEmptyTab(pane.active) ||
    surfaceIdOf(pane.active) === null
  ) {
    return { kind: "tab", paneId: pane.id };
  }
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

/** The panes the clicks act on, while the Pull Requests page shows them. */
export function attachPullRequestPanes(next: PanesController): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
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
  let target = historyTarget(histories, active, direction);
  while (target !== null && surfaces[target] === undefined) {
    histories = dropHistoryTarget(histories, active, direction);
    target = historyTarget(histories, active, direction);
  }
  const surface = target === null ? undefined : surfaces[target];
  if (target === null || !surface || !current) {
    if (histories !== currentStored().histories) setStored({ histories, surfaces });
    return;
  }
  if (leafWithTab(arrangement.root, target)) {
    controller.update((before) => activateTab(before, target));
    return;
  }
  const stepped = stepHistory(histories, active, direction);
  if (!stepped) return;
  useRightPanelStore.getState().replaceSurface(PULL_REQUESTS_PANEL_REF, current.id, surface);
  setStored({ histories: stepped.histories, surfaces: { ...surfaces, [active]: current } });
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
