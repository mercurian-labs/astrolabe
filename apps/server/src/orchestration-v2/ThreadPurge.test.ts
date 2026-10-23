import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { DELETED_THREAD_TITLE, planThreadDeletion } from "./ThreadDeletion.ts";

const layerStores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layerTest = Layer.mergeAll(
  layerStores,
  EventSink.layer.pipe(Layer.provide(layerStores)),
  ProjectionMaintenance.layer.pipe(Layer.provide(layerStores)),
  IdAllocator.layer,
);

const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;
const SECRET = "sk-live-do-not-keep";
const now = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");

function makeThread(
  threadId: ThreadId,
  parent: { readonly threadId: ThreadId; readonly relationship: "fork" | "subagent" } | null,
): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make("project:purge"),
    title: `Plan for ${SECRET}`,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature/purge",
    worktreePath: "/work/purge",
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: parent?.threadId ?? null,
      relationshipToParent: parent?.relationship ?? null,
      rootThreadId: parent?.threadId ?? threadId,
    },
    forkedFrom:
      parent === null
        ? null
        : { type: "run", threadId: parent.threadId, runId: RunId.make(`run:${parent.threadId}`) },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

const created = (thread: OrchestrationV2AppThread): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event:created:${thread.id}`),
  type: "thread.created",
  threadId: thread.id,
  providerInstanceId,
  occurredAt: now,
  payload: thread,
});

const message = (threadId: ThreadId, id: string): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event:message:${id}`),
  type: "message.updated",
  threadId,
  providerInstanceId,
  occurredAt: now,
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: MessageId.make(id),
    threadId,
    runId: null,
    nodeId: null,
    role: "user",
    text: `Use ${SECRET} for the deploy`,
    attachments: [],
    streaming: false,
    createdAt: now,
    updatedAt: now,
  },
});

const deleteThread = Effect.fn("test.deleteThread")(function* (threadId: ThreadId) {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const sink = yield* EventSink.EventSinkV2;
  const plan = yield* planThreadDeletion({
    command: { type: "thread.delete", commandId: CommandId.make(`delete:${threadId}`), threadId },
    projection: yield* projections.getThreadProjection(threadId),
    attachmentIds: [],
    now,
    idAllocator: yield* IdAllocator.IdAllocatorV2,
  });
  yield* sink.write({ events: plan.events });
});

const storedEvents = Effect.fn("test.storedEvents")(function* (threadId: ThreadId) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly event_type: string; readonly payload_json: string }>`
    SELECT event_type, payload_json FROM orchestration_events
    WHERE aggregate_kind = 'thread' AND stream_id = ${threadId}
    ORDER BY sequence ASC
  `;
});

