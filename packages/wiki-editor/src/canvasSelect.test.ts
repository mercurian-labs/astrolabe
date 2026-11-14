import type { CanvasInk, CanvasNode } from "@mercurian/wiki/canvas";
import { describe, expect, it } from "vite-plus/test";

import { CanvasDocument } from "./canvasDocument";
import { canvasInkShape } from "./canvasInk";
import {
  canvasEraserTouches,
  canvasLassoPick,
  canvasScaleEdits,
  canvasScaleFor,
  canvasScaleLeast,
  canvasScaledInk,
  canvasSelectionBounds,
  insideLoop,
} from "./canvasSelect";

const card = (id: string, x: number, y: number, width = 100, height = 100): CanvasNode => ({
  id,
  type: "text",
  text: id,
  x,
  y,
  width,
  height,
});
const stroke = (id: string, x: number, y: number, points: number[], extra: object = {}) =>
  ({ id, type: "stroke", x, y, points, ...extra }) as CanvasInk;

const BOX = { x: 0, y: 0, width: 200, height: 100 };
const FREE = { keepAspect: false, fromCentre: false, least: { x: 0, y: 0 } };

describe("scaling a selection", () => {
  it("scales about the opposite corner or edge, Shift by one factor, Alt about the middle", () => {
    expect(canvasScaleFor(BOX, "se", 200, 50, FREE)).toEqual({
      anchor: { x: 0, y: 0 },
      sx: 2,
      sy: 1.5,
    });
    expect(canvasScaleFor(BOX, "nw", 100, 50, FREE)).toEqual({
      anchor: { x: 200, y: 100 },
      sx: 0.5,
      sy: 0.5,
    });
    // An edge scales its own axis about the middle of the other.
    expect(canvasScaleFor(BOX, "e", 100, 999, FREE)).toEqual({
      anchor: { x: 0, y: 50 },
      sx: 1.5,
      sy: 1,
    });
    expect(canvasScaleFor(BOX, "se", 200, 50, { ...FREE, keepAspect: true })).toMatchObject({
      sx: 2,
      sy: 2,
    });
    expect(canvasScaleFor(BOX, "s", 0, 50, { ...FREE, keepAspect: true })).toMatchObject({
      sx: 1.5,
      sy: 1.5,
    });
    // From the middle both sides move, so the same drag scales twice as far.
    expect(canvasScaleFor(BOX, "e", 100, 0, { ...FREE, fromCentre: true })).toEqual({
      anchor: { x: 100, y: 50 },
      sx: 2,
      sy: 1,
    });
  });

  it("stops at the least size rather than flipping, and leaves an axis with no length alone", () => {
    const least = canvasScaleLeast(BOX, [card("a", 0, 0, 100, 100)]);
    expect(least).toEqual({ x: 0.5, y: 0.5 });
    expect(canvasScaleFor(BOX, "se", -500, -500, { ...FREE, least })).toMatchObject({
      sx: 0.5,
      sy: 0.5,
    });
    // Drawings alone shrink to a few units, and a card already under its least doesn't shrink.
    expect(canvasScaleLeast(BOX, [])).toEqual({ x: 0.04, y: 0.08 });
    expect(canvasScaleLeast(BOX, [card("a", 0, 0, 30, 100)]).x).toBe(1);
    const flat = { x: 0, y: 0, width: 100, height: 0 };
    expect(canvasScaleFor(flat, "se", 100, 100, FREE)).toMatchObject({ sx: 2, sy: 1 });
  });

  it("moves a stroke's points with pressure as it was, and a drawn arrow's free ends only", () => {
    const scale = { anchor: { x: 0, y: 0 }, sx: 2, sy: 0.5 };
    expect(
      canvasScaledInk(
        stroke("s", 10, 20, [0, 0, 10, 10, 15, 3], { pressure: [0.2, 0.9, 0.4] }),
        scale,
      ),
    ).toEqual({ x: 20, y: 10, points: [0, 0, 20, 5, 30, 1.5] });
    const arrow: CanvasInk = {
      id: "r",
      type: "arrow",
      from: { node: "a", side: "right" },
      to: { x: 300, y: 300 },
    };
    expect(canvasScaledInk(arrow, scale)).toEqual({ to: { x: 600, y: 150 } });
  });

  it("is one step of undo: cards resized in place, drawings rewritten, back again on undo", () => {
    const a = card("a", 0, 0);
    const b = card("b", 200, 0, 100, 100);
    const line = stroke("s", 100, 150, [0, 0, 100, 50], { pressure: [0.3, 0.7] });
    const canvas = new CanvasDocument({
      document: { nodes: [a, b], edges: [], astrolabe: { drawings: [line] } },
      revision: "r0",
    });
    const rects = new Map([a, b].map((node) => [node.id, node]));
    const box = canvasSelectionBounds([a, b], [line], rects)!;
    expect(box).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    const scale = canvasScaleFor(box, "se", 300, 200, FREE);
    const edits = canvasScaleEdits([a, b], [line], scale);
    expect(edits).toEqual([
      { op: "resize", card: "a", x: 0, y: 0, width: 200, height: 200 },
      { op: "resize", card: "b", x: 400, y: 0, width: 200, height: 200 },
      { op: "set-drawing", drawing: "s", keys: { x: 200, y: 300, points: [0, 0, 200, 100] } },
    ]);
    canvas.commit(edits);
    const after = canvas.getState().data;
    expect(after.drawings?.[0]).toMatchObject({ x: 200, y: 300, pressure: [0.3, 0.7] });
    canvas.undo();
    expect(canvas.getState().data.nodes).toEqual([a, b]);
    expect(canvas.getState().data.drawings).toEqual([line]);
    expect(canvas.getState().canUndo).toBe(false);
  });
});

