import { CanvasDocument } from "@mercurian/wiki-editor/canvas-document";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import type { CanvasData } from "@mercurian/wiki/canvas";
import { useEffect, useState, useSyncExternalStore } from "react";

import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

/** Edits this close together save as one. */
const SAVE_AFTER_MS = 400;

/**
 * Astrolabe: a board an agent drew, as a person edits it. Their edits save into the thread, where
 * they replay on the board as it is there, and the agent hears of them on its next turn; a version
 * from elsewhere comes in under what hasn't saved yet. Null for a board that was never recorded, or
 * with no thread to save it in.
 */
export function useThreadCanvasDocument(
  view: CanvasView,
  where: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly itemId: TurnItemId;
  } | null,
): CanvasDocument | null {
  const editCanvas = useAtomCommand(threadEnvironment.editCanvas);
  const { recorded } = view;
  const [board] = useState(() => {
    if (recorded === undefined || where === null) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saving = false;
    let again = false;
    const save = async (): Promise<void> => {
      if (saving) {
        again = true;
        return;
      }
      const taken = canvas.take();
      if (taken === null) return;
      saving = true;
      const result = await editCanvas({
        environmentId: where.environmentId,
        input: { threadId: where.threadId, turnItemId: where.itemId, edits: taken.edits },
      });
      saving = false;
      // What didn't land stays pending, and goes again with the next edit.
      if (result._tag === "Success") canvas.landed(taken.through, null);
      if (again) {
        again = false;
        await save();
      }
    };
    const canvas: CanvasDocument = new CanvasDocument({
      document: recorded.document,
      revision: recorded.revision,
      onEdited: () => {
        clearTimeout(timer);
        timer = setTimeout(() => void save(), SAVE_AFTER_MS);
      },
    });
    return {
      canvas,
      flush: () => {
        clearTimeout(timer);
        void save();
      },
    };
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the thread's copy of the board arrives from the server, with edits made on other devices
  useEffect(() => {
    if (board !== null && recorded !== undefined) {
      board.canvas.receive(recorded.document, recorded.revision);
    }
  }, [board, recorded]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a board scrolled away or closed still saves what was waiting to
  useEffect(() => () => board?.flush(), [board]);
  return board?.canvas ?? null;
}

const noSubscription = () => () => {};

/** What a board shows: its document as edited, or the version read when there's none. */
export function useCanvasDocumentData(canvas: CanvasDocument | null, read: CanvasData): CanvasData {
  return useSyncExternalStore(
    canvas?.subscribe ?? noSubscription,
    () => canvas?.getState().data ?? read,
  );
}
