import { describe, expect, it } from "vite-plus/test";

import { CHAT_TABS_STORAGE_KEY } from "~/chatTabs/chatTabsStore";
import { openTab, startingArrangement } from "./arrangement";
import { GROUP_PANEL_RUNS_STORAGE_KEY, openRunEntries } from "./groupPanelRuns";
import { arrangementStorageKey } from "./persistence";
import {
  lowestFreeNumber,
  numberTabGroups,
  parseTabGroupNumbers,
  releaseTabGroups,
  storedTabKeys,
} from "./tabGroupNumbers";

function memoryStorage(items: Record<string, string>) {
  const entries = Object.entries(items);
  return {
    length: entries.length,
    key: (index: number) => entries[index]?.[0] ?? null,
    getItem: (key: string) => items[key] ?? null,
  };
}

describe("numbering tab groups as strips show them", () => {
  it("gives each new group the lowest free number, in strip order", () => {
    const numbers = numberTabGroups({}, [
      { id: "a", keys: ["chat:a"] },
      { id: "b", keys: ["chat:b"] },
    ]);
    expect(numbers).toEqual({ a: { n: 1, keys: ["chat:a"] }, b: { n: 2, keys: ["chat:b"] } });
  });

  it("keeps a group's number wherever it shows again, learning its run's tabs", () => {
    const numbers = numberTabGroups({}, [{ id: "a", keys: ["chat:a"] }]);
    expect(numberTabGroups(numbers, [{ id: "a", keys: ["chat:a"] }])).toBe(numbers);
    expect(numberTabGroups(numbers, [{ id: "a", keys: ["wiki:a", "chat:a"] }])).toEqual({
      a: { n: 1, keys: ["chat:a", "wiki:a"] },
    });
  });

  it("reuses the lowest number a released group left", () => {
    const three = numberTabGroups({}, [
      { id: "a", keys: ["chat:a"] },
      { id: "b", keys: ["chat:b"] },
      { id: "c", keys: ["chat:c"] },
    ]);
    const released = releaseTabGroups(three, new Set(["chat:a", "chat:c"]));
    expect(lowestFreeNumber(released)).toBe(2);
    expect(numberTabGroups(released, [{ id: "d", keys: ["chat:d"] }]).d?.n).toBe(2);
    expect(numberTabGroups(released, [{ id: "b", keys: ["chat:b"] }]).b?.n).toBe(2);
  });
});

describe("releasing tab groups' numbers", () => {
  const numbers = numberTabGroups({}, [
    { id: "a", keys: ["chat:a", "wiki:a"] },
    { id: "b", keys: ["chat:b"] },
  ]);

  it("frees a group's number once none of its tabs is open, and forgets closed tabs", () => {
    expect(releaseTabGroups(numbers, new Set(["wiki:a"]))).toEqual({
      a: { n: 1, keys: ["wiki:a"] },
    });
  });

  it("changes nothing while every tab it knows is open", () => {
    expect(releaseTabGroups(numbers, new Set(["chat:a", "wiki:a", "chat:b", "x"]))).toBe(numbers);
  });

  it("finds open tabs in every pane arrangement kept on the device, and nowhere else", () => {
    const one = openTab(startingArrangement(), "chat:a");
    const two = openTab(startingArrangement(), "chat:b");
    const three = openTab(startingArrangement(), "wiki:a");
    const storage = memoryStorage({
      [arrangementStorageKey("env:thread")]: JSON.stringify(one),
      "astrolabe:wiki-panes:v1": JSON.stringify(two),
      "astrolabe:something-else": JSON.stringify(three),
      [arrangementStorageKey("broken")]: "{",
    });
    expect([...storedTabKeys(storage)].sort()).toEqual(["chat:a", "chat:b"]);
  });

  it("counts the chat tabs and the change groups' shared runs as open", () => {
    const runs = openRunEntries({}, "change-group:env:g1", [{ kind: "group" }]);
    const storage = memoryStorage({
      [CHAT_TABS_STORAGE_KEY]: JSON.stringify({ state: { keys: ["env:t1", 2] }, version: 1 }),
      [GROUP_PANEL_RUNS_STORAGE_KEY]: JSON.stringify({ state: { runs }, version: 1 }),
    });
    expect([...storedTabKeys(storage)].sort()).toEqual(["change-group:env:g1", "env:t1"]);
  });
});

describe("reading stored numbers", () => {
  it("keeps whole numbers from 1 held once, with tabs", () => {
    expect(
      parseTabGroupNumbers({
        a: { n: 1, keys: ["chat:a"] },
        b: { n: 1, keys: ["chat:b"] },
        c: { n: 0, keys: ["chat:c"] },
        d: { n: 2, keys: [] },
        e: { n: 3, keys: ["chat:e", 4] },
        f: "3",
      }),
    ).toEqual({ a: { n: 1, keys: ["chat:a"] }, e: { n: 3, keys: ["chat:e"] } });
    expect(parseTabGroupNumbers([1])).toEqual({});
  });
});
