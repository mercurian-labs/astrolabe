import { describe, expect, it } from "vite-plus/test";

import {
  keptFilterKeys,
  parseFilterPicks,
  toggleFilterAll,
  toggleFilterPick,
  type FilterPicks,
} from "./filterPicks";

const keys = ["a", "b", "c"];
const pick = (picks: FilterPicks, key: string) => toggleFilterPick(picks, key, keys);

describe("a filter's picks", () => {
  it("unticks every key from the All box, and ticks them all back", () => {
    const none = toggleFilterAll([], keys);
    expect(none).toBeNull();
    expect(keptFilterKeys(none, keys)).toEqual(new Set());
    expect(toggleFilterAll(none, keys)).toEqual([]);
    expect(keptFilterKeys([], keys)).toBeNull();
  });

  it("ticks every key from the All box while only some are picked", () => {
    expect(toggleFilterAll(["a"], keys)).toEqual([]);
  });

  it("starts from none when a key is ticked after unticking All", () => {
    expect(keptFilterKeys(pick(null, "b"), keys)).toEqual(new Set(["b"]));
  });

  it("keeps the rest when one key is unticked under All", () => {
    expect(pick([], "b")).toEqual(["a", "c"]);
  });

  it("reads unticking the last key as none, and ticking every key as All", () => {
    expect(pick(["a"], "a")).toBeNull();
    expect(pick(["a", "c"], "b")).toEqual([]);
  });

  it("reads picks whose keys are gone as every key", () => {
    expect(keptFilterKeys(["gone"], keys)).toBeNull();
    expect(keptFilterKeys(["gone", "b"], keys)).toEqual(new Set(["b"]));
  });

  it("reads none back from storage, and anything else it cannot read as every key", () => {
    expect(parseFilterPicks(JSON.parse(JSON.stringify(null)))).toBeNull();
    expect(parseFilterPicks(["a", 3])).toEqual(["a"]);
    expect(parseFilterPicks(undefined)).toEqual([]);
  });
});
