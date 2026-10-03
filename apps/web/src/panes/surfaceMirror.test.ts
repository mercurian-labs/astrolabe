import { describe, expect, it } from "vite-plus/test";

import {
  CONVERSATION,
  activateTab,
  focusPane,
  openTab,
  startingArrangement,
  surfaceKey,
  type Arrangement,
} from "./arrangement";
import {
  followRecord,
  hostPaneId,
  recordFor,
  type MirrorState,
  type PanelRecord,
} from "./surfaceMirror";
import { leaves } from "./tree";

const closed: PanelRecord = { isOpen: false, activeSurfaceId: null, surfaceIds: [] };

function record(activeSurfaceId: string | null, surfaceIds: string[], isOpen = true): PanelRecord {
  return { isOpen, activeSurfaceId, surfaceIds };
}

function panes(arrangement: Arrangement) {
  return leaves(arrangement.root).map((leaf) => leaf.tabs);
}

function actives(arrangement: Arrangement) {
  return leaves(arrangement.root).map((leaf) => leaf.active);
}

const start: MirrorState = { arrangement: startingArrangement(), hidden: null };

/** T3 Code opening surfaces one after another, as its record moves. */
function follow(state: MirrorState, ...records: PanelRecord[]) {
  let previous: PanelRecord = closed;
  let next = state;
  for (const each of records) {
    next = followRecord(next, previous, each);
    previous = each;
  }
  return next;
}

describe("T3 Code opening surfaces", () => {
  it("opens the first surface in a new pane right of the conversation, focus staying put", () => {
    const next = follow(start, record("diff", ["diff"]));
    expect(panes(next.arrangement)).toEqual([[CONVERSATION], [surfaceKey("diff")]]);
    expect(next.arrangement.focused).toBe("p0");
  });

  it("opens later surfaces beside the one in front, which they replace in front", () => {
    const next = follow(
      start,
      record("diff", ["diff"]),
      record("browser:a", ["diff", "browser:a"]),
    );
    expect(panes(next.arrangement)).toEqual([
      [CONVERSATION],
      [surfaceKey("diff"), surfaceKey("browser:a")],
    ]);
    expect(actives(next.arrangement)).toEqual([CONVERSATION, surfaceKey("browser:a")]);
  });

  it("opens a surface in the pane a New tab menu asked from, and focuses it", () => {
    const opened = follow(start, record("diff", ["diff"]));
    const followed = followRecord(
      opened,
      record("diff", ["diff"]),
      record("files", ["diff", "files"]),
      "p0",
    );
    expect(followed.consumedTarget).toBe(true);
    expect(panes(followed.arrangement)).toEqual([
      [CONVERSATION, surfaceKey("files")],
      [surfaceKey("diff")],
    ]);
    expect(followed.arrangement.focused).toBe("p0");
  });

  it("brings the record's active surface to the front of its pane when it changes", () => {
    const opened = follow(start, record("diff", ["diff"]), record("files", ["diff", "files"]));
    const next = followRecord(
      opened,
      record("files", ["diff", "files"]),
      record("diff", ["diff", "files"]),
    );
    expect(actives(next.arrangement)).toEqual([CONVERSATION, surfaceKey("diff")]);
  });

  it("puts a surface that replaces another in its place, as a file replaces the Files explorer", () => {
    const opened = follow(start, record("files", ["files"]));
    const resized = {
      ...opened,
      arrangement: { ...opened.arrangement, root: { ...opened.arrangement.root, weights: [3, 1] } },
    } as MirrorState;
    const next = followRecord(
      resized,
      record("files", ["files"]),
      record("file:a.md", ["file:a.md"]),
    );
    expect(panes(next.arrangement)).toEqual([[CONVERSATION], [surfaceKey("file:a.md")]]);
    expect(next.arrangement.root).toMatchObject({
      id: resized.arrangement.root.id,
      weights: [3, 1],
    });
  });

  it("opens a terminal across the bottom, and later terminals beside it", () => {
    const opened = follow(
      start,
      record("diff", ["diff"]),
      record("terminal:a", ["diff", "terminal:a"]),
      record("terminal:b", ["diff", "terminal:a", "terminal:b"]),
    );
    expect(opened.arrangement.root).toMatchObject({ type: "branch", direction: "column" });
    expect(panes(opened.arrangement)).toEqual([
      [CONVERSATION],
      [surfaceKey("diff")],
      [surfaceKey("terminal:a"), surfaceKey("terminal:b")],
    ]);
  });

  it("closes the tab of a surface gone from the record, and its pane with it", () => {
    const opened = follow(start, record("diff", ["diff"]));
    const next = followRecord(opened, record("diff", ["diff"]), closed);
    expect(panes(next.arrangement)).toEqual([[CONVERSATION]]);
  });
});

