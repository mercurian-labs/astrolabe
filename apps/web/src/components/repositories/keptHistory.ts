import { historyField } from "@codemirror/commands";
import { EditorState, type EditorStateConfig } from "@codemirror/state";

// A few closed editors' histories, the oldest dropped first.
const KEPT_HISTORIES = 20;
const kept = new Map<string, { readonly doc: string }>();

/**
 * Astrolabe: keeps a file editor's undo history as it closes, for the editor that opens next under
 * `key` (a linked file tab going back from Preview to Edit).
 */
export function keepHistory(key: string, state: EditorState): void {
  kept.delete(key);
  kept.set(key, state.toJSON({ history: historyField }));
  for (const oldest of kept.keys()) {
    if (kept.size <= KEPT_HISTORIES) break;
    kept.delete(oldest);
  }
}

/** The editor's state, with the history kept under `key` while the file reads as it left it. */
export function stateWithKeptHistory(
  key: string,
  config: EditorStateConfig & { readonly doc: string },
): EditorState {
  const json = kept.get(key);
  kept.delete(key);
  return json?.doc === config.doc
    ? EditorState.fromJSON(json, config, { history: historyField })
    : EditorState.create(config);
}
