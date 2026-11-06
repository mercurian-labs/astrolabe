import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";

import { environmentRename, type RenameResult, renameSymbol } from "./rename.ts";
import { range, setup } from "./testing.ts";

const TEXT = "const point = makePoint(1, 2);\nexport const label = point;\n";
const PLACE = { path: "src/main.ts", line: 1, column: 14, endLine: 1, endColumn: 21 };

async function open() {
  const renamed: RenameResult[] = [];
  const editor = setup(TEXT, {
    capabilities: { renameProvider: { prepareProvider: true } },
    answer: (method, params) => {
      if (method === "textDocument/prepareRename") {
        const at = TEXT.indexOf("makePoint");
        return { range: range(editor.view.state.doc, at, at + 9), placeholder: "makePoint" };
      }
      if (method === "textDocument/rename") {
        return {
          applied: {
            id: "edit-1",
            files: ["src/main.ts", "src/point.ts"],
            edits: 3,
            places: [PLACE],
          },
        };
      }
      void params;
      return undefined;
    },
    extensions: environmentRename({
      keys: [],
      host: { renamed: (_view, result) => renamed.push(result) },
    }),
  });
  await editor.initialize();
  return { ...editor, renamed };
}

const box = (view: EditorView) => view.dom.querySelector<HTMLInputElement>(".atlas-rename-input");

function key(input: HTMLInputElement, name: string) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

describe("environmentRename", () => {
  it("asks the environment to rename the symbol to what you type, and tells the host", async () => {
    const editor = await open();
    try {
      editor.view.dispatch({ selection: { anchor: TEXT.indexOf("makePoint") + 3 } });
      renameSymbol(editor.view);
      await vi.waitFor(() => expect(box(editor.view)?.value).toBe("makePoint"));
      // The box sits below the symbol's line.
      expect(box(editor.view)!.closest(".cm-line")).toBeNull();
      box(editor.view)!.value = "pointAt";
      key(box(editor.view)!, "Enter");
      expect(box(editor.view)).toBeNull();
      await vi.waitFor(() => expect(editor.renamed).toHaveLength(1));
      expect(editor.renamed[0]).toEqual({
        id: "edit-1",
        files: ["src/main.ts", "src/point.ts"],
        edits: 3,
        places: [PLACE],
        from: "makePoint",
        to: "pointAt",
      });
      const request = editor.sent.find((entry) => entry.message.method === "textDocument/rename")!;
      expect(request.message.params).toMatchObject({
        newName: "pointAt",
        position: { line: 0, character: TEXT.indexOf("makePoint") },
      });
      expect(request.document).toMatchObject({ loadId: "load" });
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("does nothing on Escape, or for an unchanged or empty name", async () => {
    const editor = await open();
    try {
      for (const [value, keyName] of [
        ["pointAt", "Escape"],
        ["makePoint", "Enter"],
        ["  ", "Enter"],
      ] as const) {
        editor.view.dispatch({ selection: { anchor: TEXT.indexOf("makePoint") } });
        renameSymbol(editor.view);
        await vi.waitFor(() => expect(box(editor.view)).not.toBeNull());
        box(editor.view)!.value = value;
        key(box(editor.view)!, keyName);
        expect(box(editor.view)).toBeNull();
      }
      expect(editor.sent.some((entry) => entry.message.method === "textDocument/rename")).toBe(
        false,
      );
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });
});
