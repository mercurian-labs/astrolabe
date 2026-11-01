import { describe, expect, it } from "vite-plus/test";

import { openBeside, openTab, startingArrangement, surfaceKey } from "./arrangement";
import {
  arrangementStorageKey,
  joinLayouts,
  loadArrangement,
  parseArrangement,
  parseLinkedArrangement,
  writeArrangement,
  type StorageLike,
} from "./persistence";
import { leaves } from "./tree";

function memoryStorage(): StorageLike & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** Diff and Files side by side in the panel. */
function arranged() {
  return openBeside(
    openTab(startingArrangement(), surfaceKey("diff")),
    surfaceKey("files"),
    "p0",
    "right",
  );
}

describe("a thread's arrangement on the device", () => {
  it("comes back as it was left", () => {
    const storage = memoryStorage();
    writeArrangement(storage, "env:thread", arranged());
    expect(loadArrangement(storage, "env:thread")).toEqual(arranged());
  });

  it("keeps nothing for a thread left as it first opened", () => {
    const storage = memoryStorage();
    const key = arrangementStorageKey("env:thread");
    writeArrangement(storage, "env:thread", arranged());
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
  it("keeps only tabs it can show, each once, dropping an earlier build's conversation and guests", () => {
    const parsed = parseArrangement({
      root: {
        type: "branch",
        id: "p2",
        direction: "row",
        weights: [2, -1, 1],
        children: [
          {
            type: "leaf",
            id: "p0",
            tabs: ["conversation", "surface:diff", "bogus", "guest:a%3Ab", "surface:diff"],
            active: "x",
          },
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
          { type: "leaf", id: "p0", tabs: ["surface:diff"], active: "surface:diff" },
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
          { type: "leaf", id: "p0", tabs: ["surface:diff"], active: "surface:diff" },
          { type: "leaf", id: "p0", tabs: ["surface:files"], active: "surface:files" },
        ],
      },
      focused: "p0",
      seq: 2,
    });
    expect(parsed?.root).toEqual({
      type: "leaf",
      id: "p0",
      tabs: ["surface:diff"],
      active: "surface:diff",
    });
  });

  it("refuses what holds nothing usable", () => {
    expect(parseArrangement(null)).toBeNull();
    expect(parseArrangement({ root: { type: "leaf", id: "p0", tabs: ["bogus"] } })).toBeNull();
    expect(
      parseArrangement({ root: { type: "leaf", id: "p0", tabs: ["conversation"] } }),
    ).toBeNull();
  });
});

describe("the shared panes on the device", () => {
  const isKey = (key: string) =>
    key.startsWith("chat:") || key.startsWith("file:") || key.startsWith("empty/");

  it("join the chat tabs and each section's panes once, side by side, every tab open once", () => {
    const files = openBeside(openTab(startingArrangement(), "file:a"), "file:b", "p0", "right");
    const joined = joinLayouts(
      ["chat:e:1", "chat:e:2"],
      "chat:e:2",
      [files, startingArrangement()],
      isKey,
    );
    expect(joined && leaves(joined.root).map((leaf) => [leaf.id, leaf.tabs])).toEqual([
      ["p0", ["chat:e:1", "chat:e:2"]],
      ["p1", ["file:a"]],
      ["p2", ["file:b"]],
    ]);
    expect(joined && leaves(joined.root)[0]?.active).toBe("chat:e:2");
    expect(joinLayouts([], null, [startingArrangement()], isKey)).toBeNull();
  });

  it("keep the links of tabs open or set aside, and nothing set aside without an owner", () => {
    const parsed = parseLinkedArrangement(
      {
        ...openTab(openTab(startingArrangement(), "chat:e:1"), "file:a"),
        owners: { "file:a": "chat:e:1", "file:gone": "chat:e:1", "file:b": "chat:e:1" },
        parked: {
          "file:b": { pane: "p9", index: 2, active: true },
          "file:c": { pane: "p9", index: 0 },
        },
        front: "chat:e:1",
      },
      isKey,
    );
    expect(parsed?.owners).toEqual({ "file:a": "chat:e:1", "file:b": "chat:e:1" });
    expect(parsed?.parked).toEqual({ "file:b": { pane: "p9", index: 2, active: true } });
    expect(parsed?.front).toBe("chat:e:1");
  });
});
