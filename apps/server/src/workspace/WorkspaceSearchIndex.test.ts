import {
  FileFinder,
  type FileItem,
  type GrepCursor,
  type GrepMatch,
  type GrepOptions,
  type GrepResult,
} from "@ff-labs/fff-node";
import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import * as WorkspaceSearchIndex from "./WorkspaceSearchIndex.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function fileItem(relativePath: string): FileItem {
  return {
    relativePath,
    fileName: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    size: 1,
    modified: 0,
    accessFrecencyScore: 0,
    modificationFrecencyScore: 0,
    totalFrecencyScore: 0,
    gitStatus: "clean",
  };
}

it.effect("filters image searches before applying the result limit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const items = [
        ...Array.from({ length: 200 }, (_, index) => fileItem(`src/file-${index}.ts`)),
        fileItem("public/icon.svg"),
      ];
      const fileSearch = vi.fn(() => ({
        ok: true as const,
        value: {
          items,
          scores: [],
          totalMatched: items.length,
          totalFiles: items.length,
        },
      }));
      const finder = {
        destroy: vi.fn(),
        waitForIndexReady: vi.fn(async () => ({ ok: true as const, value: true })),
        fileSearch,
      } as unknown as FileFinder;
      vi.spyOn(FileFinder, "create").mockReturnValueOnce({ ok: true, value: finder });

      const searchIndex = yield* WorkspaceSearchIndex.make("/workspace/project");
      const resultWithoutKind = yield* searchIndex.search("", 200, undefined, true);
      const resultWithDirectoryKind = yield* searchIndex.search("", 200, "directory", true);

      expect(resultWithoutKind.entries).toEqual([{ kind: "file", path: "public/icon.svg" }]);
      expect(resultWithDirectoryKind.entries).toEqual([{ kind: "file", path: "public/icon.svg" }]);
      expect(fileSearch).toHaveBeenCalledTimes(2);
      expect(fileSearch).toHaveBeenCalledWith("", { pageSize: 25_002 });
    }),
  ),
);

function grepMatch(relativePath: string, lineNumber: number, lineContent = "needle"): GrepMatch {
  return {
    relativePath,
    fileName: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    gitStatus: "unmodified",
    size: lineContent.length,
    modified: 0,
    isBinary: false,
    totalFrecencyScore: 0,
    accessFrecencyScore: 0,
    modificationFrecencyScore: 0,
    lineNumber,
    col: 0,
    byteOffset: 0,
    lineContent,
    matchRanges: [[0, 6]],
  };
}

function grepCursor(offset: number): GrepCursor {
  return { __brand: "GrepCursor", _offset: offset } as GrepCursor;
}

function grepResult(items: GrepMatch[], nextCursor: GrepCursor | null): GrepResult {
  return {
    items,
    totalMatched: items.length,
    totalFilesSearched: 1,
    totalFiles: 1,
    filteredFileCount: 1,
    nextCursor,
  };
}

/** Pages of a fake index, keyed by the file offset a grep call starts at. */
function makeContentIndex(pages: Record<number, GrepResult>) {
  const grep = vi.fn((_query: string, options?: GrepOptions) => {
    const page = pages[options?.cursor?._offset ?? 0];
    return page ? { ok: true as const, value: page } : { ok: false as const, error: "no page" };
  });
  const finder = {
    destroy: vi.fn(),
    waitForIndexReady: vi.fn(async () => ({ ok: true as const, value: true })),
    grep,
  } as unknown as FileFinder;
  vi.spyOn(FileFinder, "create").mockReturnValueOnce({ ok: true, value: finder });
  return grep;
}

const contentSearch = {
  query: "needle",
  caseSensitive: true,
  wholeWord: false,
  useRegex: false,
  contextLines: 0,
  pathFilter: null,
  start: { offset: 0, skip: 0 },
  deadline: Number.POSITIVE_INFINITY,
};

it.effect("continues whole-word searches after a filtered grep page", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const grep = makeContentIndex({
        0: grepResult([grepMatch("src/words.ts", 1, "needleSuffix")], grepCursor(1)),
        1: grepResult([grepMatch("src/words.ts", 2)], null),
      });

      const searchIndex = yield* WorkspaceSearchIndex.make("/workspace/project", "content");
      const result = yield* searchIndex.searchContents({
        ...contentSearch,
        limit: 1,
        wholeWord: true,
      });

      expect(result).toEqual({
        matches: [
          {
            path: "src/words.ts",
            lineNumber: 2,
            lineContent: "needle",
            matchRanges: [{ start: 0, end: 6 }],
          },
        ],
        next: null,
        limited: false,
      });
      expect(grep).toHaveBeenCalledTimes(2);
      expect(grep.mock.calls[1]?.[1]?.cursor).toEqual(grepCursor(1));
    }),
  ),
);

it.effect("resumes inside a page that reached the limit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      makeContentIndex({
        0: grepResult(
          [grepMatch("a.ts", 1), grepMatch("a.ts", 2), grepMatch("b.ts", 1)],
          grepCursor(2),
        ),
        2: grepResult([grepMatch("c.ts", 1)], null),
      });
      const searchIndex = yield* WorkspaceSearchIndex.make("/workspace/project", "content");
      const lines = (result: WorkspaceSearchIndex.IndexedContentSearchResult) =>
        result.matches.map((match) => `${match.path}:${match.lineNumber}`);

      const first = yield* searchIndex.searchContents({ ...contentSearch, limit: 2 });
      expect(lines(first)).toEqual(["a.ts:1", "a.ts:2"]);
      expect(first).toMatchObject({ next: { offset: 0, skip: 2 }, limited: true });

      const second = yield* searchIndex.searchContents({
        ...contentSearch,
        limit: 2,
        start: first.next!,
      });
      expect(lines(second)).toEqual(["b.ts:1", "c.ts:1"]);
      expect(second).toMatchObject({ next: null, limited: false });
    }),
  ),
);

it.effect("carries the skip forward when a resumed page comes back shorter", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // A time budget can end the resumed page before the files it skipped into.
      makeContentIndex({
        0: grepResult([grepMatch("a.ts", 1)], grepCursor(1)),
        1: grepResult([grepMatch("b.ts", 1), grepMatch("b.ts", 2)], null),
      });
      const searchIndex = yield* WorkspaceSearchIndex.make("/workspace/project", "content");

      const result = yield* searchIndex.searchContents({
        ...contentSearch,
        limit: 10,
        start: { offset: 0, skip: 2 },
      });
      expect(result.matches.map((match) => `${match.path}:${match.lineNumber}`)).toEqual([
        "b.ts:2",
      ]);
    }),
  ),
);
