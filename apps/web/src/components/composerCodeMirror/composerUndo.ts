import { history } from "@codemirror/commands";
import { type Extension, StateField, type Transaction } from "@codemirror/state";

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

const lastChangeKind = StateField.define<ChangeKind | null>({
  create: () => null,
  update: (previous, tr) => changeKindOf(tr) ?? previous,
});

/**
 * CodeMirror history grouped the way the Tiptap composer grouped undo: a new step whenever
 * the kind of change switches, for every one-off change, and after a pause.
 */
export function composerHistory(): Extension {
  return [
    lastChangeKind,
    history({
      newGroupDelay: COMPOSER_UNDO_GROUP_DELAY,
      joinToEvent: (tr, isAdjacent) => {
        const kind = changeKindOf(tr);
        return isAdjacent && kind !== "other" && kind === tr.startState.field(lastChangeKind);
      },
    }),
  ];
}
