import { describe, expect, it, vi } from "vite-plus/test";

import { diagnosticsUi } from "./diagnostics.ts";
import { range, setup, URI } from "./testing.ts";

const TEXT = "let a = bad;\nlet b = 2;\n";

function publish(editor: ReturnType<typeof setup>, diagnostics: readonly object[]) {
  editor.lsp.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: URI, version: 0, diagnostics },
    }),
    0,
  );
}

const messages = (editor: ReturnType<typeof setup>) =>
  [...editor.view.dom.querySelectorAll(".atlas-inline-diagnostic")].map((dom) => dom.textContent);

describe("inline diagnostics", () => {
  it("writes each line's worst message after its text, and takes it away with the problem", async () => {
    const editor = setup(TEXT, {
      extensions: diagnosticsUi({ keys: { next: [], previous: [] }, inline: true }),
    });
    try {
      await editor.initialize();
      const doc = editor.view.state.doc;
      publish(editor, [
        { range: range(doc, 4, 5), severity: 2, message: "a is unused" },
        { range: range(doc, 8, 11), severity: 1, message: "bad is not defined\nmore about it" },
      ]);
      await vi.waitFor(() => expect(messages(editor)).toEqual(["bad is not defined (+1)"]));
      expect(editor.view.dom.querySelector(".atlas-inline-diagnostic-line")).not.toBeNull();

      publish(editor, []);
      await vi.waitFor(() => expect(messages(editor)).toEqual([]));
    } finally {
      editor.view.destroy();
    }
  });

  it("stays out of the text unless asked for", async () => {
    const editor = setup(TEXT, { extensions: diagnosticsUi({ keys: { next: [], previous: [] } }) });
    try {
      await editor.initialize();
      publish(editor, [
        { range: range(editor.view.state.doc, 8, 11), severity: 1, message: "bad" },
      ]);
      await vi.waitFor(() => expect(editor.diagnostics()).toEqual(["bad"]));
      expect(messages(editor)).toEqual([]);
    } finally {
      editor.view.destroy();
    }
  });
});
