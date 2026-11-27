import { describe, expect, it } from "vite-plus/test";

import { keptTreePaths } from "./fileTreeFilter";

describe("keptTreePaths", () => {
  it("keeps each path with every folder above it, and the selected file", () => {
    expect([...keptTreePaths(["a/b/Plan.md", "Top.md"], "src/main.ts")].toSorted()).toEqual([
      "Top.md",
      "a",
      "a/b",
      "a/b/Plan.md",
      "src",
      "src/main.ts",
    ]);
    expect([...keptTreePaths([], null)]).toEqual([]);
  });
});
