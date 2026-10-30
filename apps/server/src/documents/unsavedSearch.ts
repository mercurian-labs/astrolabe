import type {
  ProjectContentMatch,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
} from "@t3tools/contracts";
import { lineMatches, textMatcher } from "@t3tools/shared/textReplace";

import { makeContentSearchPathFilter } from "../workspace/contentSearchGlobs.ts";
import { CONTENT_SEARCH_MAX_MATCHES_PER_FILE } from "../workspace/WorkspaceSearchIndex.ts";

// As the index cuts lines, so results from disk and from open documents look alike.
const MAX_LINE_LENGTH = 512;

/** A search's matches in one text, as the index would report them for that file. */
export function textContentMatches(
  input: ProjectSearchContentsInput,
  relativePath: string,
  text: string,
): ProjectContentMatch[] {
  const matcher = textMatcher(input);
  if (matcher.error !== null) return [];
  const lines = text.split("\n");
  const context = input.contextLines ?? 0;
  const cut = (line: string) => line.slice(0, MAX_LINE_LENGTH);
  const matches: ProjectContentMatch[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const matchRanges = lineMatches(line, matcher)
      .map((match) => ({ start: match.index, end: match.index + match[0].length }))
      .filter((range) => range.start < MAX_LINE_LENGTH)
      .map((range) => ({ start: range.start, end: Math.min(range.end, MAX_LINE_LENGTH) }));
    if (matchRanges.length === 0) continue;
    matches.push({
      path: relativePath,
      lineNumber: index + 1,
      lineContent: cut(line),
      matchRanges,
      ...(context > 0
        ? {
            contextBefore: lines.slice(Math.max(0, index - context), index).map(cut),
            contextAfter: lines.slice(index + 1, index + 1 + context).map(cut),
          }
        : {}),
    });
    if (matches.length === CONTENT_SEARCH_MAX_MATCHES_PER_FILE) break;
  }
  return matches;
}

/**
 * Astrolabe: a page of project search with open documents' unsaved text in place of their files
 * on disk. Their disk matches leave every page; their live matches lead the first one.
 */
export function withUnsavedTexts(
  input: ProjectSearchContentsInput,
  page: ProjectSearchContentsResult,
  unsaved: ReadonlyArray<{ readonly relativePath: string; readonly text: string }>,
): ProjectSearchContentsResult {
  if (unsaved.length === 0) return page;
  const filter = makeContentSearchPathFilter(input);
  const included = unsaved.filter((file) => filter === null || filter.matches(file.relativePath));
  if (included.length === 0) return page;
  const paths = new Set(included.map((file) => file.relativePath));
  const fromDisk = page.matches.filter((match) => !paths.has(match.path));
  if (input.cursor !== undefined) return { ...page, matches: fromDisk };
  const live = included
    .toSorted((a, b) => (a.relativePath < b.relativePath ? -1 : 1))
    .flatMap((file) => textContentMatches(input, file.relativePath, file.text));
  return { ...page, matches: [...live, ...fromDisk] };
}
