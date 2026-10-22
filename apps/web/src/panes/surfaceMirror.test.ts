import { describe, expect, it } from "vite-plus/test";

import {
  activateTab,
  openBeside,
  openTab,
  startingArrangement,
  surfaceKey,
  type Arrangement,
} from "./arrangement";
import { activeSurfaceFor, followRecord, hostPaneId, type PanelRecord } from "./surfaceMirror";
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

/** T3 Code opening surfaces one after another, as its record moves. */
function follow(start: Arrangement, ...records: PanelRecord[]) {
  let previous: PanelRecord = closed;
  let next = start;
  for (const each of records) {
    next = followRecord(next, previous, each).arrangement;
    previous = each;
  }
  return next;
}

const diff = surfaceKey("diff");
const files = surfaceKey("files");

describe("T3 Code opening surfaces", () => {
  it("opens the first surface in place of the empty tab a fresh panel shows", () => {
    const next = follow(startingArrangement(), record("diff", ["diff"]));
    expect(panes(next)).toEqual([[diff]]);
  });

  it("opens later surfaces beside the one in front, which they replace in front", () => {
    const next = follow(
      startingArrangement(),
      record("diff", ["diff"]),
      record("browser:a", ["diff", "browser:a"]),
    );
    expect(panes(next)).toEqual([[diff, surfaceKey("browser:a")]]);
    expect(actives(next)).toEqual([surfaceKey("browser:a")]);
  });

  it("opens a surface in the pane a New tab menu asked from, and focuses it", () => {
    const split = openBeside(
      follow(startingArrangement(), record("diff", ["diff"])),
      files,
      "p0",
      "right",
      {
        focus: false,
      },
    );
    const followed = followRecord(
      split,
      record("diff", ["diff", "files"]),
      record("browser:a", ["diff", "files", "browser:a"]),
      "p1",
    );
    expect(followed.consumedTarget).toBe(true);
    expect(panes(followed.arrangement)).toEqual([[diff], [files, surfaceKey("browser:a")]]);
    expect(followed.arrangement.focused).toBe("p1");
  });

  it("brings the record's active surface to the front of its pane when it changes", () => {
    const opened = follow(
      startingArrangement(),
      record("diff", ["diff"]),
      record("files", ["diff", "files"]),
    );
    const next = followRecord(
      opened,
      record("files", ["diff", "files"]),
      record("diff", ["diff", "files"]),
    );
    expect(actives(next.arrangement)).toEqual([diff]);
  });

  it("puts a surface that replaces another in its place, as a file replaces the Files explorer", () => {
    const opened = follow(
      startingArrangement(),
      record("diff", ["diff"]),
      record("files", ["diff", "files"]),
    );
    const next = followRecord(
      opened,
      record("files", ["diff", "files"]),
      record("file:a.md", ["diff", "file:a.md"]),
    );
    expect(panes(next.arrangement)).toEqual([[diff, surfaceKey("file:a.md")]]);
  });

  it("treats a terminal like any other surface", () => {
    const next = follow(
      startingArrangement(),
      record("diff", ["diff"]),
      record("terminal:a", ["diff", "terminal:a"]),
    );
    expect(panes(next)).toEqual([[diff, surfaceKey("terminal:a")]]);
  });

  it("closes the tab of a surface gone from the record, leaving the empty tab of an empty panel", () => {
    const opened = follow(startingArrangement(), record("diff", ["diff"]));
    const next = followRecord(opened, record("diff", ["diff"]), record(null, []));
    expect(panes(next.arrangement)).toEqual([["empty/1"]]);
  });
});

describe("T3 Code hiding and showing its panel", () => {
  it("leaves the tabs where they stand while the panel is hidden, and fronts the active one on show", () => {
    const shown = follow(
      startingArrangement(),
      record("diff", ["diff"]),
      record("files", ["diff", "files"]),
    );
    const hidden = followRecord(
      shown,
      record("files", ["diff", "files"]),
      record("files", ["diff", "files"], false),
    );
    expect(hidden.arrangement).toBe(shown);
    const back = followRecord(
      activateTab(hidden.arrangement, diff),
      record("files", ["diff", "files"], false),
      record("files", ["diff", "files"]),
    );
    expect(actives(back.arrangement)).toEqual([files]);
  });
});

describe("the surface the record should have in front", () => {
  const twoPanes = openBeside(
    follow(startingArrangement(), record("diff", ["diff"])),
    files,
    "p0",
    "right",
    { focus: false },
  );
  const current = record("files", ["diff", "files"]);

  it("is the surface in the focused pane", () => {
    expect(activeSurfaceFor(twoPanes, current)).toBe("diff");
  });

  it("is the record's own while it stays shown and an empty tab has focus", () => {
    const emptyFocused = openBeside(twoPanes, "empty/9", "p0", "bottom");
    expect(activeSurfaceFor(emptyFocused, current)).toBe("files");
  });

  it("hosts the record's surface in the pane showing its tab, and nowhere while closed", () => {
    expect(hostPaneId(twoPanes, current)).toBe("p1");
    expect(hostPaneId(twoPanes, record("files", ["diff", "files"], false))).toBeNull();
  });
});

describe("loading a thread", () => {
  it("drops tabs of surfaces the record no longer holds, and keeps a closed panel's tabs", () => {
    const saved = follow(
      startingArrangement(),
      record("diff", ["diff"]),
      record("browser:gone", ["diff", "browser:gone"]),
    );
    const next = followRecord(saved, null, record("diff", ["diff"], false));
    expect(panes(next.arrangement)).toEqual([[diff]]);
  });

  it("gives every surface of an open record a tab, its active one in front", () => {
    const next = followRecord(startingArrangement(), null, record("files", ["diff", "files"]));
    expect(panes(next.arrangement)).toEqual([[diff, files]]);
    expect(actives(next.arrangement)).toEqual([files]);
  });

  it("keeps a document the pane was left showing in front, over the record's surface", () => {
    const doc = "wiki:env:handbook:note";
    const saved = openTab(follow(startingArrangement(), record("diff", ["diff"])), doc);
    expect(actives(saved)).toEqual([doc]);
    const next = followRecord(saved, null, record("diff", ["diff"]));
    expect(actives(next.arrangement)).toEqual([doc]);
    // Once loaded, the record choosing its surface again brings it to the front.
    const chosen = followRecord(
      next.arrangement,
      record("files", ["diff", "files"]),
      record("diff", ["diff", "files"]),
    );
    expect(actives(chosen.arrangement)).toEqual([diff]);
  });
});
