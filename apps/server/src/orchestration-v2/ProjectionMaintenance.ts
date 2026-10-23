import { CheckpointRef, OrchestrationV2AppThreadJson, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { OrchestrationEffectRequestV2 } from "./EffectOutbox.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { DELETED_THREAD_TITLE, threadTombstone } from "./ThreadDeletion.ts";

export interface ProjectionVerificationV2 {
  readonly valid: boolean;
  readonly schemaVersion: number;
  readonly expectedSequence: number;
  readonly projectionSequence: number;
  readonly unreadableThreadIds: ReadonlyArray<ThreadId>;
  readonly missingThreadIds: ReadonlyArray<ThreadId>;
  readonly unexpectedThreadIds: ReadonlyArray<ThreadId>;
}

export class ProjectionMaintenanceError extends Schema.TaggedError<ProjectionMaintenanceError>()(
  "ProjectionMaintenanceError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** What purging a deleted thread removes outside the database. */
export interface ThreadPurgePlan {
  readonly parentThreadId: ThreadId | null;
  /** Hidden checkpoint refs no other thread records, by the checkouts that hold them. */
  readonly checkpointRefs: ReadonlyArray<{
    readonly cwds: ReadonlyArray<string>;
    readonly refs: ReadonlyArray<CheckpointRef>;
  }>;
}

export interface ProjectionMaintenanceV2Shape {
  readonly verify: Effect.Effect<ProjectionVerificationV2, ProjectionMaintenanceError>;
  /**
   * None while the thread is live or a live thread descends from it: forks read
   * their parent's history, and subagent threads their parent's records.
   */
  readonly readThreadPurge: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ThreadPurgePlan>, ProjectionMaintenanceError>;
  readonly purgeThread: (threadId: ThreadId) => Effect.Effect<void, ProjectionMaintenanceError>;
  /**
   * Queues a purge for each deleted thread that still holds content, such as
   * one deleted by a build that only hid threads. Returns how many it queued.
   */
  readonly enqueueDeletedThreadPurges: Effect.Effect<number, ProjectionMaintenanceError>;
  readonly rebuild: Effect.Effect<ProjectionVerificationV2, ProjectionMaintenanceError>;
  readonly compactEventStore: Effect.Effect<
    {
      readonly deletedEventCount: number;
      readonly deletedReceiptCount: number;
      readonly reclaimableBytes: number;
    },
    ProjectionMaintenanceError
  >;
}

export class ProjectionMaintenanceV2 extends Context.Service<
  ProjectionMaintenanceV2,
  ProjectionMaintenanceV2Shape
>()("t3/orchestration-v2/ProjectionMaintenance/ProjectionMaintenanceV2") {}

type ProjectionMetadataRow = {
  readonly schema_version: number;
  readonly last_sequence: number;
};

const THREAD_PURGE_REQUEST_JSON = Schema.encodeSync(
  Schema.fromJsonString(OrchestrationEffectRequestV2),
)({ type: "thread.purge" });

const decodeThreadJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const encodeThreadJson = Schema.encodeEffect(Schema.fromJsonString(OrchestrationV2AppThreadJson));

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

const encodeEntityKey = Schema.encodeSync(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.NullOr(Schema.String)])),
);

export const layer: Layer.Layer<
  ProjectionMaintenanceV2,
  never,
  EventStore.EventStoreV2 | ProjectionStore.ProjectionStoreV2 | SqlClient.SqlClient
