import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { DocumentChangeSetJson, DocumentClientId, DocumentLoadId } from "./documents.ts";

/**
 * Astrolabe: language servers run in the environment, per checkout: a language's primary server,
 * and the companions that join it on a file. The environment is their only LSP client and feeds
 * them its open documents; browsers speak LSP to its gateway over `languageServers.session` and
 * `languageServers.send`, one session per editor however many servers stand behind it.
 */

export const LanguageServerId = Schema.Literals([
  "typescript",
  "basedpyright",
  "rust-analyzer",
  "gopls",
  "clangd",
  "jdtls",
  "ruff",
  "eslint",
  "tailwindcss",
]);
export type LanguageServerId = typeof LanguageServerId.Type;

/** Each primary server's file extensions, and the LSP language id it opens each with. */
const LANGUAGE_IDS: Readonly<Partial<Record<LanguageServerId, Readonly<Record<string, string>>>>> =
  {
    typescript: {
      ts: "typescript",
      mts: "typescript",
      cts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      jsx: "javascriptreact",
    },
    basedpyright: { py: "python", pyi: "python" },
    "rust-analyzer": { rs: "rust" },
    gopls: { go: "go" },
    clangd: {
      c: "c",
      // clangd reads a header's language from the compile commands, not this id.
      h: "cpp",
      cc: "cpp",
      cpp: "cpp",
      cxx: "cpp",
      "c++": "cpp",
      hh: "cpp",
      hpp: "cpp",
      hxx: "cpp",
      "h++": "cpp",
      ipp: "cpp",
      tpp: "cpp",
      m: "objective-c",
      mm: "objective-cpp",
    },
    jdtls: { java: "java" },
  };

/** The extensions each companion joins the primary on, in the order they follow it. */
const COMPANION_EXTENSIONS: ReadonlyArray<readonly [LanguageServerId, ReadonlySet<string>]> = [
  ["ruff", new Set(["py", "pyi"])],
  ["eslint", new Set(["ts", "mts", "cts", "tsx", "js", "mjs", "cjs", "jsx"])],
  ["tailwindcss", new Set(["ts", "tsx", "js", "jsx"])],
];

const SERVER_FOR_EXTENSION: ReadonlyMap<
  string,
  { readonly server: LanguageServerId; readonly languageId: string }
> = new Map(
  Object.entries(LANGUAGE_IDS).flatMap(([server, extensions]) =>
    Object.entries(extensions).map(
      ([extension, languageId]) =>
        [extension, { server: server as LanguageServerId, languageId }] as const,
    ),
  ),
);

export interface LanguageServerForPath {
  readonly server: LanguageServerId;
  readonly languageId: string;
}

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : name.slice(dot + 1).toLowerCase();
};

/** The server that answers for a file, and the LSP language id it opens it with; null for none. */
export function languageServerForPath(path: string): LanguageServerForPath | null {
  const extension = extensionOf(path);
  return extension === null ? null : (SERVER_FOR_EXTENSION.get(extension) ?? null);
}

/** Every server that can serve a file, primary first; a checkout may not activate them all. */
export function languageServersForPath(path: string): ReadonlyArray<LanguageServerForPath> {
  const primary = languageServerForPath(path);
  if (primary === null) return [];
  const extension = extensionOf(path) ?? "";
  return [
    primary,
    ...COMPANION_EXTENSIONS.filter(([, extensions]) => extensions.has(extension)).map(
      ([server]) => ({ server, languageId: primary.languageId }),
    ),
  ];
}

/** Whether a server joins a primary on its files, rather than serving a language itself. */
export const isCompanionLanguageServer = (server: LanguageServerId) =>
  COMPANION_EXTENSIONS.some(([companion]) => companion === server);

