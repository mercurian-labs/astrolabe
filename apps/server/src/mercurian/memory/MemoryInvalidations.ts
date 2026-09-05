import {
  MercurianMemoryError,
  type MemoryLineRef,
  type MercurianSubscribeMemoryInvalidationsInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { lineRootCommitIdFor } from "../commitTree/LineBranchReactor.ts";
import { LegacySessionStore } from "../lineRuntimes/LegacySessionStore.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { resolveThreadLine } from "../lineRuntimes/resolveThreadLine.ts";
import { PlanningStore } from "../planning/PlanningStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { MemoryDashboard } from "./MemoryDashboard.ts";
import { MemoryReviewStore } from "./MemoryReviewStore.ts";
import { MemorySourceStore } from "./MemorySourceStore.ts";

/** Filters before the RPC coalesces signals. Every lookup here is stored metadata, never Git. */
export const memoryInvalidations = Effect.fn("MemoryInvalidations.subscribe")(function* (
  scope: MercurianSubscribeMemoryInvalidationsInput["scope"],
) {
  const engine = yield* OrchestrationEngineService;
  const runtimes = yield* LineRuntimeStore;
  const legacy = yield* LegacySessionStore;
  const planning = yield* PlanningStore;
  const turns = yield* PlanTurnRegistry;
  const repositories = yield* RepositoryStore;
  const sources = yield* MemorySourceStore;
  const reviews = yield* MemoryReviewStore;
  const dashboard = yield* MemoryDashboard;

  const target = Effect.fn(
    function* (ref: MemoryLineRef) {
      if ("planId" in ref) {
        const detail = yield* planning.getPlanSnapshot({ planId: ref.planId });
        return { planId: ref.planId, root: lineRootCommitIdFor(detail, ref.commitId) };
      }
      const line = yield* resolveThreadLine(runtimes, legacy, ref.threadId);
      if (Option.isSome(line)) {
        if (line.value.runtime)
          return { planId: line.value.planId, root: line.value.lineRootCommitId };
        const detail = yield* planning.getPlanSnapshot({ planId: line.value.planId });
        return {
          planId: line.value.planId,
          root:
            line.value.lineRootCommitId === null
              ? null
              : lineRootCommitIdFor(detail, line.value.lineRootCommitId),
        };
      }
      const turn = yield* turns.getByThread(ref.threadId);
      if (Option.isNone(turn)) return null;
      const detail = yield* planning.getPlanSnapshot({ planId: turn.value.planId });
      return {
        planId: turn.value.planId,
        root: lineRootCommitIdFor(detail, turn.value.tipCommitId),
      };
    },
    Effect.catchTag("PlanNotFoundError", () => Effect.succeed(null)),
  );

  let ownPlanId = scope ? (yield* target(scope.line))?.planId : undefined;

  // Checkpoint changes also cover interrupted/failed captures on legacy sessions,
  // which have no runtime-change stream. Missing placeholders remain conservative invalidations.
  const captures = engine.streamDomainEvents.pipe(
    Stream.filter(
      (event) =>
        event.type === "thread.turn-diff-completed" ||
        (event.type === "thread.activity-appended" &&
          event.payload.activity.kind === "checkpoint.external"),
    ),
    Stream.filterEffect(
      Effect.fn(function* (event) {
        if (!scope) return true;
        if (
          event.type !== "thread.turn-diff-completed" &&
          event.type !== "thread.activity-appended"
        )
          return false;
        const threadId = event.payload.threadId;
        if ("threadId" in scope.line && scope.line.threadId === threadId) return true;
        const own = yield* target(scope.line);
        const changed = yield* target({ threadId });
        return (
          own !== null &&
          own.root !== null &&
          own.planId === changed?.planId &&
          own.root === changed.root
        );
      }),
    ),
  );
  const runtimeChanges = runtimes.memoryChanges.pipe(
    Stream.filterEffect(
      Effect.fn(function* (change) {
        if (!scope) return true;
        if ("threadId" in scope.line && scope.line.threadId === change.threadId) {
          ownPlanId = change.planId;
          return true;
        }
        if ("planId" in scope.line && scope.line.planId !== change.planId) return false;
        const own = yield* target(scope.line);
        return (
          own !== null &&
          own.planId === change.planId &&
          own.root !== null &&
          own.root === change.lineRootCommitId
        );
      }),
    ),
  );
  const planningChanges = planning.memoryChanges.pipe(
    Stream.filterEffect(
      Effect.fn(function* (change) {
        if (!scope) return true;
        if ("planId" in scope.line && scope.line.planId !== change.planId) return false;
        if (change.commitId === null) return ownPlanId === change.planId;
        const own = yield* target(scope.line);
        if (!own || own.planId !== change.planId) return false;
        const detail = yield* planning.getPlanSnapshot({ planId: change.planId });
        return own.root === lineRootCommitIdFor(detail, change.commitId);
      }),
    ),
  );
  // Keep the prior designation for repository removal, whose transaction deletes its source row.
  let sourceRepository = scope
    ? Option.getOrNull(yield* sources.getSource(scope.projectId))?.repositoryId
    : undefined;
  const sourceChanges = sources.changes.pipe(
    Stream.filter((projectId) => !scope || projectId === scope.projectId),
    Stream.tap(
      Effect.fn(function* () {
        if (scope)
          sourceRepository = Option.getOrNull(
            yield* sources.getSource(scope.projectId),
          )?.repositoryId;
      }),
    ),
  );
  const repositoryChanges = repositories.memoryChanges.pipe(
    Stream.filter(
      (repositoryId) =>
        !scope ||
        (sourceRepository !== undefined &&
          (repositoryId === null || repositoryId === sourceRepository)),
    ),
  );
  const reviewChanges = reviews.changes.pipe(
    Stream.filterEffect(
      Effect.fn(function* (change) {
        if (!scope) return true;
        const source = yield* sources.getSource(scope.projectId);
        if (Option.isNone(source) || source.value.repositoryId !== change.repositoryId)
          return false;
        if (change.lineRootCommitId === undefined) return true;
        return (yield* target(scope.line))?.root === change.lineRootCommitId;
      }),
    ),
  );
  const streams: ReadonlyArray<Stream.Stream<unknown, unknown>> = [
    captures,
    runtimeChanges,
    planningChanges,
    repositoryChanges,
    reviewChanges,
    sourceChanges,
    dashboard.changes.pipe(
      Stream.filterEffect(
        Effect.fn(function* (change) {
          if (!scope) return true;
          if (scope.projectId !== change.projectId) return false;
          if (!change.line) return true;
          const own = yield* target(scope.line);
          const changed = yield* target(change.line);
          return (
            own !== null &&
            own.root !== null &&
            own.planId === changed?.planId &&
            own.root === changed.root
          );
        }),
      ),
    ),
  ];
  return Stream.mergeAll(
    streams.map((stream) =>
      stream.pipe(
        Stream.map(() => undefined),
        Stream.mapError(
          (cause) => new MercurianMemoryError({ operation: "subscribeMemoryInvalidations", cause }),
        ),
      ),
    ),
    { concurrency: "unbounded" },
  );
});
