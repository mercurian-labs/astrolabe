import {
  CheckpointRef,
  CommandId,
  OrchestrationV2AppThreadJson,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import { removeThreadProviderEventLogs } from "../provider/EventNdjsonLogger.ts";
import { forkParked } from "../serverActivation.ts";
import { OrchestrationEffectRequestV2 } from "./EffectOutbox.ts";
import { DELETED_THREAD_TITLE, threadTombstone } from "./ThreadDeletion.ts";

export class ThreadPurgeError extends Schema.TaggedError<ThreadPurgeError>()("ThreadPurgeError", {
  operation: Schema.Literals(["plan", "erase", "record", "delete-subagents", "sweep"]),
  threadId: Schema.optional(Schema.String),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Thread purge ${this.operation} failed${this.threadId === undefined ? "" : ` for ${this.threadId}`}.`;
  }
}

/** Retried: the parent records a deleted subagent's result moments after the deletion. */
export class ThreadPurgeAwaitingParentError extends Schema.TaggedError<ThreadPurgeAwaitingParentError>()(
  "ThreadPurgeAwaitingParentError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} waits for its parent to record its subagent result.`;
  }
}

type CheckpointRefGroups = NonNullable<
  Extract<OrchestrationEffectRequestV2, { readonly type: "thread.purge" }>["checkpointRefs"]
>;

export interface ThreadPurgeInput {
  readonly effectId: string;
  readonly threadId: ThreadId;
  /** Refs recorded by an earlier attempt that erased the records naming them. */
  readonly checkpointRefs: CheckpointRefGroups;
  /** Deleting through orchestration stops a subagent's runs before its own purge. */
  readonly deleteThread: (
    threadId: ThreadId,
    commandId: CommandId,
  ) => Effect.Effect<unknown, Error>;
}

export class ThreadPurge extends Context.Reference<{
  /**
   * Runs a thread.purge effect. It deletes the thread's live subagent threads,
   * then erases its history and each deleted ancestor's it was the last reader
   * of, then removes their checkpoint refs and provider logs.
   */
  readonly purge: (
    input: ThreadPurgeInput,
  ) => Effect.Effect<void, ThreadPurgeError | ThreadPurgeAwaitingParentError>;
  /** Queues a staggered purge for each erasable deleted thread that still holds content. */
  readonly sweep: Effect.Effect<number, ThreadPurgeError>;
}>("t3/orchestration-v2/ThreadPurge", {
  defaultValue: () => ({ purge: () => Effect.void, sweep: Effect.succeed(0) }),
}) {}

/** Rows per delete statement, so a large thread never holds the database for long. */
const BATCH_SIZE = 500;
/** Gap between swept purges, so a backlog of old deletions drains in the background. */
const SWEEP_SPACING = Duration.seconds(5);
const SWEEP_INTERVAL = Duration.hours(6);
const SCRUBBED_TEXT = "Removed when the thread was deleted.";

// Every table that holds a thread's content; a new one belongs here. The thread
// row itself stays as the tombstone.
const THREAD_CONTENT_TABLES = [
  "orchestration_v2_projection_runs",
  "orchestration_v2_projection_run_attempts",
  "orchestration_v2_projection_nodes",
  "orchestration_v2_projection_provider_turns",
  "orchestration_v2_projection_provider_threads",
  "orchestration_v2_projection_runtime_requests",
  "orchestration_v2_projection_messages",
  "orchestration_v2_projection_plans",
  "orchestration_v2_projection_turn_items",
  "orchestration_v2_projection_checkpoints",
  "orchestration_v2_projection_checkpoint_scopes",
  "orchestration_v2_projection_context_handoffs",
  "orchestration_v2_projection_subagents",
  "orchestration_v2_turn_item_positions",
  "orchestration_v2_thread_launch_workflows",
  "orchestration_v2_legacy_imports",
  // The pre-cutover V2 log; its rows were copied into orchestration_events.
  "orchestration_v2_events",
  // V1 import sources. Removing them also stops a re-import.
  "projection_threads",
  "projection_thread_messages",
  "projection_thread_pull_requests",
  "projection_thread_sessions",
  "provider_session_runtime",
  "mcp_app_model_context",
] as const;

const decodeThreadJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const encodeThreadJson = Schema.encodeEffect(Schema.fromJsonString(OrchestrationV2AppThreadJson));
const encodeRequest = Schema.encodeSync(Schema.fromJsonString(OrchestrationEffectRequestV2));

interface ThreadPurgePlan {
  readonly parentThreadId: ThreadId | null;
  readonly checkpointRefs: CheckpointRefGroups;
}

function mergeRefGroups(
  left: CheckpointRefGroups,
  right: CheckpointRefGroups,
): CheckpointRefGroups {
  const byCheckout = new Map<string, { cwds: ReadonlyArray<string>; refs: Set<CheckpointRef> }>();
  for (const group of [...left, ...right]) {
    const key = group.cwds.join("\u0000");
    const entry = byCheckout.get(key) ?? { cwds: group.cwds, refs: new Set() };
    for (const ref of group.refs) entry.refs.add(ref);
    byCheckout.set(key, entry);
  }
  return [...byCheckout.values()].map((entry) => ({ cwds: entry.cwds, refs: [...entry.refs] }));
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const checkpointStore = yield* CheckpointStore.CheckpointStore;

  /**
   * None while the thread is live or a live thread still reads it: a pending
   * transfer it sent, or a fork below it. Subagent threads don't hold their
   * parent; they are deleted with it.
   */
  const plan = Effect.fn("ThreadPurge.plan")(
    function* (threadId: ThreadId) {
      const threads = yield* sql<{
        readonly deleted_at: string | null;
        readonly parent_thread_id: string | null;
        readonly relationship: string | null;
      }>`
        SELECT deleted_at,
          json_extract(payload_json, '$.lineage.parentThreadId') AS parent_thread_id,
          json_extract(payload_json, '$.lineage.relationshipToParent') AS relationship
        FROM orchestration_v2_projection_threads
        WHERE thread_id = ${threadId}
      `;
      const thread = threads[0];
      if (thread === undefined || thread.deleted_at === null) return Option.none();
      const pendingTransfers = yield* sql`
        SELECT 1 FROM orchestration_v2_projection_context_transfers AS transfer
        JOIN orchestration_v2_projection_threads AS target
          ON target.thread_id = transfer.target_thread_id
        WHERE transfer.source_thread_id = ${threadId}
          AND transfer.target_thread_id != ${threadId}
          AND transfer.status = 'pending'
          AND target.deleted_at IS NULL
        LIMIT 1
      `;
      if (pendingTransfers.length > 0) return Option.none();
      // A fork shows the history of every fork above it.
      const liveForks = yield* sql<{ readonly count: number }>`
        WITH RECURSIVE forks(thread_id, deleted_at) AS (
          SELECT thread_id, deleted_at
          FROM orchestration_v2_projection_threads
          WHERE json_extract(payload_json, '$.lineage.parentThreadId') = ${threadId}
            AND json_extract(payload_json, '$.lineage.relationshipToParent') = 'fork'
          UNION
          SELECT child.thread_id, child.deleted_at
          FROM orchestration_v2_projection_threads AS child
          JOIN forks
            ON json_extract(child.payload_json, '$.lineage.parentThreadId') = forks.thread_id
          WHERE json_extract(child.payload_json, '$.lineage.relationshipToParent') = 'fork'
        )
        SELECT COUNT(*) AS count FROM forks WHERE deleted_at IS NULL
      `;
      if ((liveForks[0]?.count ?? 0) > 0) return Option.none();
      if (thread.relationship === "subagent" && thread.parent_thread_id !== null) {
        const awaited = yield* sql`
          SELECT 1 FROM orchestration_v2_projection_subagents AS subagent
          JOIN orchestration_v2_projection_threads AS parent
            ON parent.thread_id = subagent.thread_id
          WHERE subagent.thread_id = ${thread.parent_thread_id}
            AND subagent.child_thread_id = ${threadId}
            AND subagent.status IN ('idle', 'pending', 'running', 'waiting')
            AND parent.deleted_at IS NULL
          LIMIT 1
        `;
        if (awaited.length > 0) {
          return yield* new ThreadPurgeAwaitingParentError({ threadId });
        }
      }
      const owned = yield* sql<{
        readonly ref: string;
        readonly scope_cwd: string | null;
        readonly worktree_path: string | null;
        readonly workspace_root: string | null;
      }>`
        SELECT DISTINCT
          json_extract(checkpoint.payload_json, '$.ref') AS ref,
          json_extract(scope.payload_json, '$.cwd') AS scope_cwd,
          json_extract(thread.payload_json, '$.worktreePath') AS worktree_path,
          project.workspace_root AS workspace_root
        FROM orchestration_v2_projection_checkpoints AS checkpoint
        JOIN orchestration_v2_projection_threads AS thread
          ON thread.thread_id = checkpoint.thread_id
        LEFT JOIN orchestration_v2_projection_checkpoint_scopes AS scope
          ON scope.scope_id = checkpoint.scope_id
        LEFT JOIN projection_projects AS project ON project.project_id = thread.project_id
        WHERE checkpoint.thread_id = ${threadId}
          AND json_extract(checkpoint.payload_json, '$.ref') IS NOT NULL
      `;
      const shared = new Set<string>();
      const refs = [...new Set(owned.map((row) => row.ref))];
      for (let index = 0; index < refs.length; index += BATCH_SIZE) {
        const rows = yield* sql<{ readonly ref: string }>`
          SELECT DISTINCT json_extract(payload_json, '$.ref') AS ref
          FROM orchestration_v2_projection_checkpoints
          WHERE thread_id != ${threadId}
            AND json_extract(payload_json, '$.ref') IN ${sql.in(refs.slice(index, index + BATCH_SIZE))}
        `;
        for (const row of rows) shared.add(row.ref);
      }
      // Linked worktrees share refs with their main checkout, so the project
      // root still reaches them once the worktree is gone.
      const checkpointRefs = mergeRefGroups(
        [],
        owned
          .filter((row) => !shared.has(row.ref))
          .map((row) => ({
            cwds: [row.scope_cwd, row.worktree_path, row.workspace_root].filter(
              (cwd): cwd is string => cwd !== null,
            ),
            refs: [CheckpointRef.make(row.ref)],
          })),
      );
      return Option.some<ThreadPurgePlan>({
        parentThreadId:
          thread.parent_thread_id === null ? null : ThreadId.make(thread.parent_thread_id),
        checkpointRefs,
      });
    },
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new ThreadPurgeError({ operation: "plan", cause })),
    }),
  );

  // Every statement in between, compaction included, also overwrites what it frees.
  const withSecureDelete = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      sql<{ readonly secure_delete: number }>`PRAGMA secure_delete`.pipe(
        Effect.tap(() => sql`PRAGMA secure_delete = ON`),
      ),
      () => effect,
      // PRAGMA takes no bound parameters; the value is SQLite's own 0, 1 or 2.
      (previous) =>
        sql
          .unsafe(`PRAGMA secure_delete = ${Number(previous[0]?.secure_delete ?? 0)}`)
          .pipe(Effect.ignore),
    );

  // Batched, so the shared connection serves other work in between.
  const deleteInBatches = Effect.fn("ThreadPurge.deleteInBatches")(function* (
    table: string,
    where: Statement.Fragment,
  ) {
    while (true) {
      const deleted = yield* sql`
        DELETE FROM ${sql(table)} WHERE rowid IN (
          SELECT rowid FROM ${sql(table)} WHERE ${where} LIMIT ${BATCH_SIZE}
        )
        RETURNING 1 AS deleted
      `;
      if (deleted.length < BATCH_SIZE) return;
      yield* Effect.yieldNow;
    }
  });

  /**
   * Keeps the thread row, its first thread.created and its last
   * thread.deleted, all rewritten to the tombstone first. Like compaction,
   * every removed event is followed by the retained thread.deleted, so a
   * client replaying from any cursor still ends with the thread deleted.
   * Events go last, so leftover events mean an interrupted erase.
   */
  const erase = Effect.fn("ThreadPurge.erase")(
    function* (threadId: ThreadId) {
      const kept = yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly payload_json: string }>`
            SELECT payload_json FROM orchestration_v2_projection_threads
            WHERE thread_id = ${threadId}
          `;
          if (rows[0] === undefined) return null;
          const thread = yield* decodeThreadJson(rows[0].payload_json);
          // Destructive, so it rechecks that the thread is deleted.
          if (thread.deletedAt === null) return null;
          const tombstoneJson = yield* encodeThreadJson(threadTombstone(thread));
          const anchors = yield* sql<{
            readonly sequence: number;
            readonly event_type: string;
            readonly payload_json: string;
          }>`
            SELECT sequence, event_type, payload_json
            FROM orchestration_events
            WHERE aggregate_kind = 'thread'
              AND stream_id = ${threadId}
              AND application_event_version = 2
              AND event_type IN ('thread.created', 'thread.deleted')
            ORDER BY sequence ASC
          `;
          const created = anchors.find((row) => row.event_type === "thread.created");
          const deleted = anchors.findLast((row) => row.event_type === "thread.deleted");
          // verify expects a thread.created for every thread row.
          if (created === undefined) return null;
          // A thread deleted before V2 was imported deleted, with no
          // thread.deleted; its creation then carries the deleted state.
          const createdJson =
            deleted === undefined
              ? tombstoneJson
              : yield* encodeThreadJson(
                  threadTombstone(yield* decodeThreadJson(created.payload_json)),
                );
          yield* sql`
            UPDATE orchestration_v2_projection_threads
            SET title = ${DELETED_THREAD_TITLE}, payload_json = ${tombstoneJson}
            WHERE thread_id = ${threadId}
          `;
          yield* sql`
            UPDATE orchestration_events SET payload_json = ${createdJson}
            WHERE sequence = ${created.sequence}
          `;
          if (deleted !== undefined) {
            yield* sql`
              UPDATE orchestration_events SET payload_json = ${tombstoneJson}
              WHERE sequence = ${deleted.sequence}
            `;
          }
          // Settled effects and receipts outlive the thread; their free text goes.
          yield* sql`
            UPDATE orchestration_v2_effect_outbox
            SET payload_json = json_remove(payload_json, '$.answers', '$.detail', '$.reason'),
              last_error = CASE WHEN last_error IS NULL THEN NULL ELSE ${SCRUBBED_TEXT} END
            WHERE thread_id = ${threadId} AND status NOT IN ('pending', 'running')
          `;
          yield* sql`
            UPDATE orchestration_command_receipts SET error = ${SCRUBBED_TEXT}
            WHERE aggregate_kind = 'thread' AND aggregate_id = ${threadId} AND error IS NOT NULL
          `;
          return deleted === undefined ? [created.sequence] : [created.sequence, deleted.sequence];
        }),
      );
      if (kept === null) return;

      yield* withSecureDelete(
        Effect.gen(function* () {
          for (const table of THREAD_CONTENT_TABLES) {
            yield* deleteInBatches(table, sql`thread_id = ${threadId}`);
          }
          // Transfers live in their target's stream; one this thread sent
          // belongs to the thread that received it.
          yield* deleteInBatches(
            "orchestration_v2_projection_context_transfers",
            sql`target_thread_id = ${threadId}`,
          );
          yield* deleteInBatches(
            "orchestration_v2_projection_provider_session_bindings",
            sql`thread_id = ${threadId}`,
          );
          yield* sql`
            DELETE FROM orchestration_v2_projection_provider_sessions
            WHERE thread_id = ${threadId}
              AND NOT EXISTS (
                SELECT 1 FROM orchestration_v2_projection_provider_session_bindings AS binding
                WHERE binding.provider_session_id =
                  orchestration_v2_projection_provider_sessions.provider_session_id
              )
          `;
          yield* deleteInBatches(
            "orchestration_events",
            sql`aggregate_kind = 'thread' AND stream_id = ${threadId} AND sequence NOT IN ${sql.in(kept)}`,
          );
        }),
      );
      // Removing the newest events would leave projections ahead of the log,
      // which verify reports as invalid.
      yield* sql`
        UPDATE orchestration_v2_projection_metadata
        SET last_sequence = (
          SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events
          WHERE application_event_version = 2 AND aggregate_kind = 'thread'
        )
        WHERE projection_name = 'thread-projections'
          AND last_sequence > (
            SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events
            WHERE application_event_version = 2 AND aggregate_kind = 'thread'
          )
      `;
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.mapError((cause) => new ThreadPurgeError({ operation: "erase", threadId, cause })),
      ),
  );

  const deleteCheckpointRefs = Effect.fn("ThreadPurge.deleteCheckpointRefs")(function* (
    groups: CheckpointRefGroups,
  ) {
    for (const group of groups) {
      const cwd = yield* Effect.findFirst(group.cwds, (cwd) =>
        fileSystem.exists(cwd).pipe(Effect.orElseSucceed(() => false)),
      );
      // No checkout left means the refs went with the repository.
      if (Option.isNone(cwd)) continue;
      const checkout = cwd.value;
      yield* checkpointStore
        .deleteCheckpointRefs({ cwd: checkout, checkpointRefs: group.refs })
        .pipe(Effect.ignore);
      // A failed `update-ref -d` still succeeds there, so name what survived.
      const survivors = yield* Effect.filter(
        group.refs,
        (checkpointRef) =>
          checkpointStore
            .hasCheckpointRef({ cwd: checkout, checkpointRef })
            .pipe(Effect.orElseSucceed(() => true)),
        { concurrency: 4 },
      );
      if (survivors.length > 0) {
        yield* Effect.logWarning("Could not delete a deleted thread's checkpoint refs", {
          cwd: checkout,
          refs: survivors,
        });
      }
    }
  });

  const purge = Effect.fn("ThreadPurge.purge")(function* (input: ThreadPurgeInput) {
    const children = yield* sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM orchestration_v2_projection_threads
      WHERE json_extract(payload_json, '$.lineage.parentThreadId') = ${input.threadId}
        AND json_extract(payload_json, '$.lineage.relationshipToParent') = 'subagent'
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM orchestration_v2_projection_threads AS parent
          WHERE parent.thread_id = ${input.threadId} AND parent.deleted_at IS NOT NULL
        )
    `.pipe(
      Effect.mapError(
        (cause) => new ThreadPurgeError({ operation: "plan", threadId: input.threadId, cause }),
      ),
    );
    // A subagent thread exists for its parent, so it goes with it.
    for (const child of children) {
      const childId = ThreadId.make(child.thread_id);
      yield* input
        .deleteThread(childId, CommandId.make(`${input.effectId}:delete-subagent:${childId}`))
        .pipe(
          Effect.mapError(
            (cause) =>
              new ThreadPurgeError({ operation: "delete-subagents", threadId: childId, cause }),
          ),
        );
    }

    let recorded = input.checkpointRefs;
    const erased: Array<ThreadId> = [];
    let next: ThreadId | null = input.threadId;
    while (next !== null && !erased.includes(next)) {
      const current: ThreadId = next;
      const planned: Option.Option<ThreadPurgePlan> = yield* plan(current).pipe(
        // An ancestor still awaited by its own parent waits for its own purge.
        Effect.catchTags({
          ThreadPurgeAwaitingParentError: (error) =>
            current === input.threadId ? Effect.fail(error) : Effect.succeedNone,
        }),
      );
      if (Option.isNone(planned)) break;
      // The refs outlive the records that name them, so a retry still finds them.
      recorded = mergeRefGroups(recorded, planned.value.checkpointRefs);
      yield* sql`
        UPDATE orchestration_v2_effect_outbox
        SET payload_json = ${encodeRequest({ type: "thread.purge", checkpointRefs: recorded })}
        WHERE effect_id = ${input.effectId}
      `.pipe(
        Effect.mapError(
          (cause) => new ThreadPurgeError({ operation: "record", threadId: current, cause }),
        ),
      );
      yield* erase(current);
      erased.push(current);
      next = planned.value.parentThreadId;
    }

    // Files after the records, so a git or disk failure never keeps the transcript.
    yield* deleteCheckpointRefs(recorded);
    for (const threadId of erased) {
      yield* removeThreadProviderEventLogs(config.providerEventLogPath, threadId).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.catch((cause) =>
          Effect.logWarning("Could not delete a deleted thread's provider logs", {
            threadId,
            cause,
          }),
        ),
      );
    }
  });

  const sweep = Effect.gen(function* () {
    const candidates = yield* sql<{ readonly thread_id: string }>`
      SELECT thread.thread_id FROM orchestration_v2_projection_threads AS thread
      WHERE thread.deleted_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM orchestration_events AS event
          WHERE event.aggregate_kind = 'thread'
            AND event.stream_id = thread.thread_id
            AND event.event_type NOT IN ('thread.created', 'thread.deleted')
        )
      ORDER BY thread.deleted_at ASC, thread.thread_id ASC
    `;
    const now = yield* DateTime.now;
    let queued = 0;
    for (const candidate of candidates) {
      const threadId = ThreadId.make(candidate.thread_id);
      const planned = yield* plan(threadId).pipe(
        Effect.catchTags({ ThreadPurgeAwaitingParentError: () => Effect.succeedNone }),
      );
      if (Option.isNone(planned)) continue;
      const active = yield* sql`
        SELECT 1 FROM orchestration_v2_effect_outbox
        WHERE thread_id = ${threadId}
          AND effect_type = 'thread.purge'
          AND status IN ('pending', 'running')
        LIMIT 1
      `;
      if (active.length > 0) continue;
      const availableAt = DateTime.formatIso(
        DateTime.add(now, { milliseconds: Duration.toMillis(SWEEP_SPACING) * queued }),
      );
      const nowIso = DateTime.formatIso(now);
      // Reviving a failed purge also clears it from storage cleanup's view.
      const revived = yield* sql`
        UPDATE orchestration_v2_effect_outbox
        SET status = 'pending', attempt_count = 0, available_at = ${availableAt},
          lease_owner = NULL, lease_expires_at = NULL, completed_at = NULL,
          last_error = NULL, updated_at = ${nowIso}
        WHERE thread_id = ${threadId} AND effect_type = 'thread.purge' AND status = 'failed'
        RETURNING effect_id
      `;
      if (revived.length === 0) {
        yield* sql`
          INSERT INTO orchestration_v2_effect_outbox (
            effect_id, command_id, thread_id, effect_type, payload_json, status,
            attempt_count, available_at, created_at, updated_at
          )
          VALUES (
            ${`effect:thread-purge-sweep:${threadId}`},
            ${`thread-purge-sweep:${threadId}`},
            ${threadId},
            'thread.purge',
            ${encodeRequest({ type: "thread.purge" })},
            'pending',
            0,
            ${availableAt},
            ${nowIso},
            ${nowIso}
          )
          ON CONFLICT(effect_id) DO UPDATE SET
            status = 'pending', attempt_count = 0, available_at = excluded.available_at,
            lease_owner = NULL, lease_expires_at = NULL, completed_at = NULL,
            last_error = NULL, updated_at = excluded.updated_at
        `;
      }
      queued += 1;
    }
    return queued;
  }).pipe(Effect.mapError((cause) => new ThreadPurgeError({ operation: "sweep", cause })));

  return { purge, sweep };
});

export const layer = Layer.effect(ThreadPurge, make);

/** Finds deletions an older build only hid, or whose purge failed, after boot and every 6 h. */
export const layerSweepWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const purges = yield* ThreadPurge;
    yield* forkParked(
      Effect.sleep(Duration.minutes(1)).pipe(
        Effect.andThen(
          purges.sweep.pipe(
            Effect.tap((queued) =>
              queued > 0 ? Effect.logInfo("Queued deleted thread purges", { queued }) : Effect.void,
            ),
            Effect.catch((cause) =>
              Effect.logWarning("Queueing deleted thread purges failed", { cause }),
            ),
            Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
          ),
        ),
      ),
    );
  }),
);
