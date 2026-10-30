import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * Astrolabe: a repository's code index. Each file's facts (definitions, the names it uses, its
 * imports) are stored once per path and blob and shared by every checkout of the repository, so a
 * branch, worktree or checkpoint costs only the files it changed. Paths are repository-relative.
 */

export const CodeIndexSettings = Schema.Struct({
  enabled: Schema.Boolean,
  /** Gitignore-style patterns skipped on top of ignored, vendored and generated files. */
  skippedPaths: Schema.Array(TrimmedNonEmptyString),
});
export type CodeIndexSettings = typeof CodeIndexSettings.Type;

export const DEFAULT_CODE_INDEX_SETTINGS: CodeIndexSettings = { enabled: true, skippedPaths: [] };

export const CodeIndexErrorReason = Schema.Literals([
  /** The repository's index is turned off. */
  "off",
  /** The answer needs the index, which has not finished its first build. */
  "not-indexed",
  /** The file, folder, symbol or ref does not exist in the checkout. */
  "not-found",
  /** No index for this kind of project, or no parser for this file's language. */
  "unsupported",
  "git-failed",
  "failed",
]);
export type CodeIndexErrorReason = typeof CodeIndexErrorReason.Type;

export class CodeIndexError extends Schema.TaggedError<CodeIndexError>()("CodeIndexError", {
  message: Schema.String,
  reason: CodeIndexErrorReason,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const CodeIndexState = Schema.Literals(["off", "waiting", "indexing", "ready", "failed"]);
export type CodeIndexState = typeof CodeIndexState.Type;

/** One repository's index, as Settings and the local graph show it. */
export const CodeIndexStatus = Schema.Struct({
  projectId: ProjectId,
  state: CodeIndexState,
  /** Files of the repository's own checkout parsed so far; equal to `totalFiles` when ready. */
  files: NonNegativeInt,
  totalFiles: NonNegativeInt,
  languages: Schema.Array(TrimmedNonEmptyString),
  updatedAt: Schema.NullOr(IsoDateTime),
  failure: Schema.NullOr(Schema.String),
});
export type CodeIndexStatus = typeof CodeIndexStatus.Type;

/** Everything the environment's indexes hold on disk, for Settings → Maintenance. */
export const CodeIndexStorage = Schema.Struct({
  bytes: NonNegativeInt,
  fileVersions: NonNegativeInt,
  /** File versions no branch, worktree or checkpoint still uses; cleanup removes them. */
  unusedFileVersions: NonNegativeInt,
});
export type CodeIndexStorage = typeof CodeIndexStorage.Type;

export const CodeIndexProjectInput = Schema.Struct({ projectId: ProjectId });
export type CodeIndexProjectInput = typeof CodeIndexProjectInput.Type;

/** A checkout of a project: the repository's own working directory or a thread's worktree. */
export const CodeCheckout = Schema.Struct({
  projectId: ProjectId,
  cwd: TrimmedNonEmptyString,
});
export type CodeCheckout = typeof CodeCheckout.Type;

/**
 * How sure a link is. `heuristic`: several definitions share the name across files. `overload`:
 * several in one file. `exact`: one definition is left through the file's imports, its own
 * definitions, or the only definition of that name. `resolved`: a language server or SCIP said so.
 */
export const CodeResolution = Schema.Literals(["heuristic", "overload", "exact", "resolved"]);
export type CodeResolution = typeof CodeResolution.Type;

export const CodeSymbolKind = Schema.Literals([
  "class",
  "interface",
  "enum",
  "type",
  "function",
  "method",
  "constant",
  "module",
]);
export type CodeSymbolKind = typeof CodeSymbolKind.Type;

/** Where a change sits relative to the checkout's base branch. */
export const CodeChangeState = Schema.Literals(["branch", "uncommitted"]);
export type CodeChangeState = typeof CodeChangeState.Type;

// The local graph: a file in the middle, the files it imports and the files that import it.

export const CODE_LOCAL_GRAPH_MAX_DEPTH = 3;

export const CodeLocalGraphInput = Schema.Struct({
  ...CodeCheckout.fields,
  path: TrimmedNonEmptyString,
  depth: Schema.Literals([1, 2, 3]),
  uses: Schema.Boolean,
  usedBy: Schema.Boolean,
  /** Show packages from outside the repository (npm, crates, modules) as leaves. */
  dependencies: Schema.Boolean,
  /** Folder groups the reader opened; any other side past the fold limit stays folded. */
  expanded: Schema.Array(TrimmedNonEmptyString),
});
export type CodeLocalGraphInput = typeof CodeLocalGraphInput.Type;

export const CodeGraphNodeKind = Schema.Literals([
  "file",
  /** Another package in the repository, reached through its name; opens its entry file. */
  "package",
  /** A package from outside the repository. */
  "dependency",
  /** A folded group of files. */
  "folder",
]);
export type CodeGraphNodeKind = typeof CodeGraphNodeKind.Type;

export const CodeGraphNode = Schema.Struct({
  /** A file's or folder's path, a package's name, or `dependency:<name>`. */
  id: TrimmedNonEmptyString,
  kind: CodeGraphNodeKind,
  name: TrimmedNonEmptyString,
  /** The file, a package's entry file, or the folder; null for a dependency. */
  path: Schema.NullOr(TrimmedNonEmptyString),
  /** Links from the centre: 0 for the centre. */
  depth: NonNegativeInt,
  lines: Schema.NullOr(NonNegativeInt),
  test: Schema.Boolean,
  changed: Schema.NullOr(CodeChangeState),
  /** A folder group's file count; null otherwise. */
  files: Schema.NullOr(PositiveInt),
});
export type CodeGraphNode = typeof CodeGraphNode.Type;

/** `from` imports `to`. */
export const CodeGraphLink = Schema.Struct({
  from: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
  /** The import in `from`; null for a link into or out of a folder group. */
  line: Schema.NullOr(PositiveInt),
  text: Schema.NullOr(Schema.String),
  resolution: CodeResolution,
});
export type CodeGraphLink = typeof CodeGraphLink.Type;

export const CodeLocalGraph = Schema.Struct({
  center: TrimmedNonEmptyString,
  nodes: Schema.Array(CodeGraphNode),
  links: Schema.Array(CodeGraphLink),
  /** True while the index is building: uses come from parsing the file, used-by waits. */
  usedByPending: Schema.Boolean,
  status: CodeIndexStatus,
});
export type CodeLocalGraph = typeof CodeLocalGraph.Type;

// Agent reads (MCP). Every list is capped and says when it was cut.

export const CodeSymbolEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  kind: CodeSymbolKind,
  path: TrimmedNonEmptyString,
  line: PositiveInt,
  endLine: PositiveInt,
  /** The containing symbol's name: a method's class. */
  parent: Schema.NullOr(TrimmedNonEmptyString),
  signature: Schema.NullOr(Schema.String),
  exported: Schema.Boolean,
});
export type CodeSymbolEntry = typeof CodeSymbolEntry.Type;

