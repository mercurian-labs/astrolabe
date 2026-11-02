import type { MultibufferFileInput } from "@mercurian/editor/multibuffer";
import type { GoToKind, NavigationLocation } from "@mercurian/editor/lsp/navigation";
import type { FileDiagnostics, ProjectContentMatch } from "@t3tools/contracts";

import type { LocationList, MultibufferLocation } from "./openMultibuffer";

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

/**
 * Several places a language server named, as a list to read together: references and
 * implementations, the checkout's places only. Null leaves them to the picker: definitions,
 * declarations and type definitions are a jump to one place, and a file outside the checkout
 * has no excerpt to show.
 */
export function navigationList(
  kind: GoToKind | "references",
  title: string,
  places: readonly NavigationLocation[],
  pathOf: (uri: string) => string,
): LocationList | null {
  if (kind !== "references" && kind !== "implementation") return null;
  const locations = places.flatMap((place): MultibufferLocation[] => {
    const path = pathOf(place.uri);
    if (path.startsWith("/") || path.includes("://")) return [];
    // Navigation counts columns from 1, excerpts from 0.
    return [
      {
        path,
        line: place.line,
        column: place.column - 1,
        endLine: place.endLine,
        endColumn: place.endColumn - 1,
      },
    ];
  });
  if (locations.length === 0) return null;
  const outside = places.length - locations.length;
  return {
    title: outside === 0 ? title : `${title}, ${outside} outside the checkout left out`,
    locations,
  };
}
