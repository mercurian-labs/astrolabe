import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";

import { vimMode, type VimHistory } from "../vim.ts";
import { environmentHover, showHover, showSignatureHelp } from "./hover.ts";
import { range, setup } from "./testing.ts";

const noHistory: VimHistory = { undo() {}, redo() {}, stopCapturing() {}, groupExplicitly() {} };

const TEXT = "const point = makePoint(1, 2);\n";

async function open(extra: { vim?: boolean } = {}) {
  const editor = setup(TEXT, {
    capabilities: { hoverProvider: true, signatureHelpProvider: { triggerCharacters: ["("] } },
    answer: (method, params) => {
      if (method === "textDocument/hover") {
        const at = TEXT.indexOf("makePoint");
        const doc = editor.view.state.doc;
        return params.position.character >= at
          ? {
              contents: { kind: "markdown", value: "```ts\nfunction makePoint(): Point\n```" },
              range: range(doc, at, at + 9),
            }
          : null;
      }
      if (method === "textDocument/signatureHelp") {
        return {
          signatures: [
            {
              label: "makePoint(x: number, y: number): Point",
              parameters: [{ label: [10, 19] }, { label: [21, 30] }],
            },
          ],
          activeSignature: 0,
          activeParameter: 1,
        };
      }
      return undefined;
    },
    extensions: [
      environmentHover({ keys: { hover: [], signatureHelp: [] } }),
      extra.vim ? vimMode(noHistory) : [],
    ],
  });
  await editor.initialize();
  return editor;
}

const tooltip = (view: EditorView) => view.dom.querySelector(".cm-lsp-hover-tooltip");

function press(view: EditorView, key: string) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: `Key${key.toUpperCase()}`,
      keyCode: key.toUpperCase().charCodeAt(0),
      shiftKey: key !== key.toLowerCase(),
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("environmentHover", () => {
  it("keeps a hover open while the environment edits the file, and closes it on your edit", async () => {
    const editor = await open();
    try {
      editor.view.dispatch({ selection: { anchor: TEXT.indexOf("makePoint") + 2 } });
      showHover(editor.view);
      await vi.waitFor(() =>
        expect(tooltip(editor.view)?.textContent).toContain("makePoint(): Point"),
      );
      // An agent adds a line above; the hover stays on the symbol.
      editor.agent({ from: 0, insert: "// agent\n" });
      editor.deliver();
      expect(tooltip(editor.view)).not.toBeNull();
      editor.type(editor.view.state.doc.length, "x");
      expect(tooltip(editor.view)).toBeNull();
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("opens from Vim's K", async () => {
    const editor = await open({ vim: true });
    try {
      editor.view.dispatch({ selection: { anchor: TEXT.indexOf("makePoint") } });
      editor.view.focus();
      press(editor.view, "K");
      await vi.waitFor(() => expect(tooltip(editor.view)).not.toBeNull());
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("shows the call's signature with the active parameter marked", async () => {
    const editor = await open();
    try {
      editor.view.dispatch({ selection: { anchor: TEXT.indexOf("2)") } });
      showSignatureHelp(editor.view);
      await vi.waitFor(() =>
        expect(editor.view.dom.querySelector(".cm-lsp-active-parameter")?.textContent).toBe(
          "y: number",
        ),
      );
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });
});
