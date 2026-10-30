import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Astrolabe: the environment is the authority for open repository files. Clients edit through
 * `@codemirror/collab`: updates carry `ChangeSet.toJSON()` and the client id that made them.
 */

/** Characters, after line breaks are normalized to `\n`. */
export const DOCUMENT_MAX_LENGTH = 2 * 1024 * 1024;

/** The client id the environment uses for changes it finds on disk. */
export const DOCUMENT_DISK_CLIENT_ID = "disk";

export const DocumentTarget = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
});
export type DocumentTarget = typeof DocumentTarget.Type;

/** A fresh id each time the environment loads the file, so versions from an earlier load never match. */
export const DocumentLoadId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

export const DocumentClientId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

/** `ChangeSet.toJSON()`: retained lengths, and `[deleted, ...inserted lines]` replacements. */
export const DocumentChangeSetJson = Schema.Array(
  Schema.Union([Schema.Number, Schema.Array(Schema.Union([Schema.Number, Schema.String]))]),
);

export const DocumentUpdate = Schema.Struct({
  clientId: DocumentClientId,
  changes: DocumentChangeSetJson,
});
export type DocumentUpdate = typeof DocumentUpdate.Type;

export const DocumentSubscribeInput = Schema.Struct({
  ...DocumentTarget.fields,
  /** Where a reconnecting client left off. Honored only while that load is still open. */
  resume: Schema.optional(Schema.Struct({ loadId: DocumentLoadId, version: NonNegativeInt })),
});
export type DocumentSubscribeInput = typeof DocumentSubscribeInput.Type;

const DocumentDiskState = {
  /** The latest version whose text is on disk. */
  savedVersion: NonNegativeInt,
  /**
   * The file is gone from disk; saving waits for an explicit save. With unsaved edits
   * (`savedVersion` behind the version) the document stays open until saved or discarded.
   */
  missing: Schema.Boolean,
};

export const DocumentStreamItem = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    loadId: DocumentLoadId,
    version: NonNegativeInt,
    text: Schema.String,
    ...DocumentDiskState,
  }),
  /** The load a client asked to resume is still open; `updates` are the ones it missed. */
  Schema.Struct({
    type: Schema.Literal("resumed"),
    loadId: DocumentLoadId,
    version: NonNegativeInt,
    updates: Schema.Array(DocumentUpdate),
    ...DocumentDiskState,
  }),
  /** Accepted updates; `version` is the document version before the first one. */
  Schema.Struct({
    type: Schema.Literal("updates"),
    version: NonNegativeInt,
    updates: Schema.Array(DocumentUpdate),
  }),
  Schema.Struct({ type: Schema.Literal("disk"), ...DocumentDiskState }),
]);
export type DocumentStreamItem = typeof DocumentStreamItem.Type;

export const DocumentPushInput = Schema.Struct({
  ...DocumentTarget.fields,
  loadId: DocumentLoadId,
  /** The version the updates were made against. */
  version: NonNegativeInt,
  updates: Schema.Array(DocumentUpdate).check(Schema.isMaxLength(1000)),
});
export type DocumentPushInput = typeof DocumentPushInput.Type;

export const DocumentPushResult = Schema.Struct({ version: NonNegativeInt });
export type DocumentPushResult = typeof DocumentPushResult.Type;

export const DocumentSaveInput = Schema.Struct({
  ...DocumentTarget.fields,
  loadId: DocumentLoadId,
});
export type DocumentSaveInput = typeof DocumentSaveInput.Type;

export const DocumentSaveResult = Schema.Struct({ savedVersion: NonNegativeInt });
export type DocumentSaveResult = typeof DocumentSaveResult.Type;

/** Close without saving: the document goes back to the file on disk, or closes if it is gone. */
export const DocumentDiscardInput = Schema.Struct({
  ...DocumentTarget.fields,
  loadId: DocumentLoadId,
});
export type DocumentDiscardInput = typeof DocumentDiscardInput.Type;

