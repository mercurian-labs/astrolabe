import { MessageId, RunId, ThreadId, type GitClientTurn } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** Statuses of a run that is working in its checkout now. */
const WORKING_RUN_STATUSES = ["starting", "running", "waiting"];
const REQUEST_EXCERPT_LENGTH = 280;

const encodePaths = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));

/** The threads that worked in `cwd`: their checkpoint scopes say so, or the thread names it. */
export const checkoutThreads = Effect.fn("GitClientTurns.checkoutThreads")(function* (cwd: string) {
  const sql = yield* SqlClient.SqlClient;
  const scopes = yield* sql<{ readonly scope_id: string; readonly thread_id: string }>`
    SELECT scope.scope_id, scope.thread_id
    FROM orchestration_v2_projection_checkpoint_scopes AS scope
    JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = scope.thread_id
    WHERE thread.deleted_at IS NULL AND json_extract(scope.payload_json, '$.cwd') = ${cwd}
  `;
  const named = yield* sql<{ readonly thread_id: string }>`
    SELECT thread_id FROM orchestration_v2_projection_threads
    WHERE deleted_at IS NULL AND json_extract(payload_json, '$.worktreePath') = ${cwd}
  `;
  return {
    scopeIds: scopes.map((scope) => scope.scope_id),
    threadIds: [
      ...new Set([...scopes.map((scope) => scope.thread_id), ...named.map((row) => row.thread_id)]),
    ],
  };
});

export interface FileTurn {
  readonly runId: RunId;
  /** The checkpoint ending the turn: the working tree as the turn left it. */
  readonly ref: string;
}

/**
 * For each of `paths`, the turns whose checkpoint in these scopes lists it, the latest first and
 * each turn once; `runs` holds every such turn, the latest capture first.
 */
export const fileTurns = Effect.fn("GitClientTurns.fileTurns")(function* (
  scopeIds: ReadonlyArray<string>,
  paths: ReadonlyArray<string>,
) {
  const byPath = new Map<string, FileTurn[]>();
  const runs: RunId[] = [];
  if (scopeIds.length === 0 || paths.length === 0) return { byPath, runs };
  const sql = yield* SqlClient.SqlClient;
  const pathsJson = yield* encodePaths(paths);
  const rows = yield* sql<{
    readonly run_id: string;
    readonly ref: string;
    readonly path: string;
  }>`
    SELECT checkpoint.run_id,
      json_extract(checkpoint.payload_json, '$.ref') AS ref,
      json_extract(file.value, '$.path') AS path
    FROM orchestration_v2_projection_checkpoints AS checkpoint,
      json_each(checkpoint.payload_json, '$.files') AS file
    WHERE checkpoint.scope_id IN ${sql.in([...scopeIds])}
      AND checkpoint.status = 'ready'
      AND checkpoint.run_id IS NOT NULL
      AND checkpoint.ordinal_within_scope > 0
      AND json_extract(file.value, '$.path') IN (SELECT value FROM json_each(${pathsJson}))
      AND NOT EXISTS (
        SELECT 1 FROM orchestration_v2_projection_runs AS run
        WHERE run.run_id = checkpoint.run_id AND run.status = 'rolled_back'
      )
    ORDER BY checkpoint.captured_at DESC
  `;
  for (const row of rows) {
    const runId = RunId.make(row.run_id);
    if (!runs.includes(runId)) runs.push(runId);
    const turns = byPath.get(row.path) ?? [];
    byPath.set(row.path, turns);
    if (!turns.some((turn) => turn.runId === runId)) turns.push({ runId, ref: row.ref });
  }
  return { byPath, runs };
});

export interface RunWindow {
  readonly runId: RunId;
  /** Epoch seconds. */
  readonly start: number;
  /** Epoch seconds; null while the run is working. */
  readonly end: number | null;
}

/** The threads' runs that worked at some point since `since` (epoch seconds), oldest first. */
export const runWindows = Effect.fn("GitClientTurns.runWindows")(function* (
  threadIds: ReadonlyArray<string>,
  since: number,
) {
  if (threadIds.length === 0) return [];
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly run_id: string;
    readonly started_at: string | null;
    readonly work_started_at: string | null;
    readonly completed_at: string | null;
  }>`
    SELECT run_id,
      json_extract(payload_json, '$.startedAt') AS started_at,
      json_extract(payload_json, '$.workStartedAt') AS work_started_at,
      json_extract(payload_json, '$.completedAt') AS completed_at
    FROM orchestration_v2_projection_runs
    WHERE thread_id IN ${sql.in([...threadIds])}
      AND status != 'rolled_back'
      AND json_extract(payload_json, '$.startedAt') IS NOT NULL
      AND (
        json_extract(payload_json, '$.completedAt') IS NULL
        OR json_extract(payload_json, '$.completedAt') >= ${DateTime.formatIso(DateTime.makeUnsafe(since * 1000))}
      )
  `;
  const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  return rows
    .map((row): RunWindow => ({
      runId: RunId.make(row.run_id),
      start: seconds(row.work_started_at ?? row.started_at!),
      end: row.completed_at === null ? null : seconds(row.completed_at),
    }))
    .toSorted((a, b) => a.start - b.start);
});

/** The run working in one of these threads now, the most recently asked first. */
export const workingRunId = Effect.fn("GitClientTurns.workingRunId")(function* (
  threadIds: ReadonlyArray<string>,
) {
  if (threadIds.length === 0) return null;
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{ readonly run_id: string }>`
    SELECT run_id FROM orchestration_v2_projection_runs
    WHERE thread_id IN ${sql.in([...threadIds])}
      AND status IN ${sql.in(WORKING_RUN_STATUSES)}
    ORDER BY requested_at DESC
    LIMIT 1
  `;
  return row === undefined ? null : RunId.make(row.run_id);
});

const excerpt = (text: string | null) => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > REQUEST_EXCERPT_LENGTH
    ? `${flat.slice(0, REQUEST_EXCERPT_LENGTH - 1)}…`
    : flat;
};

/** The turns these runs are, by run id. */
export const describeTurns = Effect.fn("GitClientTurns.describeTurns")(function* (
  runIds: ReadonlyArray<RunId>,
) {
  const turns = new Map<RunId, GitClientTurn>();
  if (runIds.length === 0) return turns;
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly run_id: string;
    readonly thread_id: string;
    readonly ordinal: number;
    readonly title: string;
    readonly user_message_id: string | null;
    readonly request: string | null;
    readonly started_at: string | null;
    readonly completed_at: string | null;
  }>`
    SELECT run.run_id, run.thread_id, run.ordinal, thread.title,
      json_extract(run.payload_json, '$.userMessageId') AS user_message_id,
      json_extract(message.payload_json, '$.text') AS request,
      json_extract(run.payload_json, '$.startedAt') AS started_at,
      json_extract(run.payload_json, '$.completedAt') AS completed_at
    FROM orchestration_v2_projection_runs AS run
    JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = run.thread_id
    LEFT JOIN orchestration_v2_projection_messages AS message
      ON message.message_id = json_extract(run.payload_json, '$.userMessageId')
    WHERE run.run_id IN ${sql.in([...new Set(runIds)])}
  `;
  for (const row of rows) {
    const runId = RunId.make(row.run_id);
    turns.set(runId, {
      runId,
      threadId: ThreadId.make(row.thread_id),
      threadTitle: row.title,
      turnNumber: row.ordinal,
      request: excerpt(row.request),
      userMessageId: row.user_message_id === null ? null : MessageId.make(row.user_message_id),
      startedAt: row.started_at,
      completedAt: row.completed_at,
    });
  }
  return turns;
});
