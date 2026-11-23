import { canvasData } from "@mercurian/wiki/canvas";
import { describe, expect, it } from "vite-plus/test";

import { canvasFigureView } from "./CanvasMinimap";

const card = (id: string, x: number) => ({
  id,
  type: "text",
  text: id,
  x,
  y: 40,
  width: 100,
  height: 60,
});

const board = canvasData({
  nodes: [
    { id: "pay", type: "group", label: "Payments", x: 0, y: 0, width: 300, height: 140 },
    { id: "ship", type: "group", label: "Shipping", x: 400, y: 0, width: 300, height: 140 },
    card("charge", 20),
    card("receipt", 160),
    card("label", 420),
  ],
});

describe("canvasFigureView", () => {
  it("frames a named group, by label or id, with what it holds", () => {
    for (const frame of ["payments", "pay"]) {
      const view = canvasFigureView(board, frame);
      expect(view.box).toEqual({ x: 0, y: 0, width: 300, height: 140 });
      expect([...(view.inside ?? [])].sort()).toEqual(["charge", "pay", "receipt"]);
      expect(view.missing).toBe(false);
    }
  });

  it("shows the whole board when no frame is asked for, or the one asked for is gone", () => {
    expect(canvasFigureView(board, undefined)).toEqual({
      box: { x: 0, y: 0, width: 700, height: 140 },
      inside: undefined,
      missing: false,
    });
    expect(canvasFigureView(board, "Returns")).toMatchObject({ inside: undefined, missing: true });
  });
});
