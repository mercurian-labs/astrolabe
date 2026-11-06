import { Compartment, type Text } from "@codemirror/state";
import { describe, expect, it, vi } from "vite-plus/test";

import { codeLens } from "./codeLens.ts";
import { environmentCodeActions, type AppliedCodeAction } from "./codeActions.ts";
import { environmentNavigation, type NavigationLocation } from "./navigation.ts";
import { range, setup, URI } from "./testing.ts";

const TEXT = "function add() {}\n  function deep() {}\nconst other = 1;\n";

const lenses = new Compartment();

const KEYS = {
  definition: [],
  declaration: [],
  typeDefinition: [],
  implementation: [],
  references: [],
  incomingCalls: [],
  outgoingCalls: [],
};

function open(
  resolve: (lens: any) => unknown = (lens) => lens,
  list: (doc: Text) => unknown = (doc) => [
    { range: range(doc, 9, 12), data: "references" },
    { range: range(doc, 29, 33), data: "command" },
  ],
) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const picked: Array<readonly NavigationLocation[]> = [];
  const applied: AppliedCodeAction[] = [];
  const editor = setup(TEXT, {
    capabilities: {
      codeLensProvider: { resolveProvider: true },
      referencesProvider: true,
    },
    answer: (method, params) => {
      if (method === "textDocument/codeLens") return list(editor.view.state.doc);
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
      lenses.of(codeLens()),
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
          jumping: () => undefined,
          projectSymbols: () => undefined,
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
      ? { title: "2 references", command: "" }
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

  it("runs a row's lens from the latest list, where its text is now", async () => {
    const editor = open(resolved);
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(900);
      editor.lsp.receive(
        JSON.stringify({ jsonrpc: "2.0", method: "astrolabe/refresh", params: "codeLens" }),
      );
      await vi.advanceTimersByTimeAsync(900);
      editor.type(0, "// top\n");
      button(editor, "2 references").click();
      await vi.advanceTimersByTimeAsync(10);
      const asked = editor.sent.filter(
        (entry) => entry.message.method === "textDocument/references",
      );
      expect(asked.at(-1)?.message.params.position).toEqual({ line: 1, character: 9 });
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("resolves a lens at its range in the text now", async () => {
    const editor = open(resolved, () => undefined);
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(900);
      const list = editor.sent.find((entry) => entry.message.method === "textDocument/codeLens");
      const doc = editor.view.state.doc;
      editor.type(0, "// top\n");
      editor.lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: list?.message.id,
          result: [{ range: range(doc, 9, 12), data: "references" }],
        }),
      );
      await vi.advanceTimersByTimeAsync(10);
      const resolve = editor.sent.find((entry) => entry.message.method === "codeLens/resolve");
      expect(resolve?.message.params.range).toEqual({
        start: { line: 1, character: 9 },
        end: { line: 1, character: 12 },
      });
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("draws nothing after it is turned off, however late an answer comes", async () => {
    const editor = open(() => undefined);
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(900);
      expect(rows(editor)).toHaveLength(2);
      const resolve = editor.sent.find((entry) => entry.message.method === "codeLens/resolve");

      editor.view.dispatch({ effects: lenses.reconfigure([]) });
      await vi.advanceTimersByTimeAsync(0);
      expect(rows(editor)).toEqual([]);
      const cancels = editor.sent.filter((entry) => entry.message.method === "$/cancelRequest");
      expect(cancels.map((entry) => entry.message.params.id)).toContain(resolve?.message.id);

      editor.lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: resolve?.message.id,
          result: resolved(resolve?.message.params),
        }),
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(rows(editor)).toEqual([]);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });
});
