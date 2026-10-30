import { Text } from "@codemirror/state";
import { describe, expect, it } from "vite-plus/test";

import { diagnosticsUi } from "./diagnostics.ts";
import { range, setup, URI } from "./testing.ts";

describe("environmentLsp", () => {
  const mount = (text: string) =>
    setup(text, { extensions: diagnosticsUi({ keys: { next: [], previous: [] } }) });

  it("sends no didChange, and gives each request the editor's version and unconfirmed edits", async () => {
    const editor = mount("const a = 1;\n");
    try {
      await editor.initialize();
      expect(editor.sent.map((entry) => entry.message.method)).toEqual([
        "initialize",
        "initialized",
        "textDocument/didOpen",
      ]);
      editor.agent({ from: 0, insert: "// agent\n" });
      editor.deliver();
      editor.type(0, "let b = 2;\n");
      const pending = editor.lsp.client.request("textDocument/hover", {
        textDocument: { uri: URI },
        position: { line: 0, character: 4 },
      });
      void pending.catch(() => undefined);
      editor.lsp.client.sync();
      await Promise.resolve();
      const hover = editor.sent.find((entry) => entry.message.method === "textDocument/hover")!;
      expect(hover.document).toMatchObject({ loadId: "load", version: 1, clientId: "editor" });
      expect(hover.document!.unconfirmed).toHaveLength(1);
      expect(editor.sent.some((entry) => entry.message.method === "textDocument/didChange")).toBe(
        false,
      );
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("holds diagnostics until the editor has their version, then lands them on the right text", async () => {
    const editor = mount("let value = 1;\n");
    try {
      await editor.initialize();
      // The agent adds two lines the editor hasn't received; the editor types its own meanwhile.
      const version = editor.agent({ from: 0, insert: "// one\n// two\n" });
      editor.type(0, "const mine = 0;\n");
      const environmentText = "// one\n// two\nlet value = 1;\n";
      const at = environmentText.indexOf("value");
      editor.lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: {
            uri: URI,
            version,
            diagnostics: [
              {
                range: range(Text.of(environmentText.split("\n")), at, at + 5),
                severity: 1,
                message: "unused",
              },
            ],
          },
        }),
        version,
      );
      expect(editor.diagnostics()).toEqual([]);
      editor.deliver();
      expect(editor.diagnostics()).toEqual(["value"]);
      expect(editor.view.state.doc.toString()).toBe(
        "// one\n// two\nconst mine = 0;\nlet value = 1;\n",
      );
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("writes the cursor line's messages below it", async () => {
    const editor = mount("let value = 1;\nlet other = 2;\n");
    try {
      await editor.initialize();
      const doc = editor.view.state.doc;
      editor.lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: {
            uri: URI,
            version: 0,
            diagnostics: [{ range: range(doc, 4, 9), severity: 1, message: "value is unused" }],
          },
        }),
        0,
      );
      editor.view.dispatch({ selection: { anchor: 2 } });
      await Promise.resolve();
      await Promise.resolve();
      const messages = editor.view.dom.querySelectorAll(".atlas-diagnostic-message");
      expect([...messages].map((element) => element.textContent)).toEqual(["value is unused"]);
      editor.view.dispatch({ selection: { anchor: doc.line(2).from } });
      await Promise.resolve();
      await Promise.resolve();
      expect(editor.view.dom.querySelectorAll(".atlas-diagnostic-message")).toHaveLength(0);
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });
});
