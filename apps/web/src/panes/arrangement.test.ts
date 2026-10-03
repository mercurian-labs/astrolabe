import { describe, expect, it } from "vite-plus/test";

import {
  CONVERSATION,
  closeTab,
  moveTab,
  openBeside,
  openTab,
  restoreTabs,
  splitTab,
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

/** The conversation's pane with Diff and Files open beside it. */
function besideConversation(): Arrangement {
  const opened = openBeside(startingArrangement(), diff, "p0", "right", { focus: false });
  return openTab(opened, files, "p1", false);
}

describe("opening tabs", () => {
  it("opens a surface beside the conversation without taking focus, at the share asked", () => {
    const next = openBeside(startingArrangement(), diff, "p0", "right", {
      focus: false,
      weight: 0.4,
    });
    expect(panes(next)).toEqual([[CONVERSATION], [diff]]);
    expect(next.focused).toBe("p0");
    const root = next.root as Branch;
    expect(root.weights[0]).toBeCloseTo(0.6 * 2);
    expect(root.weights[1]).toBeCloseTo(0.4 * 2);
  });

  it("moves a tab open in another pane to the pane asked from, closing a pane it empties", () => {
    const next = openTab(besideConversation(), diff, "p0");
    expect(panes(next)).toEqual([[CONVERSATION, diff], [files]]);
    const again = openTab(next, files, "p0");
    expect(panes(again)).toEqual([[CONVERSATION, diff, files]]);
  });

  it("takes the place of an empty active tab", () => {
    // Splitting a pane's only tab leaves an empty tab behind.
    const split = splitTab(startingArrangement(), CONVERSATION, "right");
    expect(panes(split)).toEqual([["empty/1"], [CONVERSATION]]);
    expect(panes(openTab(split, browser, "p0"))).toEqual([[browser], [CONVERSATION]]);
  });
});

describe("closing tabs", () => {
  it("never closes the conversation, which holds the composer", () => {
    const start = startingArrangement();
    expect(closeTab(start, CONVERSATION)).toBe(start);
    expect(tabsToClose(openTab(start, diff), diff, "others")).toEqual([]);
  });

  it("closes a pane with its last tab, its neighbour taking its room and focus", () => {
    const opened = openBeside(startingArrangement(), diff, "p0", "right");
    expect(opened.focused).toBe("p1");
    const next = closeTab(opened, diff);
    expect(panes(next)).toEqual([[CONVERSATION]]);
    expect(next.focused).toBe("p0");
  });
});

describe("moving tabs", () => {
  it("moves the conversation into another pane, leaving its own to close", () => {
    const next = moveTab(besideConversation(), CONVERSATION, "p1", 0);
    expect(panes(next)).toEqual([[CONVERSATION, diff, files]]);
  });
});

describe("putting tabs back", () => {
  it("returns taken tabs to their former panes and places, and skips those whose pane is gone when asked to", () => {
    const before = besideConversation();
    const after = closeTab(closeTab(before, diff), files);
    expect(panes(after)).toEqual([[CONVERSATION]]);
    // The surfaces' pane closed with them, so with no fallback they stay out.
    expect(panes(restoreTabs(after, before, after, null))).toEqual([[CONVERSATION]]);
    // Into a pane that is still there, each goes back at its place.
    const kept = openTab(before, browser, "p1");
    const taken = closeTab(kept, files);
    expect(panes(taken)).toEqual([[CONVERSATION], [diff, browser]]);
    expect(panes(restoreTabs(taken, kept, taken, null))).toEqual([
      [CONVERSATION],
      [diff, files, browser],
    ]);
  });
});
