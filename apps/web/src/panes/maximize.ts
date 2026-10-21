import { create } from "zustand";

import { usePanesLayoutKey } from "./panesHost";

/**
 * The pane filling its panes' room, as T3 Code maximizes its right panel: one at a time, held in
 * memory only, and only for the arrangement it was maximized in (a thread's right panel, or the
 * Wikis area); another shows its own layout, and a reload restores every pane.
 */
export const useMaximizedPaneStore = create<{
  readonly maximized: { readonly layoutKey: string; readonly paneId: string } | null;
  readonly toggle: (layoutKey: string, paneId: string) => void;
  readonly restore: () => void;
}>((set) => ({
  maximized: null,
  toggle: (layoutKey, paneId) =>
    set(({ maximized }) => ({
      maximized:
        maximized?.layoutKey === layoutKey && maximized.paneId === paneId
          ? null
          : { layoutKey, paneId },
    })),
  restore: () => set({ maximized: null }),
}));

/** The pane maximized in the arrangement on screen, if any. */
export function useMaximizedPaneId(): string | null {
  const layoutKey = usePanesLayoutKey();
  return useMaximizedPaneStore((store) =>
    store.maximized && store.maximized.layoutKey === layoutKey ? store.maximized.paneId : null,
  );
}
