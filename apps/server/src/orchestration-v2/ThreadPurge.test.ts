import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CheckpointRef,
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
  VcsProcessExitError,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { OrchestrationEffectRequestV2 } from "./EffectOutbox.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { DELETED_THREAD_TITLE, planThreadDeletion } from "./ThreadDeletion.ts";
import * as ThreadPurge from "./ThreadPurge.ts";

type DeletedRefs = Array<ReadonlyArray<CheckpointRef>>;

/** A fresh database per test; git is the only stand-in. */
function layerTest(deletedRefs: DeletedRefs, options: { readonly gitFails?: boolean } = {}) {
  const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
    Layer.provideMerge(SqlitePersistence.layerMemory),
  );
  const checkpointStore = Layer.mock(CheckpointStore.CheckpointStore)({
    deleteCheckpointRefs: (input) =>
      Effect.suspend(() => {
        deletedRefs.push(input.checkpointRefs);
        return options.gitFails === true
          ? Effect.fail(
              new VcsProcessExitError({
                operation: "update-ref",
                command: "git",
                cwd: input.cwd,
                exitCode: 1,
                detail: "git failed",
              }),
            )
          : Effect.void;
      }),
  });
  return Layer.mergeAll(
    stores,
    EventSink.layer.pipe(Layer.provide(stores)),
    ProjectionMaintenance.layer.pipe(Layer.provide(stores)),
    ThreadPurge.layer.pipe(Layer.provide(stores), Layer.provide(checkpointStore)),
    IdAllocator.layer,
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "thread-purge-" })),
    Layer.provideMerge(NodeServices.layer),
  );
}

const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;
const SECRET = "sk-live-do-not-keep";
const now = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
// Any existing directory stands in for the checkout; git itself is mocked.
const CHECKOUT = process.cwd();
const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(OrchestrationEffectRequestV2));

function makeThread(
  threadId: ThreadId,
  parent: { readonly threadId: ThreadId; readonly relationship: "fork" | "subagent" } | null = null,
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

const purge = Effect.fn("test.purge")(function* (
  threadId: ThreadId,
  options: {
    readonly checkpointRefs?: ThreadPurge.ThreadPurgeInput["checkpointRefs"];
    /** Collects the subagent threads the purge asks orchestration to delete. */
    readonly deleted?: Array<ThreadId>;
  } = {},
) {
  const purges = yield* ThreadPurge.ThreadPurge;
  yield* purges.purge({
    effectId: `effect:test:${threadId}`,
    threadId,
    checkpointRefs: options.checkpointRefs ?? [],
    deleteThread: (childId) => Effect.sync(() => options.deleted?.push(childId)),
  });
});

const storedEvents = Effect.fn("test.storedEvents")(function* (threadId: ThreadId) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly event_type: string; readonly payload_json: string }>`
    SELECT event_type, payload_json FROM orchestration_events
    WHERE aggregate_kind = 'thread' AND stream_id = ${threadId}
    ORDER BY sequence ASC
  `;
});

const seedCheckpoint = Effect.fn("test.seedCheckpoint")(function* (
  threadId: ThreadId,
  id: string,
  ref: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const scopeId = `scope:${id}`;
  yield* sql`
    INSERT INTO orchestration_v2_projection_checkpoint_scopes (
      scope_id, thread_id, run_id, node_id, parent_scope_id, provider_thread_id, kind,
      ordinal_within_parent, advances_app_run_count, created_at, payload_json
    )
    VALUES (
      ${scopeId}, ${threadId}, NULL, ${`node:${id}`}, NULL, NULL, 'root_run', 0, 1,
      '2026-10-01T00:00:00.000Z', ${`{"id":"${scopeId}","cwd":"${CHECKOUT}"}`}
    )
  `;
  yield* sql`
    INSERT INTO orchestration_v2_projection_checkpoints (
      checkpoint_id, thread_id, scope_id, run_id, node_id, parent_checkpoint_id,
      ordinal_within_scope, app_run_ordinal, status, captured_at, payload_json
    )
    VALUES (
      ${`checkpoint:${id}`}, ${threadId}, ${scopeId}, NULL, ${`node:${id}`}, NULL, 0, NULL,
      'ready', '2026-10-01T00:00:00.000Z', ${`{"id":"${id}","ref":"${ref}"}`}
    )
  `;
});

