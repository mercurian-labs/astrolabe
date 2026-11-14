import { canvasData } from "@mercurian/wiki/canvas";
import { describe, expect, it } from "vite-plus/test";

import { canvasExportArea, canvasExportSize, canvasPlainLines } from "./canvasExport";

const data = canvasData({
  nodes: [
    { id: "a", type: "text", text: "A", x: -100, y: 0, width: 200, height: 100 },
    { id: "b", type: "text", text: "B", x: 300, y: 200, width: 200, height: 100 },
  ],
  astrolabe: { drawings: [{ id: "s", type: "stroke", x: 500, y: 300, points: [0, 0, 200, 0] }] },
});

describe("exporting a board", () => {
  const viewport = { x: 1, y: 2, width: 300, height: 200 };

  it("covers the whole board, drawings too, with room around it, or just the view", () => {
    expect(canvasExportArea(data, viewport, { area: "full" })).toEqual({
      x: -140,
      y: -40,
      width: 880,
      height: 380,
    });
    expect(canvasExportArea(data, viewport, { area: "viewport" })).toEqual(viewport);
  });

  it("scales by a power of two from -1 to 1", () => {
    const area = { x: 0, y: 0, width: 1000, height: 500 };
    expect(canvasExportSize(area, 0)).toMatchObject({ width: 1000, height: 500 });
    expect(canvasExportSize(area, 1)).toMatchObject({ width: 2000, height: 1000 });
    expect(canvasExportSize(area, -1)).toMatchObject({ width: 500, height: 250 });
  });

  it("stops at what a browser can draw, keeping the shape", () => {
    const size = canvasExportSize({ x: 0, y: 0, width: 100_000, height: 50_000 }, 1);
    expect(size).toMatchObject({ width: 16_384, height: 8_192 });
  });

  it("reads a card's Markdown as lines, without its markers", () => {
    expect(canvasPlainLines("# Title\n- [x] done **now**\n[[Note|shown]] and [a](b.md)")).toEqual([
      { heading: true, text: "Title" },
      { heading: false, text: "• done now" },
      { heading: false, text: "shown and a" },
    ]);
  });
});
