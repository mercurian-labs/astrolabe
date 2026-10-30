import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Astrolabe: the text an open file's change markers compare against. `head` is the committed
 * text; the base is a parameter so other bases can join it.
 */
export const VcsBaseTextBase = Schema.Literal("head");
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
 * in a repository, untracked, binary, or too big to read whole.
 */
export const VcsBaseTextResult = Schema.NullOr(
  Schema.Struct({
    text: Schema.String,
    hash: Schema.String,
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
