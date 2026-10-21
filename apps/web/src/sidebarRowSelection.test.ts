import { describe, expect, it } from "vite-plus/test";

import {
  NO_ROW_SELECTION,
  anchorRow,
  rangeToRow,
  rowsActedOn,
  toggleRow,
} from "./sidebarRowSelection";

const ordered = ["a", "b", "c", "d", "e"];

describe("a sidebar's row selection", () => {
  it("toggles rows with Cmd-click, the last added anchoring the next Shift-click", () => {
    const one = toggleRow(NO_ROW_SELECTION, "wikis", "b");
    expect(one).toEqual({ section: "wikis", keys: ["b"], anchor: "b" });
    const two = toggleRow(one, "wikis", "d");
    expect(two.keys).toEqual(["b", "d"]);
    expect(toggleRow(two, "wikis", "b")).toEqual({ section: "wikis", keys: ["d"], anchor: "d" });
  });

  it("adds the range from the anchor with Shift-click, either way, keeping the anchor", () => {
    expect(rangeToRow(anchorRow("wikis", "b"), "wikis", "d", ordered)).toEqual({
      section: "wikis",
      keys: ["b", "c", "d"],
      anchor: "b",
    });
    const kept = rangeToRow(toggleRow(NO_ROW_SELECTION, "wikis", "e"), "wikis", "c", ordered);
    expect(kept.keys).toEqual(["c", "d", "e"]);
    // No anchor in the list: the row alone.
    expect(rangeToRow(NO_ROW_SELECTION, "wikis", "c", ordered).keys).toEqual(["c"]);
  });

  it("starts over in another section", () => {
    const wikis = toggleRow(NO_ROW_SELECTION, "wikis", "a");
    expect(toggleRow(wikis, "pull-requests", "x")).toEqual({
      section: "pull-requests",
      keys: ["x"],
      anchor: "x",
    });
  });

  it("acts on the selection, in list order, from a selected row, else on the row alone", () => {
    const selection = toggleRow(toggleRow(NO_ROW_SELECTION, "wikis", "d"), "wikis", "a");
    expect(rowsActedOn(selection, "wikis", "d", ordered)).toEqual(["a", "d"]);
    expect(rowsActedOn(selection, "wikis", "c", ordered)).toEqual(["c"]);
    expect(rowsActedOn(selection, "pull-requests", "d", ordered)).toEqual(["d"]);
  });
});
