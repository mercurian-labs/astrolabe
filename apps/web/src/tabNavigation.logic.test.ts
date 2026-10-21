import { describe, expect, it } from "vite-plus/test";

import {
  keepHistories,
  parseHistories,
  rekeyHistory,
  replaceInHistory,
  rowClickIntent,
  stepHistory,
  TAB_HISTORY_LIMIT,
  type TabHistories,
} from "./tabNavigation.logic";

/** Replaces through `keys` in one tab, from the first; the histories after. */
function walk(keys: readonly string[]): TabHistories {
  let histories: TabHistories = {};
  for (let at = 1; at < keys.length; at++) {
    histories = replaceInHistory(histories, keys[at - 1]!, keys[at]!);
  }
  return histories;
}

describe("a tab's history", () => {
  it("pushes what a replace leaves behind, and steps back and forward through it", () => {
    const histories = walk(["a", "b", "c"]);
    expect(histories).toEqual({ c: { back: ["a", "b"], forward: [] } });
    const back = stepHistory(histories, "c", "back")!;
    expect(back.target).toBe("b");
    expect(back.histories).toEqual({ b: { back: ["a"], forward: ["c"] } });
    const forward = stepHistory(back.histories, "b", "forward")!;
    expect(forward).toEqual({ histories: { c: { back: ["a", "b"], forward: [] } }, target: "c" });
    expect(stepHistory(histories, "c", "forward")).toBeNull();
    expect(stepHistory({}, "a", "back")).toBeNull();
  });

  it("clears the way forward when a replace shows something new", () => {
    const back = stepHistory(walk(["a", "b", "c"]), "c", "back")!;
    expect(replaceInHistory(back.histories, "b", "d")).toEqual({
      d: { back: ["a", "b"], forward: [] },
    });
  });

  it("keeps the last entries only", () => {
    const keys = Array.from({ length: TAB_HISTORY_LIMIT + 10 }, (_, index) => `k${index}`);
    const histories = walk(keys);
    const last = keys.at(-1)!;
    expect(histories[last]?.back).toHaveLength(TAB_HISTORY_LIMIT);
    expect(histories[last]?.back[0]).toBe(`k${keys.length - 1 - TAB_HISTORY_LIMIT}`);
  });

  it("follows a tab to a new key, and is forgotten when its tab closes", () => {
    const histories = walk(["a", "b"]);
    expect(rekeyHistory(histories, "b", "b2")).toEqual({ b2: { back: ["a"], forward: [] } });
    expect(keepHistories(histories, ["x"])).toEqual({});
    expect(keepHistories(histories, ["b"])).toBe(histories);
  });

  it("reads stored histories as far as they are well formed", () => {
    expect(parseHistories(null)).toEqual({});
    expect(parseHistories({ a: { back: ["x", 3], forward: "no" }, b: 1 })).toEqual({
      a: { back: ["x"], forward: [] },
    });
  });
});

describe("what a click on a sidebar row asks for", () => {
  const click = (overrides: Partial<Parameters<typeof rowClickIntent>[0]> = {}) => ({
    button: 0,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...overrides,
  });

  it("is a new tab for Option-click and the middle button, else the row's own modified clicks", () => {
    expect(rowClickIntent(click(), true)).toBe("replace");
    expect(rowClickIntent(click({ altKey: true }), true)).toBe("new-tab");
    expect(rowClickIntent(click({ button: 1 }), false)).toBe("new-tab");
    // Option wins over Mod: Option-Cmd-click is still a new tab.
    expect(rowClickIntent(click({ altKey: true, metaKey: true }), true)).toBe("new-tab");
    expect(rowClickIntent(click({ metaKey: true }), true)).toBe("mod");
    expect(rowClickIntent(click({ ctrlKey: true }), false)).toBe("mod");
    // Ctrl on a Mac is not Mod.
    expect(rowClickIntent(click({ ctrlKey: true }), true)).toBe("replace");
    expect(rowClickIntent(click({ shiftKey: true }), true)).toBe("range");
  });
});
