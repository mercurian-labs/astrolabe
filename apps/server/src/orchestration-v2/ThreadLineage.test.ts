import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  ContextTransferId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ContextTransfer,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RunStatus,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadLineage from "./ThreadLineage.ts";

const providerInstanceId = ProviderInstanceId.make("codex");
const projectId = ProjectId.make("project:lineage");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 20, 0, minute));

const thread = (
  id: ThreadId,
  options: {
    readonly forkOf?: { readonly threadId: ThreadId; readonly runId: RunId };
    readonly subagentOf?: ThreadId;
    readonly minute?: number;
    readonly archived?: boolean;
    readonly deleted?: boolean;
  } = {},
): OrchestrationV2DomainEvent => {
  const parentThreadId = options.forkOf?.threadId ?? options.subagentOf ?? null;
  return {
    id: EventId.make(`created:${id}`),
    type: "thread.created",
    threadId: id,
    providerInstanceId,
    occurredAt: at(options.minute ?? 0),
    payload: {
      createdBy: "user",
      creationSource: "web",
      id,
      projectId,
      title: `Thread ${id}`,
      providerInstanceId,
      modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: {
        parentThreadId,
        relationshipToParent:
          options.forkOf !== undefined
            ? "fork"
            : options.subagentOf !== undefined
              ? "subagent"
              : null,
        rootThreadId: parentThreadId ?? id,
      },
      forkedFrom:
        options.forkOf === undefined
          ? null
          : { type: "run", threadId: options.forkOf.threadId, runId: options.forkOf.runId },
      createdAt: at(options.minute ?? 0),
      updatedAt: at(options.minute ?? 0),
      archivedAt: options.archived === true ? at(30) : null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: options.deleted === true ? at(30) : null,
    },
  };
};

