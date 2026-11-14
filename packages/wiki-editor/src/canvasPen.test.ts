import { describe, expect, it } from "vite-plus/test";

import type { CanvasEdge, CanvasInk, CanvasNode } from "@mercurian/wiki/canvas";

import {
  canvasPenKeys,
  canvasPenOfItems,
  canvasPenOfTool,
  CANVAS_DEFAULT_PEN,
  MIXED,
} from "./canvasPen";

const box = { x: 0, y: 0, width: 200, height: 100 };
const card: CanvasNode = { id: "c", type: "text", text: "", ...box };
const ellipse: CanvasNode = { ...card, id: "o", astrolabe: { shape: "ellipse" } };
const arrow: CanvasEdge = { id: "e", fromNode: "a", toNode: "b" };
const ink: CanvasInk = { id: "s", type: "stroke", x: 0, y: 0, points: [0, 0], pressure: [0.5] };

describe("the style panel's reading", () => {
  it("shows only the rows something selected has, and a mix as neither", () => {
    expect(canvasPenOfItems([arrow])).toEqual({
      color: null,
      width: "medium",
      dash: "solid",
      opacity: 1,
      sloppiness: 0,
      route: "curved",
      startHead: "none",
      endHead: "arrow",
    });
    expect(canvasPenOfItems([card])).not.toHaveProperty("route");
    expect(canvasPenOfTool("arrow", { ...CANVAS_DEFAULT_PEN, route: "elbow" })).toMatchObject({
      route: "elbow",
      endHead: "arrow",
    });
    // Ink drawn with pressure has no sloppiness, and the Pen draws it.
    expect(canvasPenOfItems([ink])).not.toHaveProperty("sloppiness");
    expect(canvasPenOfTool("stroke", CANVAS_DEFAULT_PEN)).not.toHaveProperty("sloppiness");
    expect(canvasPenOfTool("shape", { ...CANVAS_DEFAULT_PEN, sloppiness: 2 }).sloppiness).toBe(2);
    expect(
      canvasPenOfItems([
        { ...card, astrolabe: { style: { sloppiness: 1 } } },
        { ...arrow, astrolabe: { style: { sloppiness: 2 } } },
      ]).sloppiness,
    ).toBe(MIXED);
    expect(canvasPenOfItems([ellipse, { ...card, color: "1" }])).toMatchObject({
      color: MIXED,
      fill: null,
      corners: "round",
      // A card's default is thin; both are cards, so it agrees.
      width: "thin",
    });
    expect(canvasPenOfItems([card, arrow]).width).toBe(MIXED);
  });

  it("writes each kind's own step, and clears a default rather than writing it", () => {
    expect(canvasPenKeys("card", {}, { width: "bold", corners: "sharp" })).toEqual({
      astrolabe: { style: { width: 4, corners: "sharp" } },
    });
    expect(canvasPenKeys("stroke", {}, { width: "bold", corners: "sharp", fill: "1" })).toEqual({
      astrolabe: { style: { width: 5 } },
    });
    const styled = { astrolabe: { shape: "ellipse", style: { width: 4 } } };
    expect(canvasPenKeys("shape", styled, { width: "thin", color: "2" })).toEqual({
      color: "2",
      astrolabe: { shape: "ellipse" },
    });
    expect(canvasPenKeys("section", {}, { sloppiness: 2 })).toEqual({
      astrolabe: { style: { sloppiness: 2 } },
    });
    expect(
      canvasPenKeys("card", { astrolabe: { style: { sloppiness: 2 } } }, { sloppiness: 0 }),
    ).toEqual({ astrolabe: null });
    expect(canvasPenKeys("stroke", { pressure: [0.5] }, { sloppiness: 2 })).toEqual({});
    // An arrow's heads are JSON Canvas's own keys, and a line has none.
    expect(
      canvasPenKeys("arrow", {}, { route: "elbow", startHead: "arrow", endHead: "none" }),
    ).toEqual({
      fromEnd: "arrow",
      toEnd: "none",
      astrolabe: { style: { route: "elbow" } },
    });
    expect(
      canvasPenKeys(
        "arrow",
        { toEnd: "none", astrolabe: { style: { route: "elbow" } } },
        { route: "curved", startHead: "none", endHead: "arrow" },
      ),
    ).toEqual({ fromEnd: null, toEnd: null, astrolabe: null });
    expect(canvasPenKeys("card", {}, { route: "elbow", endHead: "none" })).toEqual({});
  });
});
