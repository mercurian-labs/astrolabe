import { describe, expect, it } from "vite-plus/test";

import {
  buildMentionSearchTargets,
  formatMentionCandidate,
  formatMentionToken,
  mergeMentionCandidates,
  moveMentionHighlight,
} from "./planMentions.logic";

describe("buildMentionSearchTargets", () => {
  it("aims one search at each repository root in the set", () => {
    const targets = buildMentionSearchTargets([
      { repositoryId: "r1", name: "astrolabe", path: "/code/astrolabe" },
      { repositoryId: "r2", name: "almagest", path: "/notes/almagest" },
    ]);
    expect(targets).toEqual([
      { repositoryId: "r1", repositoryName: "astrolabe", cwd: "/code/astrolabe" },
      { repositoryId: "r2", repositoryName: "almagest", cwd: "/notes/almagest" },
    ]);
  });

  it("has nothing to aim at when the project has no repositories", () => {
    expect(buildMentionSearchTargets([])).toEqual([]);
  });
});

describe("mergeMentionCandidates", () => {
  it("leaves a single repository's entries unlabelled", () => {
    const merged = mergeMentionCandidates([
      { repositoryId: "r1", repositoryName: "astrolabe", entries: [{ path: "src/a.ts" }] },
    ]);
    expect(merged).toEqual([
      {
        kind: "file",
        path: "src/a.ts",
        label: "src/a.ts",
        repositoryName: null,
        key: "r1:src/a.ts",
      },
    ]);
  });

  it("interleaves a plural set and names where each entry came from", () => {
    const merged = mergeMentionCandidates([
      {
        repositoryId: "r1",
        repositoryName: "astrolabe",
        entries: [{ path: "a1.ts" }, { path: "a2.ts" }],
      },
      { repositoryId: "r2", repositoryName: "almagest", entries: [{ path: "b1.md" }] },
    ]);
    expect(merged.filter((one) => one.kind === "file").map((one) => one.path)).toEqual([
      "a1.ts",
      "b1.md",
      "a2.ts",
    ]);
    expect(merged.map((one) => one.repositoryName)).toEqual(["astrolabe", "almagest", "astrolabe"]);
  });

  it("merges and ranks note names with files using substring and subsequence matches", () => {
    const merged = mergeMentionCandidates(
      [{ repositoryId: "r1", repositoryName: "app", entries: [{ path: "src/composer.ts" }] }],
      { noteNames: ["Planning Space", "Composer", "Product"], query: "comp" },
    );
    expect(merged.map((candidate) => [candidate.kind, candidate.label])).toEqual([
      ["note", "Composer"],
      ["file", "src/composer.ts"],
    ]);

    const subsequence = mergeMentionCandidates([], {
      noteNames: ["Planning Space"],
      query: "plsp",
    });
    expect(subsequence.map((candidate) => candidate.label)).toEqual(["Planning Space"]);
  });

  it("stops where a menu stops being a menu", () => {
    const merged = mergeMentionCandidates(
      [
        {
          repositoryId: "r1",
          repositoryName: "astrolabe",
          entries: Array.from({ length: 50 }, (_, index) => ({ path: `f${index}.ts` })),
        },
      ],
      { limit: 5 },
    );
    expect(merged).toHaveLength(5);
  });
});

describe("formatMentionToken", () => {
  it("writes a bare token, and quotes one that would end early", () => {
    expect(formatMentionToken("src/app.ts")).toBe("@src/app.ts ");
    expect(formatMentionToken("src/my file.ts")).toBe('@"src/my file.ts" ');
    expect(formatMentionToken('odd"name.ts')).toBe('@"odd\\"name.ts" ');
  });

  it("writes note candidates as wikilinks", () => {
    expect(
      formatMentionCandidate({
        kind: "note",
        name: "Planning Space",
        label: "Planning Space",
        repositoryName: null,
        key: "note:planning space",
      }),
    ).toBe("[[Planning Space]] ");
  });
});

describe("moveMentionHighlight", () => {
  it("wraps in both directions, and answers an empty menu safely", () => {
    expect(moveMentionHighlight(0, 3, "down")).toBe(1);
    expect(moveMentionHighlight(2, 3, "down")).toBe(0);
    expect(moveMentionHighlight(0, 3, "up")).toBe(2);
    expect(moveMentionHighlight(0, 0, "down")).toBe(0);
  });
});
