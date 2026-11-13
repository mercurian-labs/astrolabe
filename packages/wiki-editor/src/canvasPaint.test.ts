import { describe, expect, it } from "vite-plus/test";

import type { CanvasEdge, CanvasInk, CanvasNode, CanvasStyle } from "@mercurian/wiki/canvas";

import { canvasLineScale, canvasOutline, canvasPaint, type CanvasPaint } from "./canvasPaint";

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