/** A client whose load was evicted while it held unsent edits. */
export const DocumentRecoverInput = Schema.Struct({
  ...DocumentTarget.fields,
  /** The load the client has just subscribed to. */
  loadId: DocumentLoadId,
  clientId: DocumentClientId,
  /** The text at the client's last confirmed version. */
  baseText: Schema.String.check(Schema.isMaxLength(DOCUMENT_MAX_LENGTH)),
  text: Schema.String.check(Schema.isMaxLength(DOCUMENT_MAX_LENGTH)),
});
export type DocumentRecoverInput = typeof DocumentRecoverInput.Type;

export const DocumentRecoverResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("accepted"), version: NonNegativeInt }),
  /** The file changed on disk since `baseText`; nothing was applied. */
  Schema.Struct({ type: Schema.Literal("conflict") }),
]);
export type DocumentRecoverResult = typeof DocumentRecoverResult.Type;

/** Files one replace-all can change. */
export const DOCUMENT_REPLACE_ALL_MAX_FILES = 1000;

/**
 * Replaces every match of a project search in these files, as edits under `clientId` to each
 * file's live document (opened for it when nobody has it open). The environment keeps the
 * inverse of each edit for one `undoReplaceAll`.
 */
export const DocumentReplaceAllInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  clientId: DocumentClientId,
  query: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
  caseSensitive: Schema.Boolean,
  wholeWord: Schema.Boolean,
  useRegex: Schema.Boolean,
  replacement: Schema.String.check(Schema.isMaxLength(64 * 1024)),
  paths: Schema.Array(DocumentTarget.fields.relativePath).check(
    Schema.isMaxLength(DOCUMENT_REPLACE_ALL_MAX_FILES),
  ),
});
export type DocumentReplaceAllInput = typeof DocumentReplaceAllInput.Type;

export const DocumentReplaceAllResult = Schema.Struct({
  /** Names the edit for `undoReplaceAll`; absent when nothing changed. */
  id: Schema.optional(DocumentLoadId),
  files: NonNegativeInt,
  replacements: NonNegativeInt,
  /** Files that could not be opened or edited, with why. */
  failed: Schema.Array(Schema.Struct({ relativePath: Schema.String, message: Schema.String })),
});
export type DocumentReplaceAllResult = typeof DocumentReplaceAllResult.Type;

export const DocumentUndoReplaceAllInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  id: DocumentLoadId,
});
export type DocumentUndoReplaceAllInput = typeof DocumentUndoReplaceAllInput.Type;

export const DocumentUndoReplaceAllResult = Schema.Struct({
  files: NonNegativeInt,
  /** Files closed since, whose replacement could not be taken back. */
  skipped: Schema.Array(Schema.String),
});
export type DocumentUndoReplaceAllResult = typeof DocumentUndoReplaceAllResult.Type;

export const DocumentErrorReason = Schema.Literals([
  /** The load is gone or never existed: subscribe again. */
  "not-loaded",
  "invalid-update",
  "too-large",
  "not-text",
  "not-found",
  "outside-workspace",
  "io",
  "invalid-query",
  /** The replace-all to undo is gone: undone already, replaced by a newer one, or expired. */
  "undo-gone",
]);
export type DocumentErrorReason = typeof DocumentErrorReason.Type;

export class DocumentError extends Schema.TaggedError<DocumentError>()("DocumentError", {
  reason: DocumentErrorReason,
  relativePath: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not-loaded":
        return `'${this.relativePath}' is no longer open on this environment.`;
      case "invalid-update":
        return `An update to '${this.relativePath}' does not fit the document.`;
      case "too-large":
        return `'${this.relativePath}' is too large to edit.`;
      case "not-text":
        return `'${this.relativePath}' is not a text file.`;
      case "not-found":
        return `'${this.relativePath}' does not exist.`;
      case "outside-workspace":
        return `'${this.relativePath}' is outside a known workspace.`;
      case "io":
        return `Reading or writing '${this.relativePath}' failed.`;
      case "invalid-query":
        return "The search is not a valid regular expression.";
      case "undo-gone":
        return "That replace-all can no longer be undone.";
    }
  }
}
