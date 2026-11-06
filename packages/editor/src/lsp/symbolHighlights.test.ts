import { describe, expect, it, vi } from "vite-plus/test";

import { range, setup } from "./testing.ts";
import { symbolHighlights } from "./symbolHighlights.ts";

const TEXT = "let total = 1;\ntotal = total + 1;\nlet other = 2;\n";

function open() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const editor = setup(TEXT, {
    capabilities: { documentHighlightProvider: true },
    answer: (method) => {
      if (method !== "textDocument/documentHighlight") return undefined;
      const doc = editor.view.state.doc;
      return [
        { range: range(doc, 4, 9), kind: 3 },
        { range: range(doc, 23, 28), kind: 2 },
      ];
    },
    extensions: symbolHighlights(),
  });
  return editor;
}

const requests = (editor: ReturnType<typeof setup>) =>
  editor.sent.filter((entry) => entry.message.method === "textDocument/documentHighlight");

const marked = (editor: ReturnType<typeof setup>, kind: "read" | "write") =>
  [...editor.view.dom.querySelectorAll(`.atlas-symbol-${kind}`)].map((dom) => dom.textContent);

const moveTo = (editor: ReturnType<typeof setup>, anchor: number, head = anchor) => {
  editor.view.focus();
  editor.view.dispatch({ selection: { anchor, head } });
};

describe("symbolHighlights", () => {
  it("marks reads and writes once the cursor rests, and clears them when it leaves or you type", async () => {
    const editor = open();
    try {
      await editor.initialize();
      moveTo(editor, 5);
      await vi.advanceTimersByTimeAsync(100);
      moveTo(editor, 6);
      await vi.advanceTimersByTimeAsync(300);
      expect(requests(editor)).toHaveLength(1);
      expect(marked(editor, "write")).toEqual(["total"]);
      expect(marked(editor, "read")).toEqual(["total"]);

      // Still on the symbol: the marks stay until the next answer.
      moveTo(editor, 7);
      expect(marked(editor, "write")).toEqual(["total"]);
      await vi.advanceTimersByTimeAsync(300);

      editor.type(0, "x");
      expect(marked(editor, "write")).toEqual([]);

      await vi.advanceTimersByTimeAsync(300);
      moveTo(editor, editor.view.state.doc.length);
      expect(marked(editor, "write")).toEqual([]);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("asks nothing while you type, nor for a selection", async () => {
    const editor = open();
    try {
      await editor.initialize();
      editor.view.focus();
      for (const at of [0, 1, 2, 3]) {
        editor.type(at, "x");
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(requests(editor)).toHaveLength(0);
      moveTo(editor, 4, 9);
      await vi.advanceTimersByTimeAsync(600);
      expect(requests(editor)).toHaveLength(0);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });
});
