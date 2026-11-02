// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ProjectContentMatch, ProjectSearchContentsInput } from "@t3tools/contracts";

import type { ContentSearchPathFilter } from "./contentSearchGlobs.ts";
import { CONTENT_SEARCH_MAX_MATCHES_PER_FILE, isWholeWordRange } from "./WorkspaceSearchIndex.ts";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;
// fff cuts lines here too, so indexed and ignored results look alike.
const MAX_LINE_LENGTH = 512;
// The page budget yields only once something matched; this caps a search that keeps finding nothing.
const MAX_SEARCH_MS_WITHOUT_MATCHES = 5_000;
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

/** Resume at `path` (inclusive), skipping the first `skip` matches in it. */
export interface IgnoredContentSearchPosition {
  readonly path: string;
  readonly skip: number;
}

export interface IgnoredContentSearchInput extends Pick<
  ProjectSearchContentsInput,
  "query" | "limit" | "caseSensitive" | "wholeWord" | "useRegex"
> {
  readonly cwd: string;
  /** `git ls-files --ignored --directory` entries; directories end with `/`. */
  readonly entries: ReadonlyArray<string>;
  readonly contextLines: number;
  readonly pathFilter: ContentSearchPathFilter | null;
  readonly start: IgnoredContentSearchPosition | null;
  readonly deadline: number;
  /** The page already holds indexed matches, so the budget applies from the start. */
  readonly pageHasMatches: boolean;
}

export interface IgnoredContentSearchResult {
  readonly matches: ReadonlyArray<ProjectContentMatch>;
  readonly next: IgnoredContentSearchPosition | null;
  readonly limited: boolean;
  readonly regexFallbackError?: string;
}

/** Orders paths the way a sorted depth-first walk visits them. */
function compareWalkPaths(left: string, right: string): number {
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");
  const length = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    const leftSegment = leftSegments[index]!;
    const rightSegment = rightSegments[index]!;
    if (leftSegment !== rightSegment) return leftSegment < rightSegment ? -1 : 1;
  }
  return leftSegments.length - rightSegments.length;
}

function makeLineRegex(input: IgnoredContentSearchInput): {
  readonly regex: RegExp;
  readonly regexFallbackError?: string;
} {
  const flags = input.caseSensitive ? "gu" : "giu";
  const literal = () => new RegExp(input.query.replace(REGEX_SYNTAX, "\\$&"), flags);
  if (!input.useRegex) return { regex: literal() };
  try {
    return { regex: new RegExp(input.query, flags) };
  } catch {
    try {
      return { regex: new RegExp(input.query, flags.replace("u", "")) };
    } catch (error) {
      return { regex: literal(), regexFallbackError: String(error) };
    }
  }
}

function matchLine(
  line: string,
  regex: RegExp,
  wholeWord: boolean,
): Array<{ readonly start: number; readonly end: number }> {
  const ranges: Array<{ readonly start: number; readonly end: number }> = [];
  regex.lastIndex = 0;
  for (let found = regex.exec(line); found !== null; found = regex.exec(line)) {
    if (found[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    const range = { start: found.index, end: found.index + found[0].length };
    if (range.start >= MAX_LINE_LENGTH) break;
    if (!wholeWord || isWholeWordRange(line, range)) {
      ranges.push({ start: range.start, end: Math.min(range.end, MAX_LINE_LENGTH) });
    }
  }
  return ranges;
}

async function searchFile(
  absolutePath: string,
  relativePath: string,
  input: IgnoredContentSearchInput,
  regex: RegExp,
): Promise<ProjectContentMatch[]> {
  const stat = await NodeFSP.stat(absolutePath).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) return [];
  const bytes = await NodeFSP.readFile(absolutePath).catch(() => null);
  if (!bytes || bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return [];
  const lines = bytes.toString("utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const cut = (line: string) => line.slice(0, MAX_LINE_LENGTH);

  const matches: ProjectContentMatch[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const matchRanges = matchLine(line, regex, input.wholeWord);
    if (matchRanges.length === 0) continue;
    matches.push({
      path: relativePath,
      lineNumber: index + 1,
      lineContent: cut(line),
      matchRanges,
      ...(input.contextLines > 0
        ? {
            contextBefore: lines.slice(Math.max(0, index - input.contextLines), index).map(cut),
            contextAfter: lines.slice(index + 1, index + 1 + input.contextLines).map(cut),
          }
        : {}),
    });
    if (matches.length === CONTENT_SEARCH_MAX_MATCHES_PER_FILE) break;
  }
  return matches;
}

/** Searches gitignored files in walk order; fff never indexes them. */
export async function searchIgnoredContents(
  input: IgnoredContentSearchInput,
): Promise<IgnoredContentSearchResult> {
  const { regex, regexFallbackError } = makeLineRegex(input);
  const hardDeadline = input.deadline + MAX_SEARCH_MS_WITHOUT_MATCHES;
  const start = input.start;
  const matches: ProjectContentMatch[] = [];
  let next: IgnoredContentSearchPosition | null = null;

  const outOfTime = () => {
    const now = performance.now();
    return (
      now >= hardDeadline || ((input.pageHasMatches || matches.length > 0) && now >= input.deadline)
    );
  };

  // Returns false once the page is full or out of time; `next` then says where to resume.
  const visitFile = async (relativePath: string): Promise<boolean> => {
    if (start && compareWalkPaths(relativePath, start.path) < 0) return true;
    if (input.pathFilter && !input.pathFilter.matches(relativePath)) return true;
    if (matches.length === input.limit || outOfTime()) {
      next = { path: relativePath, skip: 0 };
      return false;
    }
    const skip = start?.path === relativePath ? start.skip : 0;
    const fileMatches = await searchFile(
      NodePath.join(input.cwd, relativePath),
      relativePath,
      input,
      regex,
    );
    for (let index = skip; index < fileMatches.length; index += 1) {
      if (matches.length === input.limit) {
        next = { path: relativePath, skip: index };
        return false;
      }
      matches.push(fileMatches[index]!);
    }
    return true;
  };

  const visitDirectory = async (relativePath: string): Promise<boolean> => {
    if (
      start &&
      compareWalkPaths(relativePath, start.path) < 0 &&
      !start.path.startsWith(`${relativePath}/`)
    ) {
      return true;
    }
    if (input.pathFilter && !input.pathFilter.mayMatchBelow(relativePath)) return true;
    const children = await NodeFSP.readdir(NodePath.join(input.cwd, relativePath), {
      withFileTypes: true,
    }).catch(() => []);
    children.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const child of children) {
      if (child.name === ".git") continue;
      const childPath = `${relativePath}/${child.name}`;
      const keepGoing = child.isDirectory()
        ? await visitDirectory(childPath)
        : child.isFile()
          ? await visitFile(childPath)
          : true;
      if (!keepGoing) return false;
    }
    return true;
  };

  const roots = input.entries
    .map((entry) => ({ path: entry.replace(/\/+$/, ""), directory: entry.endsWith("/") }))
    .filter((root) => root.path.length > 0)
    .toSorted((left, right) => compareWalkPaths(left.path, right.path));
  for (const root of roots) {
    const keepGoing = root.directory
      ? await visitDirectory(root.path)
      : // lstat: an ignored symlink usually points outside the workspace.
        (await NodeFSP.lstat(NodePath.join(input.cwd, root.path)).catch(() => null))?.isFile()
        ? await visitFile(root.path)
        : true;
    if (!keepGoing) break;
  }

  return {
    matches,
    next,
    limited: next !== null && matches.length === input.limit,
    ...(regexFallbackError !== undefined ? { regexFallbackError } : {}),
  };
}
