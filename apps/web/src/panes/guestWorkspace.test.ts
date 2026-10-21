import { describe, expect, it } from "vite-plus/test";

import {
  CONVERSATION,
  addGuests,
  dropGuests,
  guestKey,
  guestThreadOf,
  guestThreads,
  isTabKey,
  openBeside,
  startingArrangement,
  surfaceKey,
} from "./arrangement";
import { bringAlong, companionsOf, guestCandidates, workspaceNote } from "./guestWorkspace";
import { loadArrangement, type StorageLike } from "./persistence";
import { leaves } from "./tree";

const HOST = "env-1:host";
const FORK = "env-1:fork";
const OTHER = "env-1:other:thread";

function memoryStorage(): StorageLike {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

function panes(arrangement: ReturnType<typeof startingArrangement>) {
  return leaves(arrangement.root).map((leaf) => leaf.tabs);
}

describe("guest tabs", () => {
  it("name their thread, even one whose key holds colons", () => {
    expect(guestThreadOf(guestKey(OTHER))).toBe(OTHER);
    expect(isTabKey(guestKey(OTHER))).toBe(true);
    expect(guestThreadOf(CONVERSATION)).toBeNull();
    expect(guestThreadOf("guest:")).toBeNull();
  });

  it("join beside the conversation, after the guests already there, once each", () => {
    const one = addGuests(startingArrangement(), [FORK]);
    const two = addGuests(one, [OTHER, FORK]);
    expect(panes(two)).toEqual([[CONVERSATION, guestKey(FORK), guestKey(OTHER)]]);
    expect(guestThreads(two)).toEqual([FORK, OTHER]);
    // Quietly, as guests brought along do: the conversation stays in front.
    expect(leaves(two.root)[0]?.active).toBe(CONVERSATION);
  });

  it("come forward when opened beside, as a fork does, in the pane asked", () => {
    const split = openBeside(startingArrangement(), surfaceKey("diff"), "p0", "right", {
      focus: false,
    });
    const shown = addGuests(split, [FORK], { paneId: "p1", show: true });
    expect(panes(shown)).toEqual([[CONVERSATION], [surfaceKey("diff"), guestKey(FORK)]]);
    expect(leaves(shown.root)[1]?.active).toBe(guestKey(FORK));
    expect(shown.focused).toBe("p1");
    // Opening one already here brings it forward instead.
    const again = addGuests({ ...shown, root: { ...shown.root } }, [FORK], { show: true });
    expect(guestThreads(again)).toEqual([FORK]);
  });
});

describe("threads dropped on a pane from the sidebar", () => {
  it("join its tabs where the insertion line stood, the first in front", () => {
    const split = openBeside(startingArrangement(), surfaceKey("diff"), "p0", "right", {
      focus: false,
    });
    const dropped = dropGuests(split, [FORK, OTHER], "p1", { index: 0 });
    expect(panes(dropped)).toEqual([
      [CONVERSATION],
      [guestKey(FORK), guestKey(OTHER), surfaceKey("diff")],
    ]);
    expect(leaves(dropped.root)[1]?.active).toBe(guestKey(FORK));
    expect(dropped.focused).toBe("p1");
  });

  it("move a guest already here, as its tab would", () => {
    const here = addGuests(startingArrangement(), [FORK]);
    expect(panes(dropGuests(here, [FORK], "p0", { index: 0 }))).toEqual([
      [guestKey(FORK), CONVERSATION],
    ]);
  });

  it("divide the pane on the side dropped, into a new pane of their own", () => {
    const dropped = dropGuests(startingArrangement(), [FORK, OTHER], "p0", { side: "right" });
    expect(panes(dropped)).toEqual([[CONVERSATION], [guestKey(FORK), guestKey(OTHER)]]);
    expect(leaves(dropped.root)[1]?.active).toBe(guestKey(FORK));
  });

  it("leave a pane holding only them undivided", () => {
    const alone = dropGuests(startingArrangement(), [FORK], "p0", { side: "right" });
    expect(dropGuests(alone, [FORK], "p1", { side: "bottom" })).toBe(alone);
  });
});

describe("opening a guest in its own workspace", () => {
  it("offers the host and the other guests, never the guest itself", () => {
    const here = addGuests(startingArrangement(), [FORK, OTHER]);
    expect(companionsOf(HOST, here, FORK)).toEqual([HOST, OTHER]);
  });

  it("adds the threads kept to the destination's arrangement, beside its conversation", () => {
    const storage = memoryStorage();
    bringAlong(storage, FORK, [HOST, OTHER, FORK]);
    expect(panes(loadArrangement(storage, FORK))).toEqual([
      [CONVERSATION, guestKey(HOST), guestKey(OTHER)],
    ]);
    bringAlong(storage, FORK, [HOST]);
    expect(guestThreads(loadArrangement(storage, FORK))).toEqual([HOST, OTHER]);
  });
});

describe("where a guest works, as its tab says", () => {
  const host = { environmentId: "env-1", worktreePath: null, branch: "main" };

  it("says nothing when the guest shares the host's workspace", () => {
    expect(workspaceNote({ ...host, branch: "other" }, host, null)).toBeNull();
  });

  it("names the branch, or the worktree, on another worktree", () => {
    expect(
      workspaceNote(
        { environmentId: "env-1", worktreePath: "/w/fix-a", branch: "fix-a" },
        host,
        null,
      ),
    ).toBe("fix-a");
    expect(
      workspaceNote(
        { environmentId: "env-1", worktreePath: "/w/fix-b/", branch: null },
        host,
        null,
      ),
    ).toBe("fix-b");
  });

  it("adds the machine on another machine", () => {
    expect(workspaceNote({ ...host, environmentId: "env-2" }, host, "Studio")).toBe(
      "main · Studio",
    );
    expect(
      workspaceNote({ environmentId: "env-2", worktreePath: null, branch: null }, host, null),
    ).toBe("main checkout · another machine");
  });
});

describe("threads a pane offers as guests", () => {
  const thread = (key: string, updatedAt: string, extra: object = {}) => ({
    key,
    archivedAt: null,
    updatedAt,
    lineage: { relationshipToParent: null },
    ...extra,
  });

  it("lists the sidebar's threads, newest first, leaving out the present, archived and subagents", () => {
    const offered = guestCandidates(
      [
        thread("a", "2026-10-01"),
        thread("b", "2026-10-03"),
        thread("host", "2026-10-04"),
        thread("old", "2026-09-01", { archivedAt: "2026-09-02" }),
        thread("agent", "2026-10-05", { lineage: { relationshipToParent: "subagent" } }),
        thread("fork", "2026-10-02", { lineage: { relationshipToParent: "fork" } }),
      ],
      new Set(["host"]),
      2,
    );
    expect(offered.map((entry) => entry.key)).toEqual(["b", "fork"]);
  });
});
