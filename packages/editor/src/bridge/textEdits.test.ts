import { foldEffect, foldedRanges, foldState } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vite-plus/test";
import { replaceDocText } from "./textEdits.ts";

const FILE = ["import a from 'a';", "", "function one() {", "  return 1;", "}", ""].join("\n");

function editorAt(doc: string, cursor: number, selection?: { anchor: number; head: number }) {
  return EditorState.create({
    doc,
    extensions: [foldState, EditorState.allowMultipleSelections.of(true)],
    selection: selection
      ? EditorSelection.create([
          EditorSelection.cursor(cursor),
          EditorSelection.range(selection.anchor, selection.head),
        ])
      : EditorSelection.cursor(cursor),
  });
}

describe("replaceDocText", () => {
  it("does nothing when the text already matches", () => {
    expect(replaceDocText(editorAt(FILE, 0), FILE)).toBeNull();
  });

  it("keeps the cursor, the selections and a fold on their text when lines arrive above them", () => {
    const at = FILE.indexOf("return");
    const body = { from: FILE.indexOf("{") + 1, to: FILE.indexOf("}") };
    let state = editorAt(FILE, at, { anchor: FILE.indexOf("one"), head: FILE.indexOf("()") });
    state = state.update({ effects: foldEffect.of(body) }).state;

    const added = "import b from 'b';\nimport c from 'c';\n";
    const next = added + FILE;
    const spec = replaceDocText(state, next);
    if (!spec) throw new Error("expected a change");
    const after = state.update(spec).state;

    expect(after.doc.toString()).toBe(next);
    // Ranges come sorted by position: the word is before the cursor.
    const [word, cursor] = after.selection.ranges;
    expect(next.slice(cursor!.head, cursor!.head + "return".length)).toBe("return");
    expect(next.slice(word!.from, word!.to)).toBe("one");
    const folds: { from: number; to: number }[] = [];
    foldedRanges(after).between(0, after.doc.length, (from, to) => {
      folds.push({ from, to });
    });
    expect(folds).toEqual([{ from: body.from + added.length, to: body.to + added.length }]);
  });

  it("touches only the changed span, so the rest of the document keeps its positions", () => {
    const next = FILE.replace("return 1", "return 2");
    const spec = replaceDocText(editorAt(FILE, 0), next);
    if (!spec) throw new Error("expected a change");
    const changes = editorAt(FILE, 0).update(spec).changes;
    const touched: [number, number][] = [];
    changes.iterChangedRanges((fromA, toA) => touched.push([fromA, toA]));
    const digit = FILE.indexOf("1;");
    expect(touched).toEqual([[digit, digit + 1]]);
  });
});
