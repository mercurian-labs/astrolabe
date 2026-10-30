import {
  CodeIndexError,
  type CodeChanges,
  type CodeChangesInput,
  type CodeFindInput,
  type CodeFindResult,
  type CodeIndexProjectInput,
  type CodeIndexStatus,
  type CodeIndexStorage,
  type CodeLocalGraph,
  type CodeLocalGraphInput,
  type CodeMap,
  type CodeMapInput,
  type CodeOutline,
  type CodeOutlineInput,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

/**
 * Astrolabe: each repository's code index. People reach it through the WebSocket (status,
 * Settings, the Repositories local graph) and agents through the `t3_code_*` MCP tools; both call
 * these methods, so neither transport holds index logic.
 */
export class CodeIndex extends Context.Service<
  CodeIndex,
  {
    /** Every repository's status now, then each change. */
    readonly subscribe: Stream.Stream<CodeIndexStatus>;
    readonly status: (projectId: ProjectId) => Effect.Effect<CodeIndexStatus, CodeIndexError>;
    /** Drop the repository's index and build it again in the background. */
    readonly rebuild: (input: CodeIndexProjectInput) => Effect.Effect<void, CodeIndexError>;
    readonly storage: Effect.Effect<CodeIndexStorage, CodeIndexError>;
    /** Remove file versions no branch, worktree or checkpoint uses; run by storage cleanup. */
    readonly prune: Effect.Effect<
      { readonly bytesFreed: number; readonly fileVersions: number },
      CodeIndexError
    >;
    /** Delete every index; each enabled repository builds again. */
    readonly clear: Effect.Effect<void, CodeIndexError>;
    readonly localGraph: (
      input: CodeLocalGraphInput,
    ) => Effect.Effect<CodeLocalGraph, CodeIndexError>;
    readonly outline: (input: CodeOutlineInput) => Effect.Effect<CodeOutline, CodeIndexError>;
    readonly find: (input: CodeFindInput) => Effect.Effect<CodeFindResult, CodeIndexError>;
    readonly changes: (input: CodeChangesInput) => Effect.Effect<CodeChanges, CodeIndexError>;
    readonly map: (input: CodeMapInput) => Effect.Effect<CodeMap, CodeIndexError>;
  }
>()("t3/codeIndex/CodeIndex") {}

const notBuilt = Effect.fn("CodeIndex.placeholder")(function* () {
  return yield* new CodeIndexError({
    reason: "unsupported",
    message: "The code index is not available yet.",
  });
});

/** Stands in until the index is built: reads fail as unsupported, maintenance has nothing to do. */
export const layerPlaceholder = Layer.succeed(
  CodeIndex,
  CodeIndex.of({
    subscribe: Stream.empty,
    status: notBuilt,
    rebuild: notBuilt,
    storage: Effect.succeed({ bytes: 0, fileVersions: 0, unusedFileVersions: 0 }),
    prune: Effect.succeed({ bytesFreed: 0, fileVersions: 0 }),
    clear: Effect.void,
    localGraph: notBuilt,
    outline: notBuilt,
    find: notBuilt,
    changes: notBuilt,
    map: notBuilt,
  }),
);
