import { history, undo } from "@codemirror/commands";
import { describe, expect, it, vi } from "vite-plus/test";

import { linkedEditing } from "./linkedEditing.ts";
import { range, setup } from "./testing.ts";

const TEXT = "<div>text</div>\n";

function open() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const editor = setup(TEXT, {
    capabilities: { linkedEditingRangeProvider: true },
    answer: (method) => {
      if (method !== "textDocument/linkedEditingRange") return undefined;
      const doc = editor.view.state.doc;
      return { ranges: [range(doc, 1, 4), range(doc, 11, 14)] };
    },
    extensions: [history(), linkedEditing()],
  });
  return editor;
}

const typeAt = (editor: ReturnType<typeof setup>, from: number, insert: string, to = from) =>
  editor.view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.type",
  });

const onTag = async (editor: ReturnType<typeof setup>) => {
  await editor.initialize();
  editor.view.dispatch({ selection: { anchor: 2 } });
  await vi.advanceTimersByTimeAsync(300);
};

describe("linkedEditing", () => {
  it("writes a tag's pair as you type, undone together", async () => {
    const editor = open();
    try {
      await onTag(editor);
      typeAt(editor, 4, "x");
      expect(editor.view.state.doc.toString()).toBe("<divx>text</divx>\n");
      typeAt(editor, 1, "", 2);
      expect(editor.view.state.doc.toString()).toBe("<ivx>text</ivx>\n");
      undo(editor.view);
      undo(editor.view);
      expect(editor.view.state.doc.toString()).toBe(TEXT);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("lets go at a character the name can't hold, and when the cursor leaves it", async () => {
    const editor = open();
    try {
      await onTag(editor);
      typeAt(editor, 4, " ");
      expect(editor.view.state.doc.toString()).toBe("<div >text</div>\n");
      typeAt(editor, 5, "c");
      expect(editor.view.state.doc.toString()).toBe("<div c>text</div>\n");
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("leaves another client's edit alone", async () => {
    const editor = open();
    try {
      await onTag(editor);
      editor.type(2, "z");
      expect(editor.view.state.doc.toString()).toBe("<dziv>text</div>\n");
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });
});
