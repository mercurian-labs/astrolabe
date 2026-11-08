import { canvasData, type CanvasNode } from "@mercurian/wiki/canvas";
import { describe, expect, it } from "vite-plus/test";

import {
  arrange,
  boundsOfRects,
  cardAtConnectionDrop,
  CANVAS_NUDGE,
  CANVAS_NUDGE_LARGE,
  containsFully,
  fitToContent,
  groupAround,
  lineDirectionKeys,
  lineDirectionOf,
  lockedToAxis,
  movedWith,
  nearestSide,
  ratioHeight,
  resizeRect,
  snapDrag,
  snapToGrid,
  type CanvasArrangement,
  type CanvasRect,
} from "./canvasArrange";

/** The cards the report arranged in Obsidian. */
const THREE: ReadonlyArray<CanvasRect> = [
  { id: "a", x: 0, y: 0, width: 200, height: 100 },
  { id: "b", x: 300, y: 70, width: 160, height: 60 },
  { id: "c", x: 520, y: 200, width: 120, height: 200 },
];

const placed = (kind: CanvasArrangement) => {
  const by = new Map(arrange(kind, THREE).map((rect) => [rect.id, rect]));
  return ["a", "b", "c"].map((id) => by.get(id)!);
};

describe("arrange", () => {
  it.each<[CanvasArrangement, (rect: CanvasRect) => number, number]>([
    ["align-left", (rect) => rect.x, 0],
    ["align-center", (rect) => rect.x + rect.width / 2, 320],
    ["align-right", (rect) => rect.x + rect.width, 640],
    ["align-top", (rect) => rect.y, 0],
    ["align-middle", (rect) => rect.y + rect.height / 2, 200],
    ["align-bottom", (rect) => rect.y + rect.height, 400],
  ])("%s lines all three up", (kind, read, value) => {
    expect(placed(kind).map(read)).toEqual([value, value, value]);
  });

  it("makes a row left to right, 20 apart, at the top", () => {
    expect(placed("row").map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [220, 0],
      [400, 0],
    ]);
  });

  it("makes a column top to bottom, 20 apart, at the left", () => {
    expect(placed("column").map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [0, 120],
      [0, 200],
    ]);
  });

  it("makes a grid of two columns for three cards, 20 apart", () => {
    expect(placed("grid").map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [220, 0],
      [0, 120],
    ]);
  });

  it("gives equal gaps, with the end cards fixed", () => {
    const horizontal = placed("distribute-horizontal");
    expect(horizontal[0]!.x).toBe(0);
    expect(horizontal[2]!.x).toBe(520);
    expect(horizontal[1]!.x - 200).toBe(520 - (horizontal[1]!.x + 160));
    const vertical = placed("distribute-vertical");
    expect(vertical[0]!.y).toBe(0);
    expect(vertical[2]!.y).toBe(200);
    expect(vertical[1]!.y - 100).toBe(200 - (vertical[1]!.y + 60));
  });

  it("justifies to the bounding box", () => {
    expect(placed("justify-horizontal").map(({ x, width }) => [x, width])).toEqual([
      [0, 640],
      [0, 640],
      [0, 640],
    ]);
    expect(placed("justify-vertical").map(({ y, height }) => [y, height])).toEqual([
      [0, 400],
      [0, 400],
      [0, 400],
    ]);
  });
});

