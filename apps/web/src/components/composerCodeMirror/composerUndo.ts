import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorState, type Extension, StateField, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { VimHistory } from "@mercurian/editor/vim";

/** Same pause as the Tiptap composer's history: a second without changes starts a step. */
const COMPOSER_UNDO_GROUP_DELAY = 1000;

type ChangeKind = "insert" | "delete" | "other";

/**
 * What a transaction does to the text: typing, deleting, or anything else. Pastes, cuts,
 * drops, undo and redo, and store rewrites (which carry no user event and replace text)
 * are "other", one-off changes that never merge with their neighbours.
 */
function changeKindOf(tr: Transaction): ChangeKind | null {
  if (!tr.docChanged) return null;
  if (
    tr.isUserEvent("input.paste") ||
    tr.isUserEvent("input.drop") ||
    tr.isUserEvent("delete.cut") ||
    tr.isUserEvent("undo") ||
    tr.isUserEvent("redo")
  ) {
    return "other";
  }
  // IME input replaces its own range on each keystroke; it is still typing.
  if (tr.isUserEvent("input.type.compose")) return "insert";
  let kind: ChangeKind | null = null;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const inserts = inserted.length > 0;
    const deletes = toA > fromA;
    const changeKind = inserts && !deletes ? "insert" : deletes && !inserts ? "delete" : "other";
    kind = kind === null || kind === changeKind ? changeKind : "other";
  });
  return kind;
}

/** The last change: its kind, when it landed, and whether it was isolated in history. */
const lastChange = StateField.define<{
  kind: ChangeKind;
  time: number;
  isolated: boolean;
} | null>({
  create: () => null,
  update: (previous, tr) => {
    const kind = changeKindOf(tr);
    if (kind === null) return previous;
    return {
      kind,
      time: tr.annotation(Transaction.time) ?? Date.now(),
      isolated: tr.annotation(isolateHistory) !== undefined,
    };
  },
});

/**
 * CodeMirror history grouped the way the Tiptap composer grouped undo: a new step whenever
 * the kind of change switches, for every one-off change, and after a pause. `vim` is the
 * same history as Vim mode runs it: `u` and `Ctrl-r` undo and redo here, and while Vim
 * groups explicitly a step closes only when Vim says (a whole insert session is one step).
 */
export function composerHistory(view: () => EditorView): { extension: Extension; vim: VimHistory } {
  // Vim's grouping lives outside the editor state: Vim switches it while the editor is
  // being configured, when nothing may be dispatched. Each editor has its own.
  let explicit = false;
  let boundary = false;
  const extension = [
    lastChange,
    history({
      // The pause is judged here, against the last change, so explicit grouping can lift it.
      newGroupDelay: Number.POSITIVE_INFINITY,
      joinToEvent: (tr, isAdjacent) => {
        const last = tr.startState.field(lastChange);
        if (boundary || !last || last.isolated || tr.annotation(isolateHistory) !== undefined) {
          return false;
        }
        if (explicit) return true;
        const kind = changeKindOf(tr);
        const time = tr.annotation(Transaction.time) ?? Date.now();
        return (
          isAdjacent &&
          kind !== "other" &&
          kind === last.kind &&
          time - last.time < COMPOSER_UNDO_GROUP_DELAY
        );
      },
    }),
    // While Vim groups, caret moves stay out of history (they would close the step), as Yjs
    // ignores them for notes: a Vim change runs from its command to the end of its insert.
    EditorState.transactionExtender.of((tr) =>
      explicit && !tr.docChanged && tr.selection
        ? { annotations: Transaction.addToHistory.of(false) }
        : null,
    ),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) boundary = false;
    }),
  ];
  return {
    extension,
    vim: {
      undo: () => undo(view()),
      redo: () => redo(view()),
      stopCapturing: () => {
        boundary = true;
      },
      groupExplicitly: (on) => {
        explicit = on;
      },
    },
  };
}
