/**
 * What the wiki service keeps on disk: the registry (`<stateDir>/wikis.json`) and change request
 * metadata, a commit under `refs/wiki/change-requests/<id>` holding `change-request.json` with one
 * child commit per update. Everything else (amendments, files, indexes) derives from the repo.
 *
 * @module wikiStorage
 */
import { builtInSourceControlDefinitions } from "@t3tools/source-control-definitions/registry";
import { parseAmendmentTrailers, type WikiMove } from "@mercurian/wiki";
import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  type WikiAmendmentSummary,
  WikiChangeRequestId,
  WikiChangeRequestStatus,
  WikiId,
  WikiMapBackground,
  WikiHostStatus,
  WikiMirrorStatus,
  WikiPullRequestLink,
} from "@t3tools/contracts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const WikiRecord = Schema.Struct({
  wikiId: WikiId,
  name: TrimmedNonEmptyString,
  root: TrimmedNonEmptyString,
  mainBranch: TrimmedNonEmptyString,
  projectIds: Schema.Array(ProjectId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** When each link was made, so a running conversation hears of it once. Older links have none. */
  projectLinkedAt: Schema.Record(ProjectId, IsoDateTime).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  mirror: Schema.NullOr(WikiMirrorStatus),
  host: Schema.NullOr(WikiHostStatus).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  mapBackgrounds: Schema.Array(WikiMapBackground).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  createdAt: IsoDateTime,
});
export type WikiRecord = typeof WikiRecord.Type;

export const WikiRegistry = Schema.Struct({
  version: Schema.Literal(1),
  wikis: Schema.Array(WikiRecord),
});
export type WikiRegistry = typeof WikiRegistry.Type;

export const WikiRegistryJson = fromJsonStringPretty(WikiRegistry);

export const ChangeRequestRecord = Schema.Struct({
  version: Schema.Literal(1),
  changeRequestId: WikiChangeRequestId,
  title: TrimmedNonEmptyString,
  status: WikiChangeRequestStatus,
  /** A person's autosaved edits; `createdBy` is whose. */
  draft: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  branch: Schema.String,
  base: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  createdBy: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  mergedCommit: Schema.NullOr(Schema.String),
  pullRequest: Schema.NullOr(WikiPullRequestLink).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  pushedHead: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type ChangeRequestRecord = typeof ChangeRequestRecord.Type;

export const ChangeRequestRecordJson = fromJsonStringPretty(ChangeRequestRecord);

/**
 * What a turn's transforms in a thread's checkout leave for its save, kept in the worktree's git
 * folder: the amendment id their stamps carry, how many warning ids they minted, and their moves.
 */
export const PendingCheckoutAmendmentJson = fromJsonStringPretty(
  Schema.Struct({
    amendment: Schema.String,
    minted: Schema.Number,
    moved: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })),
  }),
);
export type PendingCheckoutAmendment = typeof PendingCheckoutAmendmentJson.Type;

/** The state folder's folder of thread checkouts: `<threadId>/<wikiId>` below it. */
export const THREAD_CHECKOUTS_FOLDER = "wiki-checkouts";

/** What a wiki's reviews are called: its host's name for them, else "pull request". */
export const wikiTerms = (wiki: { readonly host?: { readonly kind?: string } | null }) =>
  builtInSourceControlDefinitions.get(wiki.host?.kind).changeRequest;

export const CHANGE_REQUEST_FILE = "change-request.json";
export const changeRequestBranch = (id: string) => `refs/heads/cr/${id}`;
export const changeRequestMetadataRef = (id: string) => `refs/wiki/change-requests/${id}`;
export const CHANGE_REQUEST_BRANCH_PREFIX = "refs/heads/cr/";
export const CHANGE_REQUEST_METADATA_PREFIX = "refs/wiki/change-requests/";

/** The files of a `git ls-tree -r -z` listing, with their blob ids. */
export const parseTreeListing = (
  output: string,
): ReadonlyArray<{ readonly file: string; readonly oid: string }> =>
  output.split("\0").flatMap((entry) => {
    const tab = entry.indexOf("\t");
    if (tab < 0) return [];
    const [mode, type, oid] = entry.slice(0, tab).split(" ");
    const file = entry.slice(tab + 1);
    return type === "blob" &&
      oid !== undefined &&
      (mode === "100644" || mode === "100755") &&
      !file.includes("\n")
      ? [{ file, oid }]
      : [];
  });

