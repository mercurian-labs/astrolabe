import type { CanvasMenuEntry } from "@mercurian/wiki-editor/canvas-board";

import type { useCanvasWalk } from "./useCanvasWalk";

/** What a thread's board adds to its menu: asking about it, and keeping it in a wiki. */
export const canvasMenuItems = (
  walk: ReturnType<typeof useCanvasWalk>,
  keep: CanvasMenuEntry | undefined,
): ReadonlyArray<CanvasMenuEntry> => [
  ...(walk.ask === undefined ? [] : [{ label: walk.ask.label, run: walk.ask.run }]),
  ...(keep === undefined ? [] : [keep]),
];
