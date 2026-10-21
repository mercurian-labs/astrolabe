import type { KeybindingCommand } from "@t3tools/contracts";

import type { PaneArrangementStore, PaneTabs } from "~/panes/panesHost";
import type { AppCommand } from "./commands";
import type { KeyOrigin } from "./doors";

/**
 * Astrolabe: what mounted surfaces lend the keyboard menu and the ex line, so their entries call
 * the surface's own handlers rather than copies of them. Each surface registers while it is
 * mounted; the menu reads the latest one when a key runs.
 */
function createHandleSlot<T>() {
  let current: T | null = null;
  return {
    get: () => current,
    /** Lends `handle` until the returned function is called. */
    register(handle: T) {
      current = handle;
      return () => {
        if (current === handle) current = null;
      };
    },
  };
}

/** The sidebar section's title row: its new button ("New thread", "New document"). */
export interface SidebarSectionHandle {
  readonly newItem: () => void;
  readonly newItemLabel: string;
  readonly newItemDisabled: boolean;
}

export const sidebarSectionSlot = createHandleSlot<SidebarSectionHandle>();

/** The chat tabs across the chat column: the open chats, the one in front, and each tab's own select and close. */
export interface ChatTabsHandle {
  readonly keys: readonly string[];
  readonly activeKey: string | null;
  readonly select: (key: string) => void;
  readonly close: (key: string) => void;
}

export const chatTabsSlot = createHandleSlot<ChatTabsHandle>();

/** The panes on screen: the right panel's, or the Wikis area's. */
export interface PanesHandle {
  readonly controller: PaneArrangementStore;
  readonly tabs: PaneTabs;
  readonly layoutKey: string | null;
  /** The element holding the panes, to tell whether focus is in them. */
  readonly element: () => HTMLElement | null;
}

export const panesSlot = createHandleSlot<PanesHandle>();

/**
 * The command registry as the mounted keyboard menu holds it (its sections and finder), for the
 * Command Palette: each command as it would run from `origin`.
 */
export interface AppCommandsHandle {
  readonly command: (id: KeybindingCommand, origin: KeyOrigin | null) => AppCommand;
  /** The device's leader key as the menu names it: "Space". */
  readonly leaderLabel: string;
}

export const appCommandsSlot = createHandleSlot<AppCommandsHandle>();