const seedTransfer = Effect.fn("test.seedTransfer")(function* (
  id: string,
  sourceThreadId: ThreadId,
  targetThreadId: ThreadId,
  status: string,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO orchestration_v2_projection_context_transfers (
      context_transfer_id, source_thread_id, target_thread_id, target_run_id, type, status,
      source_provider, target_provider, source_provider_instance_id, target_provider_instance_id,
      updated_at, payload_json
    )
    VALUES (
      ${id}, ${sourceThreadId}, ${targetThreadId}, NULL, 'merge_back', ${status},
      'codex', 'codex', 'codex', 'codex', '2026-10-01T00:00:00.000Z', '{}'
    )
  `;
});

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
        created(makeThread(deletedId)),
        message(deletedId, "message:deleted"),
        created(makeThread(keptId)),
        message(keptId, "message:kept"),
      ],
    });
    // Purging a live thread does nothing.
    yield* purge(keptId);
    yield* deleteThread(deletedId);
    // A provider event that lands after the deletion, as the newest event.
    yield* sink.write({ events: [message(deletedId, "message:late")] });

    const secureDelete = sql<{ readonly secure_delete: number }>`PRAGMA secure_delete`;
    const secureDeleteBefore = (yield* secureDelete)[0]?.secure_delete;
    yield* purge(deletedId);

    const events = yield* storedEvents(deletedId);
    assert.deepEqual(
      events.map((event) => event.event_type),
      ["thread.created", "thread.deleted"],
    );
    const leaked = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM orchestration_events WHERE payload_json LIKE ${`%${SECRET}%`}
    `;
    // Only the kept thread's two events still mention it.
    assert.equal(leaked[0]?.count, 2);
    for (const event of events) assert.notInclude(event.payload_json, SECRET);

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
    yield* purge(deletedId);
    assert.equal((yield* storedEvents(deletedId)).length, 2);
  }).pipe(Effect.provide(layerTest([]))),
);

it.effect("keeps rows another thread owns or shares", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const sink = yield* EventSink.EventSinkV2;
    const deletedId = ThreadId.make("thread:purge-sharing-deleted");
    const otherId = ThreadId.make("thread:purge-sharing-other");
    yield* sink.write({ events: [created(makeThread(deletedId)), created(makeThread(otherId))] });
    yield* deleteThread(deletedId);
    // The same turn item id and one provider session, in both threads.
    for (const threadId of [deletedId, otherId]) {
      yield* sql`
        INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal)
        VALUES (${threadId}, 'turn-item:shared', 1)
      `;
      yield* sql`
        INSERT INTO orchestration_v2_projection_provider_session_bindings (provider_session_id, thread_id)
        VALUES ('session:shared', ${threadId})
      `;
    }
    yield* sql`
      INSERT INTO orchestration_v2_projection_provider_sessions (
        provider_session_id, thread_id, provider, driver, provider_instance_id, status, model,
        updated_at, payload_json
      )
      VALUES (
        'session:shared', ${deletedId}, 'codex', 'codex', 'codex', 'stopped', NULL,
        '2026-10-01T00:00:00.000Z', '{}'
      )
    `;
    // One transfer it received, which is its own, and one it sent, which is not.
    yield* seedTransfer("transfer:received", otherId, deletedId, "consumed");
    yield* seedTransfer("transfer:sent", deletedId, otherId, "consumed");
    yield* purge(deletedId);

    const positions = yield* sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM orchestration_v2_turn_item_positions WHERE turn_item_id = 'turn-item:shared'
    `;
    assert.deepEqual(
      positions.map((row) => row.thread_id),
      [otherId],
    );
    const bindings = yield* sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM orchestration_v2_projection_provider_session_bindings
    `;
    assert.deepEqual(
      bindings.map((row) => row.thread_id),
      [otherId],
    );
    const sessions = yield* sql`SELECT 1 FROM orchestration_v2_projection_provider_sessions`;
    assert.lengthOf(sessions, 1);
    const transfers = yield* sql<{ readonly context_transfer_id: string }>`
      SELECT context_transfer_id FROM orchestration_v2_projection_context_transfers
    `;
    assert.deepEqual(
      transfers.map((row) => row.context_transfer_id),
      ["transfer:sent"],
    );
  }).pipe(Effect.provide(layerTest([]))),
);

