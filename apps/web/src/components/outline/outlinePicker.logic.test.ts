import type { OutlineItem } from "@mercurian/editor/outline";
import { describe, expect, it } from "vite-plus/test";

import { outlinePickerRows } from "./outlinePicker.logic";

/** An outline from `depth name` lines, two spaces per depth. */
function outlineOf(...lines: string[]): OutlineItem[] {
  return lines.map((line, index) => {
    const name = line.trimStart();
    return {
      kind: "function",
      name,
      from: index,
      to: index + 1,
      nameFrom: index,
      depth: (line.length - name.length) / 2,
    };
  });
}

const items = outlineOf(
  "Server",
  "  start",
  "  stop",
  "  dropConnections",
  "Client",
  "  start",
  "restart",
);

const found = (query: string) =>
  outlinePickerRows(items, query).map((row) => [...row.ancestors, row.item.name].join(" › "));

describe("the outline picker's rows", () => {
  it("lists every item in source order, with its enclosing names, for no query", () => {
    expect(found("  ")).toEqual([
      "Server",
      "Server › start",
      "Server › stop",
      "Server › dropConnections",
      "Client",
      "Client › start",
      "restart",
    ]);
  });

  it("matches one word against the item's own name only, best first", () => {
    // `Server` holds `drop`'s letters, but a parent never makes its children match.
    expect(found("drop")).toEqual(["Server › dropConnections"]);
    expect(found("start")).toEqual(["Server › start", "Client › start", "restart"]);
    expect(outlinePickerRows(items, "dc")[0]?.matchIndices).toEqual([0, 4]);
  });

  it("matches earlier words against the enclosing items, in order", () => {
    expect(found("client start")).toEqual(["Client › start"]);
    // The closer match first: `st` is more of `stop` than of `start`.
    expect(found("srv st")).toEqual(["Server › stop", "Server › start"]);
    expect(found("start server")).toEqual([]);
  });
});
