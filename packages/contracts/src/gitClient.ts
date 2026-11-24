import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * Astrolabe: a git client for one checkout, organised around agent turns. Uncommitted files and
 * commits name the turn that made them; turn attribution is computed when asked, stored nowhere.
 */

/** A turn as the git client names it: "Turn 4 · <thread title>". */
export const GitClientTurn = Schema.Struct({
  runId: RunId,
  threadId: ThreadId,
  threadTitle: Schema.String,
  turnNumber: PositiveInt,
  /** The person's message that started the turn, cut short. */
  request: Schema.String,
  /** That message, for scrolling its chat to the turn. */
  userMessageId: Schema.NullOr(MessageId),
  startedAt: Schema.NullOr(IsoDateTime),
  /** Null while the turn is still working. */
  completedAt: Schema.NullOr(IsoDateTime),
});
export type GitClientTurn = typeof GitClientTurn.Type;

export const GitClientChangeKind = Schema.Literals([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typechange",
]);
export type GitClientChangeKind = typeof GitClientChangeKind.Type;

export const GitClientFile = Schema.Struct({
  /** Relative to the checkout's root. */
  path: TrimmedNonEmptyString,
  /** A rename's or copy's source. */
  originalPath: Schema.NullOr(TrimmedNonEmptyString),
  /** What is staged; null when the index matches HEAD. */
  index: Schema.NullOr(GitClientChangeKind),
  /** What is not staged; null when the file matches the index. */
  workingTree: Schema.NullOr(GitClientChangeKind),
  untracked: Schema.Boolean,
  conflicted: Schema.Boolean,
  /** Against HEAD, staged and unstaged together; null for binary files. */
  additions: Schema.NullOr(NonNegativeInt),
  deletions: Schema.NullOr(NonNegativeInt),
  /** The latest turn whose checkpoint lists the file; null for the person's own change. */
  turnRunId: Schema.NullOr(RunId),
  /** How many earlier turns also changed it. */
  earlierTurns: NonNegativeInt,
});
export type GitClientFile = typeof GitClientFile.Type;

export const GitClientOperation = Schema.Literals(["merge", "rebase", "cherry-pick", "revert"]);
export type GitClientOperation = typeof GitClientOperation.Type;

export const GitClientCwdInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type GitClientCwdInput = typeof GitClientCwdInput.Type;

export const GitClientStatus = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  isRepository: Schema.Boolean,
  /** Null when detached. */
  branch: Schema.NullOr(TrimmedNonEmptyString),
  /** Null before the first commit. */
  head: Schema.NullOr(TrimmedNonEmptyString),
  upstream: Schema.NullOr(TrimmedNonEmptyString),
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
  operation: Schema.NullOr(GitClientOperation),
  files: Schema.Array(GitClientFile),
  /** The turns `files` name, newest first. */
  turns: Schema.Array(GitClientTurn),
  /** A turn working in this checkout now; changes made here wait for it. */
  running: Schema.NullOr(GitClientTurn),
  /** What undo would take back, in a few words; null when nothing can be. */
  undo: Schema.NullOr(Schema.String),
});
export type GitClientStatus = typeof GitClientStatus.Type;

export const GitClientLogInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  limit: PositiveInt,
  skip: Schema.optional(NonNegativeInt),
});
export type GitClientLogInput = typeof GitClientLogInput.Type;

export const GitClientCommit = Schema.Struct({
  sha: TrimmedNonEmptyString,
  subject: Schema.String,
  body: Schema.String,
  authorName: Schema.String,
  authoredAt: IsoDateTime,
  /** On the upstream, or with no upstream, on any remote. */
  pushed: Schema.Boolean,
  /** The turn that was working in this checkout when the commit was made here. */
  turn: Schema.NullOr(GitClientTurn),
});
export type GitClientCommit = typeof GitClientCommit.Type;

export const GitClientLogResult = Schema.Struct({
  commits: Schema.Array(GitClientCommit),
  hasMore: Schema.Boolean,
});
export type GitClientLogResult = typeof GitClientLogResult.Type;

export const GitClientPathsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  paths: Schema.NonEmptyArray(TrimmedNonEmptyString),
});
export type GitClientPathsInput = typeof GitClientPathsInput.Type;

export const GitClientCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Generated when empty or missing. */
  message: Schema.optional(Schema.String),
});
export type GitClientCommitInput = typeof GitClientCommitInput.Type;

export const GitClientCommitResult = Schema.Struct({
  sha: TrimmedNonEmptyString,
  subject: Schema.String,
});
export type GitClientCommitResult = typeof GitClientCommitResult.Type;

export const GitClientMessageResult = Schema.Struct({ message: Schema.String });
export type GitClientMessageResult = typeof GitClientMessageResult.Type;

export class GitClientError extends Schema.TaggedError<GitClientError>()("GitClientError", {
  message: Schema.String,
  /** Set when a turn working in the checkout is why the request was refused. */
  runningThreadId: Schema.optional(ThreadId),
}) {}
