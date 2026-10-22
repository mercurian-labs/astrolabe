import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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

/**
 * The chats open as tabs across the main area, by scoped thread key, in strip order. The tab in
 * front is the route's thread, so the list holds only which chats are open and where. Showing a
 * thread anywhere (a sidebar row, the command palette, a fork, a new thread) shows it in the tab
 * in front, as a browser's tab follows a link, unless it is open in another tab already, which
 * comes to the front instead; a new tab opens only when asked for (`openNew`). Each tab walks
 * back and forward through what it showed (`histories`, under the key it shows now). The tabs
 * are the device's, kept across reloads.
 */
export interface ChatTabsLayout {
  readonly keys: readonly string[];
  /** The tab in front, as the route last showed it; a route's next thread replaces it. */
  readonly active: string | null;
  readonly histories: TabHistories;
}

interface ChatTabsState extends ChatTabsLayout {
  /** The route shows `key` now: its tab comes to the front, else it replaces the tab in front. */
  readonly arrive: (key: string) => void;
  /** Opens a chat's tab after the one in front, unless it is open already; the route shows it next. */
  readonly openNew: (key: string) => void;
  /**
   * Steps the tab in front back or forward through what it showed; the key to show next, which
   * the caller routes to, or null with nothing that way. A chat open in another tab is shown
   * there instead; one `reachable` says is gone is passed over and forgotten.
   */
  readonly step: (
    direction: HistoryDirection,
    reachable: (key: string) => boolean,
  ) => string | null;
  /** Removes a chat's tab. */
  readonly close: (key: string) => void;
  /** Moves a chat's tab to `index`, counted before the move. */
  readonly move: (key: string, index: number) => void;
  /** Opens chats as tabs together at `index`, as `openTabsAt` does; the route shows one next. */
  readonly openAt: (keys: readonly string[], index: number) => void;
  /** Opens chats as tabs together after the one in front, which stays (`openTabsBesideFront`). */
  readonly openBesideFront: (keys: readonly string[]) => void;
}

export const CHAT_TABS_STORAGE_KEY = "t3code:chat-tabs:v1";

/** The tabs once the route shows `key`, as `arrive` does. */
export function arriveAt(layout: ChatTabsLayout, key: string): ChatTabsLayout {
  const { keys, active, histories } = layout;
  if (keys.includes(key)) return active === key ? layout : { ...layout, active: key };
  const at = active === null ? -1 : keys.indexOf(active);
  if (active === null || at === -1) return { ...layout, keys: [...keys, key], active: key };
  return {
    keys: keys.map((open, index) => (index === at ? key : open)),
    active: key,
    histories: replaceInHistory(histories, active, key),
  };
}

/** The tabs with `key` open in a new tab after the one in front, as `openNew` does. */
export function openNewTab(layout: ChatTabsLayout, key: string): ChatTabsLayout {
  const { keys, active } = layout;
  if (keys.includes(key)) return layout;
  const at = active === null ? -1 : keys.indexOf(active);
  const index = at === -1 ? keys.length : at + 1;
  return { ...layout, keys: [...keys.slice(0, index), key, ...keys.slice(index)] };
}

/**
 * The tabs once the tab in front steps `direction`, and the key to show (null with nowhere to
 * go). Entries `reachable` says are gone are passed over and forgotten.
 */
export function stepTab(
  layout: ChatTabsLayout,
  direction: HistoryDirection,
  reachable: (key: string) => boolean = () => true,
): { readonly layout: ChatTabsLayout; readonly target: string | null } {
  const { keys, active } = layout;
  if (active === null || !keys.includes(active)) return { layout, target: null };
  let { histories } = layout;
  let target = historyTarget(histories, active, direction);
  while (target !== null && !reachable(target)) {
    histories = dropHistoryTarget(histories, active, direction);
    target = historyTarget(histories, active, direction);
  }
  const pruned = histories === layout.histories ? layout : { ...layout, histories };
  if (target === null) return { layout: pruned, target };
  // No chat shows in two tabs: one open elsewhere comes to the front where it is.
  if (keys.includes(target)) return { layout: pruned, target };
  const stepped = stepHistory(histories, active, direction);
  if (!stepped) return { layout: pruned, target: null };
  return {
    layout: {
      keys: keys.map((open) => (open === active ? target : open)),
      active: target,
      histories: stepped.histories,
    },
    target,
  };
}

