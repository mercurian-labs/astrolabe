import type { Extension } from "@codemirror/state";
import { EditorView, drawSelection } from "@codemirror/view";

/**
 * The selection and caret, drawn by CodeMirror's layers rather than the browser's, so several
 * selections show (and Vim's visual selection, which hides the native one). A host colours the
 * selection with `--atlas-selection` (focused) and `--atlas-selection-unfocused`, and the caret
 * with `--atlas-caret`, since a `currentColor` caret went unpainted in the desktop composer.
 */
export const drawnSelection: Extension = [
  drawSelection(),
  EditorView.theme({
    ".cm-selectionBackground": {
      background: "var(--atlas-selection-unfocused, #d9d9d9)",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      background: "var(--atlas-selection, #d7d4f0)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--atlas-caret, currentColor)" },
  }),
];
