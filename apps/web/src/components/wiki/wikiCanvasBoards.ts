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

const boards = new Map<string, WikiCanvasBoard>();

/** Lets the command palette reach an open canvas, by its tab. Returns the way to stop. */
export function registerWikiCanvasBoard(tabKey: string, board: WikiCanvasBoard) {
  boards.set(tabKey, board);
  return () => {
    if (boards.get(tabKey) === board) boards.delete(tabKey);
  };
}

export const wikiCanvasBoard = (tabKey: string) => boards.get(tabKey);
