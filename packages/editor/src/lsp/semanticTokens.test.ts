import { StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { describe, expect, it, vi } from "vite-plus/test";

import { semanticTokens } from "./semanticTokens.ts";
import { setup } from "./testing.ts";

const TEXT = "const total = add(1);\nadd(2);\n";

const LEGEND = {
  tokenTypes: ["variable", "class", "weird"],
  tokenModifiers: ["declaration", "readonly"],
};

/** `const` a type this client has no colour for, `total` declared, `add` a class twice. */
const DATA = [0, 0, 5, 2, 0, 0, 6, 5, 0, 1, 0, 8, 3, 1, 0, 1, 0, 3, 1, 0];

/** Every word is a keyword, so the server's colours have something to go over. */
const parsed = StreamLanguage.define({
  token: (stream) => {
    if (stream.match(/^\w+/)) return "keyword";
    stream.next();
    return null;
  },
});

function open(
  answer: (method: string, params: any) => unknown,
  full: object | boolean = true,
  text = TEXT,
) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return setup(text, {
    capabilities: { semanticTokensProvider: { legend: LEGEND, full } },
    answer,
    extensions: [parsed, syntaxHighlighting(classHighlighter), semanticTokens()],
  });
}

const requests = (editor: ReturnType<typeof setup>) =>
  editor.sent.filter((entry) => entry.message.method?.startsWith("textDocument/semanticTokens"));

const spanOf = (editor: ReturnType<typeof setup>, text: string) =>
  [...editor.view.dom.querySelectorAll("span")].find((span) => span.textContent === text);

describe("semanticTokens", () => {
  it("colours tokens with the highlight classes, over the parser's", async () => {
    const editor = open((method) =>
      method === "textDocument/semanticTokens/full" ? { data: DATA } : undefined,
    );
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(1100);
      // Inside the parser's span, so its colour is the one that shows.
      const { dom } = editor.view;
      expect(dom.querySelector(".tok-keyword .tok-variableName.tok-definition")?.textContent).toBe(
        "total",
      );
      expect(dom.querySelector(".tok-keyword .tok-className")?.textContent).toBe("add");
      expect(spanOf(editor, "const")?.className).toBe("tok-keyword");
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("keeps tokens on their text through edits, asking again only once they stop", async () => {
    const editor = open((method) =>
      method === "textDocument/semanticTokens/full" ? { data: DATA } : undefined,
    );
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(1100);
      expect(requests(editor)).toHaveLength(1);
      const painted = editor.view.dom.querySelectorAll(".tok-definition").length;
      for (const at of [0, 1, 2]) {
        editor.type(at, "/");
        await vi.advanceTimersByTimeAsync(200);
      }
      expect(requests(editor)).toHaveLength(1);
      expect(editor.view.dom.querySelectorAll(".tok-definition")).toHaveLength(painted);
      await vi.advanceTimersByTimeAsync(1100);
      expect(requests(editor)).toHaveLength(2);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("asks for what changed when the server can say, and applies it to what it has", async () => {
    const editor = open(
      (method, params) => {
        if (method === "textDocument/semanticTokens/full") {
          return { resultId: "1", data: DATA };
        }
        expect(params.previousResultId).toBe("1");
        // Drops the last token.
        return { resultId: "2", edits: [{ start: 15, deleteCount: 5 }] };
      },
      { delta: true },
    );
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(1100);
      expect(editor.view.dom.querySelectorAll(".tok-className")).toHaveLength(2);
      editor.type(editor.view.state.doc.length, "\n");
      await vi.advanceTimersByTimeAsync(1100);
      expect(requests(editor).map((entry) => entry.message.method)).toEqual([
        "textDocument/semanticTokens/full",
        "textDocument/semanticTokens/full/delta",
      ]);
      expect(editor.view.dom.querySelectorAll(".tok-className")).toHaveLength(1);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });

  it("leaves a large file to the parser", async () => {
    const editor = open(() => ({ data: DATA }), true, `${"// long\n".repeat(70_000)}`);
    try {
      await editor.initialize();
      await vi.advanceTimersByTimeAsync(1100);
      expect(requests(editor)).toHaveLength(0);
    } finally {
      editor.view.destroy();
      vi.useRealTimers();
    }
  });
});
