import type { MultibufferFileInput } from "@mercurian/editor/multibuffer";
import type { FileDiagnostics, ProjectContentMatch } from "@t3tools/contracts";

import type { MultibufferLocation } from "./openMultibuffer";

/**
 * Astrolabe: a multi-file view's files from what its caller lists: project search matches,
 * language-server problems, or plain locations. Files keep the order they first appear in.
 */

function byPath<T>(items: readonly T[], pathOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const path = pathOf(item);
    const group = groups.get(path);
    if (group) group.push(item);
    else groups.set(path, [item]);
  }
  return groups;
}

/** Search matches as files, with their lines and context shown until each file opens. */
export function searchFiles(matches: readonly ProjectContentMatch[]): MultibufferFileInput[] {
  return [...byPath(matches, (match) => match.path)].map(([path, fileMatches]) => {
    const preview = new Map<number, string>();
    for (const match of fileMatches) {
      preview.set(match.lineNumber, match.lineContent);
      match.contextBefore?.forEach((text, index, all) =>
        preview.set(match.lineNumber - all.length + index, text),
      );
      match.contextAfter?.forEach((text, index) => preview.set(match.lineNumber + 1 + index, text));
    }
    return { path, lines: fileMatches.map((match) => ({ line: match.lineNumber })), preview };
  });
}

/** Problems by file, files with errors first, then by path; files with none are left out. */
export function problemFiles(
  files: Iterable<FileDiagnostics>,
): Array<MultibufferFileInput & { readonly counts: ProblemCounts }> {
  return [...files]
    .filter((file) => file.diagnostics.length > 0)
    .map((file) => ({
      path: file.path,
      lines: file.diagnostics.map((item) => ({ line: item.line, endLine: item.endLine })),
      counts: problemCounts(file),
    }))
    .toSorted(
      (a, b) =>
        Number(b.counts.errors > 0) - Number(a.counts.errors > 0) ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
}

export interface ProblemCounts {
  readonly errors: number;
  readonly warnings: number;
  readonly other: number;
}

export function problemCounts(file: FileDiagnostics): ProblemCounts {
  let errors = 0;
  let warnings = 0;
  for (const item of file.diagnostics) {
    if (item.severity === "error") errors += 1;
    else if (item.severity === "warning") warnings += 1;
  }
  return { errors, warnings, other: file.diagnostics.length - errors - warnings };
}

/** Locations as files, each location marked. */
export function locationFiles(locations: readonly MultibufferLocation[]): MultibufferFileInput[] {
  return [...byPath(locations, (location) => location.path)].map(([path, fileLocations]) => ({
    path,
    lines: fileLocations.map((location) => ({
      line: location.line,
      endLine: location.endLine ?? location.line,
    })),
    marks: fileLocations.map((location) => ({
      line: location.line,
      column: location.column ?? 0,
      endLine: location.endLine ?? location.line,
      endColumn: location.endColumn ?? (location.column === undefined ? Infinity : location.column),
    })),
  }));
}
