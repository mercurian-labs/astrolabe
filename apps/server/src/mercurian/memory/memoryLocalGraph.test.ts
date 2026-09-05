import { describe, expect, it } from "@effect/vitest";
import {
  classifyMemoryDocument,
  memoryLocalGraph,
  type LocalGraphDocument,
} from "./memoryLocalGraph.ts";
const note = (
  id: string,
  before: string | null,
  after: string | null,
  name = id,
): LocalGraphDocument => ({
  id,
  name,
  kind: "note",
  before: before === null ? null : { name: id, markdown: before },
  after: after === null ? null : { name, markdown: after },
});
describe("memoryLocalGraph", () => {
  it("retains isolates, cycles and only prose edges between included endpoints", () => {
    const graph = memoryLocalGraph([
      note("A", "", "[[B]] [[Outside]]\n```md\n[[C]]\n```"),
      note("B", "", "[[A]]"),
      note("C", null, "isolated"),
    ]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(graph.edges).toEqual([
      { from: "A", to: "B", status: "added" },
      { from: "B", to: "A", status: "added" },
    ]);
    expect(graph.outsideReferences).toEqual([{ from: "A", name: "Outside", side: "selected" }]);
  });
  it("compares rename identities and preserves deleted relationships", () => {
    const graph = memoryLocalGraph([
      note("Old", "[[Gone]]", "[[New]]", "New"),
      note("Gone", "[[Old]]", null),
    ]);
    expect(graph.edges).toEqual([
      { from: "Gone", to: "Old", status: "removed" },
      { from: "Old", to: "Gone", status: "removed" },
      { from: "Old", to: "Old", status: "added" },
    ]);
  });
  it("keeps restored and add-delete isolates; maps never become nodes", () => {
    expect(
      memoryLocalGraph([
        note("Restored", "same", "same"),
        note("Transient", null, null),
        { ...note("Map", "[[Restored]]", "[[Restored]]"), kind: "skill-map" },
      ]).nodes,
    ).toEqual([
      { id: "Restored", name: "Restored" },
      { id: "Transient", name: "Transient" },
    ]);
  });
  it("excludes code spans, unchanged endpoints and ambiguous names", () => {
    const graph = memoryLocalGraph([
      note("A", "[[Unchanged]]", "`[[B]]` [[Duplicate]]"),
      note("B", "", ""),
      note("D1", null, "", "Duplicate"),
      note("D2", null, "", "Duplicate"),
    ]);
    expect(graph.edges).toEqual([]);
    expect(graph.outsideReferences.map((r) => r.name)).toEqual(["Unchanged", "Duplicate"]);
  });
  it("classifies exact configured locations without guessing directories", () => {
    expect(classifyMemoryDocument("memory/plans/Real.md", "memory")).toBe("note");
    expect(
      classifyMemoryDocument("memory/plans/Real.md", "memory", new Set(["memory/plans/Real.md"])),
    ).toBe("document");
    expect(
      classifyMemoryDocument("elsewhere/Spec.md", "memory", new Set(["elsewhere/Spec.md"])),
    ).toBe("document");
    expect(classifyMemoryDocument("memory/Broken.skillmap.md", "memory")).toBe("skill-map");
    expect(classifyMemoryDocument("outside.md", "memory")).toBeNull();
  });
});
