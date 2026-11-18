import { Facet, type EditorState } from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";

/**
 * An editor's undo history, whichever it keeps (CodeMirror's, or a Yjs undo manager's), so a menu
 * can undo and redo in it as its keys do, and tell when there is nothing to undo or redo.
 */
export interface EditorHistory {
  readonly undo: Command;
  readonly redo: Command;
  readonly canUndo: (state: EditorState) => boolean;
  readonly canRedo: (state: EditorState) => boolean;
}

export const editorHistory = Facet.define<EditorHistory, EditorHistory | null>({
  combine: (values) => values[0] ?? null,
});

export const hasEditorHistory = (state: EditorState): boolean =>
  state.facet(editorHistory) !== null;

/** An editor's keys for undo and redo, in CodeMirror's notation. */
export interface EditorHistoryKeys {
  readonly undo: readonly string[];
  readonly redo: readonly string[];
}

/** `history`'s commands on `keys`. */
export function editorHistoryBindings(
  history: EditorHistory,
  keys: EditorHistoryKeys,
): KeyBinding[] {
  return [
    ...keys.undo.map((key) => ({ key, run: history.undo, preventDefault: true })),
    ...keys.redo.map((key) => ({ key, run: history.redo, preventDefault: true })),
  ];
}
