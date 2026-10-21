import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";

import { usePanesThreadRef } from "./PaneSurfaceHost";

/**
 * The pane filling the main area, as T3 Code maximizes its right panel: one at a time, held in
 * memory only, and only for the thread it was maximized in; another thread shows its own
 * layout, and a reload restores every pane.
 */
export const useMaximizedPaneStore = create<{
  readonly maximized: { readonly threadKey: string; readonly paneId: string } | null;
  readonly toggle: (threadKey: string, paneId: string) => void;
  readonly restore: () => void;
}>((set) => ({
  maximized: null,
  toggle: (threadKey, paneId) =>
    set(({ maximized }) => ({
      maximized:
        maximized?.threadKey === threadKey && maximized.paneId === paneId
          ? null
          : { threadKey, paneId },
    })),
  restore: () => set({ maximized: null }),
}));

/** The pane maximized in the thread on screen, if any. */
export function useMaximizedPaneId(): string | null {
  const ref = usePanesThreadRef();
  const threadKey = ref ? scopedThreadKey(ref) : null;
  return useMaximizedPaneStore((store) =>
    store.maximized && store.maximized.threadKey === threadKey ? store.maximized.paneId : null,
  );
}

/** Maximizes `paneId` in the thread on screen, or restores it when it is already. */
export function useToggleMaximized(): (paneId: string) => void {
  const ref = usePanesThreadRef();
  const toggle = useMaximizedPaneStore((store) => store.toggle);
  return (paneId) => {
    if (ref) toggle(scopedThreadKey(ref), paneId);
  };
}