describe("a lasso", () => {
  // An L: the square's top right corner is cut away.
  const loop = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ];

  it("tells inside from out by winding, so a loop drawn either way round works", () => {
    expect(insideLoop({ x: 50, y: 50 }, loop)).toBe(true);
    expect(insideLoop({ x: 150, y: 50 }, loop)).toBe(false);
    expect(insideLoop({ x: 50, y: 50 }, [...loop].reverse())).toBe(true);
  });

  it("takes what lies wholly inside, a card by its box and a drawing by every point", () => {
    const nodes = [card("in", 10, 110, 50, 50), card("half", 150, 150, 100, 20)];
    const rects = new Map(nodes.map((node) => [node.id, node]));
    const inks = [
      stroke("inside", 20, 20, [0, 0, 30, 30, 60, 10]),
      stroke("crossing", 20, 20, [0, 0, 160, 40]),
      stroke("bent", 50, 50, [0, 0, 0, 100, 100, 100]),
    ].map((ink) => canvasInkShape(ink, rects)!);
    expect(canvasLassoPick(loop, nodes, inks, rects)).toEqual({
      cards: ["in"],
      drawings: ["inside", "bent"],
    });
    expect(canvasLassoPick(loop.slice(0, 2), nodes, inks, rects)).toEqual({
      cards: [],
      drawings: [],
    });
  });

  it("leaves a box out when the loop cuts into it between its corners", () => {
    const notch = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 120 },
      { x: 120, y: 120 },
      { x: 120, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ];
    const nodes = [card("notched", 20, 20, 160, 160), card("beside", 130, 20, 50, 50)];
    expect(canvasLassoPick(notch, nodes, [], new Map()).cards).toEqual(["beside"]);
  });
});

describe("the eraser", () => {
  const rects = new Map<string, CanvasNode>();
  const shape = (ink: CanvasInk) => canvasInkShape(ink, rects)!;

  it("touches a line within reach of its edge, and not one it passes by", () => {
    const line = shape(stroke("s", 0, 0, [0, 0, 100, 0], { astrolabe: { style: { width: 4 } } }));
    expect(canvasEraserTouches(line, { x: 50, y: -20 }, { x: 50, y: 20 }, 2, rects)).toBe(true);
    // Half its width plus the reach: 2 + 2.
    expect(canvasEraserTouches(line, { x: 0, y: 3.9 }, { x: 100, y: 3.9 }, 2, rects)).toBe(true);
    expect(canvasEraserTouches(line, { x: 0, y: 4.1 }, { x: 100, y: 4.1 }, 2, rects)).toBe(false);
    expect(canvasEraserTouches(line, { x: 0, y: 500 }, { x: 0, y: 500 }, 2, rects)).toBe(false);
  });

  it("follows a pressure stroke's outline, and a hand-drawn one's wander", () => {
    const style = { astrolabe: { style: { width: 4 } } };
    const pressed = shape(stroke("p", 0, 0, [0, 0, 100, 0], { ...style, pressure: [1, 1] }));
    // At full pressure perfect-freehand's radius is 4 × 1.75 × 0.8 = 5.6.
    expect(canvasEraserTouches(pressed, { x: 0, y: 7 }, { x: 100, y: 7 }, 2, rects)).toBe(true);
    const light = shape(stroke("l", 0, 0, [0, 0, 100, 0], { ...style, pressure: [0, 0] }));
    expect(canvasEraserTouches(light, { x: 0, y: 4 }, { x: 100, y: 4 }, 2, rects)).toBe(false);
    const rough = shape(
      stroke("r", 0, 0, [0, 0, 100, 0], { astrolabe: { style: { width: 4, sloppiness: 2 } } }),
    );
    expect(canvasEraserTouches(rough, { x: 0, y: 7 }, { x: 100, y: 7 }, 2, rects)).toBe(true);
  });

  it("touches a drawn arrow along its curve, ends on a card or not", () => {
    const nodes = new Map([["a", card("a", 0, 0)]]);
    const arrow = canvasInkShape(
      { id: "r", type: "arrow", from: { node: "a", side: "right" }, to: { x: 400, y: 50 } },
      nodes,
    )!;
    expect(canvasEraserTouches(arrow, { x: 250, y: 0 }, { x: 250, y: 100 }, 2, nodes)).toBe(true);
    expect(canvasEraserTouches(arrow, { x: 250, y: 100 }, { x: 300, y: 100 }, 2, nodes)).toBe(
      false,
    );
  });
});
