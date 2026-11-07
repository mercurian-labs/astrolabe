import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** The `[[links]]` parsed between `from` and `to`, so none in code. An embed isn't one. */
export function wikilinksBetween(state: EditorState, from: number, to: number) {
  const found: Array<{ readonly from: number; readonly to: number; readonly target: string }> = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "WikiLink") return true;
      const target = node.node.getChild("WikiLinkTarget");
      if (target !== null) {
        const text = state.sliceDoc(target.from, target.to);
        found.push({ from: node.from, to: node.to, target: text });
      }
      return false;
    },
  });
  return found;
}
