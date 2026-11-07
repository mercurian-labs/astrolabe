import type { CanvasBoardCommand } from "@mercurian/wiki-editor/canvas-board";

/** The group a canvas's palette entry can jump to. */
export interface WikiCanvasGroup {
  readonly id: string;
  readonly label: string;
}

export interface WikiCanvasBoard {
  readonly groups: ReadonlyArray<WikiCanvasGroup>;
  readonly jumpToGroup: (id: string) => void;
  /** Whether cards can change here. */
  readonly editable: boolean;
  readonly run: (command: CanvasBoardCommand) => void;
}

/** Where a canvas's own read-only choice is kept on this device. */
export const canvasReadOnlyKey = (wikiId: string, file: string) =>
  `astrolabe:canvas-read-only:${wikiId}:${file}`;

/** A moved canvas keeps the choice. */
export function moveCanvasReadOnly(wikiId: string, from: string, to: string) {
  try {
    const stored = window.localStorage.getItem(canvasReadOnlyKey(wikiId, from));
    if (stored === null) return;
    window.localStorage.setItem(canvasReadOnlyKey(wikiId, to), stored);
    window.localStorage.removeItem(canvasReadOnlyKey(wikiId, from));
  } catch {
    // A blocked store has nothing to carry.
  }
}

const boards = new Map<string, WikiCanvasBoard>();

/** Lets the command palette reach an open canvas, by its tab. Returns the way to stop. */
export function registerWikiCanvasBoard(tabKey: string, board: WikiCanvasBoard) {
  boards.set(tabKey, board);
  return () => {
    if (boards.get(tabKey) === board) boards.delete(tabKey);
  };
}

export const wikiCanvasBoard = (tabKey: string) => boards.get(tabKey);
