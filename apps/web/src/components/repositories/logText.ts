import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { inFileSearch } from "@mercurian/editor/search";

/**
 * Astrolabe: a read-only log in an editor. It takes batches without React, and draws only the
 * lines on screen however many it holds.
 */

/** Past this the oldest lines go; the server's rings keep about as much. */
const LENGTH_KEPT = 4 * 1024 * 1024;
/** How near the end counts as following it. */
const FOLLOW_SLACK = 8;

const THEME = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "12px", lineHeight: "1.5" },
  ".cm-content": { padding: "8px 0" },
  ".cm-line": { padding: "0 16px" },
});

export function createLogText(parent: HTMLElement) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [THEME, inFileSearch(), EditorState.readOnly.of(true), EditorView.lineWrapping],
    }),
  });

  const atEnd = () => {
    const { scrollHeight, scrollTop, clientHeight } = view.scrollDOM;
    return scrollHeight - scrollTop - clientHeight <= FOLLOW_SLACK;
  };

  return {
    replace(lines: readonly string[]) {
      const insert = lines.join("\n").slice(-LENGTH_KEPT);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert },
        effects: EditorView.scrollIntoView(insert.length),
      });
    },
    append(lines: readonly string[]) {
      if (lines.length === 0) return;
      const { doc } = view.state;
      const insert = `${doc.length === 0 ? "" : "\n"}${lines.join("\n")}`;
      const over = doc.length + insert.length - LENGTH_KEPT;
      const head =
        over > 0 ? Math.min(doc.lineAt(Math.min(over, doc.length)).to + 1, doc.length) : 0;
      const follow = atEnd();
      view.dispatch({
        changes: [
          { from: 0, to: head },
          { from: doc.length, insert },
        ],
        ...(follow
          ? { effects: EditorView.scrollIntoView(doc.length + insert.length - head) }
          : {}),
      });
    },
    text: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
}

export type LogText = ReturnType<typeof createLogText>;
