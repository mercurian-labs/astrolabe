import * as Schema from "effect/Schema";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Astrolabe: the text an open file's change markers compare against. `head` is the committed
 * text. `turn` is the file as it was when the latest turn, from any thread, that changed it in
 * this checkout started; a running turn counts once the file differs from its start.
 */
export const VcsBaseTextBase = Schema.Literals(["head", "turn"]);
export type VcsBaseTextBase = typeof VcsBaseTextBase.Type;

export const VcsBaseTextInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Relative to `cwd`. */
  path: TrimmedNonEmptyString,
  base: VcsBaseTextBase,
});
export type VcsBaseTextInput = typeof VcsBaseTextInput.Type;

/**
 * The base's text and its Git blob id, or null when the file has none to compare against: not
 * in a repository, untracked, binary, or too big to read whole, and for `turn`, no turn in this
 * checkout changed it.
 */
export const VcsBaseTextResult = Schema.NullOr(
  Schema.Struct({
    text: Schema.String,
    hash: Schema.String,
    /** The `turn` base's turn. */
    turn: Schema.optional(
      Schema.Struct({
        threadId: ThreadId,
        running: Schema.Boolean,
      }),
    ),
  }),
);
export type VcsBaseTextResult = typeof VcsBaseTextResult.Type;

export class VcsBaseTextError extends Schema.TaggedError<VcsBaseTextError>()("VcsBaseTextError", {
  cwd: Schema.String,
  path: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Could not read the base text of '${this.path}' in ${this.cwd}: ${this.detail}`;
  }
}
