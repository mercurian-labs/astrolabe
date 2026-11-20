import type {
  OrchestrationV2Checkpoint,
  OrchestrationV2CheckpointScope,
  OrchestrationV2ThreadEditedFile,
} from "@t3tools/contracts";
import { FILE_HEADERS_ONLY, formatPatch, structuredPatch } from "diff";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/** One file's diff is told in full up to this; past it the agent is asked to read the file. */
const MAX_FILE_DIFF_CHARS = 8_000;
/** All the files' diffs together, so many edited files can't crowd a turn. */
const MAX_NOTE_CHARS = 24_000;
/** Files bigger than this are neither read nor diffed. */
const MAX_FILE_BYTES = 1024 * 1024;

/** What the agent hears of one edited file: its diff, or failing that its length. */
export interface EditedFileChange {
  readonly path: string;
  /** The user's changes as a unified diff; null when too large or there is no base to diff. */
  readonly diff: string | null;
  /** Lines in the file now; null when it is gone or too large to read. */
  readonly lines: number | null;
}

/** A path inside the checkout, which is all a file edit may name. */
export function isCheckoutRelativePath(path: string): boolean {
  return !/^([\\/]|[a-zA-Z]:)/.test(path) && !path.split(/[\\/]/).includes("..");
}

/**
 * Astrolabe: the files the user edited since `since`, newest first, less those the user's message
 * `omit`s, by the server's rule the client's pill follows (`editedFilesSinceLastPrompt`).
 */
export function editedFilesSince(
  files: ReadonlyArray<OrchestrationV2ThreadEditedFile>,
  since: DateTime.Utc,
  omit: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  return files.flatMap((file) =>
    DateTime.isGreaterThan(file.editedAt, since) &&
    !omit.includes(file.path) &&
    isCheckoutRelativePath(file.path)
      ? [file.path]
      : [],
  );
}

/**
 * The checkpoint the thread's latest finished turn before run `ordinal` left in `cwd`, which the
 * user's edits are diffed from; undefined when no turn there has one.
 */
export function latestTurnCheckpoint(
  checkpoints: ReadonlyArray<OrchestrationV2Checkpoint>,
  scopes: ReadonlyArray<OrchestrationV2CheckpointScope>,
  cwd: string,
  ordinal: number,
): OrchestrationV2Checkpoint | undefined {
  const scopesHere = new Set(scopes.filter((scope) => scope.cwd === cwd).map(({ id }) => id));
  return checkpoints
    .filter(
      (checkpoint) =>
        checkpoint.status === "ready" &&
        checkpoint.appRunOrdinal !== null &&
        checkpoint.appRunOrdinal < ordinal &&
        scopesHere.has(checkpoint.scopeId),
    )
    .reduce<OrchestrationV2Checkpoint | undefined>(
      (latest, checkpoint) =>
        latest === undefined ||
        (checkpoint.appRunOrdinal ?? 0) > (latest.appRunOrdinal ?? 0) ||
        ((checkpoint.appRunOrdinal ?? 0) === (latest.appRunOrdinal ?? 0) &&
          DateTime.isGreaterThan(checkpoint.capturedAt, latest.capturedAt))
          ? checkpoint
          : latest,
      undefined,
    );
}

const lineCount = (text: string) =>
  text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

/** The change from `before` to `after` (null for no file) as a unified diff with file headers. */
export function fileDiff(path: string, before: string | null, after: string | null): string {
  const patch = structuredPatch(
    before === null ? "/dev/null" : `a/${path}`,
    after === null ? "/dev/null" : `b/${path}`,
    before ?? "",
    after ?? "",
  );
  return formatPatch(patch, FILE_HEADERS_ONLY);
}

/**
 * What one file's change is told as: `before` is the file at the last turn's end (null when that
 * turn had none of it, undefined when unknown), `after` is now (null once deleted). No diff when
 * the base is unknown or the diff is too long to tell in full; null when the file reads as the
 * last turn left it, so there is nothing to tell.
 */
export function editedFileChange(
  path: string,
  before: string | null | undefined,
  after: string | null,
): EditedFileChange | null {
  const lines = after === null ? null : lineCount(after);
  if (before === undefined) return { path, diff: null, lines };
  if ((before ?? "") === (after ?? "")) return null;
  const diff = fileDiff(path, before, after);
  return { path, diff: diff.length > MAX_FILE_DIFF_CHARS ? null : diff, lines };
}

/**
 * Astrolabe: what the agent hears of the files the user edited since its last turn, as diffs from
 * how that turn left them; a file whose diff can't be told is named for the agent to read. Null
 * when none.
 */
