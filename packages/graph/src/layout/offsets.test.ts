import { describe, expect, it } from "vite-plus/test";

import { composeOffset, dragFrom } from "./offsets.ts";

describe("drag composition", () => {
  it("leaves a dropped note where it was dropped, however often the base is recomposed", () => {
    const home = [10, 0, 0] as const;
    const gathered = [-6, 2, 1] as const;
    const hit = [30, 5, -2] as const;
    const drag = dragFrom(hit, home, gathered);
    for (let recompose = 0; recompose < 3; recompose += 1) {
      const target = composeOffset(gathered, drag);
      expect([home[0] + target[0], home[1] + target[1], home[2] + target[2]]).toEqual([30, 5, -2]);
    }
  });

  it("is the base alone without a drag", () => {
    expect(composeOffset([1, 2, 3], undefined)).toEqual([1, 2, 3]);
  });
});
