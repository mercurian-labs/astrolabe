import { describe, expect, it } from "vite-plus/test";

import {
  closeTab,
  moveTabs,
  openBeside,
  openTab,
  placeTabs,
  showTabBefore,
  splitTab,
  splitTabs,
  splitWithTabs,
  startingArrangement,
  surfaceKey,
  tabsToClose,
  type Arrangement,
} from "./arrangement";
import { leaves, type Branch } from "./tree";

const diff = surfaceKey("diff");
const files = surfaceKey("files");
const browser = surfaceKey("browser:a");

function panes(arrangement: Arrangement) {
  return leaves(arrangement.root).map((leaf) => leaf.tabs);
}

/** Diff in the panel's first pane, Files in a pane beside it. */
function sideBySide(): Arrangement {
  const opened = openTab(startingArrangement(), diff, "p0");
  return openBeside(opened, files, "p0", "right", { focus: false });
}

describe("opening tabs", () => {
  it("opens the first surface in place of the empty tab a fresh panel shows", () => {
    expect(panes(openTab(startingArrangement(), diff))).toEqual([[diff]]);
  });

  it("opens a surface beside another without taking focus, at the share asked", () => {
    const opened = openTab(startingArrangement(), diff, "p0");
    const next = openBeside(opened, files, "p0", "right", { focus: false, weight: 0.4 });
    expect(panes(next)).toEqual([[diff], [files]]);
    expect(next.focused).toBe("p0");
    const root = next.root as Branch;
    expect(root.weights[0]).toBeCloseTo(0.6 * 2);
    expect(root.weights[1]).toBeCloseTo(0.4 * 2);
  });

  it("moves a tab open in another pane to the pane asked from, closing a pane it empties", () => {
    expect(panes(openTab(sideBySide(), files, "p0"))).toEqual([[diff, files]]);
  });

  it("splits off a pane's only tab, leaving an empty tab whose place the next surface takes", () => {
    const split = splitTab(openTab(startingArrangement(), diff, "p0"), diff, "right");
    expect(panes(split)).toEqual([["empty/1"], [diff]]);
    expect(panes(openTab(split, browser, "p0"))).toEqual([[browser], [diff]]);
  });
});

describe("showing a tab group's own tab from its marker", () => {
  const group = surfaceKey("group");

  it("brings it to the front where it is open, focusing its pane", () => {
    const opened = openTab(sideBySide(), group, "p1", false);
    expect(opened.focused).toBe("p0");
    const next = showTabBefore(opened, group, diff);
    expect(panes(next)).toEqual([[diff], [files, group]]);
    expect(leaves(next.root)[1]?.active).toBe(group);
    expect(next.focused).toBe("p1");
  });

  it("opens it at the head of the run when it is not open, and shows it", () => {
    const three = openTab(openTab(openTab(startingArrangement(), diff), files), browser);
    const next = showTabBefore(three, group, files);
    expect(panes(next)).toEqual([[diff, group, files, browser]]);
    expect(leaves(next.root)[0]?.active).toBe(group);
  });
});

describe("closing tabs", () => {
  it("leaves the last pane an empty tab, as an empty panel shows, and keeps that one", () => {
    const closed = closeTab(openTab(startingArrangement(), diff), diff);
    expect(panes(closed)).toEqual([["empty/1"]]);
    expect(closeTab(closed, "empty/1")).toBe(closed);
  });

  it("closes a pane with its last tab, its neighbour taking its room and focus", () => {
    const opened = openBeside(openTab(startingArrangement(), diff), files, "p0", "right");
    expect(opened.focused).toBe("p1");
    const next = closeTab(opened, files);
    expect(panes(next)).toEqual([[diff]]);
    expect(next.focused).toBe("p0");
  });

  it("closes the others, or those after a tab, in its own pane", () => {
    const three = openTab(openTab(openTab(startingArrangement(), diff), files), browser);
    expect(panes(three)).toEqual([[diff, files, browser]]);
    expect(tabsToClose(three, files, "others")).toEqual([diff, browser]);
    expect(tabsToClose(three, files, "after")).toEqual([browser]);
    expect(tabsToClose(three, browser, "after")).toEqual([]);
  });
});

describe("moving a selection of tabs together", () => {
  it("moves them in order to the insertion line, closing the pane they empty", () => {
    const three = openTab(sideBySide(), browser, "p1", false);
    expect(panes(three)).toEqual([[diff], [files, browser]]);
    const next = moveTabs(three, [files, browser], "p0", 0, browser);
    expect(panes(next)).toEqual([[files, browser, diff]]);
    expect(leaves(next.root)[0]?.active).toBe(browser);
    expect(next.focused).toBe("p0");
  });

  it("reorders them within their own pane, counting the line before the move", () => {
    const three = openTab(openTab(openTab(startingArrangement(), diff), files), browser);
    expect(panes(moveTabs(three, [files, browser], "p0", 0))).toEqual([[files, browser, diff]]);
    expect(panes(moveTabs(three, [diff, browser], "p0", 3))).toEqual([[files, diff, browser]]);
  });

  it("leaves the tab in front as it was when that is one of the pane's own", () => {
    const three = openTab(openTab(openTab(startingArrangement(), diff), files), browser);
    const run = moveTabs(three, [diff, files], "p0", 3, browser);
    expect(panes(run)).toEqual([[browser, diff, files]]);
    expect(leaves(run.root)[0]?.active).toBe(browser);
    const one = moveTabs(three, [diff], "p0", 3, browser);
    expect(panes(one)).toEqual([[files, browser, diff]]);
    expect(leaves(one.root)[0]?.active).toBe(browser);
  });

  it("opens them in a new pane on a pane's edge", () => {
    const three = openTab(sideBySide(), browser, "p1", false);
    const next = splitWithTabs(three, [files, browser], "p0", "bottom");
    expect(next.root).toMatchObject({ type: "branch", direction: "column" });
    expect(panes(next)).toEqual([[diff], [files, browser]]);
  });

  it("splits a whole pane's tabs off beside it, leaving an empty tab behind", () => {
    const two = openTab(openTab(startingArrangement(), diff), files);
    const next = splitTabs(two, [files, diff], "right");
    expect(panes(next)).toEqual([["empty/1"], [diff, files]]);
  });
});

describe("placing tabs dropped from outside the panes", () => {
  const notes = surfaceKey("note:a");

  it("opens the ones not open at the insertion line and moves the open ones there", () => {
    const next = placeTabs(sideBySide(), [notes, files], "p0", { side: null, index: 0 });
    expect(panes(next)).toEqual([[notes, files, diff]]);
    expect(leaves(next.root)[0]?.active).toBe(notes);
    // The one dragged of several comes to the front.
    const dragged = placeTabs(sideBySide(), [notes, files], "p0", { side: null, index: 0 }, files);
    expect(leaves(dragged.root)[0]?.active).toBe(files);
  });

  it("takes the place of a pane's lone empty tab", () => {
    expect(panes(startingArrangement())).toEqual([["empty/0"]]);
    const next = placeTabs(startingArrangement(), [notes], "p0", { side: null, index: 1 });
    expect(panes(next)).toEqual([[notes]]);
  });

  it("opens them in a new pane on a pane's edge", () => {
    const next = placeTabs(sideBySide(), [notes], "p1", { side: "bottom", index: 0 });
    expect(panes(next)).toEqual([[diff], [files], [notes]]);
  });
});
