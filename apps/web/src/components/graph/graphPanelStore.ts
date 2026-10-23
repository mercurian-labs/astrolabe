import { create } from "zustand";

import { LIVE_STRIP, turnStripReducer, type TurnStrip, type TurnStripAction } from "./turnStrip";

/**
 * The Graph surface's reading state per thread (by `scopedThreadKey`), kept
 * outside the panel so a remount (a tab switch, the panel moving into a wide
 * pane) shows what the reader had: the strip (pinned turn, playback, chosen
 * move) and whether the cursor's popover is open. Only Live, a rollback that
 * took the pinned turn, or the thread settling a pinned live turn resets it.
 * Nothing here persists across a reload.
 */
export interface GraphPanelState {
  readonly strip: TurnStrip;
  readonly popover: boolean;
}

export type GraphPanelAction =
  | TurnStripAction
  | { readonly type: "popover"; readonly open: boolean }
  /** The working turn is `live`, and whether it is still being worked. */
  | { readonly type: "settled"; readonly live: number; readonly working: boolean };

export const CLOSED_PANEL: GraphPanelState = { strip: LIVE_STRIP, popover: false };

export function graphPanelReducer(
  state: GraphPanelState,
  action: GraphPanelAction,
): GraphPanelState {
  switch (action.type) {
    case "popover":
      return state.popover === action.open ? state : { ...state, popover: action.open };
    case "settled": {
      // A turn pinned only because it was the working one (nothing chosen, nothing playing)
      // lets go once its run settles: the strip is live again.
      const { strip } = state;
      const settled =
        strip.pinned === action.live && !action.working && strip.play === null && !strip.playing;
      return settled ? { ...state, strip: LIVE_STRIP } : state;
    }
    case "live":
      return { strip: LIVE_STRIP, popover: false };
    case "pick":
    case "toggle-play": {
      // Picking or playing a turn is reading it: its moves open beside the cursor.
      const strip = turnStripReducer(state.strip, action);
      return strip === state.strip && state.popover ? state : { strip, popover: true };
    }
    default: {
      const strip = turnStripReducer(state.strip, action);
      return strip === state.strip ? state : { ...state, strip };
    }
  }
}

interface GraphPanelStore {
  readonly byThread: Readonly<Record<string, GraphPanelState>>;
  /** Apply `action` to the thread's state, or to `start` when the thread has none yet. */
  readonly dispatch: (threadKey: string, action: GraphPanelAction, start: GraphPanelState) => void;
}

export const useGraphPanelStore = create<GraphPanelStore>((set) => ({
  byThread: {},
  dispatch: (threadKey, action, start) =>
    set((state) => {
      const was = state.byThread[threadKey] ?? start;
      const next = graphPanelReducer(was, action);
      return next === state.byThread[threadKey]
        ? state
        : { byThread: { ...state.byThread, [threadKey]: next } };
    }),
}));