export function editedFilesNote(changes: ReadonlyArray<EditedFileChange>): string | null {
  if (changes.length === 0) return null;
  let budget = MAX_NOTE_CHARS;
  const files = changes.map(({ path, diff, lines }) => {
    if (diff !== null && diff.length <= budget) {
      budget -= diff.length;
      return [`<file path="${path}">`, "```diff", diff.trimEnd(), "```", "</file>"].join("\n");
    }
    return lines === null
      ? `<file path="${path}">It was deleted, or is too large to read here. Check it before you work on it.</file>`
      : `<file path="${path}" lines="${lines}">Read the file to see their changes before you work on it.</file>`;
  });
  return [
    "Since your last turn the user edited files in this thread's checkout. Each diff runs from where your last turn left the file to how they left it: build on their version, and don't undo what they changed.",
    ...files,
  ].join("\n\n");
}

/**
 * Reads a checkout's files now from disk, and as `checkpoint` had them from git. `now` is null
 * once deleted; `base` is null when the checkpoint had no such file. Either is undefined when it
 * can't be read. `git` runs in the checkout, null when it can't.
 */
export const checkoutFiles = Effect.fn("EditedFilesNote.checkoutFiles")(function* (
  input: { readonly cwd: string; readonly checkpoint: OrchestrationV2Checkpoint | undefined },
  git: GitVcsDriver.GitVcsDriver["Service"] | null,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runGit = (operation: string, args: ReadonlyArray<string>) =>
    git === null
      ? Effect.succeed(null)
      : git
          .execute({
            operation: `EditedFilesNote.${operation}`,
            cwd: input.cwd,
            args,
            allowNonZeroExit: true,
            maxOutputBytes: MAX_FILE_BYTES + 1,
          })
          .pipe(Effect.orElseSucceed(() => null));

  const now = Effect.fn("EditedFilesNote.readNow")(function* (file: string) {
    const absolute = path.join(input.cwd, file);
    const info = yield* fileSystem.stat(absolute).pipe(Effect.option);
    if (info._tag === "None" || info.value.type !== "File") return null;
    if (Number(info.value.size) > MAX_FILE_BYTES) return undefined;
    return yield* fileSystem.readFileString(absolute).pipe(Effect.orElseSucceed(() => undefined));
  });

  const base = Effect.fn("EditedFilesNote.readBase")(function* (file: string) {
    if (input.checkpoint === undefined) return undefined;
    const listed = yield* runGit("listBase", ["ls-tree", input.checkpoint.ref, "--", `./${file}`]);
    if (listed === null || listed.exitCode !== 0) return undefined;
    const entry = listed.stdout.trim();
    if (entry === "") return null;
    const [, type, id] = entry.split("\t")[0]?.split(" ") ?? [];
    if (type !== "blob" || id === undefined) return undefined;
    const blob = yield* runGit("readBase", ["cat-file", "blob", id]);
    if (blob === null || blob.exitCode !== 0 || blob.stdoutTruncated) return undefined;
    return blob.stdout;
  });

  return { now, base, git: runGit };
});

/**
 * The edited files' changes since `checkpoint`: each file now from disk, and as the checkpoint had
 * it from git. Without a checkpoint each file is named with its length.
 */
export const readEditedFileChanges = Effect.fn("EditedFilesNote.readEditedFileChanges")(function* (
  input: {
    readonly cwd: string;
    readonly paths: ReadonlyArray<string>;
    readonly checkpoint: OrchestrationV2Checkpoint | undefined;
  },
  git: GitVcsDriver.GitVcsDriver["Service"] | null,
) {
  const files = yield* checkoutFiles(input, git);
  const changes = yield* Effect.forEach(input.paths, (file) =>
    Effect.gen(function* () {
      const after = yield* files.now(file);
      if (after === undefined) return { path: file, diff: null, lines: null };
      return editedFileChange(file, yield* files.base(file), after);
    }),
  );
  return changes.filter((change) => change !== null);
});

/**
 * Whether the file reads as `checkpoint` left it, so the user's edits to it net out to nothing.
 * False when there is no checkpoint or either side can't be read.
 */
export const editedFileUndone = Effect.fn("EditedFilesNote.editedFileUndone")(function* (
  input: {
    readonly cwd: string;
    readonly path: string;
    readonly checkpoint: OrchestrationV2Checkpoint | undefined;
  },
  git: GitVcsDriver.GitVcsDriver["Service"] | null,
) {
  if (input.checkpoint === undefined || !isCheckoutRelativePath(input.path)) return false;
  const files = yield* checkoutFiles(input, git);
  const after = yield* files.now(input.path);
  if (after === undefined) return false;
  const before = yield* files.base(input.path);
  return before !== undefined && editedFileChange(input.path, before, after) === null;
});
