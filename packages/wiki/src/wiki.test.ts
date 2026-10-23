import { describe, expect, it } from "vite-plus/test";

import {
  amendmentMessage,
  indexFiles,
  keepWarningHistory,
  links,
  parseAmendmentTrailers,
  parseMap,
  planAmendment,
  planTransform,
  renameLinks,
  serializeMap,
  support,
  unresolved,
  walk,
  type SkillMap,
  type WikiChanges,
  type WikiFiles,
} from "./index.ts";

const product = (
  edges: SkillMap["edges"] = [{ from: "A", type: "relates", to: "B", rationale: "A discusses B." }],
): SkillMap => ({
  version: 1,
  name: "Product",
  purpose: "Orient",
  types: { relates: "The concepts are related." },
  edges,
  body: "Read [[A]] first.",
});

let counter = 0;
const stamp = () => ({
  amendment: `am-${++counter}`,
  at: "2026-10-16T00:00:00.000Z",
  newId: () => `w-${++counter}`,
});
const base = (): WikiFiles => ({
  "A.md": "# A\n[[B]] and [[Missing]]\n",
  "B.md": "# B\n",
  "Product.skillmap.md": serializeMap(product()),
});
const apply = (files: WikiFiles, changes: WikiChanges): WikiFiles => {
  const next: Record<string, string> = { ...files };
  for (const [file, content] of Object.entries(changes)) {
    if (content === null) delete next[file];
    else next[file] = content;
  }
  return next;
};

describe("links", () => {
  it("finds real links and renames them, keeping anchors, aliases and examples", () => {
    const source =
      "[[A#Part|Label]] [[A.md]] [[Missing]] \\[[A]]\n`[[A]]`\n``[[A]]``\n~~~md\n[[A]]\n~~~\n```\n[[A]]\n```\n<!-- [[A]] -->\n";
    expect(links(source).map((link) => link.target)).toEqual(["A", "A", "Missing"]);
    const renamed = renameLinks(source, "a", "New");
    expect(renamed.startsWith("[[New#Part|Label]] [[New.md]]")).toBe(true);
    expect(renamed).toContain("`[[A]]`");
    expect(renamed).toContain("\\[[A]]");
  });
});

describe("the index", () => {
  it("allows cycles and red links, and the walk terminates", () => {
    const map = product([
      { from: "A", type: "relates", to: "B", rationale: "Linked" },
      { from: "B", type: "relates", to: "A", rationale: "Other direction" },
      { from: "A", type: "relates", to: "Missing", rationale: "Frontier" },
    ]);
    const index = indexFiles({
      "A.md": "[[B]] [[Missing]]",
      "B.md": "B",
      "Product.skillmap.md": serializeMap(map),
    });
    expect(index.errors).toEqual([]);
    expect(unresolved(index)[0]?.name).toBe("Missing");
    expect(walk(map, index)).toMatch(/already shown/);
    expect(walk(map, index)).toMatch(/Missing \(unwritten\)/);
    expect(support(index, map.edges[0]!)[0]?.prose).toBe("[[B]] [[Missing]]");
    expect(parseMap(serializeMap(map))).toEqual(map);
  });

  it("refuses malformed maps and reports edges with no prose link", () => {
    expect(() => parseMap("---\nversion: 1\nversion: 1\n---")).toThrow();
    expect(() => serializeMap({ ...product(), version: 2 } as unknown as SkillMap)).toThrow(
      /version/,
    );
    expect(() =>
      serializeMap(product([{ from: "A", type: "other", to: "B", rationale: "x" }])),
    ).toThrow(/Undeclared/);
    expect(
      indexFiles({ "A.md": "```\n[[B]]\n```", "Product.skillmap.md": serializeMap(product()) })
        .errors,
    ).toHaveLength(1);
  });

  it("ignores operational files and nested folders", () => {
    const index = indexFiles({ "AGENTS.md": "[[A]]", "research/Strategy.md": "x", "A.md": "a" });
    expect([...index.notes.keys()]).toEqual(["a"]);
  });
});

