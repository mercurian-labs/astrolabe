import type { CanvasBoardFocus } from "@mercurian/wiki-editor/canvas-board";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { useRightPanelStore } from "~/rightPanelStore";
import { canvasViewsKey } from "~/state/canvasViews";

/**
 * Astrolabe: which canvas a thread's Canvas tab shows, by its tool call's item id, which one it
 * has unlocked for editing, and the frame it was last asked to bring into view. Outside the tab so
 * a remount keeps them; nothing persists, and a tab with none chosen shows the newest.
 */
interface ThreadCanvasStore {
  readonly shownByThread: Readonly<Record<string, string>>;
  readonly editingByThread: Readonly<Record<string, string>>;
  readonly focusByThread: Readonly<Record<string, CanvasBoardFocus & { readonly id: string }>>;
  readonly show: (key: string, id: string) => void;
  readonly setEditing: (key: string, id: string | null) => void;
}

export const useThreadCanvasStore = create<ThreadCanvasStore>((set) => ({
  shownByThread: {},
  editingByThread: {},
  focusByThread: {},
  show: (key, id) => set((store) => ({ shownByThread: { ...store.shownByThread, [key]: id } })),
  setEditing: (key, id) =>
    set((store) => {
      const { [key]: _, ...rest } = store.editingByThread;
      return { editingByThread: id === null ? rest : { ...rest, [key]: id } };
    }),
}));

let focusRequests = 0;

/**
 * A thread's board in its Canvas tab; `edit` opens it unlocked, since the chat's copy only reads,
 * and `frame` brings that named group into view, as a `[[Name.canvas#Group]]` asks.
 */
export function showThreadCanvas(
  threadRef: ScopedThreadRef,
  id: string,
  options: { readonly edit?: boolean; readonly frame?: string | undefined } = {},
) {
  const key = canvasViewsKey(threadRef);
  const store = useThreadCanvasStore.getState();
  store.show(key, id);
  if (options.edit === true) store.setEditing(key, id);
  if (options.frame !== undefined) {
    focusRequests += 1;
    const focus = { id, group: options.frame, request: focusRequests };
    useThreadCanvasStore.setState((state) => ({
      focusByThread: { ...state.focusByThread, [key]: focus },
    }));
  } else {
    useThreadCanvasStore.setState((state) => {
      if (!(key in state.focusByThread)) return state;
      const { [key]: _, ...rest } = state.focusByThread;
      return { focusByThread: rest };
    });
  }
  useRightPanelStore.getState().open(threadRef, "canvas");
}
