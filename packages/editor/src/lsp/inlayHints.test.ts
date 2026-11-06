import { describe, expect, it, vi } from "vite-plus/test";

import { inlayHints } from "./inlayHints.ts";
import { setup, URI } from "./testing.ts";

const TEXT = "add(1, 2);\nconst total = add(3, 4);\n";

const at = (line: number, character: number) => ({ line, character });

const shownHints = (view: { dom: HTMLElement }) =>
  [...view.dom.querySelectorAll(".atlas-inlay-hint")].map((hint) => hint.textContent);

function open(
  answer: (params: any) => unknown,
  options: { readonly types: boolean; readonly parameters: boolean } = {
    types: true,
    parameters: true,
  },
) {
  return setup(TEXT, {
    capabilities: { inlayHintProvider: true },
    answer: (method, params) => (method === "textDocument/inlayHint" ? answer(params) : undefined),
    extensions: inlayHints(options),
  });
}

const hintRequests = (editor: ReturnType<typeof setup>) =>
  editor.sent.filter((entry) => entry.message.method === "textDocument/inlayHint");

describe("inlayHints", () => {
  it("asks for the lines on screen once the server is there, and draws the kinds wanted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const editor = open(
      () => [
        { position: at(0, 4), label: "left:", kind: 2, paddingRight: true },
        { position: at(1, 11), label: [{ value: ": " }, { value: "number" }], kind: 1 },
      ],
      { types: false, parameters: true },
    );
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(500);
      expect(hintRequests(editor)).toHaveLength(1);
      expect(hintRequests(editor)[0]!.message.params).toMatchObject({
        textDocument: { uri: URI },
        range: { start: at(0, 0) },
      });
      expect(shownHints(editor.view)).toEqual(["left:"]);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("moves hints with the text, waits out typing, and cancels what it no longer wants", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = [{ position: at(0, 4), label: "left:", kind: 2 }];
    let answers = 0;
    const editor = open(() => (answers++ === 0 ? first : undefined));
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(500);
      expect(shownHints(editor.view)).toEqual(["left:"]);

      editor.type(0, "x");
      const hint = editor.view.dom.querySelector(".atlas-inlay-hint")!;
      expect(editor.view.posAtDOM(hint)).toBe(5);
      await vi.advanceTimersByTimeAsync(100);
      editor.type(0, "y");
      await vi.advanceTimersByTimeAsync(100);
      expect(hintRequests(editor)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(500);
      expect(hintRequests(editor)).toHaveLength(2);
      const pending = hintRequests(editor)[1]!.message.id;
      editor.type(0, "z");
      await vi.advanceTimersByTimeAsync(500);
      const cancels = editor.sent.filter(
        ({ message }) => message.method === "$/cancelRequest" && message.params.id === pending,
      );
      expect(cancels).toHaveLength(1);
      expect(hintRequests(editor)).toHaveLength(3);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("drops an answer whose request a newer one replaced", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const editor = open(() => undefined);
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(500);
      const stale = hintRequests(editor)[0]!.message.id;
      editor.type(0, "x");
      await vi.advanceTimersByTimeAsync(500);
      editor.lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: stale,
          result: [{ position: at(0, 0), label: "stale" }],
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(shownHints(editor.view)).toEqual([]);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("writes a hint's edits when it is clicked", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const editor = open(() => [
      {
        position: at(1, 11),
        label: ": number",
        kind: 1,
        textEdits: [{ range: { start: at(1, 11), end: at(1, 11) }, newText: ": number" }],
      },
    ]);
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(500);
      editor.type(0, "// first\n");
      editor.view.dom
        .querySelector(".atlas-inlay-hint")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(editor.view.state.doc.line(3).text).toBe("const total: number = add(3, 4);");
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("asks again when the server says its hints changed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const editor = open(() => []);
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(500);
      expect(hintRequests(editor)).toHaveLength(1);
      editor.lsp.receive(
        JSON.stringify({ jsonrpc: "2.0", method: "astrolabe/refresh", params: "inlayHints" }),
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(hintRequests(editor)).toHaveLength(2);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });
});