describe("amendments", () => {
  it("stamps a warning into the map when a change severs an edge, and keeps it through resolution", () => {
    const files = base();
    const first = stamp();
    const severed = planAmendment(files, { "A.md": "# A\nNo relationship.\n" }, first);
    const after = apply(files, severed.changes);
    const warning = indexFiles(after).maps.get("Product.skillmap.md")?.warnings?.[0];
    expect(warning?.amendment).toBe(first.amendment);
    expect(severed.errors).toHaveLength(1);

    expect(() =>
      planTransform(
        after,
        { kind: "resolve-warning", map: "Product", id: warning!.id, text: "Handled" },
        stamp(),
      ),
    ).toThrow(/Repair/);

    const repaired = apply(
      after,
      planAmendment(after, { "A.md": "# A\n[[B]] restored.\n" }, stamp()).changes,
    );
    const resolveStamp = stamp();
    const resolved = apply(
      repaired,
      planAmendment(
        repaired,
        planTransform(
          repaired,
          { kind: "resolve-warning", map: "Product", id: warning!.id, text: "Restored." },
          resolveStamp,
        ),
        resolveStamp,
      ).changes,
    );
    const record = indexFiles(resolved).maps.get("Product.skillmap.md")?.warnings?.[0];
    expect(record?.id).toBe(warning!.id);
    expect(record?.resolution?.text).toBe("Restored.");
  });

  it("refuses to erase warning history", () => {
    const files = base();
    const after = apply(
      files,
      planAmendment(files, { "A.md": "# A\nNo relationship.\n" }, stamp()).changes,
    );
    expect(() =>
      planAmendment(after, { "Product.skillmap.md": serializeMap(product()) }, stamp()),
    ).toThrow(/warning history/);
  });

  it("refuses a new edge without prose support, and fill lands a note with its placement", () => {
    const files = base();
    const invented = { from: "A", type: "relates", to: "Invented", rationale: "Not linked" };
    const addStamp = stamp();
    expect(() =>
      planAmendment(
        files,
        planTransform(files, { kind: "edge-add", map: "Product", edge: invented }, addStamp),
        addStamp,
      ),
    ).toThrow(/prose/);

    const fillStamp = stamp();
    const fill = planTransform(
      files,
      {
        kind: "fill",
        map: "Product",
        name: "Missing",
        content: "# Missing\nWritten now.\n",
        edge: {
          from: "A",
          type: "relates",
          to: "Missing",
          rationale: "A references this frontier.",
        },
      },
      fillStamp,
    );
    const filled = apply(files, planAmendment(files, fill, fillStamp).changes);
    expect(indexFiles(filled).notes.has("missing")).toBe(true);
    expect(indexFiles(filled).errors).toEqual([]);
  });

  it("renames a note, every link to it, and every map edge in one change set", () => {
    const files = base();
    const renameStamp = stamp();
    const changes = planTransform(files, { kind: "rename", from: "B", to: "Bee" }, renameStamp);
    const renamed = apply(files, planAmendment(files, changes, renameStamp).changes);
    expect(renamed["B.md"]).toBeUndefined();
    expect(renamed["A.md"]).toContain("[[Bee]]");
    expect(indexFiles(renamed).maps.get("Product.skillmap.md")?.edges[0]?.to).toBe("Bee");
    expect(indexFiles(renamed).errors).toEqual([]);
  });

  it("refuses paths outside the flat wiki", () => {
    expect(() => planAmendment(base(), { "../x.md": "x" }, stamp())).toThrow(/flat/);
    expect(() => planAmendment(base(), { "notes/x.md": "x" }, stamp())).toThrow(/flat/);
  });

  it("restores warning history that a revert's inverse would drop", () => {
    const files = base();
    const severed = apply(
      files,
      planAmendment(files, { "A.md": "# A\nNo relationship.\n" }, stamp()).changes,
    );
    const inverse = keepWarningHistory(severed, { "Product.skillmap.md": serializeMap(product()) });
    const kept = indexFiles(apply(severed, inverse)).maps.get("Product.skillmap.md");
    expect(kept?.warnings).toHaveLength(1);
  });
});

describe("trailers", () => {
  it("round-trips an amendment's identity and reads memory-tools' older trailers", () => {
    const body = amendmentMessage("docs: x", {
      amendment: "a1",
      actor: "Claude Code",
      changeRequest: "cr1",
      thread: "t1",
    });
    expect(parseAmendmentTrailers(body)).toEqual({
      amendment: "a1",
      actor: "Claude Code",
      changeRequest: "cr1",
      thread: "t1",
    });
    expect(parseAmendmentTrailers("docs\n\nMemory-Amendment: m1\nMemory-Actor: Codex\n")).toEqual({
      amendment: "m1",
      actor: "Codex",
    });
  });
});
