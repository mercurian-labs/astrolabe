import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * Astrolabe: a repository's code index. Each file's facts are stored once per path and blob and
 * shared by every checkout of the repository. Questions take and answer paths relative to the
 * checkout's `cwd`, which may be a folder inside the repository (`../` for files outside it).
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

/** What a cleanup of unused file versions removed. */
export const CodeIndexPruneResult = Schema.Struct({
  bytesFreed: NonNegativeInt,
  fileVersions: NonNegativeInt,
});
export type CodeIndexPruneResult = typeof CodeIndexPruneResult.Type;

export const CodeIndexProjectInput = Schema.Struct({ projectId: ProjectId });
export type CodeIndexProjectInput = typeof CodeIndexProjectInput.Type;

/**
 * A checkout of a project: the repository's own working directory or a thread's worktree. Paths
 * are relative to `cwd`, even when it is a folder inside the repository.
 */
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

// The local graph: the roots in the middle, the files they import and the files that import
// them, at one level of detail, with the nodes the reader opened shown as clusters of their parts.

export const CODE_LOCAL_GRAPH_MAX_DEPTH = 3;

/**
 * How fine a graph's nodes are: folders, the language's modules (a TypeScript package, a Go
 * package, a Python package, a Rust module; a file where the language has none), files, top-level
 * definitions, or members (methods and nested definitions).
 */
export const CodeGraphLevel = Schema.Literals(["directory", "module", "file", "symbol", "member"]);
export type CodeGraphLevel = typeof CodeGraphLevel.Type;

export const CodeLocalGraphInput = Schema.Struct({
  ...CodeCheckout.fields,
  /** Files, folders, or definitions as `path#Qualified.name`; the graph grows around them. */
  roots: Schema.NonEmptyArray(TrimmedNonEmptyString),
  /** Links from the roots; 0 shows the roots and the links between them alone. */
  depth: Schema.Literals([0, 1, 2, 3]),
  uses: Schema.Boolean,
  usedBy: Schema.Boolean,
  /** Show packages from outside the repository (npm, crates, modules) as leaves. */
  dependencies: Schema.Boolean,
  level: CodeGraphLevel,
  /** Nodes whose direct neighbours the reader added, each one more ring out from it. */
  expandedNeighbours: Schema.Array(TrimmedNonEmptyString),
  /** Nodes the reader opened into clusters of their contents, folded folders among them. */
  expandedContents: Schema.Array(TrimmedNonEmptyString),
  /** Nodes the reader closed though the level opens them, or that their contents fold into. */
  collapsedContents: Schema.Array(TrimmedNonEmptyString),
});
export type CodeLocalGraphInput = typeof CodeLocalGraphInput.Type;

export const CodeGraphNodeKind = Schema.Literals([
  "file",
  /** Another package in the repository, reached through its name; opens its entry file. */
  "package",
  /** A package from outside the repository. */
  "dependency",
  /** A folder: the directory level's node, or files folded together on a crowded side. */
  "folder",
  /** A language module holding several files. */
  "module",
  /** A definition: a top-level one, or a member of one. */
  "symbol",
]);
export type CodeGraphNodeKind = typeof CodeGraphNodeKind.Type;

export const CodeGraphNode = Schema.Struct({
  /**
   * A file's or folder's path, `module:<folder>`, `<path>#<Qualified.name>` for a definition, a
   * package's name, or `dependency:<name>`.
   */
  id: TrimmedNonEmptyString,
  kind: CodeGraphNodeKind,
  name: TrimmedNonEmptyString,
  /** The file (a definition's too), a package's entry file, or the folder; null for a dependency. */
  path: Schema.NullOr(TrimmedNonEmptyString),
  /** Links from the nearest root: 0 for a root and what it holds. */
  depth: NonNegativeInt,
  /** A root, or a node holding one or held by one. */
  root: Schema.Boolean,
  lines: Schema.NullOr(NonNegativeInt),
  test: Schema.Boolean,
  changed: Schema.NullOr(CodeChangeState),
  /** How many files a folder or module node stands for; null otherwise. */
  files: Schema.NullOr(PositiveInt),
  /** The open cluster holding the node; null at the top. */
  parent: Schema.NullOr(TrimmedNonEmptyString),
  /** Whether it opens into a cluster of its contents. */
  contents: Schema.Boolean,
  /** A definition's kind and first line; null for every other node. */
  symbol: Schema.NullOr(Schema.Struct({ kind: CodeSymbolKind, line: PositiveInt })),
  /** True when `path` leaves the checkout's `cwd` (`../`), where its file tabs cannot open it. */
  outsideProject: Schema.optional(Schema.Boolean),
});
export type CodeGraphNode = typeof CodeGraphNode.Type;

