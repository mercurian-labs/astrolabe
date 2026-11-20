import { describe, expect, it } from "vite-plus/test";
import {
  MIN_SPLIT_PX,
  insertBeside,
  minWidthPx,
  gatherSpan,
  insertAround,
  leaves,
  paneBelow,
  placeBeside,
  removeLeaf,
  spanOf,
  resizeTiled,
  type Branch,
  type Leaf,
  type SplitNode,
} from "./tree";

const leaf = (id: string): Leaf => ({ type: "leaf", id, tabs: [id], active: id });
/** A pane split from `origin`. */
const split = (id: string, origin: string): Leaf => ({ ...leaf(id), from: origin });
const branch = (
  id: string,
  direction: Branch["direction"],
  children: SplitNode[],
  weights: number[],
): Branch => ({ type: "branch", id, direction, children, weights });

describe("removing panes", () => {
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

  it("gives a split-off pane's room back to the pane it was split from, and to no other", () => {
    const root = branch("r", "row", [leaf("a"), leaf("b"), split("c", "b")], [1, 2, 1]);
    expect(removeLeaf(root, "c")).toEqual(branch("r", "row", [leaf("a"), leaf("b")], [1, 3]));
  });

  it("gives a pane's room to the pane split from it when it has no origin beside it", () => {
    const root = branch("r", "row", [leaf("a"), leaf("b"), split("c", "b")], [1, 2, 1]);
    expect(removeLeaf(root, "b")).toEqual(branch("r", "row", [leaf("a"), leaf("c")], [1, 3]));
  });

  it("picks the pane split from it next to it, else the first of them", () => {
    const next = branch(
      "r",
      "row",
      [split("x", "b"), leaf("a"), leaf("b"), split("c", "b")],
      [1, 1, 1, 1],
    );
    // x, split from b too, now counts as split from c, which took b's place.
    expect(removeLeaf(next, "b")).toEqual(
      branch("r", "row", [split("x", "c"), leaf("a"), leaf("c")], [1, 1, 2]),
    );
    const apart = branch(
      "r",
      "row",
      [split("x", "b"), leaf("a"), leaf("b"), leaf("y")],
      [1, 1, 1, 1],
    );
    expect(removeLeaf(apart, "b")).toEqual(
      branch("r", "row", [leaf("x"), leaf("a"), leaf("y")], [2, 1, 1]),
    );
  });

  it("gives a pane with no origin's room to its neighbour before it, else after it", () => {
    const root = branch("r", "row", [leaf("a"), leaf("b"), leaf("c")], [1, 2, 1]);
    expect(removeLeaf(root, "b")).toEqual(branch("r", "row", [leaf("a"), leaf("c")], [3, 1]));
    expect(removeLeaf(root, "a")).toEqual(branch("r", "row", [leaf("b"), leaf("c")], [3, 1]));
  });

  it("points panes split from a closed pane at the pane that took its room", () => {
    const root = branch("r", "row", [leaf("a"), split("b", "a"), split("c", "b")], [1, 1, 1]);
    const closed = removeLeaf(root, "b");
    expect(closed).toEqual(branch("r", "row", [leaf("a"), split("c", "a")], [2, 1]));
    expect(removeLeaf(closed!, "c")).toEqual(leaf("a"));
  });

  it("hands a closed origin's own origin to the pane split from it that takes its place", () => {
    // b was split right from a, c split down from b.
    const stack = branch("s", "column", [split("b", "a"), split("c", "b")], [1, 1]);
    const root = branch("r", "row", [leaf("a"), leaf("z"), stack], [1, 1, 2]);
    const closed = removeLeaf(root, "b");
    expect(closed).toEqual(branch("r", "row", [leaf("a"), leaf("z"), split("c", "a")], [1, 1, 2]));
  });

  it("gives the room to the stack beside it that holds its origin", () => {
    const stack = branch("s", "column", [leaf("a"), split("d", "a")], [1, 1]);
    const root = branch("r", "row", [stack, split("n", "b"), split("b", "a")], [1, 1, 1]);
    expect(removeLeaf(root, "b")).toEqual(branch("r", "row", [stack, split("n", "a")], [2, 1]));
  });

  it("falls back to its neighbour in its own branch when its origin is in another", () => {
    const stack = branch("s", "column", [leaf("x"), split("b", "a"), leaf("y")], [1, 1, 2]);
    const root = branch("r", "row", [leaf("a"), stack], [1, 1]);
    expect(removeLeaf(root, "b")).toEqual(
      branch(
        "r",
        "row",
        [leaf("a"), branch("s", "column", [leaf("x"), leaf("y")], [2, 2])],
        [1, 1],
      ),
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
        [leaf("a"), branch("new", "column", [split("n", "b"), leaf("b")], [1, 1])],
        [1, 1],
      ),
    );
  });

  it("remembers the pane a new pane was split from", () => {
    const root = branch("r", "row", [leaf("a"), leaf("b")], [1, 2]);
    expect(insertBeside(root, "b", leaf("n"), "right", "new")).toEqual(
      branch("r", "row", [leaf("a"), leaf("b"), split("n", "b")], [1, 1, 1]),
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

describe("the pane below", () => {
  it("is the next pane stacked under it, and none at the bottom", () => {
    const root = branch("b", "column", [leaf("a"), leaf("z")], [1, 1]);
    expect(paneBelow(root, "a")?.id).toBe("z");
    expect(paneBelow(root, "z")).toBeNull();
    expect(paneBelow(leaf("a"), "a")).toBeNull();
  });

  it("is never a pane beside it", () => {
    expect(paneBelow(branch("b", "row", [leaf("a"), leaf("z")], [1, 1]), "a")).toBeNull();
  });

  it("reaches past the column it stands in when it is at that column's foot", () => {
    const root = branch(
      "b",
      "column",
      [branch("r", "row", [leaf("a"), leaf("x")], [1, 1]), leaf("z")],
      [1, 1],
    );
    expect(paneBelow(root, "a")?.id).toBe("z");
    expect(paneBelow(root, "x")?.id).toBe("z");
  });

  it("is the one sharing most of its foot where several start there", () => {
    const root = branch(
      "b",
      "column",
      [leaf("a"), branch("r", "row", [leaf("x"), leaf("y")], [1, 3])],
      [1, 1],
    );
    expect(paneBelow(root, "a")?.id).toBe("y");
  });

  it("ignores a pane whose top only lines up in another column", () => {
    const root = branch(
      "b",
      "row",
      [
        branch("l", "column", [leaf("a"), leaf("x")], [1, 1]),
        branch("r", "column", [leaf("c"), leaf("d")], [1, 1]),
      ],
      [1, 1],
    );
    expect(paneBelow(root, "a")?.id).toBe("x");
    expect(paneBelow(root, "c")?.id).toBe("d");
  });
});

describe("a pane's place beside its neighbour", () => {
  it("names the neighbour that takes its room, the side and its share", () => {
    const start = branch("b", "column", [leaf("a"), leaf("z")], [1, 1]);
    expect(placeBeside({ ...start, weights: [3, 1] }, "z")).toEqual({
      tabs: ["a"],
      side: "bottom",
      weight: 0.25,
    });
    expect(placeBeside(start, "a")?.side).toBe("top");
  });

  it("names the tabs of a neighbour that is a branch, what it spanned, its heir's first", () => {
    const row = branch("r", "row", [leaf("x"), leaf("a")], [1, 1]);
    const root = branch("b", "column", [row, split("z", "a")], [1, 1]);
    expect(placeBeside(root, "z")).toEqual({
      tabs: ["a", "x"],
      side: "bottom",
      weight: 0.5,
    });
  });

  it("names only the tabs asked for", () => {
    const root = branch("b", "column", [leaf("a"), leaf("z")], [1, 1]);
    expect(placeBeside(root, "z", () => ["only"])?.tabs).toEqual(["only"]);
  });

  it("is nothing for a lone pane", () => {
    expect(placeBeside(leaf("a"), "a")).toBeNull();
  });
});

describe("what a pane spanned", () => {
  const row = branch("r", "row", [leaf("a"), leaf("x")], [1, 1]);

  it("is the smallest part of the tree holding the panes still standing", () => {
    const root = branch("b", "column", [row, leaf("z")], [1, 1]);
    expect(spanOf(root, ["a", "x"])?.id).toBe("r");
    expect(spanOf(root, ["a", "gone"])?.id).toBe("a");
    expect(spanOf(root, ["gone"])).toBeNull();
  });

  it("gathers a run of a branch's children, the others outside it", () => {
    const start = branch("r", "row", [leaf("a"), leaf("x"), leaf("other")], [1, 2, 3]);
    const gathered = gatherSpan(start, ["a", "x"], "g");
    expect(gathered?.target).toMatchObject({ id: "g", direction: "row", weights: [1, 2] });
    expect(gathered?.root).toMatchObject({ id: "r", weights: [3, 3] });
    expect(leaves(gathered?.root ?? start).map((pane) => pane.id)).toEqual(["a", "x", "other"]);
  });

  it("gathers nothing with another pane among them", () => {
    const start = branch("r", "row", [leaf("a"), leaf("other"), leaf("x")], [1, 1, 1]);
    expect(gatherSpan(start, ["a", "x"], "g")).toBeNull();
    const nested = branch("n", "column", [leaf("a"), leaf("other")], [1, 1]);
    const inner = branch("r", "row", [nested, leaf("x"), leaf("y")], [1, 1, 1]);
    expect(gatherSpan(inner, ["a", "x"], "g")).toBeNull();
  });

  it("divides whole, the new pane running along all of it", () => {
    const root = insertAround(row, row, leaf("t"), "bottom", "b", 0.25) as Branch;
    expect(root.direction).toBe("column");
    expect(root.children.map((child) => child.id)).toEqual(["r", "t"]);
    expect(root.weights).toEqual([0.75, 0.25]);
  });

  it("folds into a parent running the same way, the others keeping their shares", () => {
    const start = branch("b", "column", [leaf("top"), row], [1, 1]);
    const root = insertAround(start, row, leaf("t"), "bottom", "n", 0.5) as Branch;
    expect(root.id).toBe("b");
    expect(root.children.map((child) => child.id)).toEqual(["top", "r", "t"]);
    expect(root.weights).toEqual([1, 0.5, 0.5]);
  });
});
