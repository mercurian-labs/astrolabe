import { isCanvasFile } from "@mercurian/wiki/canvas";
import type { CanvasBoardCommand, CanvasBoardFocus } from "@mercurian/wiki-editor/canvas-board";
import { create } from "zustand";

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

const boards = new Map<string, WikiCanvasBoard>();

/** Lets the command palette reach an open canvas, by its tab. Returns the way to stop. */
export function registerWikiCanvasBoard(tabKey: string, board: WikiCanvasBoard) {
  boards.set(tabKey, board);
  return () => {
    if (boards.get(tabKey) === board) boards.delete(tabKey);
  };
}

export const wikiCanvasBoard = (tabKey: string) => boards.get(tabKey);

/**
 * The frame a link or embed asked a canvas tab to show, by tab: `[[Board.canvas#Group]]`. Each ask
 * is a new request, so asking again brings the camera back; nothing persists.
 */
export const useWikiCanvasFocus = create<{
  readonly byTab: Readonly<Record<string, CanvasBoardFocus>>;
}>(() => ({ byTab: {} }));

let focusRequests = 0;

/** Asks the canvas tab `tabKey` opens to show the frame a link's `#` names, if it names one. */
export function requestWikiCanvasFrame(tabKey: string, file: string, target: string) {
  if (!isCanvasFile(file)) return;
  const at = target.indexOf("#");
  const group = at === -1 ? "" : target.slice(at + 1).trim();
  if (group === "") {
    useWikiCanvasFocus.setState((state) => {
      if (!(tabKey in state.byTab)) return state;
      const { [tabKey]: _, ...rest } = state.byTab;
      return { byTab: rest };
    });
    return;
  }
  focusRequests += 1;
  useWikiCanvasFocus.setState((state) => ({
    byTab: { ...state.byTab, [tabKey]: { group, request: focusRequests } },
  }));
}
