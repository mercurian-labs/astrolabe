import { describe, expect, it } from "vite-plus/test";

import { indexMemory } from "./memory.ts";
import { applyFilters, NO_FILTERS } from "./search.ts";

const state = indexMemory(
  [
    { id: "Atlas Graph", name: "Atlas Graph", frontier: false },
    { id: "Atlas Editor", name: "Atlas Editor", frontier: false },
    { id: "Memory", name: "Memory", frontier: false },
    { id: "Threads", name: "Threads", frontier: false },
    { id: "Depth", name: "Depth", frontier: true },
    { id: "Alone", name: "Alone", frontier: false },
  ],
  [
    { from: "Atlas Graph", to: "Memory" },
    { from: "Memory", to: "Threads" },
    { from: "Atlas Graph", to: "Depth" },
  ],
);
const everything = new Set(state.byId.keys());

describe("applyFilters", () => {
  it("narrows a search to matching names and their neighbors", () => {
    const shown = applyFilters(state, everything, { ...NO_FILTERS, search: " graph " });
    expect([...shown].toSorted()).toEqual(["Atlas Graph", "Depth", "Memory"]);
  });

  it("only offers what the reading offers", () => {
    const shown = applyFilters(state, new Set(["Atlas Graph", "Threads"]), {
      ...NO_FILTERS,
      search: "graph",
    });
    expect([...shown]).toEqual(["Atlas Graph"]);
  });

  it("hides frontier notes and orphans, even beside a match", () => {
    const shown = applyFilters(state, everything, {
      search: "atlas",
      hideFrontier: true,
      hideOrphans: true,
    });
    // Atlas Editor matches but links nowhere: an orphan, hidden.
    expect([...shown].toSorted()).toEqual(["Atlas Graph", "Memory"]);
    expect(applyFilters(state, everything, { ...NO_FILTERS, hideOrphans: true }).has("Alone")).toBe(
      false,
    );
  });

  it("restores everything when the filters clear", () => {
    expect(applyFilters(state, everything, NO_FILTERS).size).toBe(everything.size);
  });
});
