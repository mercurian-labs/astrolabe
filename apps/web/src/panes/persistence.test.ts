import { describe, expect, it } from "vite-plus/test";

import { CONVERSATION, openBeside, startingArrangement, surfaceKey } from "./arrangement";
import {
  arrangementStorageKey,
  loadArrangement,
  parseArrangement,
  writeArrangement,
  type StorageLike,
} from "./persistence";

function memoryStorage(): StorageLike & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe("a thread's arrangement on the device", () => {
  it("comes back as it was left", () => {
    const storage = memoryStorage();
    const arranged = openBeside(startingArrangement(), surfaceKey("diff"), "p0", "right");
    writeArrangement(storage, "env:thread", arranged);
    expect(loadArrangement(storage, "env:thread")).toEqual(arranged);
  });

  it("keeps nothing for a thread left as it first opened", () => {
    const storage = memoryStorage();
    const key = arrangementStorageKey("env:thread");
    writeArrangement(
      storage,
      "env:thread",
      openBeside(startingArrangement(), surfaceKey("diff"), "p0", "right"),
    );
    expect(storage.items.has(key)).toBe(true);
    writeArrangement(storage, "env:thread", startingArrangement());
    expect(storage.items.has(key)).toBe(false);
    expect(loadArrangement(storage, "env:thread")).toEqual(startingArrangement());
  });

  it("opens afresh from unreadable storage", () => {
    const storage = memoryStorage();
    storage.setItem(arrangementStorageKey("env:thread"), "{not json");
    expect(loadArrangement(storage, "env:thread")).toEqual(startingArrangement());
  });
});

describe("reading a stored arrangement", () => {
  it("keeps only tabs it can show, each once, and puts the conversation back when missing", () => {
    const parsed = parseArrangement({
      root: {
        type: "branch",
        id: "p2",
        direction: "row",
        weights: [2, -1, 1],
        children: [
          { type: "leaf", id: "p0", tabs: ["surface:diff", "bogus", "surface:diff"], active: "x" },
          { type: "leaf", id: "p1", tabs: [] },
          { type: "leaf", id: "p3", tabs: ["empty/7"], active: "empty/7" },
        ],
      },
      focused: "gone",
      seq: 1,
    });
    expect(parsed).toEqual({
      root: {
        type: "branch",
        id: "p2",
        direction: "row",
        weights: [2, 1],
        children: [
          { type: "leaf", id: "p0", tabs: [CONVERSATION, "surface:diff"], active: "surface:diff" },
          { type: "leaf", id: "p3", tabs: ["empty/7"], active: "empty/7" },
        ],
      },
      focused: "p0",
      seq: 8,
    });
  });

  it("collapses a branch left with one pane into that pane", () => {
    const parsed = parseArrangement({
      root: {
        type: "branch",
        id: "p1",
        direction: "column",
        weights: [1, 1],
        children: [
          { type: "leaf", id: "p0", tabs: [CONVERSATION], active: CONVERSATION },
          { type: "leaf", id: "p0", tabs: ["surface:files"], active: "surface:files" },
        ],
      },
      focused: "p0",
      seq: 2,
    });
    expect(parsed?.root).toEqual({
      type: "leaf",
      id: "p0",
      tabs: [CONVERSATION],
      active: CONVERSATION,
    });
  });

  it("refuses what holds nothing usable", () => {
    expect(parseArrangement(null)).toBeNull();
    expect(parseArrangement({ root: { type: "leaf", id: "p0", tabs: ["bogus"] } })).toBeNull();
  });
});
