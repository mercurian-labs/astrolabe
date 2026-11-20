import type { DocumentSessionState } from "@t3tools/client-runtime/state/document-session";

/**
 * Astrolabe: calls `saved` each time edits made in this editor reach disk. Edits from elsewhere
 * never count, nor ones a conflict ended with the file's text taken over them.
 */
export function onOwnEditsSaved(
  session: {
    readonly subscribe: (listener: () => void) => () => void;
    readonly getState: () => DocumentSessionState;
  },
  saved: () => void,
): () => void {
  let mine = false;
  return session.subscribe(() => {
    const state = session.getState();
    if (state.status === "conflict") mine = false;
    else if (state.unsent) mine = true;
    else if (mine && !state.unsaved) {
      mine = false;
      saved();
    }
  });
}
