import { describe, expect, it } from "vite-plus/test";

import { moveKey, neighbourOf } from "./tabListStore";

describe("reordering tabs", () => {
  it("moves a tab to the insertion line, counted before the move", () => {
    expect(moveKey(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
    expect(moveKey(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveKey(["a", "b", "c"], "a", 2)).toEqual(["b", "a", "c"]);
  });

  it("leaves the strip as it is for a drop where the tab already stands, or an unknown tab", () => {
    const keys = ["a", "b", "c"];
    expect(moveKey(keys, "b", 1)).toBe(keys);
    expect(moveKey(keys, "b", 2)).toBe(keys);
    expect(moveKey(keys, "z", 0)).toBe(keys);
  });
});

describe("the tab shown when the one in front closes", () => {
  it("is the tab after it, else the one before it, else none", () => {
    expect(neighbourOf(["a", "b", "c"], "b")).toBe("c");
    expect(neighbourOf(["a", "b", "c"], "c")).toBe("b");
    expect(neighbourOf(["a"], "a")).toBeNull();
    expect(neighbourOf(["a"], "z")).toBeNull();
  });
});
