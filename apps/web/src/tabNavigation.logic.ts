/**
 * Astrolabe: how a tab (a chat tab, a wiki pane's tab) walks what it has shown, as a browser's
 * tab does, and what a click on a sidebar row asks of the tabs. A tab is known by the key of what
 * it shows now (a thread's scoped key, a wiki tab's key), unique among the open tabs, so each
 * tab's history is kept under that key and moves with it.
 */

/** What a tab showed before what it shows now (`back`, oldest first), and after (`forward`, nearest first). */
export interface TabHistory {
  readonly back: readonly string[];
  readonly forward: readonly string[];
}

export type TabHistories = Readonly<Record<string, TabHistory>>;

/** How many entries each way a tab remembers; older ones fall off. */
export const TAB_HISTORY_LIMIT = 50;

const EMPTY: TabHistory = { back: [], forward: [] };

const historyOf = (histories: TabHistories, key: string): TabHistory => histories[key] ?? EMPTY;

function without(histories: TabHistories, key: string): Record<string, TabHistory> {
  const { [key]: _dropped, ...rest } = histories;
  return rest;
}

/**
 * The tab showing `from` now shows `to`, as a click replaces it: `from` joins its back history
 * and its forward history clears.
 */
export function replaceInHistory(histories: TabHistories, from: string, to: string): TabHistories {
  if (from === to) return histories;
  const { back } = historyOf(histories, from);
  return {
    ...without(histories, from),
    [to]: { back: [...back, from].slice(-TAB_HISTORY_LIMIT), forward: [] },
  };
}

/** The tab showing `from` now shows `to` as the same page under a new key: its history follows. */
export function rekeyHistory(histories: TabHistories, from: string, to: string): TabHistories {
  if (from === to || histories[from] === undefined) return histories;
  return { ...without(histories, from), [to]: historyOf(histories, from) };
}

export type HistoryDirection = "back" | "forward";

/** What the tab showing `key` would show a step `direction`; null with nothing that way. */
export function historyTarget(
  histories: TabHistories,
  key: string,
  direction: HistoryDirection,
): string | null {
  const { back, forward } = historyOf(histories, key);
  return (direction === "back" ? back.at(-1) : forward[0]) ?? null;
}

/** The histories once the tab showing `key` steps `direction`, and what it shows then. */
export function stepHistory(
  histories: TabHistories,
  key: string,
  direction: HistoryDirection,
): { readonly histories: TabHistories; readonly target: string } | null {
  const target = historyTarget(histories, key, direction);
  if (target === null) return null;
  const { back, forward } = historyOf(histories, key);
  const next: TabHistory =
    direction === "back"
      ? { back: back.slice(0, -1), forward: [key, ...forward].slice(0, TAB_HISTORY_LIMIT) }
      : { back: [...back, key].slice(-TAB_HISTORY_LIMIT), forward: forward.slice(1) };
  return { histories: { ...without(histories, key), [target]: next }, target };
}

/**
 * The histories with the entry the tab showing `key` would step to `direction` gone, as when it
 * names something that no longer exists.
 */
export function dropHistoryTarget(
  histories: TabHistories,
  key: string,
  direction: HistoryDirection,
): TabHistories {
  const history = histories[key];
  if (!history) return histories;
  const next =
    direction === "back"
      ? { back: history.back.slice(0, -1), forward: history.forward }
      : { back: history.back, forward: history.forward.slice(1) };
  return { ...histories, [key]: next };
}

/** Only the histories of the tabs open now, as when tabs close. */
export function keepHistories(histories: TabHistories, open: Iterable<string>): TabHistories {
  const kept: Record<string, TabHistory> = {};
  let dropped = false;
  const openKeys = new Set(open);
  for (const [key, history] of Object.entries(histories)) {
    if (openKeys.has(key)) kept[key] = history;
    else dropped = true;
  }
  return dropped ? kept : histories;
}

/** Stored histories as far as they read: well-formed entries only, each within the limit. */
export function parseHistories(value: unknown): TabHistories {
  if (typeof value !== "object" || value === null) return {};
  const strings = (list: unknown) =>
    Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : [];
  const parsed: Record<string, TabHistory> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { back, forward } = entry as Record<string, unknown>;
    parsed[key] = {
      back: strings(back).slice(-TAB_HISTORY_LIMIT),
      forward: strings(forward).slice(0, TAB_HISTORY_LIMIT),
    };
  }
  return parsed;
}

/**
 * What a click on a sidebar row asks for: a new tab (Option/Alt-click, or the middle button),
 * the row's Mod-click (a thread's multi-select, a document's open beside), its Shift-click (a
 * thread's range select), or else what the focused tab shows replaced.
 */
export type RowClickIntent = "new-tab" | "mod" | "range" | "replace";

/** The parts of a click (or of a menu item standing for one) that say what it asks for. */
export interface RowClick {
  readonly button: number;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

/** A click asking for a new tab, as a row's "Open in new tab" stands for. */
export const NEW_TAB_CLICK: RowClick = {
  button: 0,
  altKey: true,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
};

export function rowClickIntent(event: RowClick, mac: boolean): RowClickIntent {
  if (event.button === 1 || event.altKey) return "new-tab";
  if (mac ? event.metaKey : event.ctrlKey) return "mod";
  if (event.shiftKey) return "range";
  return "replace";
}
