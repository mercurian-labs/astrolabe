import { describe, expect, it } from "vite-plus/test";

import {
  budgetLabels,
  LABEL_BUDGET,
  LabelBoxes,
  panelLabelBudget,
  placeLabels,
  StickyPool,
  type LabelBox,
  type LabelSide,
} from "./pool.ts";

describe("StickyPool", () => {
  it("keeps a note's item while it stays wanted, and recycles the rest", () => {
    let made = 0;
    const released: Array<number> = [];
    const pool = new StickyPool(
      () => ({ id: (made += 1) }),
      (item) => released.push(item.id),
    );
    pool.begin();
    const first = pool.take(5);
    const second = pool.take(9);
    pool.end();
    expect(first.fresh && second.fresh).toBe(true);
    expect(made).toBe(2);
    pool.begin();
    expect(pool.take(5)).toEqual({ item: first.item, fresh: false });
    pool.end();
    // Note 9 went out of view: its item is released and goes back to the pool.
    expect(released).toEqual([second.item.id]);
    expect(pool.held).toBe(1);
    pool.begin();
    pool.take(5);
    const reused = pool.take(12);
    pool.end();
    expect(reused).toEqual({ item: second.item, fresh: true });
    expect(pool.items).toHaveLength(2);
  });
});

describe("budgetLabels", () => {
  it("keeps the highest-priority labels within the budget and counts the cut", () => {
    const candidates = [0, 1, 2, 3, 4];
    const priority = [0.2, 0.9, 1.5, 0.5, 0.1];
    expect(budgetLabels(candidates, (index) => priority[index] ?? 0, 3)).toBe(2);
    expect(candidates).toEqual([2, 1, 3]);
    expect(budgetLabels(candidates, () => 0, 3)).toBe(0);
  });
});

describe("LabelBoxes", () => {
  it("records a label's rectangle from its anchor, length, and size", () => {
    const boxes = new LabelBoxes(1);
    boxes.add(10, 20, 5, 10);
    boxes.add(0, 0, 1, 1);
    expect(boxes.count).toBe(1);
    expect([boxes.x[0], boxes.y[0], boxes.width[0], boxes.height[0]]).toEqual([10, 15, 30, 10]);
  });
});

describe("the panel's labels", () => {
  it("budgets labels by the frame's size: fewer in a narrow panel than a wide pane", () => {
    const narrow = panelLabelBudget(490, 800);
    const wide = panelLabelBudget(1600, 1000);
    expect(narrow).toBeLessThan(wide);
    expect(panelLabelBudget(10, 10)).toBe(12);
    expect(panelLabelBudget(10_000, 10_000)).toBe(LABEL_BUDGET);
  });

  it("keeps the highest first and drops any label that would overlap one kept", () => {
    // Four labels in a row 11 px tall: 1 and 2 overlap, 3 sits clear below, 4 overlaps 3.
    const boxes: Record<number, LabelBox> = {
      1: { left: 0, top: 0, right: 100, bottom: 11 },
      2: { left: 50, top: 5, right: 150, bottom: 16 },
      3: { left: 0, top: 40, right: 100, bottom: 51 },
      4: { left: 90, top: 45, right: 190, bottom: 56 },
    };
    const priority: Record<number, number> = { 1: 1, 2: 3, 3: 2, 4: 0.5 };
    const candidates = [1, 2, 3, 4];
    const cut = placeLabels(
      candidates,
      (index) => priority[index] ?? 0,
      (index, out) => Object.assign(out, boxes[index]),
      100,
    );
    expect(candidates).toEqual([2, 3]);
    expect(cut).toBe(2);
  });

  it("stops at the budget", () => {
    const candidates = [1, 2, 3];
    const cut = placeLabels(
      candidates,
      (index) => -index,
      (index, out) =>
        Object.assign(out, { left: 0, top: index * 100, right: 10, bottom: index * 100 + 10 }),
      2,
    );
    expect(candidates).toEqual([1, 2]);
    expect(cut).toBe(1);
  });

  it("reads a label on its node's left when its right would cross the frame's edge, else cuts it", () => {
    // A 490 px frame. Nodes at x = 100 (room on the right) and 450 (only the left fits), each
    // label 100 px wide; and 470 with a 500 px name, which fits neither side. 6 px off the node.
    const nodes: Record<number, { x: number; width: number }> = {
      1: { x: 100, width: 100 },
      2: { x: 450, width: 100 },
      3: { x: 470, width: 500 },
    };
    const box = (index: number, out: LabelBox, side: LabelSide) => {
      const node = nodes[index] ?? { x: 0, width: 0 };
      out.left = side === "right" ? node.x + 6 : node.x - 6 - node.width;
      out.right = out.left + node.width;
      out.top = index * 40;
      out.bottom = index * 40 + 11;
    };
    const sides = new Map<number, LabelSide>();
    const candidates = [1, 2, 3];
    const cut = placeLabels(
      candidates,
      (index) => -index,
      box,
      100,
      490,
      (index, side) => sides.set(index, side),
    );
    expect(candidates).toEqual([1, 2]);
    expect(cut).toBe(1);
    expect(sides.get(1)).toBe("right");
    expect(sides.get(2)).toBe("left");
  });

  it("never cuts the story's labels: they flip side, then stack, before any gives way", () => {
    // Three story notes at one spot, and an ordinary label of higher priority over them.
    const at: Record<number, number> = { 1: 200, 2: 200, 3: 200, 4: 200 };
    const box = (index: number, out: LabelBox, side: LabelSide) => {
      const x = at[index] ?? 0;
      out.left = side === "right" ? x + 6 : x - 106;
      out.right = out.left + 100;
      out.top = 300;
      out.bottom = 311;
    };
    const places = new Map<number, [LabelSide, number]>();
    const candidates = [4, 1, 2, 3];
    const cut = placeLabels(
      candidates,
      (index) => (index === 4 ? 10 : 1),
      box,
      // No budget left for ordinary labels at all.
      0,
      490,
      (index, side, dy) => places.set(index, [side, dy]),
      (index) => index !== 4,
    );
    expect(candidates.toSorted()).toEqual([1, 2, 3]);
    expect(cut).toBe(1);
    expect(places.get(1)).toEqual(["right", 0]);
    expect(places.get(2)).toEqual(["left", 0]);
    // The third stacks a label height (and the gap) below the first.
    expect(places.get(3)?.[1]).toBe(13);
  });
});
