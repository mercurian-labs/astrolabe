import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";
import { canvasViewsKey } from "~/state/canvasViews";

/**
 * Astrolabe: which canvas a thread's Canvas tab shows, by its tool call's item id. Outside the
 * tab so a remount keeps it; nothing persists, and a tab with none chosen shows the newest.
 */
interface ThreadCanvasStore {
  readonly shownByThread: Readonly<Record<string, string>>;
  readonly show: (key: string, id: string) => void;
}

export const useThreadCanvasStore = create<ThreadCanvasStore>((set) => ({
  shownByThread: {},
  show: (key, id) => set((store) => ({ shownByThread: { ...store.shownByThread, [key]: id } })),
}));

export function showThreadCanvas(threadRef: ScopedThreadRef, id: string) {
  useThreadCanvasStore.getState().show(canvasViewsKey(threadRef), id);
  useRightPanelStore.getState().open(threadRef, "canvas");
}
