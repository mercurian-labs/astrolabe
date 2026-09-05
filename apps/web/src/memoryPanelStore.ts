/**
 * Line-scoped Memory panel selection.
 *
 * Selection lives outside the tab so a note mention, a checkpoint's amendment
 * effect, or a graph node can address the surface while it is unmounted, and
 * so the selection survives closing and reopening the singleton tab.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { useRightPanelStore } from "./rightPanelStore";

export type MemorySelection =
  | { readonly kind: "document"; readonly id: string }
  | { readonly kind: "amendment"; readonly id: string }
  /** A note addressed by name; the tab resolves it against the line's changed documents. */
  | { readonly kind: "note"; readonly name: string };

interface MemoryPanelStoreState {
  selectionByThreadKey: Record<string, MemorySelection>;
  graphOpenByThreadKey: Record<string, boolean>;
  select: (ref: ScopedThreadRef, selection: MemorySelection | null) => void;
  setGraphOpen: (ref: ScopedThreadRef, open: boolean) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

export const useMemoryPanelStore = create<MemoryPanelStoreState>()((set) => ({
  selectionByThreadKey: {},
  graphOpenByThreadKey: {},
  select: (ref, selection) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (selection === null) {
        if (!(threadKey in state.selectionByThreadKey)) return state;
        const { [threadKey]: _removed, ...rest } = state.selectionByThreadKey;
        return { selectionByThreadKey: rest };
      }
      return { selectionByThreadKey: { ...state.selectionByThreadKey, [threadKey]: selection } };
    }),
  setGraphOpen: (ref, open) =>
    set((state) => ({
      graphOpenByThreadKey: { ...state.graphOpenByThreadKey, [scopedThreadKey(ref)]: open },
    })),
  removeThread: (ref) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const { [threadKey]: _selection, ...selectionByThreadKey } = state.selectionByThreadKey;
      const { [threadKey]: _graph, ...graphOpenByThreadKey } = state.graphOpenByThreadKey;
      return { selectionByThreadKey, graphOpenByThreadKey };
    }),
}));

export function selectMemorySelection(
  byThreadKey: Record<string, MemorySelection>,
  ref: ScopedThreadRef | null,
): MemorySelection | null {
  return ref === null ? null : (byThreadKey[scopedThreadKey(ref)] ?? null);
}

export function selectMemoryGraphOpen(
  byThreadKey: Record<string, boolean>,
  ref: ScopedThreadRef | null,
): boolean {
  return ref === null ? false : (byThreadKey[scopedThreadKey(ref)] ?? false);
}

/** Address the line's Memory tab with a selection and bring it forward. */
export function revealMemorySelection(ref: ScopedThreadRef, selection: MemorySelection): void {
  useMemoryPanelStore.getState().select(ref, selection);
  useRightPanelStore.getState().open(ref, "memory");
}