interface NameStatus {
  /** Git's letter: `A`, `D`, `M`, `R` and the like. */
  readonly status: string;
  readonly file: string;
  /** The path it had, when git took the change for a move. */
  readonly movedFrom?: string;
}

/** The fields `--name-status -z` writes: a status, then a path, or two for a rename. */
function nameStatuses(fields: ReadonlyArray<string>): ReadonlyArray<NameStatus> {
  const found: NameStatus[] = [];
  for (let at = 0; at < fields.length;) {
    const status = fields[at]?.trim() ?? "";
    if (status === "") {
      at += 1;
    } else if (status.startsWith("R")) {
      found.push({ status: "R", file: fields[at + 2] ?? "", movedFrom: fields[at + 1] ?? "" });
      at += 3;
    } else {
      found.push({ status: status.charAt(0), file: fields[at + 1] ?? "" });
      at += 2;
    }
  }
  return found;
}

/** `git diff --find-renames --name-status -z`: what changed, with what moved as one file. */
export const parseChangeList = (output: string): ReadonlyArray<NameStatus> =>
  nameStatuses(output.split("\0"));

/**
 * `listed`, with the moves amendments recorded (oldest first) as one file each. A move of a moved
 * file chains to where it began. One the diff doesn't bear out, as a reverted one, is left out.
 */
