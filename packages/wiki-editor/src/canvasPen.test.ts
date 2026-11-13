import { describe, expect, it } from "vite-plus/test";

import type { CanvasEdge, CanvasNode } from "@mercurian/wiki/canvas";

import { canvasPenKeys, canvasPenOfItems, MIXED } from "./canvasPen";

const box = { x: 0, y: 0, width: 200, height: 100 };
const card: CanvasNode = { id: "c", type: "text", text: "", ...box };
const ellipse: CanvasNode = { ...card, id: "o", astrolabe: { shape: "ellipse" } };
const arrow: CanvasEdge = { id: "e", fromNode: "a", toNode: "b" };

describe("the style panel's reading", () => {
  it("shows only the rows something selected has, and a mix as neither", () => {
    expect(canvasPenOfItems([arrow])).toEqual({
      color: null,
      width: "medium",
      dash: "solid",
      opacity: 1,
    });
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
  });
});