/** A node opened in place: drawn around the nodes it holds, not as a node. */
export const CodeGraphCluster = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literals(["folder", "module", "file", "symbol"]),
  name: TrimmedNonEmptyString,
  path: Schema.NullOr(TrimmedNonEmptyString),
  parent: Schema.NullOr(TrimmedNonEmptyString),
  root: Schema.Boolean,
});
export type CodeGraphCluster = typeof CodeGraphCluster.Type;

/** `from` imports or uses `to`, or holds what does. */
export const CodeGraphLink = Schema.Struct({
  from: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
  /** The import or use in `from`; null for a link standing for several. */
  line: Schema.NullOr(PositiveInt),
  text: Schema.NullOr(Schema.String),
  /** The surest of the links it stands for. */
  resolution: CodeResolution,
});
export type CodeGraphLink = typeof CodeGraphLink.Type;

export const CodeLocalGraph = Schema.Struct({
  /** The nodes that are or hold a root, as shown. */
  roots: Schema.Array(TrimmedNonEmptyString),
  nodes: Schema.Array(CodeGraphNode),
  clusters: Schema.Array(CodeGraphCluster),
  links: Schema.Array(CodeGraphLink),
  /** Roots the checkout does not hold. */
  unknown: Schema.Array(TrimmedNonEmptyString),
  /** True while the index is building: uses come from parsing the file, used-by waits. */
  usedByPending: Schema.Boolean,
  status: CodeIndexStatus,
});
export type CodeLocalGraph = typeof CodeLocalGraph.Type;

// A view of the code graph an agent shows the user: one step for a picture, several for a story
// they step through. It is the `astrolabe_code_graph_show` call's input, kept in the thread like
// any tool call, and the thread's Graph tab draws it from there. Descriptions use the plain
// NonEmptyString: a trimmed string's annotations never reach the MCP schema.

const GraphId = Schema.NonEmptyString;

export const CodeGraphStepInput = Schema.Struct({
  caption: Schema.NonEmptyString.annotate({
    description: "One or two sentences the user reads under the graph for this step.",
  }),
  focus: Schema.Array(GraphId).annotate({
    description:
      "The nodes this step is about, lit in the graph: file or folder paths, or definitions as `path#Qualified.name` (the `id` that astrolabe_code_outline and astrolabe_code_find return).",
  }),
  links: Schema.optional(
    Schema.Array(Schema.Struct({ from: GraphId, to: GraphId })).annotate({
      description:
        "Links to light, from the node that imports or uses to the one it uses. Links between focus nodes light anyway.",
    }),
  ),
  level: Schema.optional(
    CodeGraphLevel.annotate({
      description:
        "How fine the nodes are: directory, module, file (the default), symbol (top-level definitions), or member (methods).",
    }),
  ),
  depth: Schema.optional(
    Schema.Literals([0, 1, 2, 3]).annotate({
      description:
        "Links out from the story's nodes to show around them; 0 (the default) shows only the nodes named and the links between them.",
    }),
  ),
  expandNeighbours: Schema.optional(
    Schema.Array(GraphId).annotate({
      description: "Nodes whose direct neighbours to add to the graph.",
    }),
  ),
  showContents: Schema.optional(
    Schema.Array(GraphId).annotate({
      description:
        "Folders or files to open in place, showing the files or definitions inside them.",
    }),
  ),
});
export type CodeGraphStepInput = typeof CodeGraphStepInput.Type;

export const CodeGraphShowInput = Schema.Struct({
  title: Schema.optional(
    Schema.NonEmptyString.annotate({ description: "A few words naming the picture or story." }),
  ),
  steps: Schema.NonEmptyArray(CodeGraphStepInput).annotate({
    description:
      "One step for a single picture; several, in order, for a story the user steps through. Every step draws over the same nodes: all the steps' focus nodes.",
  }),
});
export type CodeGraphShowInput = typeof CodeGraphShowInput.Type;

export const CodeGraphShowResult = Schema.Struct({
  steps: NonNegativeInt,
  /** Ids the checkout does not hold; the graph leaves them out. */
  unknown: Schema.Array(Schema.String),
});
export type CodeGraphShowResult = typeof CodeGraphShowResult.Type;

// Agent reads (MCP). Every list is capped and says when it was cut.

export const CodeSymbolEntry = Schema.Struct({
  /** `path#Qualified.name`: how the code graph names it. */
  id: TrimmedNonEmptyString,
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
