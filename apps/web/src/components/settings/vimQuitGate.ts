import { EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type VimHistory, vimAtRest, vimExLine, vimMode } from "@mercurian/editor/vim";

/** One line with nothing worth undoing. */
const NO_HISTORY: VimHistory = {
  undo() {},
  redo() {},
  stopCapturing() {},
  groupExplicitly() {},
};

/** `:q` as Vim reads it (`:q`, `:qu`, `:qui`, `:quit`), with or without `!`. */
export function isVimQuit(input: string) {
  // Vim skips colons typed after the ex line's own.
  return /^[\s:]*q(u(it?)?)?!?\s*$/.test(input);
}

const gateTheme = EditorView.theme({
  "&": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "inherit" },
  ".cm-content": { padding: "0", caretColor: "currentColor" },
  ".cm-line": { padding: "0" },
  ".cm-panels": { backgroundColor: "transparent", color: "inherit" },
});

/**
 * The way into Vim mode: a one-line Vim editor, in normal mode, that asks for `:q`. Entering
 * `:q` confirms; any other ex command, or Escape in normal mode, backs out. Searches and
 * Escape on the ex line are Vim's as usual. Settles at most once.
 */
export function vimQuitGate({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}): Extension {
  let settled = false;
  const settle = (done: () => void) => {
    if (settled) return;
    settled = true;
    done();
  };
  return [
    // A Vim editor of this layer's, so `:q` itself runs quietly once it has confirmed.
    vimMode(NO_HISTORY, { panel: false }),
    // An empty ex line runs nothing, so it decides nothing.
    vimExLine((input) => {
      if (input.trim() !== "") settle(isVimQuit(input) ? onConfirm : onCancel);
    }),
    // Ahead of Vim: in normal mode Escape has nothing to end, so it backs out.
    Prec.highest(
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (event.key !== "Escape" || !vimAtRest(view)) return false;
          event.stopPropagation();
          settle(onCancel);
          return true;
        },
      }),
    ),
    // One line: nothing that would add a second one applies.
    EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
    gateTheme,
    EditorView.contentAttributes.of({ "aria-label": "Type :q and press Enter" }),
  ];
}
