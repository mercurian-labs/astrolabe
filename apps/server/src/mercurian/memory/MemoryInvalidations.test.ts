import { assert, it } from "@effect/vitest";
import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  ThreadId,
  OrchestrationEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { CommitId, HistoryId } from "../commitTree/schema.ts";
import { LegacySessionStore } from "../lineRuntimes/LegacySessionStore.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { PlanningStore, type PlanDetail } from "../planning/PlanningStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { MemoryDashboard } from "./MemoryDashboard.ts";
import { memoryInvalidations } from "./MemoryInvalidations.ts";
import { MemoryReviewStore } from "./MemoryReviewStore.ts";
import { MemorySourceStore } from "./MemorySourceStore.ts";

const decode = Schema.decodeUnknownSync(OrchestrationEvent);
const projectId = MercurianProjectId.make("project");
const repositoryId = MercurianRepositoryId.make("memory-repository");
const planId = PlanId.make("plan");
const threadId = ThreadId.make("thread");
const root = MercurianCommitId.make("root");
const otherRoot = MercurianCommitId.make("other-root");
const otherThread = ThreadId.make("other-thread");
const now = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
const runtime = {
  planId,
  threadId,
  lineRootCommitId: root,
  homeRepositoryId: repositoryId,
  branch: "line",
  worktreePath: "/unused",
  unreachableRepositories: [],
  snapshotOid: null,
  snapshotKind: null,
  departedRef: null,
  branchMovement: null,
  lineBranchMissingOid: null,
  createdAt: now,
  updatedAt: now,
};
const detail: PlanDetail = {
  plan: {
    planId,
    projectId,
    historyId: HistoryId.make("history"),
    title: "Plan",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  },
  planText: "",
  spec: null,
  snapshotSequence: 1,
  codingSessions: [],
  lineRuntimes: [runtime],
  timeline: [
    {
      _tag: "message",
      commitId: CommitId.make(root),
      sequence: 1,
      parents: [],
      published: false,
      authorKind: "human",
      createdAt: now,
      text: "Start",
    },
  ],
};
type Events = {
  runtime?: LineRuntimeStore["Service"]["memoryChanges"];
  planning?: PlanningStore["Service"]["memoryChanges"];
  reviews?: MemoryReviewStore["Service"]["changes"];
  sources?: MemorySourceStore["Service"]["changes"];
  repositories?: RepositoryStore["Service"]["memoryChanges"];
  dashboard?: MemoryDashboard["Service"]["changes"];
  captures?: OrchestrationEngineService["Service"]["streamDomainEvents"];
};

const readCount = Effect.fn(function* (events: Events) {
  let reads = 0;
  const readDashboard = () =>
    Effect.sync(() => {
      reads += 1;
      return { kind: "unavailable", reason: "line-missing" } as const;
    });
  const layers = Layer.mergeAll(
    Layer.mock(OrchestrationEngineService)({ streamDomainEvents: events.captures ?? Stream.empty }),
    Layer.mock(LineRuntimeStore)({
      getByThreadId: (id) =>
        Effect.succeed(
          Option.some(
            id === threadId ? runtime : { ...runtime, threadId: id, lineRootCommitId: otherRoot },
          ),
        ),
      memoryChanges: events.runtime ?? Stream.empty,
    }),
    Layer.mock(LegacySessionStore)({ getByThreadId: () => Effect.succeed(Option.none()) }),
    Layer.mock(PlanTurnRegistry)({ getByThread: () => Effect.succeed(Option.none()) }),
    Layer.mock(PlanningStore)({
      getPlanSnapshot: () => Effect.succeed(detail),
      memoryChanges: events.planning ?? Stream.empty,
    }),
    // No Git driver or getSnapshot implementation is supplied. Filtering cannot probe disk.
    Layer.mock(RepositoryStore)({ memoryChanges: events.repositories ?? Stream.empty }),
    Layer.mock(MemorySourceStore)({
      getSource: () =>
        Effect.succeed(
          Option.some({ projectId, repositoryId, subpath: null, createdAt: now, updatedAt: now }),
        ),
      changes: events.sources ?? Stream.empty,
    }),
    Layer.mock(MemoryReviewStore)({ changes: events.reviews ?? Stream.empty }),
    Layer.mock(MemoryDashboard)({ readDashboard, changes: events.dashboard ?? Stream.empty }),
  );
  yield* memoryInvalidations({ projectId, line: { threadId } }).pipe(
    Effect.flatMap((stream) => Stream.runForEach(stream, readDashboard)),
    Effect.provide(layers),
  );
  // All finite source streams have drained, so zero proves absence without a timing assertion.
  return reads;
});

