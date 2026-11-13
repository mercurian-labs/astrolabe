import { CANVAS_MAX_STROKE_POINTS } from "@mercurian/wiki/canvas";
import { describe, expect, it } from "vite-plus/test";

import { canvasStroke, inkMovedWith } from "./canvasInk";

describe("a pen stroke", () => {
  it("keeps the corners of a line, in whole units from its first point", () => {
    // Along a straight run, then a corner: only the ends and the corner are needed.
    const drawn = [10.4, 20.6, 30.2, 20.4, 50.1, 20.5, 70, 20.6, 70.3, 60, 70.5, 100.2];
    expect(canvasStroke("s", drawn)).toEqual({
      id: "s",
      type: "stroke",
      x: 10,
      y: 21,
      points: [0, 0, 60, 0, 61, 79],
    });
  });

  it("is a dot for a click, and never more points than a stroke may hold", () => {
    expect(canvasStroke("s", [5, 5]).points).toEqual([0, 0, 0, 0]);
    const zigzag = Array.from({ length: 20_000 }, (_, at) => (at % 2 === 0 ? at : (at % 4) * 20));
    const { points } = canvasStroke("s", zigzag) as { points: number[] };
    expect(points.length / 2).toBeLessThanOrEqual(CANVAS_MAX_STROKE_POINTS);
  });
});

describe("a section's drawings", () => {
  it("carries what's wholly inside it, a drawn arrow by its free ends", () => {
    const section = { id: "g", type: "group", x: 0, y: 0, width: 500, height: 500 } as const;
    const card = {
      id: "c",
      type: "text",
      text: "",
      x: 900,
      y: 0,
      width: 100,
      height: 100,
    } as const;
    const stroke = (id: string, x: number) =>
      ({ id, type: "stroke", x, y: 10, points: [0, 0, 40, 40] }) as const;
    const carried = inkMovedWith(
      [section, card],
      [
        stroke("in", 10),
        stroke("across", 480),
        { id: "to-card", type: "arrow", from: { x: 50, y: 50 }, to: { node: "c", side: "left" } },
        { id: "out", type: "arrow", from: { x: 50, y: 50 }, to: { x: 700, y: 50 } },
      ],
      new Set(["g"]),
    );
    expect([...carried]).toEqual(["in", "to-card"]);
    expect(inkMovedWith([section], [stroke("in", 10)], new Set(["c"])).size).toBe(0);
  });
});
