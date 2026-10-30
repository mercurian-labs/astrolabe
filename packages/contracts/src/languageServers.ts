import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { DocumentChangeSetJson, DocumentClientId, DocumentLoadId } from "./documents.ts";

/**
 * Astrolabe: language servers run in the environment, one per language per checkout. The
 * environment is their only LSP client and feeds them its open documents; browsers speak LSP to
 * its gateway over `languageServers.session` and `languageServers.send`.
 */

export const LanguageServerId = Schema.Literals(["typescript"]);
export type LanguageServerId = typeof LanguageServerId.Type;

const TYPESCRIPT_LANGUAGE_IDS: Readonly<Record<string, string>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
};

/** The server that serves a file, and the LSP language id it opens it with; null for none. */
export function languageServerForPath(
  path: string,
): { readonly server: LanguageServerId; readonly languageId: string } | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  // `.d.ts` files are part of the project the server already loads.
  const languageId = TYPESCRIPT_LANGUAGE_IDS[name.slice(dot + 1).toLowerCase()];
  return languageId === undefined ? null : { server: "typescript", languageId };
}

export const LanguageServerState = Schema.Literals([
  /** Nothing usable is installed, and the environment's first download waits for a yes. */
  "download-needed",
  "downloading",
  "starting",
  "ready",
  /** Gave up after crashing too often, or could not start; `message` says why. */
  "failed",
  /** Stopped on request; opening files does not start it again until it is restarted. */
  "stopped",
  /** Stopped to keep the environment inside its language-server memory budget. */
  "capped",
]);
export type LanguageServerState = typeof LanguageServerState.Type;

export const LanguageServerSource = Schema.Literals(["project", "path", "cache", "download"]);
export type LanguageServerSource = typeof LanguageServerSource.Type;

export const LanguageServerStatus = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  server: LanguageServerId,
  /** What runs, as people know it: "TypeScript 7.0.2". */
  name: Schema.String,
  state: LanguageServerState,
  source: Schema.NullOr(LanguageServerSource),
  /** An untrusted repository: our own build with the features that run repository code off. */
  restricted: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
  memoryBytes: Schema.NullOr(NonNegativeInt),
});
export type LanguageServerStatus = typeof LanguageServerStatus.Type;

export const LanguageServerTarget = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  server: LanguageServerId,
});
export type LanguageServerTarget = typeof LanguageServerTarget.Type;

/** Chosen by the client, unique per connection. */
export const LanguageServerSessionId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

export const LanguageServerSessionInput = Schema.Struct({
  ...LanguageServerTarget.fields,
  sessionId: LanguageServerSessionId,
});
export type LanguageServerSessionInput = typeof LanguageServerSessionInput.Type;

export const LanguageServerSessionItem = Schema.Union([
  Schema.Struct({ type: Schema.Literal("status"), status: LanguageServerStatus }),
  Schema.Struct({
    type: Schema.Literal("message"),
    /** One LSP message, as JSON. */
    message: Schema.String,
    /**
     * Set when the message's positions are in the document at this version of the environment's
     * copy (diagnostics); answers to requests are in the request's own coordinates.
     */
    version: Schema.optional(NonNegativeInt),
  }),
]);
export type LanguageServerSessionItem = typeof LanguageServerSessionItem.Type;

/** What a request's positions are relative to: the editor's document at its last LSP sync. */
export const LanguageServerDocumentState = Schema.Struct({
  loadId: DocumentLoadId,
  /** The environment version the editor's confirmed text is at. */
  version: NonNegativeInt,
  clientId: DocumentClientId,
  /** The editor's edits the environment has not confirmed, which the gateway lands first. */
  unconfirmed: Schema.Array(DocumentChangeSetJson).check(Schema.isMaxLength(1000)),
});
export type LanguageServerDocumentState = typeof LanguageServerDocumentState.Type;

const LANGUAGE_SERVER_MESSAGE_MAX_LENGTH = 1024 * 1024;

export const LanguageServerSendInput = Schema.Struct({
  sessionId: LanguageServerSessionId,
  message: Schema.String.check(Schema.isMaxLength(LANGUAGE_SERVER_MESSAGE_MAX_LENGTH)),
  document: Schema.optional(LanguageServerDocumentState),
});
export type LanguageServerSendInput = typeof LanguageServerSendInput.Type;

/** A send that lands edits on the environment's copy writes the file. */
export const languageServerSendWrites = (input: unknown): boolean => {
  if (typeof input !== "object" || input === null) return false;
  const document = (input as { readonly document?: { readonly unconfirmed?: unknown } }).document;
  return Array.isArray(document?.unconfirmed) && document.unconfirmed.length > 0;
};

export const DiagnosticSeverity = Schema.Literals(["error", "warning", "info", "hint"]);
export type DiagnosticSeverity = typeof DiagnosticSeverity.Type;

/** Lines and columns count from 1; columns in UTF-16 code units, as LSP has them. */
export const FileDiagnostic = Schema.Struct({
  severity: DiagnosticSeverity,
  line: PositiveInt,
  column: PositiveInt,
  endLine: PositiveInt,
  endColumn: PositiveInt,
  message: Schema.String,
  code: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
});
export type FileDiagnostic = typeof FileDiagnostic.Type;

export const FileDiagnostics = Schema.Struct({
  path: Schema.String,
  /** The environment's version of the file the diagnostics are for. */
  version: NonNegativeInt,
  diagnostics: Schema.Array(FileDiagnostic),
  /** Only the first diagnostics are listed. */
  truncated: Schema.Boolean,
});
export type FileDiagnostics = typeof FileDiagnostics.Type;

export const LanguageServerErrorReason = Schema.Literals([
  /** No language server serves this file. */
  "unsupported",
  "download-needed",
  "not-running",
  "failed",
  "timeout",
  /** The session is gone or never existed: open it again. */
  "no-session",
  "document",
]);
export type LanguageServerErrorReason = typeof LanguageServerErrorReason.Type;

export class LanguageServerError extends Schema.TaggedError<LanguageServerError>()(
  "LanguageServerError",
  {
    reason: LanguageServerErrorReason,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
