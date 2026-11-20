import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * Astrolabe: intent blame. For each line of a file, the agent turn that last changed it, found by
 * comparing the file with the checkpoints of the turns that changed it.
 */
export const IntentBlameInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Relative to `cwd`. */
  path: TrimmedNonEmptyString,
  /** The editor's unsaved text, when it differs from the file on disk. */
  contents: Schema.optional(Schema.String),
});
export type IntentBlameInput = typeof IntentBlameInput.Type;

/**
 * Where a run of lines came from. `turn`: a turn changed it last. `before`: it was there before
 * every recorded turn that changed the file. `outside`: it changed outside any recorded turn, such
 * as by a person, a merge or pull, or a turn whose checkpoint is gone. `unsaved`: it exists only
 * in the editor's unsaved text.
 */
export const IntentBlameOrigin = Schema.Literals(["turn", "before", "outside", "unsaved"]);
export type IntentBlameOrigin = typeof IntentBlameOrigin.Type;

export const IntentBlameSpan = Schema.Struct({
  /** 1-based and inclusive. */
  startLine: PositiveInt,
  endLine: PositiveInt,
  origin: IntentBlameOrigin,
  /** An index into `turns`, for `turn`. */
  turn: Schema.optional(NonNegativeInt),
});
export type IntentBlameSpan = typeof IntentBlameSpan.Type;

export const IntentBlameTurn = Schema.Struct({
  threadId: ThreadId,
  threadTitle: Schema.String,
  /** The run's ordinal in its thread, as the thread counts its turns. */
  turnNumber: NonNegativeInt,
  /** The person's message that started the turn: where the thread opens. */
  userMessageId: Schema.NullOr(MessageId),
  request: Schema.String,
  /** The agent's last words before it first changed this file in the turn, when they are known. */
  beforeChange: Schema.NullOr(Schema.String),
  /** The agent's last words in the turn. */
  closing: Schema.NullOr(Schema.String),
  /** When the turn's checkpoint was captured. */
  at: IsoDateTime,
  /** The checkout the turn ran in. */
  checkout: Schema.String,
});
export type IntentBlameTurn = typeof IntentBlameTurn.Type;

export const IntentBlameResult = Schema.Struct({
  spans: Schema.Array(IntentBlameSpan),
  /** The turns some line goes to, in the order they ran. */
  turns: Schema.Array(IntentBlameTurn),
  /** Recorded turns that changed the file, whether or not any of their lines remain. */
  changedBy: NonNegativeInt,
  /** Turns that changed the file but whose checkpoints this repository no longer has. */
  missingCheckpoints: NonNegativeInt,
});
export type IntentBlameResult = typeof IntentBlameResult.Type;

export class IntentBlameError extends Schema.TaggedError<IntentBlameError>()("IntentBlameError", {
  cwd: Schema.String,
  path: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Could not find the turns behind '${this.path}' in ${this.cwd}: ${this.detail}`;
  }
}
