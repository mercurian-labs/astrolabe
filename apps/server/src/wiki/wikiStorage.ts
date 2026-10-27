/**
 * What the wiki service keeps on disk: the registry (`<stateDir>/wikis.json`) and change request
 * metadata, a commit under `refs/wiki/change-requests/<id>` holding `change-request.json` with one
 * child commit per update. Everything else (amendments, files, indexes) derives from the repo.
 *
 * @module wikiStorage
 */
import { isWikiDocument, parseAmendmentTrailers } from "@mercurian/wiki";
import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  type WikiAmendmentSummary,
  WikiChangeRequestId,
  WikiChangeRequestStatus,
  WikiId,
  WikiMirrorStatus,
} from "@t3tools/contracts";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Schema from "effect/Schema";

export const WikiRecord = Schema.Struct({
  wikiId: WikiId,
  name: TrimmedNonEmptyString,
  root: TrimmedNonEmptyString,
  mainBranch: TrimmedNonEmptyString,
  projectId: Schema.NullOr(ProjectId),
  mirror: Schema.NullOr(WikiMirrorStatus),
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
  branch: Schema.String,
  base: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  createdBy: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  mergedCommit: Schema.NullOr(Schema.String),
});
export type ChangeRequestRecord = typeof ChangeRequestRecord.Type;

export const ChangeRequestRecordJson = fromJsonStringPretty(ChangeRequestRecord);

export const CHANGE_REQUEST_FILE = "change-request.json";
export const changeRequestBranch = (id: string) => `refs/heads/cr/${id}`;
export const changeRequestMetadataRef = (id: string) => `refs/wiki/change-requests/${id}`;
export const CHANGE_REQUEST_BRANCH_PREFIX = "refs/heads/cr/";
export const CHANGE_REQUEST_METADATA_PREFIX = "refs/wiki/change-requests/";

/** The wiki documents of a `git ls-tree -z` listing, with their blob ids. */
export const parseDocumentListing = (
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
      !file.includes("\n") &&
      isWikiDocument(file)
      ? [{ file, oid }]
      : [];
  });

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
        },
      ];
    });

/** How far back edit times are read; a file untouched for longer shows no edit time. */
export const EDIT_TIMES_DEPTH = 2000;
export const EDIT_TIMES_FORMAT = "%x1e%cI";

/**
 * When each file was last changed, from `git log --no-renames --name-only -z` (newest first)
 * with {@link EDIT_TIMES_FORMAT}: the first commit naming a file is its latest.
 */
export const parseEditTimes = (output: string): ReadonlyMap<string, string> => {
  const times = new Map<string, string>();
  for (const record of output.split("\x1e").slice(1)) {
    const [header = "", ...files] = record.split("\0");
    const [at, first] = header.split("\n");
    if (!at) continue;
    for (const file of [first ?? "", ...files.map((name) => name.replace(/^\n/, ""))]) {
      if (file && !times.has(file)) times.set(file, at);
    }
  }
  return times;
};

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
