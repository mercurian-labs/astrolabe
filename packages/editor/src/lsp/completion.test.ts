import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";

import { vimInsertMode, vimMode, type VimHistory } from "../vim.ts";
import { environmentCompletion } from "./completion.ts";
import { setup } from "./testing.ts";

const noHistory: VimHistory = { undo() {}, redo() {}, stopCapturing() {}, groupExplicitly() {} };

const CAPABILITIES = {
  completionProvider: { resolveProvider: true, triggerCharacters: ["."] },
};

/** A completion list as the gateway sends it, and auto-import resolves. */
function server(
  labels: readonly string[],
  options: { incomplete?: boolean; holdResolve?: boolean } = {},
) {
  const calls: string[] = [];
  return {
    calls,
    answer: (method: string, params: any) => {
      calls.push(method);
      if (method === "textDocument/completion") {
        return {
          isIncomplete: options.incomplete ?? false,
          items: labels.map((label, index) => ({
            label,
            sortText: String(index),
            data: { label },
          })),
        };
      }
      if (method === "completionItem/resolve") {
        if (options.holdResolve) return undefined;
        return resolved(params);
      }
      return undefined;
    },
  };
}

function resolved(params: any) {
  return {
    ...params,
    documentation: `About ${params.label}`,
    additionalTextEdits: [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: `import { ${params.label} } from "./lib";\n`,
      },
    ],
  };
}

function press(view: EditorView, key: string) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      keyCode:
        key.length === 1
          ? key.toUpperCase().charCodeAt(0)
          : (({ Escape: 27, Enter: 13, Tab: 9 } as Record<string, number>)[key] ?? 0),
      shiftKey: key.length === 1 && key !== key.toLowerCase(),
      bubbles: true,
      cancelable: true,
    }),
  );
}

const typeAtCaret = (view: EditorView, text: string) =>
  view.dispatch({ ...view.state.replaceSelection(text), userEvent: "input.type" });

const shown = (view: EditorView) =>
  currentCompletions(view.state).map((option) => option.displayLabel);

async function open(
  text: string,
  answers: ReturnType<typeof server>,
  extra: { vim?: boolean } = {},
) {
  const editor = setup(text, {
    answer: answers.answer,
    capabilities: CAPABILITIES,
    extensions: [
      history(),
      environmentCompletion({ keys: { complete: ["Ctrl-Space"] } }),
      extra.vim ? vimMode(noHistory) : [],
    ],
  });
  await editor.initialize();
  editor.view.dispatch({ selection: { anchor: text.length } });
  return editor;
}

/** Moves the clock past the menu's guard against keys pressed the moment it opens. */
const pastGuard = () => {
  const now = Date.now() + 1000;
  return vi.spyOn(Date, "now").mockReturnValue(now);
};

const menuOpen = (view: EditorView) =>
  vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));

describe("environmentCompletion", () => {
  it("ranks the server's items for the word typed, and narrows them without asking again", async () => {
    const answers = server(["summary", "flatMap", "map", "mapValues"]);
    const editor = await open("const x = ma", answers);
    try {
      startCompletion(editor.view);
      await menuOpen(editor.view);
      expect(shown(editor.view)).toEqual(["map", "mapValues", "flatMap", "summary"]);
      const request = editor.sent.find(
        (entry) => entry.message.method === "textDocument/completion",
      );
      expect(request?.document).toMatchObject({ loadId: "load", version: 0 });
      typeAtCaret(editor.view, "p");
      await vi.waitFor(() => expect(shown(editor.view)).toEqual(["map", "mapValues", "flatMap"]));
      typeAtCaret(editor.view, "V");
      await vi.waitFor(() => expect(shown(editor.view)).toEqual(["mapValues"]));
      expect(answers.calls.filter((method) => method === "textDocument/completion")).toHaveLength(
        1,
      );
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("asks again when the server said its list was cut short", async () => {
    const answers = server(["map", "mapValues"], { incomplete: true });
    const editor = await open("const x = ma", answers);
    try {
      startCompletion(editor.view);
      await menuOpen(editor.view);
      typeAtCaret(editor.view, "p");
      await vi.waitFor(() =>
        expect(answers.calls.filter((method) => method === "textDocument/completion")).toHaveLength(
          2,
        ),
      );
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("adds the import its resolve brings with the accepted name, as one undo step", async () => {
    const answers = server(["makePoint"]);
    const editor = await open("const p = mak", answers);
    try {
      startCompletion(editor.view);
      await menuOpen(editor.view);
      // The selected item's documentation asks for its resolve.
      await vi.waitFor(() => expect(answers.calls).toContain("completionItem/resolve"));
      await vi.waitFor(() =>
        expect(editor.view.dom.querySelector(".cm-completionInfo")?.textContent).toContain(
          "About makePoint",
        ),
      );
      using _later = pastGuard();
      press(editor.view, "Tab");
      expect(editor.view.state.doc.toString()).toBe(
        'import { makePoint } from "./lib";\nconst p = makePoint',
      );
      undo(editor.view);
      expect(editor.view.state.doc.toString()).toBe("const p = mak");
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("adds the import when it arrives after the name was accepted", async () => {
    const answers = server(["makePoint"], { holdResolve: true });
    const editor = await open("const p = mak", answers);
    try {
      startCompletion(editor.view);
      await menuOpen(editor.view);
      using _later = pastGuard();
      acceptCompletion(editor.view);
      expect(editor.view.state.doc.toString()).toBe("const p = makePoint");
      // The user types on before the answer; the import still lands at the top.
      typeAtCaret(editor.view, "(");
      const request = editor.sent.find(
        (entry) => entry.message.method === "completionItem/resolve",
      )!;
      editor.lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.message.id,
          result: resolved(request.message.params),
        }),
      );
      await vi.waitFor(() =>
        expect(editor.view.state.doc.toString()).toBe(
          'import { makePoint } from "./lib";\nconst p = makePoint(',
        ),
      );
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("in Vim's insert mode, Enter accepts and the first Escape only closes the menu", async () => {
    const answers = server(["makePoint"]);
    const editor = await open("const p = mak", answers, { vim: true });
    try {
      editor.view.focus();
      press(editor.view, "A");
      expect(vimInsertMode(editor.view)).toBe(true);
      startCompletion(editor.view);
      await menuOpen(editor.view);
      press(editor.view, "Escape");
      expect(completionStatus(editor.view.state)).toBeNull();
      expect(vimInsertMode(editor.view)).toBe(true);
      startCompletion(editor.view);
      await menuOpen(editor.view);
      using _later = pastGuard();
      press(editor.view, "Enter");
      expect(editor.view.state.doc.toString()).toContain("const p = makePoint");
      expect(editor.view.state.doc.toString()).not.toContain("makePoint\n");
      expect(vimInsertMode(editor.view)).toBe(true);
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });
});
