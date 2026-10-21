import { describe, expect, it } from "vite-plus/test";

import {
  NO_TAB_SELECTION,
  anchorAt,
  selectRange,
  selectedIn,
  tabsActedOn,
  toggleTab,
} from "./tabSelection";
import type { Leaf } from "./tree";

const pane: Leaf = { type: "leaf", id: "p0", tabs: ["a", "b", "c", "d", "e"], active: "a" };
const other: Leaf = { type: "leaf", id: "p1", tabs: ["x", "y"], active: "x" };

describe("selecting tabs as the sidebar selects threads", () => {
  it("toggles one tab in and out with ⌘/Ctrl-click", () => {
    const one = toggleTab(NO_TAB_SELECTION, "p0", "b");
    const two = toggleTab(one, "p0", "d");
    expect(selectedIn(two, pane)).toEqual(["b", "d"]);
    expect(selectedIn(toggleTab(two, "p0", "b"), pane)).toEqual(["d"]);
  });

  it("selects from the anchor a plain click left, in the pane's order, both ends included", () => {
    const anchored = anchorAt("p0", "b");
    expect(selectedIn(anchored, pane)).toEqual([]);
    expect(selectedIn(selectRange(anchored, pane, "d"), pane)).toEqual(["b", "c", "d"]);
    expect(selectedIn(selectRange(anchored, pane, "a"), pane)).toEqual(["a", "b"]);
  });

  it("keeps the anchor across ranges, and adds a range to what is toggled", () => {
    const toggled = toggleTab(anchorAt("p0", "a"), "p0", "e");
    const ranged = selectRange(toggleTab(toggled, "p0", "b"), pane, "c");
    expect(selectedIn(ranged, pane)).toEqual(["b", "c", "e"]);
  });

  it("starts afresh in another pane", () => {
    const here = selectRange(anchorAt("p0", "a"), pane, "c");
    const there = toggleTab(here, "p1", "y");
    expect(selectedIn(there, pane)).toEqual([]);
    expect(selectedIn(there, other)).toEqual(["y"]);
    // A range without an anchor in its pane selects the tab clicked.
    expect(selectedIn(selectRange(here, other, "y"), other)).toEqual(["y"]);
  });

  it("acts on the selection from a selected tab, and on a tab alone otherwise", () => {
    const selected = selectRange(anchorAt("p0", "b"), pane, "c");
    expect(tabsActedOn(selected, pane, "c")).toEqual(["b", "c"]);
    expect(tabsActedOn(selected, pane, "e")).toEqual(["e"]);
    expect(tabsActedOn(toggleTab(NO_TAB_SELECTION, "p0", "b"), pane, "b")).toEqual(["b"]);
  });
});
