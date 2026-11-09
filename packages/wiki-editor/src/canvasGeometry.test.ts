import type { CanvasData, CanvasNode } from "@mercurian/wiki/canvas";
import { describe, expect, it } from "vite-plus/test";

import {
  cameraWindow,
  canvasColor,
  canvasEdgeShapes,
  canvasFileKind,
  fitCamera,
  isOpenableUrl,
  zoomAt,
} from "./canvasGeometry";

const card = (id: string, x: number, y: number): CanvasNode => ({
  id,
  type: "text",
  text: id,
  x,
  y,
  width: 100,
  height: 50,
});

describe("fitCamera", () => {
  it("shows the whole board inside the padding, centred", () => {
    const bounds = { x: -100, y: 50, width: 1000, height: 400 };
    const camera = fitCamera(bounds, 520, 400, 10);
    expect(camera.zoom).toBe(0.5);
    expect(bounds.x * camera.zoom + camera.x).toBe(10);
    expect(bounds.y * camera.zoom + camera.y).toBe(100);
  });

  it("doesn't enlarge a board smaller than the view", () => {
    expect(fitCamera({ x: 0, y: 0, width: 100, height: 100 }, 800, 600, 16).zoom).toBe(1);
  });

  it("survives an empty board and a view that hasn't laid out", () => {
    const { x, y, zoom } = fitCamera({ x: 0, y: 0, width: 0, height: 0 }, 0, 0, 16);
    expect([x, y, zoom].every(Number.isFinite)).toBe(true);
  });
});

describe("zoomAt", () => {
  it("keeps what is under the pointer under it", () => {
    const before = { x: 30, y: -20, zoom: 0.5 };
    const after = zoomAt(before, 200, 100, 2);
    const world = (camera: typeof before) => [
      (200 - camera.x) / camera.zoom,
      (100 - camera.y) / camera.zoom,
    ];
    expect(world(after)).toEqual(world(before));
    expect(after.zoom).toBe(1);
  });

  it("stops at the limits without drifting", () => {
    const limit = { x: 7, y: 9, zoom: 2 };
    expect(zoomAt(limit, 100, 100, 2)).toEqual(limit);
  });
});

describe("canvasEdgeShapes", () => {
  const data = (edge: Partial<CanvasData["edges"][number]>): CanvasData => ({
    nodes: [card("a", 0, 0), card("b", 300, 0)],
    edges: [{ id: "e", fromNode: "a", toNode: "b", ...edge }],
  });

  it("leaves from the sides the edge names", () => {
    const [shape] = canvasEdgeShapes(data({ fromSide: "bottom", toSide: "top" }));
    expect(shape?.path.startsWith("M50 50C")).toBe(true);
    expect(shape?.path.endsWith("350 0")).toBe(true);
  });

  it("works out the facing sides when the file leaves them out, as the spec allows", () => {
    const [shape] = canvasEdgeShapes(data({}));
    expect(shape?.path.startsWith("M100 25C")).toBe(true);
    expect(shape?.path.endsWith("300 25")).toBe(true);
  });

  it("draws the spec's default ends: an arrow at the end only", () => {
    expect(canvasEdgeShapes(data({}))[0]?.heads).toHaveLength(1);
    expect(canvasEdgeShapes(data({ fromEnd: "arrow" }))[0]?.heads).toHaveLength(2);
    expect(canvasEdgeShapes(data({ toEnd: "none" }))[0]?.heads).toHaveLength(0);
  });

  it("skips an edge to a card that isn't there", () => {
    expect(canvasEdgeShapes(data({ toNode: "gone" }))).toEqual([]);
  });
});

describe("colours and links", () => {
  it("passes presets and hex through, and nothing else into a style", () => {
    expect(canvasColor("3")).toEqual({ preset: "3" });
    expect(canvasColor("#FF0000")).toEqual({ hex: "#FF0000" });
    expect(canvasColor("7")).toEqual({});
    expect(canvasColor("red;background:url(x)")).toEqual({});
  });

  it("opens web and mail links only", () => {
    expect(isOpenableUrl("https://example.com")).toBe(true);
    expect(isOpenableUrl("mailto:a@b.co")).toBe(true);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("data:text/html,x")).toBe(false);
    expect(isOpenableUrl("")).toBe(false);
  });
});

describe("cameraWindow", () => {
  it("is what the frame shows, with its margin in screen pixels", () => {
    expect(cameraWindow({ x: 100, y: 0, zoom: 2 }, 400, 200, 40)).toEqual({
      x: -70,
      y: -20,
      width: 240,
      height: 140,
    });
  });
});

describe("canvasEdgeShapes", () => {
  it("draws a self-edge from one side, and covers its curve in its bounds", () => {
    const card = { id: "a", type: "text" as const, text: "", x: 0, y: 0, width: 100, height: 60 };
    const [shape] = canvasEdgeShapes({
      nodes: [card],
      edges: [{ id: "e", fromNode: "a", toNode: "a" }],
    });
    expect(shape?.path.startsWith("M100 30")).toBe(true);
    expect(shape?.bounds.width).toBeGreaterThan(0);
  });
});

describe("canvasFileKind", () => {
  it.each([
    ["Note.md", "note"],
    ["a/B.canvas", "canvas"],
    ["Open.base", "base"],
    ["a/pic.PNG", "image"],
    ["doc.pdf", "pdf"],
    ["song.mp3", "audio"],
    ["clip.mp4", "video"],
    ["data.zip", "other"],
  ])("reads %s as %s", (file, kind) => {
    expect(canvasFileKind(file)).toBe(kind);
  });
});
