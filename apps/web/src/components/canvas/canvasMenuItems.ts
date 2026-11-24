/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type { CanvasMenuEntry } from "@mercurian/wiki-editor/canvas-board";
import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { canvasContextRecord } from "@t3tools/shared/composerContextReferences";

import { useComposerHandleContext } from "~/composerHandleContext";

import { toastManager } from "../ui/toast";

/** What a thread's board adds to its menu: asking about it in the composer, and keeping it. */
export function useCanvasMenuItems(
  board: {
    readonly threadId: ThreadId;
    readonly itemId: TurnItemId;
    readonly title: string;
  } | null,
  keep: CanvasMenuEntry | undefined,
): ReadonlyArray<CanvasMenuEntry> {
  const composer = useComposerHandleContext();
  const ask =
    composer === null || board === null
      ? []
      : [
          {
            label: "Ask about this canvas",
            run: () => {
              const added = composer.current?.addCanvas(canvasContextRecord(board));
              if (added !== false) return;
              toastManager.add({
                type: "warning",
                title: "The composer can't take this right now",
                description: "Answer the agent's question first.",
              });
            },
          },
        ];
  return [...ask, ...(keep === undefined ? [] : [keep])];
}