export const LanguageServerState = Schema.Literals([
  /** The project isn't trusted, and this server needs a download or runs its code. */
  "trust-needed",
  "downloading",
  "starting",
  "ready",
  /** Gave up after crashing too often, or could not start; `message` says why. */
  "failed",
  /** Not on this machine, and nothing here can install it; `message` says what to install. */
  "missing",
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

/** What each language server would run for a checkout, without starting or downloading it. */
export const LanguageServerCheckInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type LanguageServerCheckInput = typeof LanguageServerCheckInput.Type;

export const LanguageServerCheck = Schema.Struct({
  server: LanguageServerId,
  /** The languages it serves: "C and C++". */
  languages: Schema.String,
  /** "rust-analyzer 1.99.0", or the bare name before a version is known. */
  name: Schema.String,
  /**
   * `download`: the first file of its language downloads it. `trust`: it won't start until the
   * project is trusted.
   */
  state: Schema.Literals(["found", "download", "trust", "missing"]),
  source: Schema.NullOr(LanguageServerSource),
  /** The binary that runs, when found. */
  executable: Schema.NullOr(Schema.String),
  /** Why it's missing, what downloading fetches, or what the checkout lacks for it. */
  message: Schema.NullOr(Schema.String),
  /** For a companion: whether this checkout uses it, and what says so. Null for a primary. */
  companion: Schema.NullOr(Schema.Struct({ active: Schema.Boolean, reason: Schema.String })),
});
export type LanguageServerCheck = typeof LanguageServerCheck.Type;

export const LanguageServerCheckResult = Schema.Struct({
  /** Whether the checkout's project is trusted on this environment. */
  trusted: Schema.Boolean,
  servers: Schema.Array(LanguageServerCheck),
});
export type LanguageServerCheckResult = typeof LanguageServerCheckResult.Type;

/** A checkout, standing for every checkout of its repository: they share trust. */
export const LanguageServerTrustInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type LanguageServerTrustInput = typeof LanguageServerTrustInput.Type;

export const LanguageServerLogSource = Schema.Literals([
  "stderr",
  /** `window/logMessage`. */
  "log",
  /** `window/showMessage`, which the server means a person to see. */
  "message",
  /** The environment's own note: a start, an exit. */
  "environment",
]);
export type LanguageServerLogSource = typeof LanguageServerLogSource.Type;

export const LanguageServerLogLine = Schema.Struct({
  /** Milliseconds since the epoch. */
  at: NonNegativeInt,
  source: LanguageServerLogSource,
  /** The server's own severity, for `log` and `message`. */
  severity: Schema.optional(Schema.Literals(["error", "warning", "info", "log"])),
  text: Schema.String,
});
export type LanguageServerLogLine = typeof LanguageServerLogLine.Type;

/** One LSP message as JSON, cut when long. It can hold file contents: memory only, off by default. */
export const LanguageServerTraceEntry = Schema.Struct({
  at: NonNegativeInt,
  /** As the environment sees it: `sent` went to the server. */
  direction: Schema.Literals(["sent", "received"]),
  text: Schema.String,
});
export type LanguageServerTraceEntry = typeof LanguageServerTraceEntry.Type;

/** A server as a person debugging it wants it: its status, and the process behind it. */
export const LanguageServerInfo = Schema.Struct({
  ...LanguageServerStatus.fields,
  /** The last launch's: they stay after the process stops. */
  binary: Schema.NullOr(Schema.String),
  args: Schema.Array(Schema.String),
  /** What the running server says it is. */
  version: Schema.NullOr(Schema.String),
  pid: Schema.NullOr(NonNegativeInt),
  /** The running server's capabilities, as JSON. */
  capabilities: Schema.NullOr(Schema.String),
});
export type LanguageServerInfo = typeof LanguageServerInfo.Type;

const LanguageServerLogState = Schema.Struct({
  /** Null while no server runs for the target: it may have stopped for being idle. */
  info: Schema.NullOr(LanguageServerInfo),
  tracing: Schema.Boolean,
});

export const LanguageServerLogItem = Schema.Union([
  /** What the environment has kept. */
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    state: LanguageServerLogState,
    lines: Schema.Array(LanguageServerLogLine),
    trace: Schema.Array(LanguageServerTraceEntry),
  }),
  /** What arrived since the last item, batched; `state` only when it changed. */
  Schema.Struct({
    type: Schema.Literal("batch"),
    state: Schema.optional(LanguageServerLogState),
    lines: Schema.Array(LanguageServerLogLine),
    trace: Schema.Array(LanguageServerTraceEntry),
  }),
]);
export type LanguageServerLogItem = typeof LanguageServerLogItem.Type;