it.effect(
  "erases records before refs, records the refs, and skips refs another thread holds",
  () => {
    const deletedRefs: DeletedRefs = [];
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const sink = yield* EventSink.EventSinkV2;
      const deletedId = ThreadId.make("thread:purge-refs-deleted");
      const otherId = ThreadId.make("thread:purge-refs-other");
      const effectId = `effect:test:${deletedId}`;
      yield* sink.write({
        events: [
          created(makeThread(deletedId)),
          message(deletedId, "message:refs"),
          created(makeThread(otherId)),
        ],
      });
      yield* deleteThread(deletedId);
      yield* seedCheckpoint(deletedId, "own", "refs/t3/orchestration-v2/checkpoints/own/ordinal/0");
      yield* seedCheckpoint(
        deletedId,
        "shared-a",
        "refs/t3/orchestration-v2/checkpoints/shared/ordinal/0",
      );
      yield* seedCheckpoint(
        otherId,
        "shared-b",
        "refs/t3/orchestration-v2/checkpoints/shared/ordinal/0",
      );
      yield* sql`
      INSERT INTO orchestration_v2_effect_outbox (
        effect_id, command_id, thread_id, effect_type, payload_json, status, attempt_count,
        available_at, created_at, updated_at
      )
      VALUES (
        ${effectId}, 'command:test', ${deletedId}, 'thread.purge', '{"type":"thread.purge"}',
        'running', 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
        '2026-10-01T00:00:00.000Z'
      )
    `;
      // git fails, and the transcript still goes.
      yield* purge(deletedId);
      const ownRef = CheckpointRef.make("refs/t3/orchestration-v2/checkpoints/own/ordinal/0");
      assert.deepEqual(deletedRefs, [[ownRef]]);
      assert.deepEqual(
        (yield* storedEvents(deletedId)).map((event) => event.event_type),
        ["thread.created", "thread.deleted"],
      );

      // The effect remembers the ref, so its retry deletes it with the records gone.
      const stored = yield* sql<{ readonly payload_json: string }>`
      SELECT payload_json FROM orchestration_v2_effect_outbox WHERE effect_id = ${effectId}
    `;
      const request = decodeRequest(stored[0]?.payload_json);
      assert.equal(request.type, "thread.purge");
      const recorded = request.type === "thread.purge" ? (request.checkpointRefs ?? []) : [];
      assert.deepEqual(recorded, [{ cwds: [CHECKOUT, "/work/purge"], refs: [ownRef] }]);
      yield* purge(deletedId, { checkpointRefs: recorded });
      assert.lengthOf(deletedRefs, 2);
      assert.deepEqual(deletedRefs[1], [ownRef]);
      const shared = yield* sql`
      SELECT 1 FROM orchestration_v2_projection_checkpoints WHERE thread_id = ${otherId}
    `;
      assert.lengthOf(shared, 1);
    }).pipe(Effect.provide(layerTest(deletedRefs, { gitFails: true })));
  },
);

it.effect("waits for every fork below it, then erases the deleted forks above", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const rootId = ThreadId.make("thread:purge-root");
    const forkId = ThreadId.make("thread:purge-fork");
    const grandforkId = ThreadId.make("thread:purge-grandfork");
    yield* sink.write({
      events: [
        created(makeThread(rootId)),
        message(rootId, "message:root"),
        created(makeThread(forkId, { threadId: rootId, relationship: "fork" })),
        message(forkId, "message:fork"),
        created(makeThread(grandforkId, { threadId: forkId, relationship: "fork" })),
      ],
    });
    yield* deleteThread(rootId);
    yield* deleteThread(forkId);
    yield* purge(rootId);
    yield* purge(forkId);
    // The live grandfork still shows both histories.
    assert.lengthOf((yield* projections.getThreadProjection(rootId)).messages, 1);
    assert.lengthOf((yield* projections.getThreadProjection(forkId)).messages, 1);

    yield* deleteThread(grandforkId);
    yield* purge(grandforkId);
    assert.lengthOf((yield* projections.getThreadProjection(rootId)).messages, 0);
    assert.lengthOf((yield* projections.getThreadProjection(forkId)).messages, 0);
  }).pipe(Effect.provide(layerTest([]))),
);