export const useChatTabsStore = create<ChatTabsState>()(
  persist(
    (set, get) => ({
      keys: [],
      active: null,
      histories: {},
      arrive: (key) => set((state) => arriveAt(state, key)),
      openNew: (key) => set((state) => openNewTab(state, key)),
      step: (direction, reachable) => {
        const stepped = stepTab(get(), direction, reachable);
        set(stepped.layout);
        return stepped.target;
      },
      close: (key) =>
        set(({ keys, histories }) => {
          if (!keys.includes(key)) return {};
          const rest = keys.filter((k) => k !== key);
          return { keys: rest, histories: keepHistories(histories, rest) };
        }),
      move: (key, index) => set(({ keys }) => ({ keys: moveKey(keys, key, index) })),
      openAt: (keys, index) => set((state) => openTabsAt(state, keys, index)),
      openBesideFront: (keys) => set((state) => openTabsBesideFront(state, keys)),
    }),
    {
      name: CHAT_TABS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ keys, active, histories }) => ({ keys, active, histories }),
      // Stored before tabs had histories, a layout holds only `keys`.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<Record<keyof ChatTabsLayout, unknown>>;
        const keys = Array.isArray(stored.keys)
          ? stored.keys.filter((key): key is string => typeof key === "string")
          : current.keys;
        const active = typeof stored.active === "string" ? stored.active : null;
        return {
          ...current,
          keys,
          active: active !== null && keys.includes(active) ? active : null,
          histories: keepHistories(parseHistories(stored.histories), keys),
        };
      },
    },
  ),
);

/** `keys` with `key` moved to `index`, counted before the move as an insertion line shows it. */
export function moveKey(keys: readonly string[], key: string, index: number): readonly string[] {
  const from = keys.indexOf(key);
  if (from === -1) return keys;
  const at = Math.max(0, Math.min(keys.length, index)) - (from < index ? 1 : 0);
  if (at === from) return keys;
  const rest = keys.filter((k) => k !== key);
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

/**
 * Astrolabe: the tabs with `opened` side by side at `index` (counted before, as an insertion line
 * shows it), as threads dragged from the sidebar onto the strip land. One open already moves
 * there, keeping its history; the others are new tabs.
 */
export function openTabsAt(
  layout: ChatTabsLayout,
  opened: readonly string[],
  index: number,
): ChatTabsLayout {
  const moving = new Set(opened);
  if (moving.size === 0) return layout;
  const at = Math.max(0, Math.min(layout.keys.length, index));
  const before = layout.keys.slice(0, at).filter((key) => !moving.has(key));
  const after = layout.keys.slice(at).filter((key) => !moving.has(key));
  return { ...layout, keys: [...before, ...moving, ...after] };
}

/**
 * Astrolabe: the tabs with `opened` side by side right after the one in front (at the end with
 * none), as a change group's threads open from its tab beside a thread; the tab in front stays.
 */
export function openTabsBesideFront(
  layout: ChatTabsLayout,
  opened: readonly string[],
): ChatTabsLayout {
  const at = layout.active === null ? -1 : layout.keys.indexOf(layout.active);
  return openTabsAt(layout, opened, at === -1 ? layout.keys.length : at + 1);
}

/**
 * The tab to show when `key` closes: the one after it, else the one before it; null when it was
 * the only one, or is not open.
 */
export function neighbourOf(keys: readonly string[], key: string): string | null {
  const at = keys.indexOf(key);
  if (at === -1) return null;
  return keys[at + 1] ?? keys[at - 1] ?? null;
}
