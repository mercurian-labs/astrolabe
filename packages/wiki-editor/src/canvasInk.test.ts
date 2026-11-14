import { CANVAS_MAX_STROKE_POINTS, type CanvasInk } from "@mercurian/wiki/canvas";
import { describe, expect, it } from "vite-plus/test";

import {
  canvasBendRemoved,
  canvasBendsMoved,
  canvasEndOnCard,
  canvasInkIsEdge,
  canvasInkShape,
  canvasSimulatedPressure,
  canvasStroke,
  canvasStrokePath,
  inkMovedWith,
  movedInk,
} from "./canvasInk";

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

  it("keeps a point where the pressure changes along a straight run, and the pressure of each", () => {
    const drawn = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
    expect(canvasStroke("s", drawn, [0.5, 0.5, 0.5, 0.5, 0.5])).toMatchObject({
      points: [0, 0, 40, 0],
      pressure: [0.5, 0.5],
    });
    expect(canvasStroke("s", drawn, [0.2, 0.4, 0.6, 0.4, 0.2])).toMatchObject({
      points: [0, 0, 20, 0, 40, 0],
      pressure: [0.2, 0.6, 0.2],
    });
    const zigzag = Array.from({ length: 20_000 }, (_, at) => (at % 2 === 0 ? at : (at % 4) * 20));
    const thinned = canvasStroke("s", zigzag, Array(10_000).fill(0.4)) as {
      points: number[];
      pressure: number[];
    };
    expect(thinned.pressure.length).toBe(thinned.points.length / 2);
    expect(canvasStroke("s", [5, 5], [0.3])).toMatchObject({
      points: [0, 0, 0, 0],
      pressure: [0.3, 0.3],
    });
  });

  it("presses lighter the faster a mouse moves", () => {
    const slow = canvasSimulatedPressure(0.5, 1, 2.5);
    const fast = canvasSimulatedPressure(0.5, 40, 2.5);
    expect(slow).toBeGreaterThan(0.5);
    expect(fast).toBeLessThan(0.5);
  });
});

describe("a stroke's shape", () => {
  const old: CanvasInk = { id: "s", type: "stroke", x: 10, y: 20, points: [0, 0, 30, 10, 60, 0] };
  const pressed: CanvasInk = { ...old, pressure: [0.2, 0.8, 0.4] };

  it("draws a stroke without pressure as the line it always drew", () => {
    const shape = canvasInkShape(old, new Map());
    expect(shape?.path).toBe(canvasStrokePath(10, 20, old.points));
    expect(shape?.path).toBe("M10 20Q40 30 55 25L70 20");
    expect(shape).not.toHaveProperty("fill");
  });

  it("fills ink with pressure as its outline, the same each time, its line kept to press on", () => {
    const shape = canvasInkShape(pressed, new Map());
    expect(shape?.path).toBe(canvasStrokePath(10, 20, old.points));
    expect(shape?.fill).toMatch(/^M.*Z$/);
    // A copy with the same points draws the same, not from what the first one remembered.
    const again = canvasInkShape({ ...pressed, pressure: [0.2, 0.8, 0.4] }, new Map());
    expect(again?.fill).toBe(shape?.fill);
    const harder = canvasInkShape({ ...pressed, pressure: [0.9, 0.9, 0.9] }, new Map());
    expect(harder?.fill).not.toBe(shape?.fill);
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

describe("a drawn arrow's end on a card", () => {
  const card = { id: "c", type: "text", text: "", x: 0, y: 0, width: 200, height: 100 } as const;

  it("holds where it's dropped on the outline, as a share of the box, and snaps to a middle", () => {
    expect(canvasEndOnCard(card, { x: 50, y: 104 }, 16, 10)).toEqual({
      node: "c",
      side: "bottom",
      at: [0.25, 1],
    });
    expect(canvasEndOnCard(card, { x: -6, y: 80 }, 16, 10)).toEqual({
      node: "c",
      side: "left",
      at: [0, 0.8],
    });
    expect(canvasEndOnCard(card, { x: 106, y: -3 }, 16, 10)).toEqual({ node: "c", side: "top" });
    // Deep inside, it's the nearest side's middle, as before.
    expect(canvasEndOnCard(card, { x: 160, y: 50 }, 16, 10)).toEqual({ node: "c", side: "right" });
  });

  it("is an edge only on two cards' middles, without bends", () => {
    const a = { node: "a", side: "right" } as const;
    const b = { node: "b", side: "left" } as const;
    expect(canvasInkIsEdge(a, b, undefined)).toBe(true);
    expect(canvasInkIsEdge(a, { ...b, at: [0, 0.2] }, undefined)).toBe(false);
    expect(canvasInkIsEdge(a, b, [10, 10])).toBe(false);
    expect(canvasInkIsEdge(a, { node: "a", side: "top" }, undefined)).toBe(false);
    expect(canvasInkIsEdge(a, { x: 0, y: 0 }, undefined)).toBe(false);
  });
});

describe("a drawn arrow's bends", () => {
  const arrow: CanvasInk = {
    id: "a",
    type: "arrow",
    from: { x: 0, y: 0 },
    to: { node: "c", side: "left", at: [0, 0.2] },
    bends: [50, 50, 80, 20],
  };

  it("move with it, and draw as its line goes through them", () => {
    expect(movedInk(arrow, 10, -5)).toEqual({ from: { x: 10, y: -5 }, bends: [60, 45, 90, 15] });
    const rects = new Map([["c", { x: 200, y: 0, width: 100, height: 100 }]]);
    const shape = canvasInkShape({ ...arrow, astrolabe: { style: { route: "straight" } } }, rects)!;
    expect(shape.path).toBe("M0 0L50 50L80 20L200 20");
    expect(shape.heads).toHaveLength(1);
    expect(
      canvasInkShape({ ...arrow, fromEnd: "arrow", toEnd: "none" }, rects)!.heads,
    ).toHaveLength(1);
    expect(canvasInkShape({ ...arrow, toEnd: "none" }, rects)!.heads).toEqual([]);
  });

  it("are added from a stretch's middle, moved, and deleted down to none", () => {
    const rects = new Map([["c", { x: 200, y: 0, width: 100, height: 100 }]]);
    const line = { ...arrow, astrolabe: { style: { route: "straight" as const } } };
    expect(canvasInkShape(line, rects)!.mids).toEqual([
      { x: 25, y: 25 },
      { x: 65, y: 35 },
      { x: 140, y: 20 },
    ]);
    // Pulled out of the stretch from its first point to the next.
    expect(canvasBendsMoved(arrow.bends, 0, true, { x: 10.4, y: 30.6 })).toEqual([
      10, 31, 50, 50, 80, 20,
    ]);
    expect(canvasBendsMoved(undefined, 0, true, { x: 5, y: 5 })).toEqual([5, 5]);
    expect(canvasBendsMoved(arrow.bends, 1, false, { x: 90, y: 0 })).toEqual([50, 50, 90, 0]);
    expect(canvasBendRemoved(arrow.bends, 0)).toEqual([80, 20]);
    expect(canvasBendRemoved([80, 20], 0)).toBeNull();
    // An elbow keeps its own route: there's nowhere to pull one from.
    const elbow = { ...arrow, astrolabe: { style: { route: "elbow" as const } } };
    expect(canvasInkShape(elbow, rects)!.mids).toEqual([]);
  });
});
