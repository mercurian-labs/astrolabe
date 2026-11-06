import { describe, expect, it } from "vite-plus/test";

import { lastRename, undoableEdit, type UndoOutcome } from "./renameUndo";

describe("undoableEdit", () => {
  it("takes the edit back once, whichever door runs it, and stops being the last rename", async () => {
    let finish = (_outcome: UndoOutcome) => {};
    let calls = 0;
    const edit = undoableEdit("Undo rename", () => {
      calls += 1;
      return new Promise((resolve) => (finish = resolve));
    });
    lastRename.set(edit);
    const seen: string[] = [];
    edit.subscribe(() => seen.push(edit.state()));

    edit.run();
    edit.run();
    expect(lastRename.get()).toBeNull();
    finish({ files: ["a.ts"], skipped: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(seen).toEqual(["undoing", "undone"]);
  });

  it.each([
    ["the environment could not", null, "failed", []],
    ["every file changed since", { files: [], skipped: ["a.ts"] }, "failed", ["a.ts"]],
    ["some files changed since", { files: ["a.ts"], skipped: ["b.ts"] }, "partly", ["b.ts"]],
  ] as const)("says what happened when %s", async (_case, outcome, state, skipped) => {
    const edit = undoableEdit("Undo rename", () => Promise.resolve(outcome));
    edit.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(edit.state()).toBe(state);
    expect(edit.skipped()).toEqual(skipped);
  });
});