it.layer(layerTest)("thread purge", (it) => {
  it.effect("leaves a content-free tombstone and every other thread untouched", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const deletedId = ThreadId.make("thread:purge-deleted");
      const keptId = ThreadId.make("thread:purge-kept");
      yield* sink.write({
        events: [
          created(makeThread(deletedId, null)),
          message(deletedId, "message:deleted"),
          created(makeThread(keptId, null)),
          message(keptId, "message:kept"),
        ],
      });
      yield* deleteThread(deletedId);
      // A provider event that lands after the deletion, as the newest event.
      yield* sink.write({ events: [message(deletedId, "message:late")] });

      assert.isTrue(Option.isSome(yield* maintenance.readThreadPurge(deletedId)));
      assert.isTrue(Option.isNone(yield* maintenance.readThreadPurge(keptId)));
      const secureDelete = sql<{ readonly secure_delete: number }>`PRAGMA secure_delete`;
      const secureDeleteBefore = (yield* secureDelete)[0]?.secure_delete;
      yield* maintenance.purgeThread(deletedId);

      const events = yield* storedEvents(deletedId);
      assert.deepEqual(
        events.map((event) => event.event_type),
        ["thread.created", "thread.deleted"],
      );
      for (const event of events) assert.notInclude(event.payload_json, SECRET);
      const leaked = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM orchestration_events
        WHERE stream_id = ${deletedId} AND payload_json LIKE ${`%${SECRET}%`}
      `;
      assert.equal(leaked[0]?.count, 0);

      const tombstone = yield* projections.getThreadProjection(deletedId);
      assert.equal(tombstone.thread.title, DELETED_THREAD_TITLE);
      assert.isNotNull(tombstone.thread.deletedAt);
      assert.equal(tombstone.thread.worktreePath, "/work/purge");
      assert.lengthOf(tombstone.messages, 0);
      assert.deepEqual(
        (yield* projections.getThreadProjection(keptId)).messages.map((entry) => entry.id),
        ["message:kept"],
      );
      assert.equal((yield* storedEvents(keptId)).length, 2);

      assert.equal((yield* secureDelete)[0]?.secure_delete, secureDeleteBefore);
      assert.isTrue((yield* maintenance.verify).valid);
      assert.isTrue((yield* maintenance.rebuild).valid);
      const rebuilt = yield* projections.getThreadProjection(deletedId);
      assert.equal(rebuilt.thread.title, DELETED_THREAD_TITLE);
      assert.lengthOf(rebuilt.messages, 0);

      // A retry after a crash finds nothing left to do.
      yield* maintenance.purgeThread(deletedId);
      assert.equal((yield* storedEvents(deletedId)).length, 2);
    }),
  );

  it.effect("waits until every thread forked or delegated from it is deleted", () =>
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const rootId = ThreadId.make("thread:purge-root");
      const forkId = ThreadId.make("thread:purge-fork");
      const childId = ThreadId.make("thread:purge-fork-child");
      yield* sink.write({
        events: [
          created(makeThread(rootId, null)),
          message(rootId, "message:root"),
          created(makeThread(forkId, { threadId: rootId, relationship: "fork" })),
          created(makeThread(childId, { threadId: forkId, relationship: "subagent" })),
        ],
      });

      yield* deleteThread(rootId);
      yield* deleteThread(forkId);
      assert.isTrue(Option.isNone(yield* maintenance.readThreadPurge(rootId)));
      assert.isTrue(Option.isNone(yield* maintenance.readThreadPurge(forkId)));

      yield* deleteThread(childId);
      const childPlan = yield* maintenance.readThreadPurge(childId);
      assert.deepEqual(
        Option.map(childPlan, (plan) => plan.parentThreadId),
        Option.some(forkId),
      );
      assert.isTrue(Option.isSome(yield* maintenance.readThreadPurge(forkId)));
      assert.deepEqual(
        Option.map(yield* maintenance.readThreadPurge(rootId), (plan) => plan.parentThreadId),
        Option.some(null),
      );
    }),
  );

  it.effect("finds and purges threads that older builds only hid", () =>
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const hiddenId = ThreadId.make("thread:purge-hidden");
      const importedId = ThreadId.make("thread:purge-imported-deleted");
      const hidden = makeThread(hiddenId, null);
      yield* sink.write({
        events: [
          created(hidden),
          message(hiddenId, "message:hidden"),
          // What an older build wrote: the whole record, title included.
          {
            id: EventId.make("event:hidden-deleted"),
            type: "thread.deleted",
            threadId: hiddenId,
            providerInstanceId,
            occurredAt: now,
            payload: { ...hidden, deletedAt: now },
          },
          // Imported already deleted, so it has no thread.deleted at all.
          created({ ...makeThread(importedId, null), deletedAt: now }),
          message(importedId, "message:imported"),
        ],
      });

      const queued = yield* maintenance.enqueueDeletedThreadPurges;
      assert.isAtLeast(queued, 2);
      assert.equal(yield* maintenance.enqueueDeletedThreadPurges, 0);

      yield* maintenance.purgeThread(hiddenId);
      yield* maintenance.purgeThread(importedId);
      assert.deepEqual(
        (yield* storedEvents(hiddenId)).map((event) => event.event_type),
        ["thread.created", "thread.deleted"],
      );
      const imported = yield* storedEvents(importedId);
      assert.deepEqual(
        imported.map((event) => event.event_type),
        ["thread.created"],
      );
      for (const event of [...(yield* storedEvents(hiddenId)), ...imported]) {
        assert.notInclude(event.payload_json, SECRET);
      }
      const rebuilt = yield* maintenance.rebuild;
      assert.isTrue(rebuilt.valid);
      for (const threadId of [hiddenId, importedId]) {
        const thread = (yield* projections.getThreadProjection(threadId)).thread;
        assert.equal(thread.title, DELETED_THREAD_TITLE);
        assert.isNotNull(thread.deletedAt);
      }
    }),
  );
});
