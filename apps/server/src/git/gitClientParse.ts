import type { GitClientChangeKind } from "@t3tools/contracts";

/** A changed file as `git status --porcelain=v2 -z` reports it, before counts and turns. */
export interface StatusEntry {
  readonly path: string;
  readonly originalPath: string | null;
  readonly index: GitClientChangeKind | null;
  readonly workingTree: GitClientChangeKind | null;
  readonly untracked: boolean;
  readonly conflicted: boolean;
}

export interface ParsedStatus {
  readonly branch: string | null;
  readonly head: string | null;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly entries: ReadonlyArray<StatusEntry>;
}

const KINDS: Readonly<Record<string, GitClientChangeKind>> = {
  M: "modified",
  T: "typechange",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
};

const kindOf = (letter: string | undefined) =>
  letter === undefined ? null : (KINDS[letter] ?? null);

/** The rest of `record` after `fields` space-separated fields: a path, which may hold spaces. */
const afterFields = (record: string, fields: number) => {
  let at = 0;
  for (let field = 0; field < fields; field += 1) {
    at = record.indexOf(" ", at) + 1;
    if (at === 0) return null;
  }
  return record.slice(at);
};

export function parsePorcelainV2(stdout: string): ParsedStatus {
  let branch: string | null = null;
  let head: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const entries: StatusEntry[] = [];
  const records = stdout.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.length === 0) continue;
    if (record.startsWith("# branch.oid ")) {
      const value = record.slice("# branch.oid ".length);
      head = value === "(initial)" ? null : value;
    } else if (record.startsWith("# branch.head ")) {
      const value = record.slice("# branch.head ".length);
      branch = value === "(detached)" ? null : value;
    } else if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice("# branch.upstream ".length) || null;
    } else if (record.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -(\d+)$/.exec(record.slice("# branch.ab ".length));
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (record.startsWith("1 ")) {
      const path = afterFields(record, 8);
      if (path === null) continue;
      entries.push({
        path,
        originalPath: null,
        index: kindOf(record[2]),
        workingTree: kindOf(record[3]),
        untracked: false,
        conflicted: false,
      });
    } else if (record.startsWith("2 ")) {
      const path = afterFields(record, 9);
      // A rename or copy record is followed by its source as a record of its own.
      const originalPath = records[index + 1] ?? null;
      index += 1;
      if (path === null) continue;
      entries.push({
        path,
        originalPath: originalPath || null,
        index: kindOf(record[2]),
        workingTree: kindOf(record[3]),
        untracked: false,
        conflicted: false,
      });
    } else if (record.startsWith("u ")) {
      const path = afterFields(record, 10);
      if (path === null) continue;
      entries.push({
        path,
        originalPath: null,
        index: null,
        workingTree: null,
        untracked: false,
        conflicted: true,
      });
    } else if (record.startsWith("? ")) {
      entries.push({
        path: record.slice(2),
        originalPath: null,
        index: null,
        workingTree: "added",
        untracked: true,
        conflicted: false,
      });
    }
  }
  return { branch, head, upstream, ahead, behind, entries };
}

export interface NumstatEntry {
  readonly path: string;
  /** Null for a binary file. */
  readonly additions: number | null;
  readonly deletions: number | null;
}

/** `git diff-index --numstat -z`: a rename's record names no path; its source and target follow. */
export function parseNumstatZ(stdout: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  const records = stdout.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.length === 0) continue;
    const [added, deleted, ...rest] = record.split("\t");
    let path = rest.join("\t");
    if (path === "") {
      path = records[index + 2] ?? "";
      index += 2;
    }
    if (path === "" || added === undefined || deleted === undefined) continue;
    entries.push({
      path,
      additions: added === "-" ? null : Number(added),
      deletions: deleted === "-" ? null : Number(deleted),
    });
  }
  return entries;
}

export const LOG_FIELD = "\u001f";

export interface LogEntry {
  readonly sha: string;
  readonly authorName: string;
  readonly authoredAt: string;
  readonly subject: string;
  readonly body: string;
}

/** `git log -z` with `%H %an %aI %s %b` joined by `LOG_FIELD`. */
export function parseLog(stdout: string): LogEntry[] {
  return stdout.split("\0").flatMap((record) => {
    const [sha, authorName, authoredAt, subject, body] = record.replace(/^\n/, "").split(LOG_FIELD);
    if (!sha || authoredAt === undefined) return [];
    return [
      {
        sha,
        authorName: authorName ?? "",
        authoredAt,
        subject: subject ?? "",
        body: (body ?? "").trim(),
      },
    ];
  });
}

/**
 * Reflog entries that made a commit in this checkout: a commit, an amend, a cherry-pick, a
 * revert, or a rebase replaying one. Pulls, merges that fast-forward, resets and checkouts only
 * moved HEAD to commits made elsewhere.
 */
const MADE_HERE =
  /^(commit( \((amend|initial|merge)\))?|cherry-pick|revert|rebase( -i)? \((pick|reword|edit|squash|fixup|continue)\)):/;

/**
 * When each commit was made here, in epoch seconds, from `git log -g --date=unix` with
 * `%H %gd %gs` joined by `LOG_FIELD`. Newest entries come first; a commit made twice keeps its
 * first making.
 */
export function parseReflogMadeAt(stdout: string): Map<string, number> {
  const madeAt = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const [sha, selector, subject] = line.split(LOG_FIELD);
    if (!sha || selector === undefined || subject === undefined) continue;
    if (!MADE_HERE.test(subject)) continue;
    const time = /@\{(\d+)\}$/.exec(selector);
    if (!time) continue;
    madeAt.set(sha, Number(time[1]));
  }
  return madeAt;
}
