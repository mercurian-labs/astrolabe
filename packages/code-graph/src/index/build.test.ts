import { afterAll, describe, expect, it } from "vite-plus/test";

import type { CodeEdge } from "../model/code.ts";
import { tempRepo, TWO_COMMITS } from "../testing/gitRepo.ts";
import { advance, buildIndex, DEFAULT_MAX_BYTES, type IndexOptions } from "./build.ts";

const OPTIONS: IndexOptions = { paths: [], maxBytes: DEFAULT_MAX_BYTES };
const edgeText = (edge: CodeEdge) => `${edge.from} ${edge.kind} ${edge.to} (${edge.resolution})`;
const A = (rest: string) => `src/a.ts#${rest}`;
const B = (rest: string) => `src/b.ts#${rest}`;

describe("advance", () => {
  const repo = tempRepo();
  const first = repo.commit(TWO_COMMITS.first, "first");
  const second = repo.commit(TWO_COMMITS.second, "second");
  afterAll(() => repo.remove());

  it("reports exactly the symbols and edges that changed, parsing only the changed file", async () => {
    const state = await buildIndex(repo.dir, first, OPTIONS);
    expect(state.stats.parsed.toSorted()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    state.stats.parsed.length = 0;

    const delta = await advance(state, second);

    expect(state.stats.parsed).toEqual(["src/a.ts"]);
    expect(delta.changedPaths).toEqual(["src/a.ts"]);
    expect(delta.added.map((symbol) => symbol.id)).toEqual([A("function:later")]);
    expect(delta.removed.map((symbol) => symbol.id)).toEqual([A("function:drop")]);
    expect(delta.modified.map(({ after }) => after.id)).toEqual([A("function:change")]);
    expect(delta.addedEdges.map(edgeText).toSorted()).toEqual([
      `${A("file:a.ts")} exports ${A("function:later")} (exact)`,
      `${A("function:later")} calls ${A("function:keep")} (exact)`,
      // b.ts is untouched, yet its call to `later` now lands on the new definition.
      `${B("function:user")} calls ${A("function:later")} (exact)`,
    ]);
    expect(delta.removedEdges.map(edgeText).toSorted()).toEqual([
      `${A("file:a.ts")} exports ${A("function:drop")} (exact)`,
      `${B("function:user")} calls frontier:later (heuristic)`,
    ]);
  });

  it("lands on the same index as building the later tree from scratch", async () => {
    const moved = await buildIndex(repo.dir, first, OPTIONS);
    await advance(moved, second);
    const fresh = await buildIndex(repo.dir, second, OPTIONS);
    expect(moved.indexer.snapshot("x", second)).toEqual(fresh.indexer.snapshot("x", second));
  });

  it("restricts the index to the given paths", async () => {
    const state = await buildIndex(repo.dir, first, { ...OPTIONS, paths: ["src/b.ts"] });
    const index = state.indexer.snapshot("x", first);
    expect(state.stats.parsed).toEqual(["src/b.ts"]);
    // `change` is imported from a file outside the paths: external, not a frontier.
    expect(index.frontier.map((symbol) => symbol.name)).toEqual(["later"]);
    expect(index.externals).toEqual([
      { from: B("function:user"), name: "change", source: "./a.ts" },
    ]);
  });
});

/** Walk `commits` incrementally and check each tree against a fresh build of it. */
async function expectIncrementalMatchesFresh(
  dir: string,
  commits: ReadonlyArray<string>,
  options: IndexOptions,
) {
  const [first, ...rest] = commits;
  if (first === undefined) return;
  const moved = await buildIndex(dir, first, options);
  for (const commit of rest) {
    await advance(moved, commit);
    const fresh = await buildIndex(dir, commit, options);
    expect(moved.indexer.snapshot("x", commit)).toEqual(fresh.indexer.snapshot("x", commit));
  }
  return moved;
}

describe("advance and buildIndex agree on which files count", () => {
  it("drops a file that becomes a symlink, and never reads an added symlink", async () => {
    const repo = tempRepo();
    try {
      const commits = [
        repo.commit(
          { "src/x.ts": "export function x() {}\n", "src/y.ts": "export function y() {}\n" },
          "files",
        ),
        repo.commit({ "src/x.ts": { symlink: "y.ts" } }, "x becomes a symlink"),
        repo.commit({ "src/z.ts": { symlink: "y.ts" } }, "add a symlink"),
        repo.commit({ "src/x.ts": "export function x() {}\n" }, "x is a file again"),
      ];
      const moved = await expectIncrementalMatchesFresh(repo.dir, commits, OPTIONS);
      expect(moved?.stats.parsed).toEqual(["src/x.ts", "src/y.ts", "src/x.ts"]);
    } finally {
      repo.remove();
    }
  });

  it("writes a new folder chain with its first file and drops a folder with its last", async () => {
    const repo = tempRepo();
    try {
      const commits = [
        repo.commit({ "app/main.ts": "export function main() {}\n" }, "main"),
        repo.commit({ "app/deep/er/x.ts": "export function x() {}\n" }, "deep file"),
        repo.commit({ "app/deep/er/x.ts": null, "app/go/a.go": "package go\n" }, "swap"),
        repo.commit({ "app/go/sub/b.go": "package sub\n" }, "nested package"),
      ];
      const options = { ...OPTIONS, paths: ["app"] };
      await expectIncrementalMatchesFresh(repo.dir, commits, options);
      const state = await buildIndex(repo.dir, commits[0] ?? "", options);
      const added = await advance(state, commits[1] ?? "");
      expect(added.added.map((symbol) => `${symbol.id} <- ${symbol.parent ?? "-"}`)).toEqual([
        "app/deep#folder:deep <- app#folder:app",
        "app/deep/er#folder:er <- app/deep#folder:deep",
        "app/deep/er/x.ts#file:x.ts <- app/deep/er#folder:er",
        "app/deep/er/x.ts#function:x <- app/deep/er/x.ts#file:x.ts",
      ]);
      const swapped = await advance(state, commits[2] ?? "");
      expect(swapped.removed.map((symbol) => symbol.id)).toEqual([
        "app/deep#folder:deep",
        "app/deep/er#folder:er",
        "app/deep/er/x.ts#file:x.ts",
        "app/deep/er/x.ts#function:x",
      ]);
      expect(swapped.added.map((symbol) => symbol.id)).toEqual([
        "app/go#package:go",
        "app/go/a.go#file:a.go",
      ]);
    } finally {
      repo.remove();
    }
  });

  it("measures the size limit in bytes, not characters", async () => {
    const repo = tempRepo();
    try {
      // 42 characters but 63 bytes in UTF-8: within 60 characters, over 60 bytes.
      const wide = `export const S = "${"é".repeat(21)}";\n`;
      expect(wide.length).toBeLessThanOrEqual(60);
      expect(Buffer.byteLength(wide)).toBeGreaterThan(60);
      const commits = [
        repo.commit({ "src/small.ts": "export const A = 1;\n" }, "small"),
        repo.commit({ "src/wide.ts": wide }, "wide"),
      ];
      const moved = await expectIncrementalMatchesFresh(repo.dir, commits, {
        ...OPTIONS,
        maxBytes: 60,
      });
      expect(moved?.stats.parsed).toEqual(["src/small.ts"]);
    } finally {
      repo.remove();
    }
  });
});