it.effect("sweeps up deletions an older build only hid, staggered, and revives failed purges", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const sink = yield* EventSink.EventSinkV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const purges = yield* ThreadPurge.ThreadPurge;
    const hiddenId = ThreadId.make("thread:purge-hidden");
    const importedId = ThreadId.make("thread:purge-imported-deleted");
    const failedId = ThreadId.make("thread:purge-failed");
    const liveId = ThreadId.make("thread:purge-live");
    const hidden = makeThread(hiddenId);
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
        created({ ...makeThread(importedId), deletedAt: now }),
        message(importedId, "message:imported"),
        created(makeThread(failedId)),
        message(failedId, "message:failed"),
        created(makeThread(liveId)),
        message(liveId, "message:live"),
      ],
    });
    yield* deleteThread(failedId);
    yield* sql`
      INSERT INTO orchestration_v2_effect_outbox (
        effect_id, command_id, thread_id, effect_type, payload_json, status, attempt_count,
        available_at, created_at, updated_at, last_error
      )
      VALUES (
        'effect:failed:thread.purge', 'command:failed', ${failedId}, 'thread.purge',
        '{"type":"thread.purge"}', 'failed', 5, '2026-10-01T00:00:00.000Z',
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'database is locked'
      )
    `;

    assert.equal(yield* purges.sweep, 3);
    const queued = yield* sql<{
      readonly effect_id: string;
      readonly thread_id: string;
      readonly available_at: string;
    }>`
      SELECT effect_id, thread_id, available_at FROM orchestration_v2_effect_outbox
      WHERE effect_type = 'thread.purge' AND status = 'pending'
      ORDER BY available_at ASC
    `;
    assert.sameMembers(
      queued.map((row) => row.thread_id),
      [hiddenId, importedId, failedId],
    );
    assert.include(
      queued.map((row) => row.effect_id),
      "effect:failed:thread.purge",
    );
    assert.equal(new Set(queued.map((row) => row.available_at)).size, 3);
    assert.equal(yield* purges.sweep, 0);

    for (const threadId of [hiddenId, importedId, failedId]) yield* purge(threadId);
    assert.deepEqual(
      (yield* storedEvents(hiddenId)).map((event) => event.event_type),
      ["thread.created", "thread.deleted"],
    );
    assert.deepEqual(
      (yield* storedEvents(importedId)).map((event) => event.event_type),
      ["thread.created"],
    );
    for (const threadId of [hiddenId, importedId, failedId]) {
      for (const event of yield* storedEvents(threadId)) {
        assert.notInclude(event.payload_json, SECRET);
      }
    }
    assert.isTrue((yield* maintenance.rebuild).valid);
    for (const threadId of [hiddenId, importedId]) {
      const thread = (yield* projections.getThreadProjection(threadId)).thread;
      assert.equal(thread.title, DELETED_THREAD_TITLE);
      assert.isNotNull(thread.deletedAt);
    }
    assert.lengthOf((yield* projections.getThreadProjection(liveId)).messages, 1);
  }).pipe(Effect.provide(layerTest([]))),
);

const seedSubagentRow = Effect.fn("test.seedSubagentRow")(function* (
  parentId: ThreadId,
  childId: ThreadId,
  status: string,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO orchestration_v2_projection_subagents (
      subagent_id, thread_id, run_id, parent_node_id, provider, provider_thread_id,
      child_thread_id, origin, status, started_at, completed_at, updated_at, payload_json,
      driver, provider_instance_id
    )
    VALUES (
      ${`subagent:${childId}`}, ${parentId}, NULL, ${`node:${parentId}`}, 'codex', NULL,
      ${childId}, 'app_owned', ${status}, NULL, NULL, '2026-10-01T00:00:00.000Z', '{}',
      'codex', 'codex'
    )
  `;
});

it.effect("goes with its subagent threads and never waits on them", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const parentId = ThreadId.make("thread:purge-subagent-parent");
    const liveChildId = ThreadId.make("thread:purge-subagent-live");
    const deletedChildId = ThreadId.make("thread:purge-subagent-deleted");
    yield* sink.write({
      events: [
        created(makeThread(parentId)),
        message(parentId, "message:subagent-parent"),
        // A provider subagent: no sidebar row, and nothing deletes it on its own.
        created({
          ...makeThread(liveChildId, { threadId: parentId, relationship: "subagent" }),
          creationSource: "provider",
        }),
        created(makeThread(deletedChildId, { threadId: parentId, relationship: "subagent" })),
      ],
    });
    yield* deleteThread(deletedChildId);
    yield* deleteThread(parentId);
    const deleted: Array<ThreadId> = [];
    yield* purge(parentId, { deleted });
    assert.deepEqual(deleted, [liveChildId]);
    assert.lengthOf((yield* projections.getThreadProjection(parentId)).messages, 0);
    assert.deepEqual(
      (yield* storedEvents(parentId)).map((event) => event.event_type),
      ["thread.created", "thread.deleted"],
    );
  }).pipe(Effect.provide(layerTest([]))),
);

it.effect("waits while a live parent still waits on its deleted subagent", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const sink = yield* EventSink.EventSinkV2;
    const parentId = ThreadId.make("thread:purge-delegating-parent");
    const childId = ThreadId.make("thread:purge-delegated-child");
    yield* sink.write({
      events: [
        created(makeThread(parentId)),
        created(makeThread(childId, { threadId: parentId, relationship: "subagent" })),
        message(childId, "message:delegated"),
      ],
    });
    yield* deleteThread(childId);
    yield* seedSubagentRow(parentId, childId, "running");

    const waiting = yield* purge(childId).pipe(Effect.flip);
    assert.equal(waiting._tag, "ThreadPurgeAwaitingParentError");
    assert.lengthOf(yield* storedEvents(childId), 3);

    // The parent records the cancelled result, and the retry erases the thread.
    yield* sql`
      UPDATE orchestration_v2_projection_subagents SET status = 'cancelled'
      WHERE child_thread_id = ${childId}
    `;
    yield* purge(childId);
    assert.deepEqual(
      (yield* storedEvents(childId)).map((event) => event.event_type),
      ["thread.created", "thread.deleted"],
    );
  }).pipe(Effect.provide(layerTest([]))),
);