it.effect(
  "unrelated plan, line, review, source and repository events cause no dashboard read",
  () =>
    Effect.gen(function* () {
      const unrelatedProject = MercurianProjectId.make("other-project");
      const unrelatedRepository = MercurianRepositoryId.make("other-repository");
      assert.strictEqual(
        yield* readCount({
          runtime: Stream.make(
            {
              planId: PlanId.make("other-plan"),
              threadId: otherThread,
              lineRootCommitId: otherRoot,
            },
            { planId, threadId: otherThread, lineRootCommitId: otherRoot },
          ),
          planning: Stream.make({
            planId: PlanId.make("other-plan"),
            commitId: CommitId.make(otherRoot),
          }),
          reviews: Stream.make(
            { repositoryId, lineRootCommitId: otherRoot },
            { repositoryId: unrelatedRepository },
          ),
          sources: Stream.make(unrelatedProject),
          repositories: Stream.make(unrelatedRepository),
          dashboard: Stream.make(
            { projectId, line: { threadId: otherThread } },
            { projectId: unrelatedProject },
          ),
        }),
        0,
      );
    }),
);

it.effect("captures, amendments, cross-client reviews and curation refresh the owning line", () =>
  Effect.gen(function* () {
    assert.strictEqual(
      yield* readCount({
        runtime: Stream.make({ planId, threadId, lineRootCommitId: root }),
        planning: Stream.make({ planId, commitId: CommitId.make(root) }),
        reviews: Stream.make({ repositoryId, lineRootCommitId: root }),
        dashboard: Stream.make({ projectId, line: { threadId } }),
      }),
      4,
    );
  }),
);

it.effect(
  "shared-home changes, source designation/removal and explicit repository refresh reach the line",
  () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* readCount({
          reviews: Stream.make({ repositoryId }),
          sources: Stream.make(projectId, projectId),
          repositories: Stream.make(null, repositoryId),
        }),
        5,
      );
    }),
);

it.effect("filters non-memory activity and unrelated completed checkpoints before reading", () =>
  Effect.gen(function* () {
    const base = {
      sequence: 1,
      eventId: "event",
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: "2026-09-05T00:00:00Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
    };
    const capture = (id: ThreadId, status: string) =>
      decode({
        ...base,
        type: "thread.turn-diff-completed",
        payload: {
          threadId: id,
          turnId: "turn",
          checkpointTurnCount: 1,
          checkpointRef: "refs/t3/test",
          status,
          files: [],
          assistantMessageId: null,
          completedAt: base.occurredAt,
        },
      });
    const activity = (kind: string) =>
      decode({
        ...base,
        type: "thread.activity-appended",
        payload: {
          threadId,
          activity: {
            id: "activity",
            tone: "info",
            kind,
            summary: "Activity",
            payload: {},
            turnId: null,
            createdAt: base.occurredAt,
          },
        },
      });
    assert.strictEqual(
      yield* readCount({
        captures: Stream.make(
          capture(otherThread, "ready"),
          capture(otherThread, "missing"),
          activity("provider.connected"),
        ),
      }),
      0,
    );
    assert.strictEqual(
      yield* readCount({
        captures: Stream.make(
          capture(threadId, "ready"),
          capture(threadId, "missing"),
          capture(threadId, "error"),
          activity("checkpoint.external"),
        ),
      }),
      4,
    );
  }),
);
