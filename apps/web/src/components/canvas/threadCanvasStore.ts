import { create } from "zustand";

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
