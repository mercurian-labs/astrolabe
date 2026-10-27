import { describe, expect, it } from "vite-plus/test";

import {
  arriveAt,
  isChatTabGone,
  moveKey,
  neighbourOf,
  openNewTab,
  openTabsAt,
  openTabsBesideFront,
  stepTab,
  type ChatTabsLayout,
} from "./chatTabsStore";

describe("reordering chat tabs", () => {
  it("moves a tab to the insertion line, counted before the move", () => {
    expect(moveKey(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
    expect(moveKey(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveKey(["a", "b", "c"], "a", 2)).toEqual(["b", "a", "c"]);
  });

  it("leaves the strip as it is for a drop where the tab already stands, or an unknown tab", () => {
    const keys = ["a", "b", "c"];
    expect(moveKey(keys, "b", 1)).toBe(keys);
    expect(moveKey(keys, "b", 2)).toBe(keys);
    expect(moveKey(keys, "z", 0)).toBe(keys);
  });
});

describe("threads dropped on the strip from the sidebar", () => {
  const layout: ChatTabsLayout = { keys: ["a", "b", "c"], active: "b", histories: {} };

  it("open side by side at the insertion line, in the order given", () => {
    expect(openTabsAt(layout, ["x", "y"], 1).keys).toEqual(["a", "x", "y", "b", "c"]);
    expect(openTabsAt(layout, ["x"], 3).keys).toEqual(["a", "b", "c", "x"]);
  });

  it("move a thread open already to the line, counted before the move", () => {
    expect(openTabsAt(layout, ["c", "x"], 0).keys).toEqual(["c", "x", "a", "b"]);
    expect(openTabsAt(layout, ["a"], 3).keys).toEqual(["b", "c", "a"]);
    expect(openTabsAt(layout, [], 1)).toBe(layout);
  });
});

describe("the chat shown when the one in front closes", () => {
  it("is the tab after it, else the one before it, else none", () => {
    expect(neighbourOf(["a", "b", "c"], "b")).toBe("c");
    expect(neighbourOf(["a", "b", "c"], "c")).toBe("b");
    expect(neighbourOf(["a"], "a")).toBeNull();
    expect(neighbourOf(["a"], "z")).toBeNull();
  });
});

const layout = (keys: string[], active: string | null): ChatTabsLayout => ({
  keys,
  active,
  histories: {},
});

describe("showing a chat", () => {
  it("replaces the tab in front, which remembers what it showed", () => {
    const shown = arriveAt(layout(["a", "b"], "a"), "c");
    expect(shown.keys).toEqual(["c", "b"]);
    expect(shown.active).toBe("c");
    expect(shown.histories).toEqual({ c: { back: ["a"], forward: [] } });
  });

  it("brings forward the tab already showing it, rather than showing it twice", () => {
    const start = layout(["a", "b"], "a");
    expect(arriveAt(start, "b")).toEqual({ ...start, active: "b" });
    expect(arriveAt({ ...start, active: "a" }, "a")).toEqual(start);
  });

  it("opens the first tab, or one after a tab in front that closed", () => {
    expect(arriveAt(layout([], null), "a")).toEqual(layout(["a"], "a"));
    expect(arriveAt(layout(["b"], "gone"), "a")).toEqual(layout(["b", "a"], "a"));
  });

  it("opens a new tab after the one in front when asked, once", () => {
    expect(openNewTab(layout(["a", "b"], "a"), "c").keys).toEqual(["a", "c", "b"]);
    const start = layout(["a", "b"], "a");
    expect(openNewTab(start, "b")).toBe(start);
    // The route then shows it, and its tab comes to the front unreplaced.
    expect(arriveAt(openNewTab(start, "c"), "c")).toEqual(layout(["a", "c", "b"], "c"));
  });
});

describe("stepping the tab in front", () => {
  const walked = () => arriveAt(arriveAt(layout(["a", "x"], "a"), "b"), "c");

  it("walks back and forward through what it showed", () => {
    const back = stepTab(walked(), "back");
    expect(back.target).toBe("b");
    expect(back.layout.keys).toEqual(["b", "x"]);
    expect(back.layout.active).toBe("b");
    const forward = stepTab(back.layout, "forward");
    expect(forward.target).toBe("c");
    expect(forward.layout).toEqual(walked());
    expect(stepTab(walked(), "forward").target).toBeNull();
  });

  it("clears the way forward once it shows something new", () => {
    const back = stepTab(walked(), "back").layout;
    expect(stepTab(arriveAt(back, "d"), "forward").target).toBeNull();
  });

  it("goes to the tab already showing what is back there, leaving its own as it is", () => {
    const start = arriveAt(layout(["a", "x"], "a"), "b");
    expect(stepTab(start, "back").layout.keys).toEqual(["a", "x"]);
    // With a open in another tab, the step is a trip to that tab.
    const shared = { ...start, keys: ["b", "a"] };
    expect(stepTab(shared, "back")).toEqual({ layout: shared, target: "a" });
  });

  it("passes over a chat that is gone, and forgets it", () => {
    const stepped = stepTab(walked(), "back", (key) => key !== "b");
    expect(stepped.target).toBe("a");
    expect(stepped.layout.histories).toEqual({ a: { back: [], forward: ["c"] } });
    const none = stepTab(walked(), "back", () => false);
    expect(none.target).toBeNull();
    expect(none.layout.histories).toEqual({ c: { back: [], forward: [] } });
  });
});

describe("a change group's threads opening beside the chat in front", () => {
  it("open together right after the tab in front, which stays in front", () => {
    const layout: ChatTabsLayout = { keys: ["a", "b", "c"], active: "b", histories: {} };
    expect(openTabsBesideFront(layout, ["x", "c", "y"])).toEqual({
      ...layout,
      keys: ["a", "b", "x", "c", "y"],
    });
  });

  it("gather around the tab in front when it is one of them", () => {
    const layout: ChatTabsLayout = { keys: ["a", "b", "c", "d"], active: "b", histories: {} };
    expect(openTabsBesideFront(layout, ["b", "d"]).keys).toEqual(["a", "b", "d", "c"]);
  });

  it("open at the end with no tab in front", () => {
    const layout: ChatTabsLayout = { keys: ["a"], active: null, histories: {} };
    expect(openTabsBesideFront(layout, ["x"]).keys).toEqual(["a", "x"]);
  });
});

describe("a tab whose thread the shell does not list", () => {
  const missing = { live: true, shell: null, hasDraft: false } as const;

  it("stays open until its thread family read settles, as cold connect omits older threads", () => {
    expect(isChatTabGone({ ...missing, familyRead: "pending" })).toBe(false);
    expect(isChatTabGone({ ...missing, familyRead: "failed" })).toBe(false);
  });

  it("closes once a settled family read leaves it out too", () => {
    expect(isChatTabGone({ ...missing, familyRead: "settled" })).toBe(true);
  });

  it("closes at once for a thread the shell lists as deleted, and never while not live", () => {
    const deleted = { deletedAt: "2026-10-27T00:00:00.000Z" };
    expect(isChatTabGone({ ...missing, shell: deleted, familyRead: "pending" })).toBe(true);
    expect(isChatTabGone({ ...missing, live: false, familyRead: "settled" })).toBe(false);
    expect(isChatTabGone({ ...missing, hasDraft: true, familyRead: "settled" })).toBe(false);
  });
});