const run = (
  threadId: ThreadId,
  id: RunId,
  ordinal: number,
  status: OrchestrationV2RunStatus = "completed",
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`run:${id}`),
  type: "run.created",
  threadId,
  runId: id,
  occurredAt: at(ordinal),
  payload: {
    id,
    threadId,
    ordinal,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${id}`),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at(ordinal),
    startedAt: at(ordinal),
    completedAt: status === "completed" ? at(ordinal) : null,
    checkpointId: null,
    contextHandoffId: null,
  },
});

const asked = (threadId: ThreadId, runId: RunId, text: string): OrchestrationV2DomainEvent => ({
  id: EventId.make(`message:${runId}`),
  type: "message.updated",
  threadId,
  runId,
  occurredAt: at(1),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: MessageId.make(`message:${runId}`),
    threadId,
    runId,
    nodeId: null,
    role: "user",
    text,
    attachments: [],
    streaming: false,
    createdAt: at(1),
    updatedAt: at(1),
  },
});

const replied = (
  threadId: ThreadId,
  runId: RunId,
  key: string,
  minute: number,
  text: string,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`reply:${key}`),
  type: "message.updated",
  threadId,
  runId,
  occurredAt: at(minute),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: MessageId.make(`reply:${key}`),
    threadId,
    runId,
    nodeId: null,
    role: "assistant",
    text,
    attachments: [],
    streaming: false,
    createdAt: at(minute),
    updatedAt: at(minute),
  },
});

const checkpoint = (
  threadId: ThreadId,
  runId: RunId,
  key: string,
  files: ReadonlyArray<readonly [additions: number, deletions: number]>,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`checkpoint:${key}`),
  type: "checkpoint.captured",
  threadId,
  runId,
  occurredAt: at(2),
  payload: {
    id: CheckpointId.make(`checkpoint:${key}`),
    threadId,
    scopeId: CheckpointScopeId.make(`scope:${key}`),
    runId,
    nodeId: NodeId.make(`node:${key}`),
    parentCheckpointId: null,
    ordinalWithinScope: 0,
    appRunOrdinal: null,
    ref: CheckpointRef.make(`refs/t3/${key}`),
    status: "ready",
    files: files.map(([additions, deletions], index) => ({
      path: `src/${key}-${index}.ts`,
      kind: "modified",
      additions,
      deletions,
    })),
    capturedAt: at(2),
  },
});

const transfer = (
  id: string,
  source: { readonly threadId: ThreadId; readonly runId: RunId },
  targetThreadId: ThreadId,
  options: {
    readonly type?: OrchestrationV2ContextTransfer["type"];
    readonly status: OrchestrationV2ContextTransfer["status"];
    readonly targetRunId?: RunId;
  },
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`transfer:${id}`),
  type: "context-transfer.created",
  threadId: targetThreadId,
  occurredAt: at(20),
  payload: {
    id: ContextTransferId.make(id),
    type: options.type ?? "merge_back",
    sourceThreadId: source.threadId,
    targetThreadId,
    sourcePoint: { threadId: source.threadId, runId: source.runId },
    basePoint: null,
    sourceProviderInstanceId: providerInstanceId,
    targetProviderInstanceId: providerInstanceId,
    targetRunId: options.targetRunId ?? null,
    status: options.status,
    resolution: null,
    createdBy: "user",
    error: null,
    createdAt: at(20),
    updatedAt: at(20),
    consumedAt: null,
  },
});

const root = ThreadId.make("thread:root");
const fork = ThreadId.make("thread:fork");
const forkOfFork = ThreadId.make("thread:fork-of-fork");
const agent = ThreadId.make("thread:agent");
const deletedFork = ThreadId.make("thread:deleted-fork");
const goneParent = ThreadId.make("thread:gone-parent");
const orphan = ThreadId.make("thread:orphan");
const other = ThreadId.make("thread:other");
const r1 = RunId.make("run:root-1");
const r2 = RunId.make("run:root-2");
const r3 = RunId.make("run:root-3");
const f1 = RunId.make("run:fork-1");
const g1 = RunId.make("run:fork-of-fork-1");
const o1 = RunId.make("run:other-1");

const seed = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
    thread(root),
    run(root, r2, 2, "rolled_back"),
    run(root, r1, 1),
    run(root, r3, 3, "running"),
    asked(root, r1, "Plan the ledger"),
    asked(root, r2, "x".repeat(400)),
    replied(root, r1, "root-1-late", 4, "The ledger plan is ready."),
    replied(root, r1, "root-1-early", 3, "Reading the ledger first."),
    checkpoint(root, r2, "root-2a", [
      [4, 1],
      [2, 0],
    ]),
    checkpoint(root, r2, "root-2b", [[1, 3]]),
    thread(fork, { forkOf: { threadId: root, runId: r1 }, minute: 5, archived: true }),
    run(fork, f1, 1),
    thread(forkOfFork, { forkOf: { threadId: fork, runId: f1 }, minute: 6 }),
    run(forkOfFork, g1, 1),
    thread(agent, { subagentOf: root, minute: 7 }),
    thread(deletedFork, { forkOf: { threadId: root, runId: r1 }, minute: 8, deleted: true }),
    thread(goneParent, { deleted: true }),
    thread(orphan, { forkOf: { threadId: goneParent, runId: r1 }, minute: 9 }),
    thread(other),
    run(other, o1, 1),
    transfer("taken", { threadId: fork, runId: f1 }, root, { status: "consumed", targetRunId: r3 }),
    transfer("waiting", { threadId: forkOfFork, runId: g1 }, fork, { status: "pending" }),
    transfer("old", { threadId: fork, runId: f1 }, root, { status: "superseded" }),
    transfer("broken", { threadId: fork, runId: f1 }, root, { status: "failed" }),
    transfer("forked", { threadId: root, runId: r1 }, fork, { type: "fork", status: "consumed" }),
    transfer("outside", { threadId: other, runId: o1 }, root, { status: "pending" }),
  ];
  yield* Effect.forEach(events, projections.apply, { discard: true });
});

const layerTest = Layer.effectDiscard(seed).pipe(
  Layer.provideMerge(Layer.mergeAll(ThreadLineage.layer, ProjectionStore.layer)),
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

it.layer(layerTest)("ThreadLineage", (it) => {
  it.effect("climbs to the root and gathers every fork below it, archived ones included", () =>
    Effect.gen(function* () {
      const lineage = yield* ThreadLineage.ThreadLineage;

      const family = yield* lineage.read(forkOfFork);
      assert.deepEqual(
        family.threads.map(({ id, parentId, forkRunId, archived }) => ({
          id,
          parentId,
          forkRunId,
          archived,
        })),
        [
          { id: root, parentId: null, forkRunId: null, archived: false },
          { id: fork, parentId: root, forkRunId: r1, archived: true },
          { id: forkOfFork, parentId: fork, forkRunId: f1, archived: false },
        ],
      );
      assert.deepEqual(
        (yield* lineage.read(root)).threads.map((entry) => entry.id),
        [root, fork, forkOfFork],
      );
      // A subagent is not a fork, and a fork whose parent is deleted roots its own family.
      assert.deepEqual(
        (yield* lineage.read(agent)).threads.map((entry) => entry.id),
        [agent],
      );
      assert.deepEqual(
        (yield* lineage.read(orphan)).threads.map(({ id, parentId }) => ({ id, parentId })),
        [{ id: orphan, parentId: null }],
      );

      const missing = yield* Effect.flip(lineage.read(deletedFork));
      assert.equal(missing._tag, "ThreadLineageThreadNotFoundError");
    }),
  );

  it.effect("lists every run in order with the start of what was asked and its line totals", () =>
    Effect.gen(function* () {
      const lineage = yield* ThreadLineage.ThreadLineage;

      const [rootThread] = (yield* lineage.read(root)).threads;
      assert.deepEqual(
        rootThread?.runs.map(({ id, ordinal, status, userMessageId, additions, deletions }) => ({
          id,
          ordinal,
          status,
          userMessageId,
          additions,
          deletions,
        })),
        [
          {
            id: r1,
            ordinal: 1,
            status: "completed",
            userMessageId: MessageId.make(`message:${r1}`),
            additions: 0,
            deletions: 0,
          },
          {
            id: r2,
            ordinal: 2,
            status: "rolled_back",
            userMessageId: MessageId.make(`message:${r2}`),
            additions: 7,
            deletions: 4,
          },
          {
            id: r3,
            ordinal: 3,
            status: "running",
            userMessageId: MessageId.make(`message:${r3}`),
            additions: 0,
            deletions: 0,
          },
        ],
      );
      assert.deepEqual(
        rootThread?.runs.map((entry) => entry.text),
        ["Plan the ledger", "x".repeat(300), ""],
      );
      // The run's last reply, how many files its checkpoints touched, its model and its end.
      assert.deepEqual(
        rootThread?.runs.map(({ reply, files, model, completedAt }) => ({
          reply,
          files,
          model,
          completedAt: completedAt === null ? null : DateTime.toEpochMillis(completedAt),
        })),
        [
          {
            reply: "The ledger plan is ready.",
            files: 0,
            model: "gpt-5",
            completedAt: DateTime.toEpochMillis(at(1)),
          },
          { reply: "", files: 3, model: "gpt-5", completedAt: null },
          { reply: "", files: 0, model: "gpt-5", completedAt: null },
        ],
      );
      assert.equal(
        DateTime.toEpochMillis(rootThread!.runs[0]!.requestedAt),
        DateTime.toEpochMillis(at(1)),
      );
    }),
  );

  it.effect("keeps the family's merge-backs that carried or will carry context", () =>
    Effect.gen(function* () {
      const lineage = yield* ThreadLineage.ThreadLineage;

      const { mergeBacks } = yield* lineage.read(fork);
      assert.deepEqual(
        mergeBacks.map(({ id, sourceThreadId, sourceRunId, targetThreadId, targetRunId }) => ({
          id,
          sourceThreadId,
          sourceRunId,
          targetThreadId,
          targetRunId,
        })),
        [
          {
            id: ContextTransferId.make("taken"),
            sourceThreadId: fork,
            sourceRunId: f1,
            targetThreadId: root,
            targetRunId: r3,
          },
          {
            id: ContextTransferId.make("waiting"),
            sourceThreadId: forkOfFork,
            sourceRunId: g1,
            targetThreadId: fork,
            targetRunId: null,
          },
        ],
      );
    }),
  );
});
