import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * A strip of tabs' open keys, in strip order. The tab in front is the route's, so the list holds
 * only which tabs are open and where; showing a route opens its tab. The list is the device's,
 * kept across reloads under `storageKey`.
 */
export interface TabListState {
  readonly keys: readonly string[];
  /** Adds a tab at the end of the strip, unless it is open already. */
  readonly open: (key: string) => void;
  /** Removes a tab. */
  readonly close: (key: string) => void;
  /** Moves a tab to `index`, counted before the move. */
  readonly move: (key: string, index: number) => void;
}

export function createTabListStore(storageKey: string) {
  return create<TabListState>()(
    persist(
      (set) => ({
        keys: [],
        open: (key) => set(({ keys }) => (keys.includes(key) ? {} : { keys: [...keys, key] })),
        close: (key) =>
          set(({ keys }) => (keys.includes(key) ? { keys: keys.filter((k) => k !== key) } : {})),
        move: (key, index) => set(({ keys }) => ({ keys: moveKey(keys, key, index) })),
      }),
      {
        name: storageKey,
        version: 1,
        storage: createJSONStorage(() => window.localStorage),
        partialize: ({ keys }) => ({ keys }),
      },
    ),
  );
}

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
 * The tab to show when `key` closes: the one after it, else the one before it; null when it was
 * the only one, or is not open.
 */
export function neighbourOf(keys: readonly string[], key: string): string | null {
  const at = keys.indexOf(key);
  if (at === -1) return null;
  return keys[at + 1] ?? keys[at - 1] ?? null;
}
