import { describe, expect, it } from "vite-plus/test";

import { lastRename, undoableEdit } from "./renameUndo";

describe("undoableEdit", () => {
  it("takes the edit back once, whichever door runs it, and stops being the last rename", async () => {
    let finish = (_done: boolean) => {};
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
    finish(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(seen).toEqual(["undoing", "undone"]);
  });

  it("says when the environment could not take it back", async () => {
    const edit = undoableEdit("Undo rename", () => Promise.resolve(false));
    edit.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(edit.state()).toBe("failed");
  });
});
