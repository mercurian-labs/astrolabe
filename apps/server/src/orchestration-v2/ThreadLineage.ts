import {
  ContextTransferId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2RunStatus,
  type OrchestrationV2ThreadLineage,
  type OrchestrationV2ThreadLineageRun,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class ThreadLineageThreadNotFoundError extends Schema.TaggedError<ThreadLineageThreadNotFoundError>()(
  "ThreadLineageThreadNotFoundError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return "The thread does not exist or was deleted.";
  }
}

export class ThreadLineageReadError extends Schema.TaggedError<ThreadLineageReadError>()(
  "ThreadLineageReadError",
  { threadId: ThreadId, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the thread's lineage.";
  }
}

/** Enough of a run's user message, and of its last reply, to describe its turn, without sending whole messages. */
const TEXT_LENGTH = 300;

/**
 * Reads a thread's fork family for the Lineage view straight from the projection tables: every
 * run of every family thread, which the clients' bounded projections do not hold.
 */
export class ThreadLineage extends Context.Service<
  ThreadLineage,
  {
    readonly read: (
      threadId: ThreadId,
    ) => Effect.Effect<
      OrchestrationV2ThreadLineage,
      ThreadLineageThreadNotFoundError | ThreadLineageReadError
    >;
  }
>()("t3/orchestration-v2/ThreadLineage") {}

interface ForkEdge {
  readonly id: ThreadId;
  readonly parentId: ThreadId;
}

