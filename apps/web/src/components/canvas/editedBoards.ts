import {
  editedBoardsSinceLastPrompt,
  editedFilesSinceLastPrompt,
} from "@t3tools/client-runtime/canvasViews";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type ScopedThreadRef, TurnItemId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadDetails } from "~/state/threads";

/**
 * Astrolabe: the edits a person left out of their next message, per thread, by the edit they left
 * out (its `editedAt`), so a later edit brings it back. Kept across reloads. Boards are keyed by
 * their turn item, files by their path.
 */
interface EditDismissals {
  readonly byThread: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly dismiss: (threadRef: ScopedThreadRef, key: string, editedAt: string) => void;
  readonly restore: (threadRef: ScopedThreadRef, key: string) => void;
}

const NO_DISMISSALS: Readonly<Record<string, string>> = {};

const createEditDismissals = (name: string) =>
  create<EditDismissals>()(
    persist(
      (set) => ({
        byThread: {},
        dismiss: (threadRef, key, editedAt) =>
          set((state) => {
            const thread = scopedThreadKey(threadRef);
            return {
              byThread: {
                ...state.byThread,
                [thread]: { ...state.byThread[thread], [key]: editedAt },
              },
            };
          }),
        restore: (threadRef, key) =>
          set((state) => {
            const thread = scopedThreadKey(threadRef);
            const { [key]: _restored, ...rest } = state.byThread[thread] ?? {};
            return { byThread: { ...state.byThread, [thread]: rest } };
          }),
      }),
      {
        name,
        storage: createJSONStorage(() =>
          resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
        ),
        version: 1,
      },
    ),
  );

export const useEditedBoardDismissals = createEditDismissals("t3code:edited-board-dismissals:v1");
export const useEditedFileDismissals = createEditDismissals("t3code:edited-file-dismissals:v1");

export const editDismissalsFor = (state: EditDismissals, threadRef: ScopedThreadRef) =>
  state.byThread[scopedThreadKey(threadRef)] ?? NO_DISMISSALS;

const threadProjection = (threadRef: ScopedThreadRef) =>
  appAtomRegistry.get(environmentThreadDetails.quietThreadAtom(threadRef))?.projection ?? null;

/** The edited boards the person left out, which the next message names so the agent isn't told. */
export function omittedEditedBoards(threadRef: ScopedThreadRef): ReadonlyArray<TurnItemId> {
  const projection = threadProjection(threadRef);
  if (projection === null) return [];
  const dismissed = editDismissalsFor(useEditedBoardDismissals.getState(), threadRef);
  return editedBoardsSinceLastPrompt(projection, dismissed).flatMap((board) =>
    board.dismissed ? [TurnItemId.make(board.id)] : [],
  );
}

/** The same for the files the person edited, by their path in the thread's checkout. */
export function omittedEditedFiles(threadRef: ScopedThreadRef): ReadonlyArray<string> {
  const projection = threadProjection(threadRef);
  if (projection === null) return [];
  const dismissed = editDismissalsFor(useEditedFileDismissals.getState(), threadRef);
  return editedFilesSinceLastPrompt(projection, dismissed).flatMap((file) =>
    file.dismissed ? [file.path] : [],
  );
}
