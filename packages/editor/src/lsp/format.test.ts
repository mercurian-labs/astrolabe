import { history, undo } from "@codemirror/commands";
import { describe, expect, it, vi } from "vite-plus/test";

import { formatCode, formattingOptions } from "./format.ts";
import { setup } from "./testing.ts";

const TEXT = "f(1,2);\n";

describe("formatCode", () => {
  it("applies the server's formatting in the editor, as one undo step", async () => {
    const editor = setup(TEXT, {
      capabilities: { documentFormattingProvider: true },
      answer: (method, params) => {
        if (method !== "textDocument/formatting") return undefined;
        expect(params.options).toEqual({ tabSize: 2, insertSpaces: true });
        return [
          {
            range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } },
            newText: " ",
          },
        ];
      },
      extensions: history(),
    });
    try {
      await editor.initialize();
      expect(formattingOptions(editor.view.state)).toEqual({ tabSize: 2, insertSpaces: true });
      expect(formatCode(editor.view)).toBe(true);
      await vi.waitFor(() => expect(editor.view.state.doc.toString()).toBe("f(1, 2);\n"));
      undo(editor.view);
      expect(editor.view.state.doc.toString()).toBe(TEXT);
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("does nothing where the server doesn't format", async () => {
    const editor = setup(TEXT, { answer: () => [] });
    try {
      await editor.initialize();
      expect(formatCode(editor.view)).toBe(false);
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });
});