export const CodeOutlineInput = Schema.Struct({
  ...CodeCheckout.fields,
  /** A file, or a folder for every file under it. */
  path: TrimmedNonEmptyString,
});
export type CodeOutlineInput = typeof CodeOutlineInput.Type;

export const CodeOutline = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      path: TrimmedNonEmptyString,
      lines: NonNegativeInt,
      symbols: Schema.Array(CodeSymbolEntry),
    }),
  ),
  truncated: Schema.Boolean,
});
export type CodeOutline = typeof CodeOutline.Type;

export const CodeFindInput = Schema.Struct({
  ...CodeCheckout.fields,
  name: TrimmedNonEmptyString,
  /** Narrow definitions to this file or folder. */
  path: Schema.optional(TrimmedNonEmptyString),
});
export type CodeFindInput = typeof CodeFindInput.Type;

export const CodeUse = Schema.Struct({
  path: TrimmedNonEmptyString,
  line: PositiveInt,
  /** The symbol the use sits in; null at a file's top level. */
  from: Schema.NullOr(TrimmedNonEmptyString),
  kind: Schema.Literals(["calls", "instantiates", "inherits", "implements", "types", "imports"]),
  resolution: CodeResolution,
});
export type CodeUse = typeof CodeUse.Type;

export const CodeFindResult = Schema.Struct({
  definitions: Schema.Array(CodeSymbolEntry),
  uses: Schema.Array(CodeUse),
  truncated: Schema.Boolean,
});
export type CodeFindResult = typeof CodeFindResult.Type;

export const CodeChangesInput = Schema.Struct({
  ...CodeCheckout.fields,
  /** Git refs or commits; `to` defaults to the checkout as it is now, unsaved files included. */
  from: TrimmedNonEmptyString,
  to: Schema.optional(TrimmedNonEmptyString),
});
export type CodeChangesInput = typeof CodeChangesInput.Type;

export const CodeChanges = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      path: TrimmedNonEmptyString,
      change: Schema.Literals(["added", "modified", "deleted"]),
    }),
  ),
  symbols: Schema.Array(
    Schema.Struct({
      change: Schema.Literals(["added", "changed", "removed"]),
      symbol: CodeSymbolEntry,
    }),
  ),
  links: Schema.Array(
    Schema.Struct({
      change: Schema.Literals(["made", "broken"]),
      from: TrimmedNonEmptyString,
      to: TrimmedNonEmptyString,
      kind: CodeUse.fields.kind,
      resolution: CodeResolution,
    }),
  ),
  truncated: Schema.Boolean,
});
export type CodeChanges = typeof CodeChanges.Type;

export const CodeMapInput = Schema.Struct({
  ...CodeCheckout.fields,
  /** Files and folders that make up the slice. */
  paths: Schema.Array(TrimmedNonEmptyString),
});
export type CodeMapInput = typeof CodeMapInput.Type;

/** How the files of a slice depend on each other, and what outside the slice they touch. */
export const CodeMap = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      path: TrimmedNonEmptyString,
      lines: NonNegativeInt,
      exports: Schema.Array(TrimmedNonEmptyString),
    }),
  ),
  links: Schema.Array(
    Schema.Struct({
      from: TrimmedNonEmptyString,
      to: TrimmedNonEmptyString,
      names: Schema.Array(TrimmedNonEmptyString),
      resolution: CodeResolution,
    }),
  ),
  /** Files outside the slice that it imports or that import it, with how many links. */
  outside: Schema.Array(
    Schema.Struct({
      path: TrimmedNonEmptyString,
      direction: Schema.Literals(["uses", "usedBy"]),
      links: PositiveInt,
    }),
  ),
  truncated: Schema.Boolean,
});
export type CodeMap = typeof CodeMap.Type;
