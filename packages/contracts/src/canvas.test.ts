import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { CanvasHandEdit } from "./canvas.ts";

const decodes = Schema.is(CanvasHandEdit);

describe("a person's canvas edits", () => {
  it("caps a stroke's pressure as it caps its points, one for each", () => {
    const stroke = (count: number) => ({
      op: "put-drawing",
      drawing: {
        id: "s",
        type: "stroke",
        x: 0,
        y: 0,
        points: Array<number>(count * 2).fill(0),
        pressure: Array<number>(count).fill(0.5),
      },
    });
    expect(decodes(stroke(1_000))).toBe(true);
    expect(decodes(stroke(1_001))).toBe(false);
    expect(
      decodes({ op: "set-drawing", drawing: "s", keys: { pressure: Array(1_001).fill(1) } }),
    ).toBe(false);
  });
});