export function withRecordedMoves(
  listed: ReadonlyArray<NameStatus>,
  recorded: ReadonlyArray<WikiMove>,
): ReadonlyArray<NameStatus> {
  const began = new Map<string, string>();
  for (const { from, to } of recorded) {
    const origin = began.get(from) ?? from;
    began.delete(from);
    began.set(to, origin);
  }
  const left = new Set<string>();
  const arrived = new Set<string>();
  for (const { status, file, movedFrom } of listed) {
    if (status === "D") left.add(file);
    if (movedFrom !== undefined) left.add(movedFrom);
    if (status === "A" || status === "R") arrived.add(file);
  }
  const moved = new Map([...began].filter(([to, from]) => arrived.has(to) && left.has(from)));
  const sources = new Set(moved.values());
  return listed
    .flatMap((entry): ReadonlyArray<NameStatus> =>
      entry.movedFrom !== undefined && (moved.has(entry.file) || sources.has(entry.movedFrom))
        ? [
            { status: "D", file: entry.movedFrom },
            { status: "A", file: entry.file },
          ]
        : [entry],
    )
    .flatMap((entry): ReadonlyArray<NameStatus> => {
      const movedFrom = moved.get(entry.file);
      if (movedFrom !== undefined) return [{ status: "R", file: entry.file, movedFrom }];
      return sources.has(entry.file) ? [] : [entry];
    });
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Splits `git cat-file --batch` output into one entry per requested object, `null` for a missing
 * one. Sizes are bytes, so the text is re-encoded; `undefined` means the output did not line up
 * (a blob that was not valid UTF-8), and the caller reads those objects one by one instead.
 */
export const parseBatchOutput = (
  output: string,
  count: number,
): ReadonlyArray<string | null> | undefined => {
  const bytes = encoder.encode(output);
  const results: Array<string | null> = [];
  let offset = 0;
  for (let item = 0; item < count; item++) {
    const end = bytes.indexOf(10, offset);
    if (end < 0) return undefined;
    const header = decoder.decode(bytes.subarray(offset, end));
    offset = end + 1;
    if (header.endsWith(" missing") || header.endsWith(" ambiguous")) {
      results.push(null);
      continue;
    }
    const size = /^\S+ \S+ (\d+)$/.exec(header)?.[1];
    if (size === undefined) return undefined;
    const contentEnd = offset + Number(size);
    if (bytes[contentEnd] !== 10) return undefined;
    results.push(decoder.decode(bytes.subarray(offset, contentEnd)));
    offset = contentEnd + 1;
  }
  return results;
};

/**
 * The amendments of `git log --reverse --no-renames --name-only -z` with
 * {@link AMENDMENT_LOG_FORMAT}. A commit without amendment trailers (one made outside the app)
 * still shows, attributed to its author, so a reviewer sees everything a merge would land.
 */
export const AMENDMENT_LOG_FORMAT = "%x1e%H%x1f%aI%x1f%an%x1f%B%x1f";

export const parseAmendmentLog = (output: string): ReadonlyArray<WikiAmendmentSummary> =>
  output
    .split("\x1e")
    .slice(1)
    .flatMap((record) => {
      const [commit, at, author, body, rest] = record.split("\x1f");
      if (!commit || at === undefined || body === undefined) return [];
      const trailers = parseAmendmentTrailers(body);
      return [
        {
          commit,
          amendment: trailers?.amendment ?? commit,
          actor: trailers?.actor ?? author ?? "unknown",
          subject: body.split("\n")[0]?.trim() ?? "",
          at,
          files: (rest ?? "")
            .split("\0")
            .map((file) => file.replace(/^\n/, ""))
            .filter(Boolean),
          reverts: trailers?.reverts ?? null,
          ...(trailers?.autosave === undefined ? {} : { autosave: trailers.autosave }),
        },
      ];
    });

/** How far back edit times are read; a file untouched for longer shows no edit time. */
export const EDIT_TIMES_DEPTH = 2000;
export const EDIT_TIMES_FORMAT = "%x1e%cI";

/** When each file was last and first changed, as ISO times. */
export interface WikiFileTimes {
  readonly modified: ReadonlyMap<string, string>;
  readonly created: ReadonlyMap<string, string>;
}

/**
 * When each file was last and first changed, from `git log --find-renames --name-status -z` (newest
 * first) with {@link EDIT_TIMES_FORMAT}: the first commit naming a file is its latest, the last
 * its first within {@link EDIT_TIMES_DEPTH}. Commits before a move count for the file it became.
 */
export const parseFileTimes = (output: string): WikiFileTimes => {
  const modified = new Map<string, string>();
  const created = new Map<string, string>();
  const becameFile = new Map<string, string>();
  for (const record of output.split("\x1e").slice(1)) {
    const [at, ...fields] = record.split("\0");
    if (!at) continue;
    for (const { file, movedFrom } of nameStatuses(fields)) {
      const current = becameFile.get(file) ?? file;
      if (!modified.has(current)) modified.set(current, at);
      created.set(current, at);
      if (movedFrom !== undefined) becameFile.set(movedFrom, current);
    }
  }
  return { modified, created };
};

/** `git ls-tree -r -l -z`: every file at a commit, with its blob and size, for bases to list. */
export const parseFileListing = (
  output: string,
): ReadonlyArray<{ readonly file: string; readonly oid: string; readonly size: number }> =>
  output.split("\0").flatMap((entry) => {
    const tab = entry.indexOf("\t");
    if (tab < 0) return [];
    const [mode, type, oid, size] = entry.slice(0, tab).split(/ +/);
    const file = entry.slice(tab + 1);
    const bytes = Number(size);
    return type === "blob" &&
      oid !== undefined &&
      (mode === "100644" || mode === "100755") &&
      Number.isFinite(bytes) &&
      !file.includes("\n")
      ? [{ file, oid, size: bytes }]
      : [];
  });

/** `git merge-tree --write-tree --name-only --no-messages -z`: the tree, then conflicted files. */
export const parseMergeTree = (
  output: string,
): { readonly tree: string; readonly conflicts: ReadonlyArray<string> } => {
  const [tree = "", ...rest] = output.split("\0");
  return { tree: tree.trim(), conflicts: [...new Set(rest.filter(Boolean))] };
};

/** The paths git names in a refused `read-tree -m -u`, such as `Entry 'A.md' not uptodate`. */
export const parseBusyPaths = (stderr: string): ReadonlyArray<string> => [
  ...new Set(
    stderr
      .split("\n")
      .filter((line) => line.startsWith("error:"))
      .flatMap((line) => {
        const path = /'([^']+)'/.exec(line)?.[1];
        return path === undefined ? [] : [path];
      }),
  ),
];

/** `git --version` at least 2.38, the first with `merge-tree --write-tree`. */
export const gitSupportsWikis = (versionOutput: string): boolean => {
  const match = /(\d+)\.(\d+)/.exec(versionOutput);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 38);
};
