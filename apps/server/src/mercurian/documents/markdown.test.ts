import { describe, expect, it } from "vite-plus/test";
import {
  importedSpecMarkdown,
  readDocumentMarkdown,
  replaceSpecBody,
  readSpecBody,
  refreshSpecMarkdown,
  specRevision,
} from "./markdown.ts";

describe("project document Markdown", () => {
  it("reads plain Markdown without manufacturing a counterpart", () => {
    expect(readDocumentMarkdown("# Search design\n\nBody", "search.md")).toEqual({
      title: "Search design",
      body: "# Search design\n\nBody",
      metadata: null,
      problem: null,
    });
  });
  it("keeps explicit identities and links portable", () => {
    const value = readDocumentMarkdown(
      "---\nid: search-plan\ncounterparts: [search-spec]\n---\n# Search\n",
      "search.md",
    );
    expect(value.metadata).toEqual({ id: "search-plan", counterparts: ["search-spec"] });
    expect(value.title).toBe("Search");
  });
  it("renders malformed metadata as a problem without losing the body", () => {
    const value = readDocumentMarkdown("---\nid: [invalid]\n---\n# Search\n", "search.md");
    expect(value.metadata).toBeNull();
    expect(value.body).toBe("# Search\n");
    expect(value.problem).not.toBeNull();
  });
  it("writes escaped origin metadata and preserves custom fields on refresh", () => {
    const markdown = importedSpecMarkdown({
      id: "spec-1",
      url: "https://example.com/issue/1",
      goal: "Search",
      acceptanceCriteria: "Fast",
    });
    expect(readDocumentMarkdown(markdown, "search.md").metadata?.origin?.url).toBe(
      "https://example.com/issue/1",
    );
    const local = markdown.replace("kind: spec", "kind: spec\ncustom: keep-me");
    expect(replaceSpecBody(local, "New goal", "New AC")).toContain("custom: keep-me");
  });
});

it("refreshes only the imported sections and records the upstream baseline after a local resolution", () => {
  const initial = importedSpecMarkdown({
    id: "spec",
    url: "https://example.com/1",
    goal: "Old",
    acceptanceCriteria: "Old criteria",
  });
  const local =
    initial.replace("kind: spec", "kind: spec\ncustom: keep") + "\n# Notes\n\nKeep my notes.\n";
  const revision = specRevision("Upstream", "New criteria");
  const updated = refreshSpecMarkdown(local, "Reviewed goal", "Reviewed criteria", revision);
  expect(readSpecBody(updated)).toEqual({
    goal: "Reviewed goal",
    acceptanceCriteria: "Reviewed criteria",
  });
  expect(updated).toContain("# Notes\n\nKeep my notes.");
  expect(updated).toContain("custom: keep");
  expect(readDocumentMarkdown(updated, "spec.md").metadata?.origin?.revision).toBe(revision);
});
