import { describe, expect, it } from "vite-plus/test";

import { rankCompletions } from "./ranking.ts";

const item = (label: string, extra: { sortText?: string; kind?: number } = {}) => ({
  label,
  filterText: label,
  ...extra,
});
const labels = (items: ReturnType<typeof item>[], query: string) =>
  rankCompletions(items, query).map((ranked) => ranked.item.label);

describe("rankCompletions", () => {
  it("puts a variable before a constant that matches as well", () => {
    expect(labels([item("COUNT_MAX", { kind: 21 }), item("count", { kind: 6 })], "cou")).toEqual([
      "count",
      "COUNT_MAX",
    ]);
  });

  it("orders equal matches by the server's sort text", () => {
    expect(
      labels([item("beta", { sortText: "b" }), item("bets", { sortText: "a" })], "bet"),
    ).toEqual(["bets", "beta"]);
  });

  it("puts an exact match first, whatever the sort text says", () => {
    expect(
      labels([item("flatMap", { sortText: "a" }), item("map", { sortText: "z" })], "map"),
    ).toEqual(["map", "flatMap"]);
  });

  it("keeps a match at the start of an inner word in the first tier", () => {
    expect(labels([item("summary"), item("ripMap")], "m")).toEqual(["ripMap", "summary"]);
  });

  it("leaves out items the query does not match in order", () => {
    expect(labels([item("value"), item("other")], "vl")).toEqual(["value"]);
    expect(rankCompletions([item("getUser")], "gu")[0]!.matched).toEqual([0, 3]);
  });

  it("keeps the server's order for an empty query", () => {
    expect(
      labels(
        [item("b", { sortText: "2" }), item("a", { sortText: "3" }), item("c", { sortText: "1" })],
        "",
      ),
    ).toEqual(["c", "b", "a"]);
  });
});
