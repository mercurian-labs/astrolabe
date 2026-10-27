import { useEffect } from "react";
import { create } from "zustand";

import {
  type CommandPaletteUiAction,
  type CommandPaletteUiState,
  reduceCommandPaletteUiState,
} from "./components/CommandPalette.logic";

const INITIAL_STATE: CommandPaletteUiState = {
  open: false,
  mode: "command",
  openIntent: null,
  session: 0,
};

export const useCommandPaletteStore = create<CommandPaletteUiState>(() => INITIAL_STATE);

export function dispatchCommandPalette(action: CommandPaletteUiAction): void {
  useCommandPaletteStore.setState((state) => reduceCommandPaletteUiState(state, action), true);
}

// The palette is only mounted on app-shell routes (not /pair, sign-in or
// landings), so its shortcuts must stay inert elsewhere.
let mountedPalettes = 0;

export function isCommandPaletteMounted(): boolean {
  return mountedPalettes > 0;
}

// Astrolabe: an open asked for before the palette mounts (Vim's `:` just after a page load)
// waits for the mount instead of being lost. Only set while nothing is mounted.
let pendingOpen: CommandPaletteUiAction | null = null;

/** Dispatches `action` now, or once the palette mounts. */
export function requestCommandPalette(action: CommandPaletteUiAction): void {
  if (mountedPalettes > 0) dispatchCommandPalette(action);
  else pendingOpen = action;
}

// Outside the hook: React Compiler forwards a module variable read in an effect past its reset.
function flushPendingOpen(): void {
  const action = pendingOpen;
  pendingOpen = null;
  if (action !== null) dispatchCommandPalette(action);
}

/**
 * Marks the palette as mounted while the calling component is. An unmounted
 * palette cannot stay open, so the last unmount resets the store.
 */
export function useCommandPaletteMount(): void {
  // oxlint-disable-next-line t3code/react-effect-budget -- The palette's mount gates its global shortcuts, and leaving the route while it is open calls no close handler, so only unmount can reset the store.
  useEffect(() => {
    mountedPalettes += 1;
    flushPendingOpen();
    return () => {
      mountedPalettes -= 1;
      if (mountedPalettes === 0) {
        useCommandPaletteStore.setState(
          (state) => ({ ...INITIAL_STATE, session: state.session + 1 }),
          true,
        );
      }
    };
  }, []);
}
