import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";
import { canvasViewsKey } from "~/state/canvasViews";

/**
 * Astrolabe: which canvas a thread's Canvas tab shows, by its tool call's item id, and which one it
 * has unlocked for editing. Outside the tab so a remount keeps them; nothing persists, and a tab
 * with none chosen shows the newest.
 */
interface ThreadCanvasStore {
  readonly shownByThread: Readonly<Record<string, string>>;
  readonly editingByThread: Readonly<Record<string, string>>;
  readonly show: (key: string, id: string) => void;
  readonly setEditing: (key: string, id: string | null) => void;
}

export const useThreadCanvasStore = create<ThreadCanvasStore>((set) => ({
  shownByThread: {},
  editingByThread: {},
  show: (key, id) => set((store) => ({ shownByThread: { ...store.shownByThread, [key]: id } })),
  setEditing: (key, id) =>
    set((store) => {
      const { [key]: _, ...rest } = store.editingByThread;
      return { editingByThread: id === null ? rest : { ...rest, [key]: id } };
    }),
}));

/** A thread's board in its Canvas tab; `edit` opens it unlocked, since the chat's copy only reads. */
export function showThreadCanvas(threadRef: ScopedThreadRef, id: string, edit = false) {
  const key = canvasViewsKey(threadRef);
  const store = useThreadCanvasStore.getState();
  store.show(key, id);
  if (edit) store.setEditing(key, id);
  useRightPanelStore.getState().open(threadRef, "canvas");
}
