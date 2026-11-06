import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";

import { type AppliedCodeAction, environmentCodeActions, showCodeActions } from "./codeActions.ts";
import { range, setup, URI } from "./testing.ts";

const TEXT = "let bad = 1;\nlet fine = 2;\n";
const PLACE = { path: "src/main.ts", line: 1, column: 4, endLine: 1, endColumn: 8 };

async function open() {
  const applied: AppliedCodeAction[] = [];
  const editor = setup(TEXT, {
    capabilities: { codeActionProvider: true },
    answer: (method, params) => {
      if (method === "textDocument/codeAction") {
        return params.context.diagnostics.length === 0
          ? []
          : [
              { index: 0, title: "Remove the line" },
              { index: 1, title: "Replace bad with good", kind: "quickfix", isPreferred: true },
            ];
      }
      if (method === "astrolabe/applyCodeAction") {
        return {
          applied: {
            id: "edit-7",
            files: ["src/main.ts"],
            edits: 1,
            places: [PLACE],
          },
        };
      }
      return undefined;
    },
    extensions: environmentCodeActions({
      keys: [],
      host: { applied: (_view, action) => applied.push(action) },
    }),
  });
  await editor.initialize();
  // The server's diagnostic, with the code its fixes are keyed by.
  editor.lsp.receive(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: URI,
        version: 0,
        diagnostics: [
          {
            range: range(editor.view.state.doc, 4, 7),
            severity: 1,
            message: "bad is not allowed",
            code: 7,
          },
        ],
      },
    }),
    0,
  );
  return { ...editor, applied };
}

const rows = (view: EditorView) =>
  [...view.dom.querySelectorAll(".atlas-code-action")].map((row) => [
    row.textContent,
    row.getAttribute("aria-selected") === "true",
  ]);

function press(view: EditorView, key: string) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

describe("environmentCodeActions", () => {
  it("offers the server's actions for the diagnostics under the cursor, and applies the one picked", async () => {
    const editor = await open();
    try {
      editor.view.dispatch({ selection: { anchor: 5 } });
      showCodeActions(editor.view);
      await vi.waitFor(() =>
        expect(rows(editor.view)).toEqual([
          ["Remove the line", false],
          ["Replace bad with good", true],
        ]),
      );
      const request = editor.sent.find(
        (entry) => entry.message.method === "textDocument/codeAction",
      )!;
      expect(request.message.params.context.diagnostics).toMatchObject([
        { code: 7, message: "bad is not allowed" },
      ]);
      press(editor.view, "Enter");
      expect(rows(editor.view)).toEqual([]);
      await vi.waitFor(() => expect(editor.applied).toHaveLength(1));
      expect(editor.applied[0]).toEqual({
        title: "Replace bad with good",
        id: "edit-7",
        files: ["src/main.ts"],
        edits: 1,
        places: [PLACE],
      });
      const apply = editor.sent.find(
        (entry) => entry.message.method === "astrolabe/applyCodeAction",
      )!;
      expect(apply.message.params).toEqual({ index: 1 });
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("shows a light bulb on the line once the cursor rests where actions exist", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const editor = await open();
    try {
      const bulbs = () => editor.view.dom.querySelectorAll(".atlas-lightbulb svg").length;
      editor.view.dispatch({ selection: { anchor: TEXT.indexOf("fine") } });
      await vi.advanceTimersByTimeAsync(300);
      expect(bulbs()).toBe(0);
      editor.view.dispatch({ selection: { anchor: 5 } });
      await vi.advanceTimersByTimeAsync(300);
      expect(bulbs()).toBe(1);
      // Moving on hides it until the next rest.
      editor.view.dispatch({ selection: { anchor: 6 } });
      expect(bulbs()).toBe(0);
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
      vi.useRealTimers();
    }
  });
});
