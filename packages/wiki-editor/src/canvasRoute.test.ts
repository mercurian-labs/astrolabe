import type { CanvasBounds, CanvasSide } from "@mercurian/wiki/canvas";
import { describe, expect, it } from "vite-plus/test";

import { canvasArrowLine, canvasLine, type CanvasLineEnd } from "./canvasRoute";

const box = (id: string, x: number, y: number, width = 100, height = 60) => ({
  id,
  type: "text",
  x,
  y,
  width,
  height,
});

const middle = (card: CanvasBounds, side: CanvasSide): { x: number; y: number } => {
  switch (side) {
    case "top":
      return { x: card.x + card.width / 2, y: card.y };
    case "right":
      return { x: card.x + card.width, y: card.y + card.height / 2 };
    case "bottom":
      return { x: card.x + card.width / 2, y: card.y + card.height };
    case "left":
      return { x: card.x, y: card.y + card.height / 2 };
  }
};

const on = (card: CanvasBounds, side: CanvasSide, head = false): CanvasLineEnd => ({
  ...middle(card, side),
  box: card,
  side,
  head,
});

const crosses = (points: ReadonlyArray<{ x: number; y: number }>, card: CanvasBounds) =>
  points.some((point, at) => {
    const next = points[at + 1];
    if (next === undefined) return false;
    const [left, right] = [Math.min(point.x, next.x), Math.max(point.x, next.x)];
    const [top, bottom] = [Math.min(point.y, next.y), Math.max(point.y, next.y)];
    return (
      left < card.x + card.width && right > card.x && top < card.y + card.height && bottom > card.y
    );
  });

const square = (points: ReadonlyArray<{ x: number; y: number }>) =>
  points.every((point, at) => {
    const next = points[at + 1];
    return next === undefined || point.x === next.x || point.y === next.y;
  });

let ids = 0;
const elbow = (from: CanvasLineEnd, to: CanvasLineEnd, boxes: ReturnType<typeof box>[] = []) =>
  canvasArrowLine(`test-${ids++}`, "elbow", from, to, [], () => boxes, []);

describe("an elbow", () => {
  const a = box("a", 0, 0);
  const b = box("b", 400, 200);

  it("leaves and enters each side square to it, in right angles only", () => {
    const sides: CanvasSide[] = ["top", "right", "bottom", "left"];
    for (const fromSide of sides) {
      for (const toSide of sides) {
        const { along } = elbow(on(a, fromSide), on(b, toSide, true));
        expect(square(along)).toBe(true);
        expect(along[0]).toEqual(middle(a, fromSide));
        expect(along.at(-1)).toEqual(middle(b, toSide));
        // It never runs back through either card it joins.
        expect(crosses(along.slice(1, -1), a)).toBe(false);
        expect(crosses(along.slice(1, -1), b)).toBe(false);
      }
    }
  });

  it("steps round a card in its way, and goes straight when nothing is", () => {
    const left = box("l", 0, 100);
    const right = box("r", 600, 100);
    const straight = elbow(on(left, "right"), on(right, "left", true)).along;
    expect(straight).toEqual([middle(left, "right"), middle(right, "left")]);
    const between = box("m", 300, 80, 100, 100);
    const around = elbow(on(left, "right"), on(right, "left", true), [between]).along;
    expect(square(around)).toBe(true);
    expect(crosses(around, between)).toBe(false);
    expect(around.at(-1)).toEqual(middle(right, "left"));
    // A section holds cards rather than stands in their way.
    const section = { ...box("s", 200, 0, 600, 400), type: "group" };
    expect(elbow(on(left, "right"), on(right, "left", true), [section]).along).toEqual(straight);
  });

  it("from a free point, heads for the other end", () => {
    const { along } = elbow({ x: 0, y: 0, head: false }, on(b, "left", true));
    expect(square(along)).toBe(true);
    expect(along[0]).toEqual({ x: 0, y: 0 });
    expect(along.at(-1)).toEqual(middle(b, "left"));
  });

  it("works its route out again only when a box it depends on moves", () => {
    const between = box("m", 200, 100, 80, 80);
    const far = box("f", 5_000, 5_000);
    const route = (cards: ReturnType<typeof box>[], to = b) =>
      canvasArrowLine("cached", "elbow", on(a, "right"), on(to, "left", true), [], () => cards, []);
    const first = route([between, far]);
    expect(route([between, { ...far, x: 6_000 }])).toBe(first);
    expect(route([{ ...between, y: 300 }, far])).not.toBe(first);
    expect(route([between, far], { ...b, x: 500 })).not.toBe(first);
  });
});

describe("a line's route", () => {
  const from: CanvasLineEnd = { x: 0, y: 0, head: false };
  const to: CanvasLineEnd = { x: 100, y: 0, head: true };

  it("is straight through its bends, with its head along the last of them", () => {
    const line = canvasLine("straight", from, to, [{ x: 50, y: 50 }]);
    expect(line.path).toBe("M0 0L50 50L100 0");
    expect(line.tips).toEqual([{ tip: to, back: { x: 50, y: 50 } }]);
    expect(line.labelAt).toEqual({ x: 50, y: 50 });
  });

  it("curves through each bend, and draws as it always has with none", () => {
    expect(canvasLine(undefined, from, to).path).toBe("M0 0C0 0 100 0 100 0");
    const bent = canvasLine("curved", from, to, [{ x: 50, y: 50 }]);
    expect(bent.path.match(/C/g)).toHaveLength(2);
    expect(bent.along).toContainEqual({ x: 50, y: 50 });
  });

  it("takes no bends as an elbow, keeping its own route", () => {
    const end = { ...to, y: 100 };
    const line = canvasLine("elbow", from, end, [{ x: -300, y: -300 }]);
    expect(line).toEqual(canvasLine("elbow", from, end));
    expect(square(line.along)).toBe(true);
  });
});
