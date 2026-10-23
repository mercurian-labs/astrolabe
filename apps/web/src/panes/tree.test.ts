import { describe, expect, it } from "vite-plus/test";
import {
  MIN_SPLIT_PX,
  insertBeside,
  minWidthPx,
  removeLeaf,
  resizeTiled,
  type Branch,
  type Leaf,
  type SplitNode,
} from "./tree";

const leaf = (id: string): Leaf => ({ type: "leaf", id, tabs: [id], active: id });
const branch = (
  id: string,
  direction: Branch["direction"],
  children: SplitNode[],
  weights: number[],
): Branch => ({ type: "branch", id, direction, children, weights });

describe("removing panes", () => {
  it("gives a removed pane's room to its neighbours", () => {
    const root = branch("r", "row", [leaf("a"), leaf("b"), leaf("c")], [1, 2, 1]);
    expect(removeLeaf(root, "b")).toEqual(branch("r", "row", [leaf("a"), leaf("c")], [1, 1]));
  });

  it("collapses an inner branch left with one pane into that pane", () => {
    const stack = branch("s", "column", [leaf("a"), leaf("b")], [1, 1]);
    const root = branch("r", "row", [leaf("x"), stack], [1, 2]);
    expect(removeLeaf(root, "a")).toEqual(branch("r", "row", [leaf("x"), leaf("b")], [1, 2]));
  });

  it("collapses the root, row or stack, left with one pane into that pane", () => {
    const root = branch("r", "row", [leaf("a"), leaf("b")], [1.5, 1]);
    expect(removeLeaf(root, "b")).toEqual(leaf("a"));
    const stacked = branch("c", "column", [leaf("a"), leaf("b")], [1, 1]);
    expect(removeLeaf(stacked, "b")).toEqual(leaf("a"));
  });

  it("folds a same-direction branch into its parent, keeping each pane's share", () => {
    const stack = branch("s", "column", [leaf("b"), leaf("c")], [1, 3]);
    const root = branch("r", "row", [leaf("a"), stack], [1, 1]);
    const inner = branch("i", "column", [leaf("x"), root], [1, 1]);
    // Removing x leaves the row alone at the top; nothing else changes shape.
    expect(removeLeaf(inner, "x")).toEqual(root);
    // Removing a collapses the row, and the stack folds into the outer column.
    expect(removeLeaf(inner, "a")).toEqual(
      branch("i", "column", [leaf("x"), leaf("b"), leaf("c")], [1, 0.25, 0.75]),
    );
  });

  it("keeps untouched subtrees by reference", () => {
    const stack = branch("s", "column", [leaf("b"), leaf("c")], [1, 1]);
    const root = branch("r", "row", [leaf("a"), stack, leaf("d")], [1, 1, 1]);
    const next = removeLeaf(root, "a") as Branch;
    expect(next.children[0]).toBe(stack);
  });
});

describe("dividing panes", () => {
  it("wraps a pane in a new branch when dividing across its parent's direction", () => {
    const root = branch("r", "row", [leaf("a"), leaf("b")], [1, 1]);
    expect(insertBeside(root, "b", leaf("n"), "top", "new")).toEqual(
      branch(
        "r",
        "row",
        [leaf("a"), branch("new", "column", [leaf("n"), leaf("b")], [1, 1])],
        [1, 1],
      ),
    );
  });
});

describe("size arithmetic", () => {
  it("moves a tiled divider by the dragged share of the branch", () => {
    // 1000px across weights summing to 2: 100px is 0.2 of weight.
    const next = resizeTiled([1, 1], 0, 100, 1000);
    expect(next[0]).toBeCloseTo(1.2);
    expect(next[1]).toBeCloseTo(0.8);
  });

  it("changes only the two panes beside the divider", () => {
    const next = resizeTiled([1, 1, 1], 1, -150, 1500);
    expect(next[0]).toBe(1);
    expect(next[1]).toBeCloseTo(0.7);
    expect(next[2]).toBeCloseTo(1.3);
  });

  it("stops a pane at the minimum size", () => {
    const next = resizeTiled([1, 1], 0, 10_000, 1000);
    const secondPx = ((next[1] ?? 0) / 2) * 1000;
    expect(secondPx).toBeCloseTo(MIN_SPLIT_PX);
  });

  it("measures a subtree's minimum width: side by side adds up, stacked takes the widest", () => {
    const stack = branch("s", "column", [leaf("a"), leaf("b")], [1, 1]);
    const plain = () => MIN_SPLIT_PX;
    expect(minWidthPx(stack, plain)).toBe(MIN_SPLIT_PX);
    expect(minWidthPx(branch("r", "row", [stack, leaf("c")], [1, 1]), plain)).toBe(
      2 * MIN_SPLIT_PX,
    );
  });
});
