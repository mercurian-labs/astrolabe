import { describe, expect, it } from "vite-plus/test";

import { openTab, startingArrangement } from "./arrangement";
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
      "astrolabe:workspace:v1": JSON.stringify(two),
      "astrolabe:something-else": JSON.stringify(three),
      [arrangementStorageKey("broken")]: "{",
    });
    expect([...storedTabKeys(storage)].sort()).toEqual(["chat:a", "chat:b"]);
  });

  it("counts the shared panes' tabs as open, those set aside included", () => {
    const storage = memoryStorage({
      "astrolabe:workspace:v1": JSON.stringify({
        ...openTab(startingArrangement(), "chat:a"),
        owners: { "change-group:env:g1": "change-group:env:g1" },
        parked: { "change-group:env:g1": { pane: "p0", index: 1, active: false } },
      }),
    });
    expect([...storedTabKeys(storage)].sort()).toEqual(["change-group:env:g1", "chat:a"]);
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
