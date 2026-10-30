import type { FileDiagnostics } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { locationFiles, problemFiles, searchFiles } from "./multibufferInputs";

const problem = (severity: "error" | "warning" | "info", line: number, endLine = line) => ({
  severity,
  line,
  column: 1,
  endLine,
  endColumn: 4,
  message: `${severity} on ${line}`,
});

const file = (path: string, diagnostics: FileDiagnostics["diagnostics"]): FileDiagnostics => ({
  path,
  version: 1,
  diagnostics,
  truncated: false,
});

describe("problemFiles", () => {
  it("groups problems by file, files with errors first and then by path, and drops clean files", () => {
    const files = problemFiles([
      file("src/z.ts", [problem("warning", 3)]),
      file("src/clean.ts", []),
      file("src/b.ts", [problem("info", 9), problem("error", 2, 4)]),
      file("src/a.ts", [problem("warning", 1)]),
    ]);
    expect(files.map((item) => item.path)).toEqual(["src/b.ts", "src/a.ts", "src/z.ts"]);
    expect(files[0]).toMatchObject({
      lines: [
        { line: 9, endLine: 9 },
        { line: 2, endLine: 4 },
      ],
      counts: { errors: 1, warnings: 0, other: 1 },
    });
  });
});

describe("searchFiles", () => {
  it("lists each file once in the order it was found, with its lines shown until it opens", () => {
    const files = searchFiles([
      {
        path: "b.ts",
        lineNumber: 5,
        lineContent: "five",
        matchRanges: [],
        contextBefore: ["three", "four"],
        contextAfter: ["six"],
      },
      { path: "a.ts", lineNumber: 1, lineContent: "one", matchRanges: [] },
      { path: "b.ts", lineNumber: 9, lineContent: "nine", matchRanges: [] },
    ]);
    expect(files.map((item) => [item.path, item.lines])).toEqual([
      ["b.ts", [{ line: 5 }, { line: 9 }]],
      ["a.ts", [{ line: 1 }]],
    ]);
    expect([...files[0]!.preview!]).toEqual([
      [5, "five"],
      [3, "three"],
      [4, "four"],
      [6, "six"],
      [9, "nine"],
    ]);
  });
});

describe("locationFiles", () => {
  it("marks a whole line when a place has no column", () => {
    const [only] = locationFiles([{ path: "a.ts", line: 4 }]);
    expect(only!.marks).toEqual([{ line: 4, column: 0, endLine: 4, endColumn: Infinity }]);
  });
});
