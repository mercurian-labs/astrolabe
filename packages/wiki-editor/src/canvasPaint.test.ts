import { describe, expect, it } from "vite-plus/test";

import type { CanvasEdge, CanvasInk, CanvasNode, CanvasStyle } from "@mercurian/wiki/canvas";

import {
  canvasLineScale,
  canvasOutline,
  canvasPaint,
  canvasSketchBox,
  canvasSketchLine,
  type CanvasPaint,
} from "./canvasPaint";

const box = { x: 0, y: 0, width: 200, height: 100 };
const styled = (style: CanvasStyle) => ({ astrolabe: { style } });
const card = (more: object = {}): CanvasNode => ({
  id: "c",
  type: "text",
  text: "",
  ...box,
  ...more,
});
const section = (more: object = {}): CanvasNode => ({ id: "g", type: "group", ...box, ...more });
const edge = (more: object = {}): CanvasEdge => ({ id: "e", fromNode: "a", toNode: "b", ...more });
const stroke = (more: object = {}): CanvasInk => ({
  id: "s",
  type: "stroke",
  x: 0,
  y: 0,
  points: [0, 0],
  ...more,
});

describe("canvasPaint", () => {
  it.each<[string, CanvasNode | CanvasEdge | CanvasInk, Partial<CanvasPaint>]>([
    [
      "a plain card as it always drew",
      card(),
      { kind: "card", width: 1, dashArray: null, radius: 8, opacity: 1, fill: { kind: "surface" } },
    ],
    [
      "a coloured card tinted from its colour",
      card({ color: "4" }),
      { stroke: "#30a46c", fill: { kind: "tint", color: "#30a46c", amount: 0.1, over: "surface" } },
    ],
    [
      "a card with no fill",
      card({ color: "4", ...styled({ fill: "none" }) }),
      { fill: { kind: "none" } },
    ],
    [
      "a soft preset fill under another colour's line",
      card({ color: "1", ...styled({ fill: "5" }) }),
      {
        stroke: "#e5484d",
        fill: { kind: "tint", color: "#00a2c7", amount: 0.22, over: "surface" },
      },
    ],
    [
      "a custom fill as it is",
      section(styled({ fill: "#123456" })),
      { fill: { kind: "tint", color: "#123456", amount: 1, over: "clear" } },
    ],
    [
      "a bold dashed sharp card",
      card(styled({ width: 4, dash: "dashed", corners: "sharp" })),
      { width: 4, dashArray: [16, 12], cap: "butt", radius: 0 },
    ],
    [
      "a dotted arrow, round",
      edge(styled({ dash: "dotted" })),
      { kind: "arrow", width: 1.5, dashArray: [0, 3], cap: "round" },
    ],
    [
      "a section at half opacity",
      section(styled({ opacity: 0.5 })),
      { kind: "section", opacity: 0.5 },
    ],
    [
      "corners on a shape, which keeps none",
      card({ astrolabe: { shape: "ellipse", style: { corners: "round" } } }),
      { kind: "shape", radius: 0 },
    ],
    ["a stroke, round at its default", stroke(), { kind: "stroke", width: 2.5, cap: "round" }],
    [
      "a stroke's fill, which it has none of",
      stroke(styled({ fill: "1" })),
      { fill: { kind: "none" } },
    ],
    ["a card drawn clean, as it always was", card(), { sloppiness: 0 }],
    ["a cartoonist's arrow", edge(styled({ sloppiness: 2 })), { sloppiness: 2 }],
    [
      "ink with pressure, which is hand-drawn already",
      stroke({ pressure: [0.5], ...styled({ sloppiness: 2 }) }),
      { sloppiness: 0 },
    ],
  ])("paints %s", (_name, item, expected) => {
    expect(canvasPaint(item)).toMatchObject(expected);
  });

  it("outlines a box with its corners, and a shape as its path", () => {
    expect(canvasOutline(card(), canvasPaint(card()))).toEqual({ kind: "box", ...box, radius: 8 });
    const diamond = card({ astrolabe: { shape: "diamond" } });
    expect(canvasOutline(diamond, canvasPaint(diamond))).toEqual({
      kind: "path",
      d: "M100 0L200 50L100 100L0 50Z",
    });
  });

  it.each([
    [2, 1],
    [1, 1],
    [0.5, 1],
    [0.25, 2],
    [0.1, 5],
  ])("keeps a line's width at %s zoom to its floor, times %s", (zoom, scale) => {
    expect(canvasLineScale(zoom)).toBe(scale);
  });
});

describe("a hand-drawn look", () => {
  const rough = (more: object = {}) => card({ id: "rough", ...styled({ sloppiness: 1 }), ...more });
  const line = "M0 0C40 0 60 100 100 100";

  it("draws nothing of its own for a clean item, which keeps its plain outline", () => {
    expect(canvasSketchBox(card(), canvasPaint(card()))).toBeUndefined();
    expect(canvasSketchLine(edge(), line)).toBeUndefined();
  });

  it("draws the same paths for the same item every time, from its id", () => {
    const first = canvasSketchBox(rough(), canvasPaint(rough()));
    // A copy of the item, so the board's cache can't be what answers.
    const again = canvasSketchBox({ ...rough(), width: 201 }, canvasPaint(rough()));
    const back = canvasSketchBox(rough({ width: 200 }), canvasPaint(rough()));
    expect(first?.line).toMatch(/^M/);
    expect(first?.fill).toMatch(/^M/);
    expect(back).toEqual(first);
    expect(again?.line).not.toBe(first?.line);
    expect(canvasSketchBox(rough({ id: "other" }), canvasPaint(rough()))?.line).not.toBe(
      first?.line,
    );
  });

  it("draws a moved card's outline from its corner, so moving it draws nothing anew", () => {
    const moved = rough({ x: 500, y: 300 });
    expect(canvasSketchBox(moved, canvasPaint(moved))).toBe(
      canvasSketchBox(rough(), canvasPaint(rough())),
    );
  });

  it("fills nothing for a card with no fill, and roughens more at each level", () => {
    const empty = rough(styled({ sloppiness: 1, fill: "none" }));
    expect(canvasSketchBox(empty, canvasPaint(empty))).not.toHaveProperty("fill");
    const artist = canvasSketchLine(edge(styled({ sloppiness: 1 })), line);
    const cartoonist = canvasSketchLine(edge(styled({ sloppiness: 2 })), line);
    expect(artist).toMatch(/^M/);
    expect(cartoonist).not.toBe(artist);
  });

  it("draws a stroke's line through its points", () => {
    const scribble = (x: number) =>
      stroke({ x, points: [0, 0, 20, 5, 40, 0, 60, 10], ...styled({ sloppiness: 1 }) });
    const d = canvasSketchLine(scribble(10), "M10 0L70 10");
    const [x, y] = (d ?? "")
      .split(/[ ,MC]+/)
      .filter(Boolean)
      .slice(-2)
      .map(Number);
    expect(Math.hypot(x! - 70, y! - 10)).toBeLessThan(3);
    expect(canvasSketchLine(scribble(11), "M11 0L71 10")).not.toBe(d);
  });
});