describe("snapping a drag", () => {
  const options = { grid: true, objects: true, tolerance: 14 };
  const moved = { x: 133, y: 47, width: 100, height: 100 };

  it("lands on the grid of 20", () => {
    expect(snapDrag(moved, [], options)).toEqual({ x: 7, y: -7 });
    expect(snapToGrid(37)).toBe(40);
    expect(snapToGrid(23)).toBe(20);
  });

  it("lets an object beat the grid, centre to centre", () => {
    const neighbour = { x: 400, y: 80, width: 100, height: 40 };
    expect(snapDrag(moved, [neighbour], options).y).toBe(50 - 47);
  });

  it.each([
    ["tops", { x: 500, y: 40, width: 80, height: 300 }, -7],
    ["bottoms", { x: 500, y: 0, width: 80, height: 155 }, 8],
    ["edge to edge", { x: 500, y: 150, width: 80, height: 300 }, 3],
  ])("aligns %s", (_name, other, dy) => {
    expect(snapDrag(moved, [other], { ...options, grid: false }).y).toBe(dy);
  });

  it("ignores an object past the tolerance", () => {
    const far = { x: 900, y: 300, width: 100, height: 30 };
    expect(snapDrag({ ...moved, x: 100 }, [far], { ...options, grid: false })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("does nothing with both off, as ⌃ mid-drag asks", () => {
    expect(snapDrag(moved, [moved], { grid: false, objects: false, tolerance: 14 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("holds Shift to the dominant axis", () => {
    expect(lockedToAxis(30, 10)).toEqual({ x: 30, y: 0 });
    expect(lockedToAxis(-5, 10)).toEqual({ x: 0, y: 10 });
  });

  it("nudges 20, or 100 with Shift", () => {
    expect([CANVAS_NUDGE, CANVAS_NUDGE_LARGE]).toEqual([20, 100]);
  });
});

describe("resizing", () => {
  const card = { x: 100, y: 100, width: 200, height: 120 };

  it("snaps the moved edge and keeps the far one", () => {
    expect(resizeRect(card, "e", 33, 0, { grid: true })).toEqual({ ...card, width: 240 });
    expect(resizeRect(card, "w", -33, 0, { grid: true })).toEqual({
      ...card,
      x: 60,
      width: 240,
    });
    expect(resizeRect(card, "n", 0, 12, { grid: true })).toEqual({
      ...card,
      y: 120,
      height: 100,
    });
    expect(resizeRect(card, "se", 7, 9, { grid: false })).toEqual({
      ...card,
      width: 207,
      height: 129,
    });
  });

  it("stops at 50x50, with the far edge where it was", () => {
    expect(resizeRect(card, "se", -500, -500, { grid: true })).toEqual({
      x: 100,
      y: 100,
      width: 50,
      height: 50,
    });
    expect(resizeRect(card, "nw", 500, 500, { grid: true })).toEqual({
      x: 250,
      y: 170,
      width: 50,
      height: 50,
    });
  });

  it("locks an image's aspect on a corner, not an edge, and stops at 133x50", () => {
    const image = { x: 0, y: 0, width: 400, height: 150 };
    const aspect = 800 / 300;
    expect(resizeRect(image, "se", 400, 0, { grid: false, aspect })).toEqual({
      ...image,
      width: 800,
      height: 300,
    });
    expect(resizeRect(image, "se", -1000, -1000, { grid: false, aspect })).toEqual({
      ...image,
      width: 133,
      height: 50,
    });
    expect(resizeRect(image, "e", 100, 0, { grid: false, aspect })).toEqual({
      ...image,
      width: 500,
    });
  });

  it("fits a bottom handle to its content, and a right one narrower only", () => {
    const text = { x: 0, y: 0, width: 250, height: 60 };
    expect(fitToContent(text, "s", { width: 200, height: 26.4 })).toEqual({ ...text, height: 27 });
    expect(fitToContent(text, "s", { width: 200, height: 498 })).toEqual({ ...text, height: 498 });
    expect(fitToContent(text, "e", { width: 72, height: 27 })).toEqual({ ...text, width: 72 });
    expect(fitToContent(text, "e", { width: 900, height: 27 })).toEqual(text);
  });
});

describe("group membership", () => {
  const nodes: ReadonlyArray<CanvasNode> = canvasData({
    nodes: [
      { id: "outer", type: "group", x: 0, y: 0, width: 500, height: 500 },
      { id: "inner", type: "group", x: 20, y: 20, width: 200, height: 200 },
      { id: "in-inner", type: "text", x: 40, y: 40, width: 100, height: 100 },
      { id: "edge", type: "text", x: 400, y: 400, width: 100, height: 100 },
      { id: "half-out", type: "text", x: 450, y: 0, width: 100, height: 100 },
      { id: "outside", type: "text", x: 600, y: 0, width: 100, height: 100 },
    ],
  }).nodes;

  it("takes what's fully inside, boundary included, and not what's half out", () => {
    expect([...movedWith(nodes, ["outer"])].toSorted()).toEqual([
      "edge",
      "in-inner",
      "inner",
      "outer",
    ]);
  });

  it("leaves the outer group when an inner one moves", () => {
    expect([...movedWith(nodes, ["inner"])].toSorted()).toEqual(["in-inner", "inner"]);
  });

  it("moves a card alone, out of any group", () => {
    expect([...movedWith(nodes, ["in-inner"])]).toEqual(["in-inner"]);
  });

  it("counts a card exactly on the edge as inside", () => {
    expect(
      containsFully(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 0, y: 0, width: 100, height: 100 },
      ),
    ).toBe(true);
  });

  it("draws a new group 20 around the selection", () => {
    expect(groupAround(THREE)).toEqual({ x: -20, y: -20, width: 680, height: 440 });
    expect(boundsOfRects([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("sets a group's height from its background's ratio", () => {
    expect(ratioHeight(400, { width: 800, height: 300 })).toBe(150);
  });
});

describe("connections", () => {
  const card = { x: 100, y: 100, width: 200, height: 100 };

  it.each([
    [{ x: 200, y: 95 }, "top"],
    [{ x: 310, y: 150 }, "right"],
    [{ x: 200, y: 215 }, "bottom"],
    [{ x: 80, y: 150 }, "left"],
    [{ x: 110, y: 150 }, "left"],
  ] as const)("picks the side nearest the drop %o", (point, side) => {
    expect(nearestSide(card, point)).toBe(side);
  });

  it.each([
    ["right", { x: 500, y: 200 }, { x: 500, y: 170 }],
    ["left", { x: 500, y: 200 }, { x: 250, y: 170 }],
    ["bottom", { x: 500, y: 200 }, { x: 375, y: 200 }],
    ["top", { x: 500, y: 200 }, { x: 375, y: 140 }],
  ] as const)("places a new card off a %s-going line", (side, drop, at) => {
    expect(cardAtConnectionDrop(side, drop, { width: 250, height: 60 })).toEqual(at);
  });

  it("writes only the keys a line direction needs", () => {
    expect(lineDirectionKeys("none")).toEqual({ fromEnd: null, toEnd: "none" });
    expect(lineDirectionKeys("end")).toEqual({ fromEnd: null, toEnd: null });
    expect(lineDirectionKeys("both")).toEqual({ fromEnd: "arrow", toEnd: null });
  });

  it("reads a line's direction back", () => {
    const edge = { id: "e", fromNode: "a", toNode: "b" };
    expect(lineDirectionOf(edge)).toBe("end");
    expect(lineDirectionOf({ ...edge, toEnd: "none" })).toBe("none");
    expect(lineDirectionOf({ ...edge, fromEnd: "arrow" })).toBe("both");
  });
});