> = Layer.effect(
  ProjectionMaintenanceV2,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* EventStore.EventStoreV2;
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;

    const verify = Effect.gen(function* () {
      const expectedThreadRows = yield* sql<{ readonly thread_id: string }>`
        SELECT DISTINCT stream_id AS thread_id
        FROM orchestration_events INDEXED BY orchestration_events_v2_created_threads_idx
        WHERE application_event_version = 2
          AND aggregate_kind = 'thread'
          AND event_type = 'thread.created'
        ORDER BY stream_id ASC
      `;
      const projectionRows = yield* sql<{ readonly thread_id: string }>`
        SELECT thread_id
        FROM orchestration_v2_projection_threads
        ORDER BY thread_id ASC
      `;
      const actualIds = projectionRows.map((row) => ThreadId.make(row.thread_id));
      const expectedIds = expectedThreadRows.map((row) => ThreadId.make(row.thread_id));
      const actualSet = new Set(actualIds);
      const expectedSet = new Set(expectedIds);
      const missingThreadIds = expectedIds.filter((threadId) => !actualSet.has(threadId));
      const unexpectedThreadIds = actualIds.filter((threadId) => !expectedSet.has(threadId));
      const unreadableThreadIds = yield* projectionStore.getUnreadableThreadIds();
      const metadata = yield* sql<ProjectionMetadataRow>`
        SELECT schema_version, last_sequence
        FROM orchestration_v2_projection_metadata
        WHERE projection_name = 'thread-projections'
        LIMIT 1
      `;
      const expectedSequence = yield* eventStore.latestSequence();
      const schemaVersion = metadata[0]?.schema_version ?? 0;
      const projectionSequence = metadata[0]?.last_sequence ?? 0;
      return {
        valid:
          schemaVersion === ProjectionStore.ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION &&
          projectionSequence === expectedSequence &&
          missingThreadIds.length === 0 &&
          unexpectedThreadIds.length === 0 &&
          unreadableThreadIds.length === 0,
        schemaVersion,
        expectedSequence,
        projectionSequence,
        unreadableThreadIds,
        missingThreadIds,
        unexpectedThreadIds,
      } satisfies ProjectionVerificationV2;
    }).pipe(sql.withTransaction);

    const rebuild = Effect.gen(function* () {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const throughSequence = yield* eventStore.latestSequence();
          yield* sql`DELETE FROM orchestration_v2_projection_context_transfers`;
          yield* sql`DELETE FROM orchestration_v2_projection_context_handoffs`;
          yield* sql`DELETE FROM orchestration_v2_projection_checkpoints`;
          yield* sql`DELETE FROM orchestration_v2_projection_checkpoint_scopes`;
          yield* sql`DELETE FROM orchestration_v2_projection_turn_items`;
          yield* sql`DELETE FROM orchestration_v2_projection_plans`;
          yield* sql`DELETE FROM orchestration_v2_projection_messages`;
          yield* sql`DELETE FROM orchestration_v2_projection_runtime_requests`;
          yield* sql`DELETE FROM orchestration_v2_projection_provider_turns`;
          yield* sql`DELETE FROM orchestration_v2_projection_provider_threads`;
          yield* sql`DELETE FROM orchestration_v2_projection_provider_session_bindings`;
          yield* sql`DELETE FROM orchestration_v2_projection_provider_sessions`;
          yield* sql`DELETE FROM orchestration_v2_projection_subagents`;
          yield* sql`DELETE FROM orchestration_v2_projection_nodes`;
          yield* sql`DELETE FROM orchestration_v2_projection_run_attempts`;
          yield* sql`DELETE FROM orchestration_v2_projection_runs`;
          yield* sql`DELETE FROM orchestration_v2_projection_threads`;
          yield* sql`DELETE FROM orchestration_v2_turn_item_positions`;

          const pageSize = 500;
          let lastSequence = 0;
          while (true) {
            const page = yield* eventStore
              .read({ afterSequence: lastSequence, throughSequence, limit: pageSize })
              .pipe(Stream.runCollect);
            for (const stored of page) {
              yield* projectionStore.apply(stored.event);
              if (stored.event.type === "turn-item.updated") {
                yield* sql`
                INSERT INTO orchestration_v2_turn_item_positions (
                  thread_id,
                  turn_item_id,
                  ordinal
                )
                VALUES (
                  ${stored.event.threadId},
                  ${stored.event.payload.id},
                  ${stored.event.payload.ordinal}
                )
                ON CONFLICT(thread_id, turn_item_id) DO UPDATE SET
                  ordinal = excluded.ordinal
                `;
              }
              lastSequence = stored.sequence;
            }
            if (page.length < pageSize) break;
            yield* Effect.yieldNow;
          }
          const now = DateTime.formatIso(yield* DateTime.now);
          yield* sql`
            INSERT INTO orchestration_v2_projection_metadata (
              projection_name,
              schema_version,
              last_sequence,
              updated_at
            )
            VALUES (
              'thread-projections',
              ${ProjectionStore.ORCHESTRATION_V2_PROJECTION_SCHEMA_VERSION},
              ${lastSequence},
              ${now}
            )
            ON CONFLICT(projection_name) DO UPDATE SET
              schema_version = excluded.schema_version,
              last_sequence = excluded.last_sequence,
              updated_at = excluded.updated_at
          `;
        }),
      );
      return yield* verify;
    });

    const mapError =
      (operation: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.mapError((cause) => new ProjectionMaintenanceError({ operation, cause })),
        );

    // thread.created stays out — verify derives the expected thread set from
    // it, and it anchors replay ordering. thread.deleted stays out too: clients
    // and waitForThread switch on the event type, not just the payload.
    const SUPERSEDABLE_THREAD_EVENT_TYPES = [
      "thread.archived",
      "thread.unarchived",
      "thread.settled",
      "thread.unsettled",
      "thread.snoozed",
      "thread.unsnoozed",
      "thread.pinned",
      "thread.auto-settle-set",
      "thread.unpinned",
      "thread.pin-reordered",
      "thread.active-reordered",
      "thread.metadata-updated",
      "thread.pull-request-synced",
      "thread.runtime-mode-updated",
      "thread.interaction-mode-updated",
      "thread.model-selection-updated",
      "thread.provider-switched",
    ];
    // Read-state events carry the whole thread too, but client reducers apply
    // them without bumping updatedAt. They supersede only each other: a newer
    // visit must not delete the rename that carries the activity timestamp,
    // while any newer activity-bearing event supersedes both groups.
    const READ_STATE_THREAD_EVENT_TYPES = ["thread.visited", "thread.marked-unread"];

    const supersedableThreadEventTypes = new Set(SUPERSEDABLE_THREAD_EVENT_TYPES);
    const readStateThreadEventTypes = new Set(READ_STATE_THREAD_EVENT_TYPES);
    // Keep subagent.updated and turn-item.updated rows: slimmed payloads reference their prompts.
    // Small pages bound work on the reader worker and synchronous fallback.
    const COMPACTION_PAGE_SIZE = 50;

    /**
     * Scan newest first to retain the newest state for each entity. Keyed
     * entities (messages, nodes, PR links) also keep their oldest event: client
     * reducers append an entity where they first see it, so a replay from any
     * cursor must either carry that first event or find the entity already
     * present. Only the events in between are deleted.
     * Page every event, including non-candidates: filtering before LIMIT could
     * still scan the entire history when superseded events are sparse.
     * turn-item.updated stays intact because replay assigns positions on first write.
     */
    const compactEventStore = Effect.gen(function* () {
      const bounds = yield* sql<{
        readonly event_sequence: number;
        readonly receipt_row_id: number;
      }>`
        SELECT
          COALESCE((SELECT MAX(sequence) FROM orchestration_events), 0) AS event_sequence,
          COALESCE((SELECT MAX(rowid) FROM orchestration_command_receipts), 0) AS receipt_row_id
      `;
      let throughSequence = bounds[0]?.event_sequence ?? 0;
      let throughReceiptRowId = bounds[0]?.receipt_row_id ?? 0;
      const retainedThreadIds = new Set<string>();
      const retainedReadStateThreadIds = new Set<string>();
      // Per key: the lowest sequence seen so far after the newest. It is
      // deleted once an even older event turns up and kept otherwise.
      const oldestCandidateByEntityKey = new Map<string, number | null>();
      let deletedEventCount = 0;
      let deletedReceiptCount = 0;

      while (throughSequence > 0) {
        const rows = yield* sql<{
          readonly sequence: number;
          readonly application_event_version: number;
          readonly aggregate_kind: string;
          readonly stream_id: string;
          readonly event_type: string;
          readonly entity_id: string | null;
          readonly imported_legacy_thread: number;
        }>`
          SELECT
            event.sequence,
            event.application_event_version,
            event.aggregate_kind,
            event.stream_id,
            event.event_type,
            CASE
              WHEN event.application_event_version = 2
                AND event.event_type IN ('message.updated', 'node.updated')
              THEN json_extract(event.payload_json, '$.id')
              WHEN event.application_event_version = 2
                AND event.event_type = 'thread.pull-request-link-updated'
              THEN json_array(json_extract(event.payload_json, '$.host'),
                json_extract(event.payload_json, '$.repository'),
                json_extract(event.payload_json, '$.number'))
              ELSE NULL
            END AS entity_id,
            CASE
              WHEN event.application_event_version = 1 AND event.aggregate_kind = 'thread'
              THEN EXISTS (
                SELECT 1 FROM orchestration_v2_legacy_imports AS legacy_import
                WHERE legacy_import.thread_id = event.stream_id
                  AND legacy_import.transcript_imported_at IS NOT NULL
              )
              ELSE 0
            END AS imported_legacy_thread
          FROM orchestration_events AS event
          WHERE event.sequence <= ${throughSequence}
          ORDER BY event.sequence DESC
          LIMIT ${COMPACTION_PAGE_SIZE}
        `.pipe(NodeSqliteClient.readOnly);
        const obsolete: number[] = [];
        for (const row of rows) {
          if (row.imported_legacy_thread === 1) {
            obsolete.push(row.sequence);
          } else if (row.application_event_version === 2) {
            if (
              row.aggregate_kind === "thread" &&
              supersedableThreadEventTypes.has(row.event_type)
            ) {
              if (retainedThreadIds.has(row.stream_id)) obsolete.push(row.sequence);
              else retainedThreadIds.add(row.stream_id);
            } else if (
              row.aggregate_kind === "thread" &&
              readStateThreadEventTypes.has(row.event_type)
            ) {
              if (
                retainedThreadIds.has(row.stream_id) ||
                retainedReadStateThreadIds.has(row.stream_id)
              ) {
                obsolete.push(row.sequence);
              } else retainedReadStateThreadIds.add(row.stream_id);
            } else if (
              row.event_type === "thread.pull-request-link-updated" &&
              retainedThreadIds.has(row.stream_id)
            ) {
              // A newer whole-thread payload already carries this link's state.
              obsolete.push(row.sequence);
            } else if (
              row.event_type === "thread.pull-request-link-updated" ||
              row.event_type === "message.updated" ||
              row.event_type === "node.updated"
            ) {
              const key = encodeEntityKey([row.event_type, row.stream_id, row.entity_id]);
              const candidate = oldestCandidateByEntityKey.get(key);
              if (candidate === undefined) oldestCandidateByEntityKey.set(key, null);
              else {
                if (candidate !== null) obsolete.push(candidate);
                oldestCandidateByEntityKey.set(key, row.sequence);
              }
            }
          }
        }
        // Yield even without deletions for clients using the synchronous fallback.
        yield* Effect.yieldNow;
        if (obsolete.length > 0) {
          yield* sql`DELETE FROM orchestration_events WHERE sequence IN ${sql.in(obsolete)}`;
          deletedEventCount += obsolete.length;
          yield* Effect.yieldNow;
        }
        throughSequence = (rows.at(-1)?.sequence ?? 1) - 1;
        if (rows.length < COMPACTION_PAGE_SIZE) break;
      }

      while (throughReceiptRowId > 0) {
        const rows = yield* sql<{
          readonly row_id: number;
          readonly command_id: string;
          readonly imported_legacy_thread: number;
        }>`
          SELECT
            receipt.rowid AS row_id,
            receipt.command_id,
            CASE
              WHEN receipt.command_type = 'legacy' AND receipt.aggregate_kind = 'thread'
              THEN EXISTS (
                SELECT 1 FROM orchestration_v2_legacy_imports AS legacy_import
                WHERE legacy_import.thread_id = receipt.aggregate_id
                  AND legacy_import.transcript_imported_at IS NOT NULL
              )
              ELSE 0
            END AS imported_legacy_thread
          FROM orchestration_command_receipts AS receipt
          WHERE receipt.rowid <= ${throughReceiptRowId}
          ORDER BY receipt.rowid DESC
          LIMIT ${COMPACTION_PAGE_SIZE}
        `.pipe(NodeSqliteClient.readOnly);
        const obsolete = rows
          .filter((row) => row.imported_legacy_thread === 1)
          .map((row) => row.command_id);
        yield* Effect.yieldNow;
        if (obsolete.length > 0) {
          yield* sql`DELETE FROM orchestration_command_receipts WHERE command_id IN ${sql.in(obsolete)}`;
          deletedReceiptCount += obsolete.length;
          yield* Effect.yieldNow;
        }
        throughReceiptRowId = (rows.at(-1)?.row_id ?? 1) - 1;
        if (rows.length < COMPACTION_PAGE_SIZE) break;
      }

      const freelistRows = yield* sql<{ readonly freelist_count: number }>`PRAGMA freelist_count`;
      const pageSizeRows = yield* sql<{ readonly page_size: number }>`PRAGMA page_size`;
      const reclaimableBytes =
        (freelistRows[0]?.freelist_count ?? 0) * (pageSizeRows[0]?.page_size ?? 0);

      return { deletedEventCount, deletedReceiptCount, reclaimableBytes };
    });

    const readThreadPurge = Effect.fn("ProjectionMaintenance.readThreadPurge")(function* (
      threadId: ThreadId,
    ) {
      const threads = yield* sql<{
        readonly deleted_at: string | null;
        readonly parent_thread_id: string | null;
      }>`
        SELECT deleted_at,
          json_extract(payload_json, '$.lineage.parentThreadId') AS parent_thread_id
        FROM orchestration_v2_projection_threads
        WHERE thread_id = ${threadId}
      `;
      const thread = threads[0];
      if (thread === undefined || thread.deleted_at === null) return Option.none();
      const liveDescendants = yield* sql<{ readonly count: number }>`
        WITH RECURSIVE descendants(thread_id, deleted_at) AS (
          SELECT thread_id, deleted_at
          FROM orchestration_v2_projection_threads
          WHERE json_extract(payload_json, '$.lineage.parentThreadId') = ${threadId}
          UNION
          SELECT child.thread_id, child.deleted_at
          FROM orchestration_v2_projection_threads AS child
          JOIN descendants
            ON json_extract(child.payload_json, '$.lineage.parentThreadId') = descendants.thread_id
        )
        SELECT COUNT(*) AS count FROM descendants WHERE deleted_at IS NULL
      `;
      if ((liveDescendants[0]?.count ?? 0) > 0) return Option.none();
      const refs = yield* sql<{
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
        JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = checkpoint.thread_id
        LEFT JOIN orchestration_v2_projection_checkpoint_scopes AS scope
          ON scope.scope_id = checkpoint.scope_id
        LEFT JOIN projection_projects AS project ON project.project_id = thread.project_id
        WHERE checkpoint.thread_id = ${threadId}
          AND json_extract(checkpoint.payload_json, '$.ref') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM orchestration_v2_projection_checkpoints AS other
            WHERE other.thread_id != ${threadId}
              AND json_extract(other.payload_json, '$.ref') =
                json_extract(checkpoint.payload_json, '$.ref')
          )
      `;
      // Linked worktrees share refs with their main checkout, so the project
      // root still reaches them once the worktree is gone.
      const byCheckout = new Map<string, { cwds: Array<string>; refs: Array<CheckpointRef> }>();
      for (const row of refs) {
        const cwds = [row.scope_cwd, row.worktree_path, row.workspace_root].filter(
          (cwd): cwd is string => cwd !== null,
        );
        const key = cwds.join("\u0000");
        const group = byCheckout.get(key) ?? { cwds, refs: [] };
        group.refs.push(CheckpointRef.make(row.ref));
        byCheckout.set(key, group);
      }
      return Option.some<ThreadPurgePlan>({
        parentThreadId:
          thread.parent_thread_id === null ? null : ThreadId.make(thread.parent_thread_id),
        checkpointRefs: [...byCheckout.values()],
      });
    }, mapError("read thread purge"));

    /**
     * Keeps the thread row, its first thread.created and its last
     * thread.deleted, all rewritten to the tombstone. Like compaction,
     * every removed event is followed by the retained thread.deleted, so a
     * client replaying from any cursor still ends with the thread deleted.
     * Content goes with secure_delete on, so freed pages hold zeros, not text.
     */
    const purgeThread = Effect.fn("ProjectionMaintenance.purgeThread")(function* (
      threadId: ThreadId,
    ) {
      const previous = yield* sql<{ readonly secure_delete: number }>`PRAGMA secure_delete`;
      yield* sql`PRAGMA secure_delete = ON`;
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql<{ readonly payload_json: string }>`
              SELECT payload_json FROM orchestration_v2_projection_threads
              WHERE thread_id = ${threadId}
            `;
            if (rows[0] === undefined) return;
            const thread = yield* decodeThreadJson(rows[0].payload_json);
            // Destructive, so it rechecks that the thread is deleted.
            if (thread.deletedAt === null) return;
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
            if (created === undefined) return;
            // A thread deleted before V2 was imported deleted, with no
            // thread.deleted; its creation then carries the deleted state.
            const createdJson =
              deleted === undefined
                ? tombstoneJson
                : yield* encodeThreadJson(
                    threadTombstone(yield* decodeThreadJson(created.payload_json)),
                  );
            const kept =
              deleted === undefined ? [created.sequence] : [created.sequence, deleted.sequence];

            yield* sql`
              DELETE FROM orchestration_events
              WHERE aggregate_kind = 'thread'
                AND stream_id = ${threadId}
                AND sequence NOT IN ${sql.in(kept)}
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

            for (const table of THREAD_CONTENT_TABLES) {
              yield* sql`DELETE FROM ${sql(table)} WHERE thread_id = ${threadId}`;
            }
            // Transfers live in their target's stream; one this thread sent
            // belongs to the thread that received it.
            yield* sql`
              DELETE FROM orchestration_v2_projection_context_transfers
              WHERE target_thread_id = ${threadId}
            `;
            yield* sql`
              DELETE FROM orchestration_v2_projection_provider_session_bindings
              WHERE thread_id = ${threadId}
            `;
            yield* sql`
              DELETE FROM orchestration_v2_projection_provider_sessions
              WHERE thread_id = ${threadId}
                AND NOT EXISTS (
                  SELECT 1 FROM orchestration_v2_projection_provider_session_bindings AS binding
                  WHERE binding.provider_session_id =
                    orchestration_v2_projection_provider_sessions.provider_session_id
                )
            `;
            yield* sql`
              UPDATE orchestration_v2_projection_threads
              SET title = ${DELETED_THREAD_TITLE}, payload_json = ${tombstoneJson}
              WHERE thread_id = ${threadId}
            `;
            // Removing the newest events would leave projections ahead of the
            // log, which verify reports as invalid.
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
          }),
        )
        .pipe(
          Effect.ensuring(
            // PRAGMA takes no bound parameters; the value is SQLite's own 0, 1 or 2.
            sql
              .unsafe(`PRAGMA secure_delete = ${Number(previous[0]?.secure_delete ?? 0)}`)
              .pipe(Effect.ignore),
          ),
        );
    }, mapError("purge thread"));

    const enqueueDeletedThreadPurges = Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      const queued = yield* sql<{ readonly effect_id: string }>`
        INSERT INTO orchestration_v2_effect_outbox (
          effect_id,
          command_id,
          thread_id,
          effect_type,
          payload_json,
          status,
          attempt_count,
          available_at,
          created_at,
          updated_at
        )
        SELECT
          'effect:thread-purge-backfill:' || thread.thread_id,
          'thread-purge-backfill:' || thread.thread_id,
          thread.thread_id,
          'thread.purge',
          ${THREAD_PURGE_REQUEST_JSON},
          'pending',
          0,
          ${now},
          ${now},
          ${now}
        FROM orchestration_v2_projection_threads AS thread
        WHERE thread.deleted_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM orchestration_events AS event
            WHERE event.aggregate_kind = 'thread'
              AND event.stream_id = thread.thread_id
              AND event.event_type NOT IN ('thread.created', 'thread.deleted')
          )
          AND NOT EXISTS (
            SELECT 1 FROM orchestration_v2_effect_outbox AS effect
            WHERE effect.thread_id = thread.thread_id
              AND effect.effect_type = 'thread.purge'
              AND effect.status IN ('pending', 'running')
          )
        ON CONFLICT(effect_id) DO NOTHING
        RETURNING effect_id
      `;
      return queued.length;
    });

    return ProjectionMaintenanceV2.of({
      verify: mapError("verify")(verify),
      readThreadPurge,
      purgeThread,
      enqueueDeletedThreadPurges: mapError("enqueue deleted thread purges")(
        enqueueDeletedThreadPurges,
      ),
      rebuild: mapError("rebuild")(rebuild),
      compactEventStore: mapError("compact event store")(compactEventStore),
    });
  }),
);
