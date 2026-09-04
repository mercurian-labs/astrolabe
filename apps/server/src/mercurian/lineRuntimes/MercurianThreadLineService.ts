import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ThreadLineService } from "../../checkpointing/ThreadLineService.ts";
import { LegacySessionStore } from "./LegacySessionStore.ts";
import { LineRuntimeStore } from "./LineRuntimeStore.ts";
import { resolveThreadLine } from "./resolveThreadLine.ts";

export const make = Effect.gen(function* () {
  const lineRuntimes = yield* LineRuntimeStore;
  const legacySessions = yield* LegacySessionStore;
  return ThreadLineService.of({
    resolve: (threadId) =>
      resolveThreadLine(lineRuntimes, legacySessions, threadId).pipe(
        Effect.map(
          Option.flatMap((line) =>
            line.lineRootCommitId === null
              ? Option.none()
              : Option.some({
                  lineRootCommitId: line.lineRootCommitId,
                  homeRepositoryId: line.homeRepositoryId,
                  repositories: line.repositories,
                  branch: line.branch,
                }),
          ),
        ),
      ),
    updateBranch: (threadId, branch) =>
      lineRuntimes.getByThreadId(threadId).pipe(
        Effect.flatMap((runtime) =>
          Option.isSome(runtime)
            ? lineRuntimes.updateWorkspace(threadId, {
                branch,
                worktreePath: runtime.value.worktreePath,
              })
            : Effect.void,
        ),
      ),
    recordSnapshot: (threadId, snapshot) =>
      lineRuntimes
        .getByThreadId(threadId)
        .pipe(
          Effect.flatMap((runtime) =>
            Option.isSome(runtime) ? lineRuntimes.recordSnapshot(threadId, snapshot) : Effect.void,
          ),
        ),
    recordRepositorySnapshot: (threadId, repositoryId, snapshot) =>
      lineRuntimes
        .getByThreadId(threadId)
        .pipe(
          Effect.flatMap((runtime) =>
            Option.isSome(runtime)
              ? lineRuntimes.recordRepositorySnapshot(threadId, repositoryId, snapshot)
              : Effect.void,
          ),
        ),
  });
});

export const MercurianThreadLineServiceLive = Layer.effect(ThreadLineService, make);
