import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vimHostKeys } from "@mercurian/editor/vim";

import { openCommandPalette } from "~/commandPaletteBus";
import { appCommandsSlot } from "./handles";

/**
 * Astrolabe: where a key for the keyboard menu or the ex line came from, so what it opens can act
 * there: the focused element, and the editor it came from (whose own ex commands route back to
 * it, and whose `:w` sends or saves).
 */
export interface KeyOrigin {
  readonly element: Element | null;
  readonly view: EditorView | null;
  /** What `:w` does in that editor: sends the composer's draft, saves the note. */
  readonly write: EditorWrite | null;
}

export interface EditorWrite {
  readonly label: string;
  readonly run: () => void;
}

interface LeaderHandler {
  readonly open: (origin: KeyOrigin) => boolean;
  /** The device's leader key, read at each key; null for none. */
  readonly key: () => string | null;
}

let leaderHandler: LeaderHandler | null = null;

/**
 * Makes `handler` the page's keyboard menu, which an editor's leader key asks for; returns the
 * way to stop.
 */
export function handleLeaderRequests(handler: LeaderHandler) {
  leaderHandler = handler;
  return () => {
    if (leaderHandler === handler) leaderHandler = null;
  };
}

/** Opens the keyboard menu from the leader key; false when there is none, or it declined. */
function requestLeader(origin: KeyOrigin): boolean {
  return leaderHandler?.open(origin) ?? false;
}

/**
 * Opens the keyboard menu from `key` pressed on `element` when it is the leader key, for a
 * place whose own keys would otherwise take it (a sidebar list's row, which Space presses);
 * false when it is not the leader key, or the menu declined.
 */
export function openLeaderFrom(element: Element, key: string): boolean {
  if (!leaderHandler || key !== leaderHandler.key()) return false;
  return requestLeader({ element, view: null, write: null });
}

let pendingOrigin: KeyOrigin | null = null;

/** Opens the command palette as an ex line, `:` and `text` typed, acting where `origin` says. */
export function openExLine(origin: KeyOrigin | null, text = "") {
  pendingOrigin = origin;
  openCommandPalette({ query: `:${text}` });
}

/** The origin the palette opening now was asked for from; `releaseExOrigin` once it has it. */
export function pendingExOrigin(): KeyOrigin | null {
  return pendingOrigin;
}

export function releaseExOrigin(origin: KeyOrigin | null) {
  if (pendingOrigin === origin) pendingOrigin = null;
}

const WINDOW_COMMANDS = {
  left: "focus.left",
  down: "focus.down",
  up: "focus.up",
  right: "focus.right",
} as const;

/**
 * Menu doors in the app's Vim editors: the leader key in normal and visual mode opens the menu,
 * and `:` in normal mode opens the palette as the ex line with `write` as `:w`. Without Vim or a
 * leader key, the keys stay Vim's. `<C-w>h` and friends move focus between sidebar and panes.
 */
export function appVimKeys(write: (view: EditorView) => EditorWrite | null): Extension {
  const origin = (view: EditorView): KeyOrigin => ({
    element: view.contentDOM,
    view,
    write: write(view),
  });
  return vimHostKeys({
    leader: (view) => requestLeader(origin(view)),
    // Space until the menu says otherwise (while none is mounted, Space stays Vim's anyway).
    leaderKey: () => (leaderHandler ? leaderHandler.key() : " "),
    exLine: (view) => {
      openExLine(origin(view));
      return true;
    },
    window: (view, direction) =>
      appCommandsSlot.get()?.command(WINDOW_COMMANDS[direction], origin(view)).run(),
  });
}
