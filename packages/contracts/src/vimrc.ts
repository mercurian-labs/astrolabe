import * as Schema from "effect/Schema";
import { ForwardCompatibleArray, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Astrolabe: the server's vimrc, a plain vimrc file next to keybindings.json that every Vim editor
 * of that server's clients applies. Clients edit it line by line through the RPCs below; a hand
 * edit to the file applies live. `@t3tools/shared/vimrc` reads and edits the text.
 */

/** A longer file is not applied at all, so a mistake never rides the wire whole. */
export const MAX_VIMRC_LENGTH = 20_000;
const MAX_VIM_KEYS_LENGTH = 64;
const MAX_VIM_KEYS_SENT_LENGTH = 256;

/** The modes a mapping row offers: `nmap`, `vmap`, `imap`, and plain `map` (`all`). */
export const VimMappingMode = Schema.Literals(["normal", "visual", "insert", "all"]);
export type VimMappingMode = typeof VimMappingMode.Type;

/** A mapping's left side in Vim key notation (`jk`, `<C-d>`, `<Space>w`): no spaces. */
export const VimMappingKeys = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_VIM_KEYS_LENGTH),
  Schema.isPattern(/^\S+$/),
);

/** What a mapping sends, in Vim key notation; one line. */
export const VimMappingSends = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_VIM_KEYS_SENT_LENGTH),
  Schema.isPattern(/^[^\r\n]*\S[^\r\n]*$/),
);

/** A mapping's identity in the file: its mode and keys. */
export const VimMappingTarget = Schema.Struct({
  mode: VimMappingMode,
  keys: VimMappingKeys,
});
export type VimMappingTarget = typeof VimMappingTarget.Type;

export const VimMapping = Schema.Struct({
  mode: VimMappingMode,
  keys: VimMappingKeys,
  does: VimMappingSends,
  /** `nmap` rather than `nnoremap`: what it sends is mapped again. */
  recursive: Schema.Boolean,
});
export type VimMapping = typeof VimMapping.Type;

export const ServerUpsertVimMappingInput = Schema.Struct({
  ...VimMapping.fields,
  /** The mapping this one replaces, when its mode or keys changed. */
  replace: Schema.optional(VimMappingTarget),
});
export type ServerUpsertVimMappingInput = typeof ServerUpsertVimMappingInput.Type;

export const ServerRemoveVimMappingInput = VimMappingTarget;
export type ServerRemoveVimMappingInput = typeof ServerRemoveVimMappingInput.Type;

/** The options Settings offers; null removes the option's `set` lines (back to the default). */
export const ServerSetVimOptionInput = Schema.Union([
  Schema.Struct({ name: Schema.Literal("pcre"), value: Schema.NullOr(Schema.Boolean) }),
  Schema.Struct({
    name: Schema.Literal("insertModeEscKeysTimeout"),
    value: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))),
  }),
]);
export type ServerSetVimOptionInput = typeof ServerSetVimOptionInput.Type;
export type VimOptionName = ServerSetVimOptionInput["name"];

const VimrcMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("vimrc.malformed-config"),
  message: TrimmedNonEmptyString,
});

/** A line the vimrc cannot apply; the rest of the file still applies. */
const VimrcInvalidLineIssue = Schema.Struct({
  kind: Schema.Literal("vimrc.invalid-line"),
  message: TrimmedNonEmptyString,
  /** 1-based, as an editor numbers lines. */
  line: Schema.Number,
});

export const VimrcIssue = Schema.Union([VimrcMalformedConfigIssue, VimrcInvalidLineIssue]);
export type VimrcIssue = typeof VimrcIssue.Type;

/** The vimrc as a server serves it: the file's text, and the lines it cannot apply. */
export const ServerVimrc = Schema.Struct({
  text: Schema.String,
  issues: ForwardCompatibleArray(VimrcIssue),
});
export type ServerVimrc = typeof ServerVimrc.Type;

export class VimrcConfigError extends Schema.TaggedError<VimrcConfigError>()("VimrcConfigError", {
  configPath: Schema.String,
  operation: Schema.Literals(["read", "write"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.operation === "read" ? "Unable to read the vimrc." : "Unable to write the vimrc.";
  }
}
