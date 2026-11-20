import { describe, expect, it } from "vite-plus/test";

import { cycledWeights } from "./paneCommands";

describe("cycling a pane's size", () => {
  it("steps its share through a third, a half and two thirds, the rest keeping proportions", () => {
    const thirds = (weights: number[]) => weights.map((weight) => Math.round(weight * 300) / 300);
    expect(thirds(cycledWeights([1, 1], 0))).toEqual([2 / 3, 1 / 3]);
    expect(thirds(cycledWeights([2, 1], 0))).toEqual([1 / 3, 2 / 3]);
    expect(thirds(cycledWeights([1, 2], 0))).toEqual([1 / 2, 1 / 2]);
    expect(thirds(cycledWeights([1, 1, 2], 2))).toEqual([1 / 6, 1 / 6, 2 / 3]);
  });
});