describe("T3 Code hiding and showing its panel", () => {
  it("takes every surface tab away on hide and puts the arrangement back exactly on show", () => {
    const shown = follow(start, record("diff", ["diff"]), record("files", ["diff", "files"]));
    const hidden = followRecord(
      shown,
      record("files", ["diff", "files"]),
      record("files", ["diff", "files"], false),
    );
    expect(panes(hidden.arrangement)).toEqual([[CONVERSATION]]);
    const back = followRecord(
      hidden,
      record("files", ["diff", "files"], false),
      record("files", ["diff", "files"]),
    );
    expect(back.arrangement).toBe(shown.arrangement);
    expect(back.hidden).toBeNull();
  });

  it("reopens surfaces beside the conversation when what was hidden cannot come back as it was", () => {
    const shown = follow(start, record("diff", ["diff"]));
    const hidden = followRecord(shown, record("diff", ["diff"]), record("diff", ["diff"], false));
    // Something changed while hidden: the panes split the conversation's pane.
    const changed = { ...hidden, arrangement: focusPane(hidden.arrangement, "p0") };
    const moved = {
      ...changed,
      arrangement: { ...changed.arrangement, seq: changed.arrangement.seq + 1 },
    };
    const back = followRecord(moved, record("diff", ["diff"], false), record("diff", ["diff"]));
    expect(panes(back.arrangement)).toEqual([[CONVERSATION], [surfaceKey("diff")]]);
  });
});

describe("what the record should say for the panes", () => {
  const twoPanes = follow(
    start,
    record("diff", ["diff"]),
    record("files", ["diff", "files"]),
  ).arrangement;
  const current = record("files", ["diff", "files"]);

  it("names the surface in the focused pane", () => {
    const focused = activateTab(twoPanes, surfaceKey("diff"));
    expect(recordFor(focused, current)).toEqual({ isOpen: true, activeSurfaceId: "diff" });
  });

  it("keeps the record's surface while it stays shown and the conversation has focus", () => {
    expect(recordFor(twoPanes, current)).toEqual({ isOpen: true, activeSurfaceId: "files" });
  });

  it("closes the panel when no surface tab is shown, keeping the tabs", () => {
    const behind = openTab(twoPanes, CONVERSATION, "p1");
    expect(panes(behind)).toEqual([[surfaceKey("diff"), surfaceKey("files"), CONVERSATION]]);
    expect(recordFor(behind, current)).toEqual({ isOpen: false, activeSurfaceId: "files" });
  });

  it("hosts the record's surface in the pane showing its tab, and nowhere while closed", () => {
    expect(hostPaneId(twoPanes, current)).toBe("p1");
    expect(hostPaneId(twoPanes, record("files", ["diff", "files"], false))).toBeNull();
    expect(hostPaneId(twoPanes, record("diff", ["diff", "files"]))).toBeNull();
  });
});

describe("loading a thread", () => {
  it("drops tabs of surfaces the record no longer holds, and keeps a closed panel's tabs", () => {
    const saved = openTab(
      openTab(startingArrangement(), surfaceKey("diff"), "p0"),
      CONVERSATION,
      "p0",
    );
    const withGone = openTab(saved, surfaceKey("browser:gone"), "p0", false);
    const next = followRecord(
      { arrangement: activateTab(withGone, CONVERSATION), hidden: null },
      null,
      record("diff", ["diff"], false),
    );
    expect(panes(next.arrangement)).toEqual([[CONVERSATION, surfaceKey("diff")]]);
    expect(actives(next.arrangement)).toEqual([CONVERSATION]);
  });

  it("gives every surface of an open record a tab, its active one in front", () => {
    const next = followRecord(start, null, record("files", ["diff", "files"]));
    expect(panes(next.arrangement)).toEqual([
      [CONVERSATION],
      [surfaceKey("diff"), surfaceKey("files")],
    ]);
    expect(actives(next.arrangement)).toEqual([CONVERSATION, surfaceKey("files")]);
  });
});
