import { create } from "zustand";

import { NO_KEYED_EXPANSION, type KeyedExpansion } from "../codeGraph/codeGraphData";

/**
 * Astrolabe: what a thread's Graph tab shows, per thread, kept outside the tab so a remount (a
 * tab switch, a pane that moved) keeps it. Nothing persists across a reload: the views themselves
 * live in the thread, and the tab opens on its changes again.
 */
export interface ThreadGraphState {
  /** An agent's view (its tool call's item id) and the step shown; null for the thread's changes. */
  readonly view: { readonly id: string; readonly step: number } | null;
  /** Where the reader re-rooted the graph; null for the thread's changed files. */
  readonly roots: readonly [string, ...string[]] | null;
  readonly expansion: KeyedExpansion;
}

export const INITIAL_THREAD_GRAPH: ThreadGraphState = {
  view: null,
  roots: null,
  expansion: NO_KEYED_EXPANSION,
};

interface ThreadGraphStore {
  readonly byThread: Readonly<Record<string, ThreadGraphState>>;
  readonly update: (key: string, change: (state: ThreadGraphState) => ThreadGraphState) => void;
}

export const useThreadGraphStore = create<ThreadGraphStore>((set) => ({
  byThread: {},
  update: (key, change) =>
    set((store) => ({
      byThread: { ...store.byThread, [key]: change(store.byThread[key] ?? INITIAL_THREAD_GRAPH) },
    })),
}));

/** Show an agent's view from its first step, as a newly landed view does. */
export const showThreadGraphView = (key: string, id: string) =>
  useThreadGraphStore
    .getState()
    .update(key, (state) => ({ ...state, view: { id, step: 0 }, roots: null }));
