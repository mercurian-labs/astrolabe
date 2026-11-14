import { editedBoardsSinceLastPrompt } from "@t3tools/client-runtime/canvasViews";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type ScopedThreadRef, TurnItemId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentThreadDetails } from "~/state/threads";

/**
 * Astrolabe: the edited boards a person left out of their next message, per thread, by the edit
 * they left out (its `editedAt`), so a later edit brings the board back. Kept across reloads.
 */
interface EditedBoardDismissals {
  readonly byThread: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly dismiss: (threadRef: ScopedThreadRef, boardId: string, editedAt: string) => void;
  readonly restore: (threadRef: ScopedThreadRef, boardId: string) => void;
}

const NO_DISMISSALS: Readonly<Record<string, string>> = {};

export const useEditedBoardDismissals = create<EditedBoardDismissals>()(
  persist(
    (set) => ({
      byThread: {},
      dismiss: (threadRef, boardId, editedAt) =>
        set((state) => {
          const key = scopedThreadKey(threadRef);
          return {
            byThread: {
              ...state.byThread,
              [key]: { ...state.byThread[key], [boardId]: editedAt },
            },
          };
        }),
      restore: (threadRef, boardId) =>
        set((state) => {
          const key = scopedThreadKey(threadRef);
          const { [boardId]: _restored, ...rest } = state.byThread[key] ?? {};
          return { byThread: { ...state.byThread, [key]: rest } };
        }),
    }),
    {
      name: "t3code:edited-board-dismissals:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
    },
  ),
);

export const editedBoardDismissalsFor = (
  state: EditedBoardDismissals,
  threadRef: ScopedThreadRef,
) => state.byThread[scopedThreadKey(threadRef)] ?? NO_DISMISSALS;

/** The edited boards the person left out, which the next message names so the agent isn't told. */
export function omittedEditedBoards(threadRef: ScopedThreadRef): ReadonlyArray<TurnItemId> {
  const thread = appAtomRegistry.get(environmentThreadDetails.quietThreadAtom(threadRef));
  if (thread === null) return [];
  const dismissed = editedBoardDismissalsFor(useEditedBoardDismissals.getState(), threadRef);
  return editedBoardsSinceLastPrompt(thread.projection, dismissed).flatMap((board) =>
    board.dismissed ? [TurnItemId.make(board.id)] : [],
  );
}