export const LanguageServerSetTraceInput = Schema.Struct({
  ...LanguageServerTarget.fields,
  enabled: Schema.Boolean,
});
export type LanguageServerSetTraceInput = typeof LanguageServerSetTraceInput.Type;

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
  if (Array.isArray(document?.unconfirmed) && document.unconfirmed.length > 0) return true;
  const message = (input as { readonly message?: unknown }).message;
  if (typeof message !== "string") return false;
  try {
    const parsed = JSON.parse(message) as { readonly method?: unknown };
    return typeof parsed.method === "string" && WRITING_METHODS.has(parsed.method);
  } catch {
    return false;
  }
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

/** Where a symbol is: lines and columns count from 1, columns in UTF-16 code units. */
export const CodeLocation = Schema.Struct({
  /** Repository-relative, or absolute for a file outside the checkout (a library's types). */
  path: Schema.String,
  line: PositiveInt,
  column: PositiveInt,
  endLine: PositiveInt,
  endColumn: PositiveInt,
  /** The text of the location's first line, cut to 200 characters. */
  preview: Schema.String,
});
export type CodeLocation = typeof CodeLocation.Type;

export const CodeLocationKind = Schema.Literals([
  "definition",
  "declaration",
  "typeDefinition",
  "implementation",
  "references",
]);
export type CodeLocationKind = typeof CodeLocationKind.Type;

export const CodeLocations = Schema.Struct({
  locations: Schema.Array(CodeLocation),
  /** Only the first locations are listed. */
  truncated: Schema.Boolean,
});
export type CodeLocations = typeof CodeLocations.Type;

/**
 * A language server's edit the environment applied (a rename, a code action): the files it
 * changed, and the id that undoes it while the environment keeps it.
 */
export const LanguageServerAppliedEdit = Schema.Struct({
  id: TrimmedNonEmptyString,
  /** Repository-relative. */
  files: Schema.Array(Schema.String),
  edits: NonNegativeInt,
});
export type LanguageServerAppliedEdit = typeof LanguageServerAppliedEdit.Type;

export const LanguageServerUndoEditInput = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
});
export type LanguageServerUndoEditInput = typeof LanguageServerUndoEditInput.Type;

export const LanguageServerUndoEditResult = Schema.Struct({
  /** Repository-relative: the files put back. */
  files: Schema.Array(Schema.String),
  /** Files left as they are: closed and changed since, so the edit can't be found in them. */
  skipped: Schema.Array(Schema.String),
});
export type LanguageServerUndoEditResult = typeof LanguageServerUndoEditResult.Type;

/** LSP requests whose answer the environment applies to files, so a send of one writes. */
const WRITING_METHODS = new Set(["textDocument/rename", "astrolabe/applyCodeAction"]);
/** A checkout's problems: the files language servers have open, or had open since they started. */
export const LanguageServerProblemsInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type LanguageServerProblemsInput = typeof LanguageServerProblemsInput.Type;

export const LanguageServerProblemsItem = Schema.Union([
  /** Every file with problems now. */
  Schema.Struct({ type: Schema.Literal("snapshot"), files: Schema.Array(FileDiagnostics) }),
  /** One file's problems changed; an empty list means it has none now. */
  Schema.Struct({ type: Schema.Literal("file"), file: FileDiagnostics }),
]);
export type LanguageServerProblemsItem = typeof LanguageServerProblemsItem.Type;

export const LanguageServerErrorReason = Schema.Literals([
  /** No language server serves this file. */
  "unsupported",
  "trust-needed",
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
