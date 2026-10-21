import type { KeybindingCommand } from "@t3tools/contracts";

import { CONVERSATION, guestThreadOf } from "./arrangement";

/**
 * What a shortcut does inside the panes, which replace T3 Code's terminal drawer and right
 * panel. `focusedTab` is the focused pane's active tab.
 *
 * - The terminal shortcut goes to a terminal tab and back (see `toggleTerminal`).
 * - The right panel's toggle does nothing: there is no panel to show or hide, and hiding every
 *   tab at once is not what the panes offer. Its maximize toggle maximizes the focused pane.
 * - Its close shortcut closes the focused pane's tab, as closing a tab does. On the
 *   conversation, which never closes, the shortcut keeps its native meaning.
 * - The thread details toggle belongs to the conversation in front, the host's or a guest's,
 *   whose ChatView answers it. With anything else in front, the pane has no toggle, and the
 *   shortcut does nothing.
 *
 * Everything else (new, split and close inside a terminal, diff, preview, reopening a closed
 * view) goes through T3 Code's right-panel record, which the panes follow: null.
 */
export type PanesShortcut = "toggle-terminal" | "toggle-maximized" | "ignore" | "close-tab" | null;

export function panesShortcut(
  command: KeybindingCommand | null,
  focusedTab: string | null,
): PanesShortcut {
  switch (command) {
    case "terminal.toggle":
      return "toggle-terminal";
    case "rightPanel.toggle":
      return "ignore";
    case "rightPanel.toggleMaximized":
      return "toggle-maximized";
    case "threadPanel.toggle":
      return focusedTab === CONVERSATION || (focusedTab !== null && guestThreadOf(focusedTab))
        ? null
        : "ignore";
    case "rightPanel.close":
      return focusedTab === null || focusedTab === CONVERSATION ? null : "close-tab";
    default:
      return null;
  }
}