/** Up the fork parents to the root, then every fork below it breadth first, root first. */
function forkFamily(threadId: ThreadId, edges: ReadonlyArray<ForkEdge>): ThreadId[] {
  const parentOf = new Map(edges.map((edge) => [edge.id, edge.parentId]));
  const forksOf = new Map<ThreadId, ThreadId[]>();
  for (const edge of edges) {
    forksOf.set(edge.parentId, [...(forksOf.get(edge.parentId) ?? []), edge.id]);
  }
  let root = threadId;
  const climbed = new Set([root]);
  for (let parent = parentOf.get(root); parent !== undefined; parent = parentOf.get(root)) {
    if (climbed.has(parent)) break;
    climbed.add(parent);
    root = parent;
  }
  const family = [root];
  const listed = new Set(family);
  for (let index = 0; index < family.length; index += 1) {
    for (const fork of forksOf.get(family[index]!) ?? []) {
      if (listed.has(fork)) continue;
      listed.add(fork);
      family.push(fork);
    }
  }
  return family;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readRows = Effect.fn("ThreadLineage.readRows")(function* (threadId: ThreadId) {
    const viewed = yield* sql<{ readonly thread_id: string }>`
        SELECT thread_id FROM orchestration_v2_projection_threads
        WHERE thread_id = ${threadId} AND deleted_at IS NULL
      `;
    if (viewed.length === 0) return null;
    // Fork edges whose two ends both survive: a deleted parent ends the climb at its fork.
    const edges = yield* sql<{ readonly id: string; readonly parent_id: string }>`
        SELECT fork.thread_id AS id, parent.thread_id AS parent_id
        FROM orchestration_v2_projection_threads AS fork
        JOIN orchestration_v2_projection_threads AS parent
          ON parent.thread_id = json_extract(fork.payload_json, '$.lineage.parentThreadId')
        WHERE fork.deleted_at IS NULL
          AND parent.deleted_at IS NULL
          AND json_extract(fork.payload_json, '$.lineage.relationshipToParent') = 'fork'
        ORDER BY fork.created_at ASC, fork.thread_id ASC
      `;
    const family = forkFamily(
      threadId,
      edges.map((edge) => ({
        id: ThreadId.make(edge.id),
        parentId: ThreadId.make(edge.parent_id),
      })),
    );
    const threads = yield* sql<{
      readonly id: string;
      readonly title: string;
      readonly created_at: string;
      readonly archived_at: string | null;
      readonly provider_instance_id: string;
      readonly parent_id: string | null;
      readonly fork_type: string | null;
      readonly fork_run_id: string | null;
    }>`
        SELECT thread_id AS id, title, created_at, archived_at,
          json_extract(payload_json, '$.providerInstanceId') AS provider_instance_id,
          json_extract(payload_json, '$.lineage.parentThreadId') AS parent_id,
          json_extract(payload_json, '$.forkedFrom.type') AS fork_type,
          json_extract(payload_json, '$.forkedFrom.runId') AS fork_run_id
        FROM orchestration_v2_projection_threads
        WHERE thread_id IN ${sql.in(family)}
      `;
    const runs = yield* sql<{
      readonly thread_id: string;
      readonly run_id: string;
      readonly ordinal: number;
      readonly status: OrchestrationV2RunStatus;
      readonly requested_at: string;
      readonly completed_at: string | null;
      readonly model: string | null;
      readonly user_message_id: string;
      readonly text: string;
      readonly reply: string;
      readonly additions: number;
      readonly deletions: number;
      readonly files: number;
    }>`
        WITH lines AS (
          SELECT checkpoint.run_id,
            SUM(json_extract(file.value, '$.additions')) AS additions,
            SUM(json_extract(file.value, '$.deletions')) AS deletions,
            COUNT(DISTINCT json_extract(file.value, '$.path')) AS files
          FROM orchestration_v2_projection_checkpoints AS checkpoint,
            json_each(checkpoint.payload_json, '$.files') AS file
          WHERE checkpoint.thread_id IN ${sql.in(family)} AND checkpoint.run_id IS NOT NULL
          GROUP BY checkpoint.run_id
        )
        SELECT run.thread_id, run.run_id, run.ordinal, run.status, run.requested_at,
          run.completed_at,
          json_extract(run.payload_json, '$.modelSelection.model') AS model,
          json_extract(run.payload_json, '$.userMessageId') AS user_message_id,
          COALESCE(substr(json_extract(message.payload_json, '$.text'), 1, ${TEXT_LENGTH}), '') AS text,
          COALESCE((
            SELECT substr(json_extract(reply.payload_json, '$.text'), 1, ${TEXT_LENGTH})
            FROM orchestration_v2_projection_messages AS reply
            WHERE reply.run_id = run.run_id AND reply.role = 'assistant'
            ORDER BY reply.created_at DESC, reply.message_id DESC
            LIMIT 1
          ), '') AS reply,
          COALESCE(lines.additions, 0) AS additions,
          COALESCE(lines.deletions, 0) AS deletions,
          COALESCE(lines.files, 0) AS files
        FROM orchestration_v2_projection_runs AS run
        LEFT JOIN orchestration_v2_projection_messages AS message
          ON message.message_id = json_extract(run.payload_json, '$.userMessageId')
        LEFT JOIN lines ON lines.run_id = run.run_id
        WHERE run.thread_id IN ${sql.in(family)}
        ORDER BY run.thread_id ASC, run.ordinal ASC
      `;
    const mergeBacks = yield* sql<{
      readonly id: string;
      readonly source_thread_id: string;
      readonly source_run_id: string | null;
      readonly target_thread_id: string;
      readonly target_run_id: string | null;
      readonly created_at: string;
    }>`
        SELECT context_transfer_id AS id, source_thread_id, target_thread_id, target_run_id,
          json_extract(payload_json, '$.sourcePoint.runId') AS source_run_id,
          json_extract(payload_json, '$.createdAt') AS created_at
        FROM orchestration_v2_projection_context_transfers
        WHERE type = 'merge_back'
          AND status NOT IN ('failed', 'superseded')
          AND target_thread_id IN ${sql.in(family)}
          AND source_thread_id IN ${sql.in(family)}
        ORDER BY created_at ASC, context_transfer_id ASC
      `;
    return { family, threads, runs, mergeBacks };
  });

  const read: ThreadLineage["Service"]["read"] = Effect.fn("ThreadLineage.read")(
    function* (threadId) {
      const rows = yield* sql
        .withTransaction(readRows(threadId))
        .pipe(Effect.mapError((cause) => new ThreadLineageReadError({ threadId, cause })));
      if (rows === null) return yield* new ThreadLineageThreadNotFoundError({ threadId });
      const runsOf = new Map<string, OrchestrationV2ThreadLineageRun[]>();
      for (const run of rows.runs) {
        const runs = runsOf.get(run.thread_id) ?? [];
        runs.push({
          id: RunId.make(run.run_id),
          ordinal: run.ordinal,
          requestedAt: DateTime.makeUnsafe(run.requested_at),
          status: run.status,
          completedAt: run.completed_at === null ? null : DateTime.makeUnsafe(run.completed_at),
          model: run.model,
          userMessageId: MessageId.make(run.user_message_id),
          text: run.text,
          reply: run.reply,
          additions: run.additions,
          deletions: run.deletions,
          files: run.files,
        });
        runsOf.set(run.thread_id, runs);
      }
      const threadOf = new Map(rows.threads.map((thread) => [thread.id, thread]));
      const root = rows.family[0];
      return {
        threads: rows.family.flatMap((id) => {
          const thread = threadOf.get(id);
          if (thread === undefined) return [];
          return [
            {
              id,
              title: thread.title,
              parentId:
                id === root || thread.parent_id === null ? null : ThreadId.make(thread.parent_id),
              forkRunId:
                thread.fork_type === "run" && thread.fork_run_id !== null
                  ? RunId.make(thread.fork_run_id)
                  : null,
              createdAt: DateTime.makeUnsafe(thread.created_at),
              providerInstanceId: ProviderInstanceId.make(thread.provider_instance_id),
              archived: thread.archived_at !== null,
              runs: runsOf.get(id) ?? [],
            },
          ];
        }),
        mergeBacks: rows.mergeBacks.map((mergeBack) => ({
          id: ContextTransferId.make(mergeBack.id),
          sourceThreadId: ThreadId.make(mergeBack.source_thread_id),
          sourceRunId:
            mergeBack.source_run_id === null ? null : RunId.make(mergeBack.source_run_id),
          targetThreadId: ThreadId.make(mergeBack.target_thread_id),
          targetRunId:
            mergeBack.target_run_id === null ? null : RunId.make(mergeBack.target_run_id),
          createdAt: DateTime.makeUnsafe(mergeBack.created_at),
        })),
      };
    },
  );

  return ThreadLineage.of({ read });
});

export const layer = Layer.effect(ThreadLineage, make);
