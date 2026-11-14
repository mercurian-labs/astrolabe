import { describe, expect, it } from "@effect/vitest";

import { mergeCapabilities, mergeCompletions } from "./fanOut.ts";

describe("merging several servers' answers", () => {
  it("advertises only what some server does, with their trigger characters together", () => {
    const merged = mergeCapabilities([
      {
        hoverProvider: false,
        renameProvider: { prepareProvider: true },
        completionProvider: { triggerCharacters: ["."], resolveProvider: false },
      },
      {
        hoverProvider: true,
        renameProvider: true,
        completionProvider: { triggerCharacters: [".", " "], resolveProvider: true },
        signatureHelpProvider: { triggerCharacters: ["("], retriggerCharacters: [","] },
      },
    ]);
    expect(merged).toEqual({
      hoverProvider: true,
      renameProvider: { prepareProvider: true },
      completionProvider: { triggerCharacters: [".", " "], resolveProvider: true },
      signatureHelpProvider: { triggerCharacters: ["("], retriggerCharacters: [","] },
    });
    expect(mergeCapabilities([{}]).completionProvider).toBeUndefined();
  });

  it("writes a list's defaults into its items, since a merged list keeps none", () => {
    const range = {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 4 },
    };
    const merged = mergeCompletions([
      {
        isIncomplete: false,
        itemDefaults: { editRange: range, insertTextFormat: 2, commitCharacters: ["."] },
        items: [{ label: "a" }, { label: "b", textEditText: "bee", insertTextFormat: 1 }],
      },
      { isIncomplete: true, items: [{ label: "c" }] },
    ]);
    expect(merged).toEqual({
      isIncomplete: true,
      items: [
        {
          label: "a",
          commitCharacters: ["."],
          insertTextFormat: 2,
          textEdit: { range, newText: "a" },
        },
        {
          label: "b",
          textEditText: "bee",
          commitCharacters: ["."],
          insertTextFormat: 1,
          textEdit: { range, newText: "bee" },
        },
        { label: "c" },
      ],
    });
  });
});
