import type { ProjectContentMatch } from "@t3tools/contracts";

export type IndexedContentMatch = ProjectContentMatch & { readonly resultIndex: number };

export type ContentSearchRow =
  | { readonly kind: "match"; readonly match: IndexedContentMatch }
  | { readonly kind: "context"; readonly lineNumber: number; readonly text: string }
  | { readonly kind: "gap"; readonly lineNumber: number };

export interface ContentSearchFileGroup {
  readonly path: string;
  readonly matchCount: number;
  readonly rows: ReadonlyArray<ContentSearchRow>;
}

/**
 * Groups matches by file in arrival order. Within a file, each match brings its context lines;
 * excerpts that touch or overlap merge, and a gap row separates the ones that don't.
 */
export function groupContentSearchMatches(
  matches: ReadonlyArray<ProjectContentMatch>,
): ContentSearchFileGroup[] {
  const byPath = new Map<string, IndexedContentMatch[]>();
  matches.forEach((match, resultIndex) => {
    const group = byPath.get(match.path);
    const indexed = { ...match, resultIndex };
    if (group) group.push(indexed);
    else byPath.set(match.path, [indexed]);
  });
  return [...byPath].map(([path, fileMatches]) => ({
    path,
    matchCount: fileMatches.length,
    rows: fileRows(fileMatches),
  }));
}

function fileRows(matches: ReadonlyArray<IndexedContentMatch>): ContentSearchRow[] {
  const sorted = matches.toSorted((left, right) => left.lineNumber - right.lineNumber);
  const matchLines = new Set(sorted.map((match) => match.lineNumber));
  const rows: ContentSearchRow[] = [];
  let lastLine = 0;
  const push = (row: ContentSearchRow, lineNumber: number) => {
    if (lineNumber <= lastLine) return;
    if (lastLine > 0 && lineNumber > lastLine + 1) rows.push({ kind: "gap", lineNumber });
    rows.push(row);
    lastLine = lineNumber;
  };
  for (const match of sorted) {
    const before = match.contextBefore ?? [];
    before.forEach((text, index) => {
      const lineNumber = match.lineNumber - before.length + index;
      if (lineNumber >= 1) push({ kind: "context", lineNumber, text }, lineNumber);
    });
    push({ kind: "match", match }, match.lineNumber);
    for (const [index, text] of (match.contextAfter ?? []).entries()) {
      const lineNumber = match.lineNumber + 1 + index;
      // The next match brings its own leading context.
      if (matchLines.has(lineNumber)) break;
      push({ kind: "context", lineNumber, text }, lineNumber);
    }
  }
  return rows;
}
