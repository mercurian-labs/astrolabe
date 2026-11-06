import { describe, expect, it, vi } from "vite-plus/test";

import { codeLens } from "./codeLens.ts";
import { environmentCodeActions, type AppliedCodeAction } from "./codeActions.ts";
import { environmentNavigation, type NavigationLocation } from "./navigation.ts";
import { range, setup, URI } from "./testing.ts";

const TEXT = "function add() {}\n  function deep() {}\nconst other = 1;\n";

const KEYS = {
  definition: [],
  declaration: [],
  typeDefinition: [],
  implementation: [],
  references: [],
  incomingCalls: [],
  outgoingCalls: [],
};

function open(resolve: (lens: any) => unknown = (lens) => lens) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const picked: Array<readonly NavigationLocation[]> = [];
  const applied: AppliedCodeAction[] = [];
  const editor = setup(TEXT, {
    capabilities: {
      codeLensProvider: { resolveProvider: true },
      referencesProvider: true,
    },
    answer: (method, params) => {
      if (method === "textDocument/codeLens") {
        const doc = editor.view.state.doc;
        return [
          { range: range(doc, 9, 12), data: "references" },
          { range: range(doc, 29, 33), data: "command" },
        ];
      }
      if (method === "codeLens/resolve") return resolve(params);
      if (method === "textDocument/references") {
        return [
          { uri: URI, range: range(editor.view.state.doc, 9, 12) },
          { uri: "file:///repo/src/other.ts", range: range(editor.view.state.doc, 0, 3) },
        ];
      }
      if (method === "astrolabe/runLensCommand") {
        return { applied: { id: "edit-1", files: ["src/main.ts"], edits: 1, places: [] } };
      }
      return undefined;
    },
    extensions: [
      codeLens(),
      environmentCodeActions({
        keys: [],
        host: { applied: (_view, action) => applied.push(action) },
      }),
      environmentNavigation({
        keys: KEYS,
        host: {
          open: () => undefined,
          pick: (_view, _title, locations) => picked.push(locations),
          nothing: () => undefined,
        },
      }),
    ],
  });
  return Object.assign(editor, { picked, applied });
}

const resolved = (lens: any) => ({
  ...lens,
  command:
    lens.data === "references"
      ? { title: "2 references", command: "editor.showReferences" }
      : { title: "Run test", command: "server.runTest", arguments: [1] },
});

const rows = (editor: ReturnType<typeof setup>) =>
  [...editor.view.dom.querySelectorAll(".atlas-code-lens")].map((row) => row.textContent);

const button = (editor: ReturnType<typeof setup>, name: string) =>
  [...editor.view.dom.querySelectorAll("button")].find((item) => item.textContent === name)!;

describe("codeLens", () => {
  it("holds a row for each lens until it resolves, then fills it in or lets it go", async () => {
    let answer: (lens: any) => unknown = () => undefined;
    const editor = open((lens) => answer(lens));
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(900);
      expect(rows(editor)).toEqual(["\u00a0", "  \u00a0"]);

      answer = (lens) => (lens.data === "references" ? resolved(lens) : lens);
      editor.lsp.receive(
        JSON.stringify({ jsonrpc: "2.0", method: "astrolabe/refresh", params: "codeLens" }),
      );
      await vi.advanceTimersByTimeAsync(900);
      expect(rows(editor)).toEqual(["2 references"]);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("opens references itself and runs anything else on the server", async () => {
    const editor = open(resolved);
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(900);
      button(editor, "2 references").click();
      await vi.advanceTimersByTimeAsync(10);
      expect(editor.picked).toHaveLength(1);
      expect(editor.view.state.selection.main.head).toBe(0);

      button(editor, "Run test").click();
      await vi.advanceTimersByTimeAsync(10);
      const run = editor.sent.find((entry) => entry.message.method === "astrolabe/runLensCommand");
      expect(run?.message.params.command.command).toBe("server.runTest");
      expect(editor.applied).toHaveLength(1);
      expect(editor.applied[0]?.title).toBe("Run test");
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("keeps rows through an edit and asks again once it settles", async () => {
    const editor = open(resolved);
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(900);
      editor.type(0, "// top\n");
      await vi.advanceTimersByTimeAsync(100);
      expect(rows(editor)).toEqual(["2 references", "  Run test"]);
      await vi.advanceTimersByTimeAsync(900);
      const lists = editor.sent.filter((entry) => entry.message.method === "textDocument/codeLens");
      expect(lists).toHaveLength(2);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });
});
