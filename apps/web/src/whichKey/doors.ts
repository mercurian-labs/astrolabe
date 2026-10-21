import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vimHostKeys } from "@mercurian/editor/vim";

import { openCommandPalette } from "~/commandPaletteBus";

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

/**
 * The keyboard menu's doors in a Vim editor of the app's (the composer, a wiki note): the leader
 * key in normal and visual mode opens the menu, and `:` in normal mode opens the palette as the
 * ex line, with `write` as that editor's `:w`. Without Vim, or with no leader key, the keys stay
 * Vim's.
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
  });
}
