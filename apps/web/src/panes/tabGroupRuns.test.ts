import { describe, expect, it } from "vite-plus/test";

import { tabGroupRuns } from "./tabGroupRuns";

/** Each tab's groups, by the letters of its key past the colon: `t:ab` is in groups a and b. */
const groupsOf = (key: string) => [...(key.split(":")[1] ?? "")];
const runs = (keys: string[]) =>
  tabGroupRuns(keys, groupsOf, (group) => group).map(({ group, keys: run }) => [group, run]);

describe("a strip's tabs in runs", () => {
  it("puts neighbouring tabs of one group together, and a tab in none on its own", () => {
    expect(runs(["1:a", "2:a", "3:", "4:", "5:a"])).toEqual([
      ["a", ["1:a", "2:a"]],
      [null, ["3:"]],
      [null, ["4:"]],
      ["a", ["5:a"]],
    ]);
  });

  it("joins a tab in several groups to the run before it when it shares that run's group", () => {
    expect(runs(["1:b", "2:ab", "3:a"])).toEqual([
      ["b", ["1:b", "2:ab"]],
      ["a", ["3:a"]],
    ]);
  });

  it("starts a tab in several groups on the group it shares with the tab after it", () => {
    expect(runs(["1:", "2:ab", "3:b"])).toEqual([
      [null, ["1:"]],
      ["b", ["2:ab", "3:b"]],
    ]);
    expect(runs(["1:ab"])).toEqual([["a", ["1:ab"]]]);
  });
});
