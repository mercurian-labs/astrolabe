import {
  MercurianCommitId,
  MercurianProjectId,
  MessageId,
  PlanId,
  PlanCheckpointCapture,
  PlanCheckpointRecord,
  type OrchestrationEvent,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { PersistenceSqlError } from "../../persistence/Errors.ts";

const recordJson = Schema.fromJsonString(PlanCheckpointRecord);
const captureJson = Schema.fromJsonString(PlanCheckpointCapture);
const decodeRecord = Schema.decodeUnknownEffect(recordJson);
const encodeRecord = Schema.encodeEffect(recordJson);
const decodeCapture = Schema.decodeUnknownEffect(captureJson);
const encodeCapture = Schema.encodeEffect(captureJson);
const queryJson = Schema.fromJsonString(
  Schema.Struct({
    checkpointRequest: Schema.optional(
      Schema.Struct({
        threadId: Schema.String,
        lineRootCommitId: MercurianCommitId,
      }),
    ),
  }),
);

const decodeQuery = Schema.decodeUnknownEffect(queryJson);

/** Merge availability monotonically, including successful members of a partial capture. */
export function mergeCheckpointCapture(
  previous: PlanCheckpointCapture | undefined,
  incoming: PlanCheckpointCapture,
): PlanCheckpointCapture {
  if (previous === undefined) return incoming;
  if (previous.terminal && !incoming.terminal) return previous;
  if (
    previous.terminal &&
    previous.status === "ready" &&
    incoming.repositories === undefined &&
    incoming.status !== "ready"
  )
    return previous;
  if (previous.status !== "missing" && incoming.status === "missing" && !incoming.terminal)
    return previous;
  const repositories =
    incoming.repositories === undefined
      ? previous.repositories
      : [
          ...incoming.repositories.map((next) => {
            const old = previous.repositories?.find(
              (group) => group.repositoryId === next.repositoryId,
            );
            if (old?.afterSnapshotOid !== undefined && next.afterSnapshotOid === undefined)
              return old;
            if (
              old?.summaryStatus === "ready" &&
              next.summaryStatus !== "ready" &&
              old.afterSnapshotOid === next.afterSnapshotOid
            )
              return old;
            return next;
          }),
          ...(previous.repositories ?? []).filter(
            (old) => !incoming.repositories?.some((next) => next.repositoryId === old.repositoryId),
          ),
        ];
  return {
    ...incoming,
    ...(repositories === undefined ? {} : { repositories }),
    ...(previous.partial === true ? { partial: true, snapshotKind: "partial" as const } : {}),
  };
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changed = yield* PubSub.unbounded<void>();
  const failure = (cause: unknown) =>
    new PersistenceSqlError({ operation: "CheckpointRecordStore", cause });
  const read = Effect.fn("CheckpointRecordStore.read")(function* (ownerCommitId: string) {
    const rows = yield* sql<{
      record_json: string;
    }>`SELECT record_json FROM checkpoint_records WHERE owner_commit_id = ${ownerCommitId}`;
    return rows[0] === undefined ? null : yield* decodeRecord(rows[0].record_json);
  });
  const write = Effect.fn("CheckpointRecordStore.write")(function* (
    value: Omit<PlanCheckpointRecord, "revision" | "updateSequence">,
  ) {
    const old = yield* read(value.ownerCommitId);
    const candidate = {
      ...value,
      revision: old?.revision ?? 1,
      updateSequence: old?.updateSequence ?? 1,
    };
    if (old !== null && (yield* encodeRecord(old)) === (yield* encodeRecord(candidate))) return old;
    const clock = yield* sql<{
      update_sequence: number;
    }>`UPDATE checkpoint_record_clock SET update_sequence = update_sequence + 1 WHERE singleton = 1 RETURNING update_sequence`;
    const record = {
      ...value,
      revision: (old?.revision ?? 0) + 1,
      updateSequence: clock[0]!.update_sequence,
    };
    const json = yield* encodeRecord(record);
    yield* sql`INSERT INTO checkpoint_records (owner_commit_id, plan_id, thread_id, turn_id, update_sequence, record_json)
      VALUES (${record.ownerCommitId}, ${record.planId}, ${record.request?.threadId ?? null}, ${record.request?.turnId ?? null}, ${record.updateSequence}, ${json})
      ON CONFLICT(owner_commit_id) DO UPDATE SET thread_id = excluded.thread_id, turn_id = excluded.turn_id,
        update_sequence = excluded.update_sequence, record_json = excluded.record_json`;
    return record;
  });
  const transaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const before = yield* sql<{
            update_sequence: number;
          }>`SELECT update_sequence FROM checkpoint_record_clock WHERE singleton = 1`;
          const value = yield* effect;
          const after = yield* sql<{
            update_sequence: number;
          }>`SELECT update_sequence FROM checkpoint_record_clock WHERE singleton = 1`;
          return { value, changed: before[0]!.update_sequence !== after[0]!.update_sequence };
        }),
      )
      .pipe(
        Effect.tap((result) => (result.changed ? PubSub.publish(changed, undefined) : Effect.void)),
        Effect.map((result) => result.value),
        Effect.mapError(failure),
      );
  const owner = Effect.fn("CheckpointRecordStore.owner")(function* (
    ownerCommitId: MercurianCommitId,
    threadId?: ThreadId,
  ) {
    const existing = yield* read(ownerCommitId);
    if (existing !== null)
      return threadId !== undefined && existing.request?.threadId !== threadId ? null : existing;
    const rows = yield* sql<{
      plan_id: string;
      project_id: string;
      payload_json: string;
      kind: string;
      author_kind: string;
    }>`
      SELECT p.plan_id, p.project_id, c.payload_json, c.kind, c.author_kind FROM commits c
      JOIN plans p ON p.history_id = c.history_id WHERE c.commit_id = ${ownerCommitId}`;
    const row = rows[0];
    if (row === undefined) return null;
    if (threadId !== undefined && (row.kind !== "message" || row.author_kind !== "human"))
      return null;
    const payload = yield* decodeQuery(row.payload_json);
    if (
      threadId !== undefined &&
      payload.checkpointRequest !== undefined &&
      payload.checkpointRequest.threadId !== threadId
    )
      return null;
    return yield* write({
      ownerCommitId,
      planId: PlanId.make(row.plan_id),
      projectId: MercurianProjectId.make(row.project_id),
      ...(payload.checkpointRequest?.lineRootCommitId === undefined
        ? threadId === undefined
          ? { lineRootCommitId: ownerCommitId }
          : {}
        : { lineRootCommitId: payload.checkpointRequest.lineRootCommitId }),
      ...(threadId === undefined
        ? {}
        : {
            request: {
              threadId,
              messageId: MessageId.make(ownerCommitId),
              state: "unanswered" as const,
            },
          }),
    });
  });
  const repairResponse = Effect.fn("CheckpointRecordStore.repairResponse")(function* (
    record: PlanCheckpointRecord,
  ) {
    if (record.responseCommitId !== undefined || record.request === undefined) return record;
    const rows = yield* sql<{
      commit_id: string;
      interrupted: number | null;
    }>`SELECT c.commit_id, json_extract(c.payload_json, '$.interrupted') AS interrupted
      FROM commits c JOIN plans p ON p.history_id = c.history_id
      WHERE json_extract(c.payload_json, '$.checkpointOwnerCommitId') IS NOT NULL
        AND json_extract(c.payload_json, '$.checkpointOwnerCommitId') = ${record.ownerCommitId}
        AND p.plan_id = ${record.planId} AND c.kind = 'message' AND c.author_kind = 'assistant'`;
    if (rows.length !== 1) return record;
    return yield* write({
      ...record,
      responseCommitId: MercurianCommitId.make(rows[0]!.commit_id),
      request: {
        ...record.request,
        state:
          record.request.state === "cancelled" ||
          record.request.state === "failed" ||
          record.request.state === "unknown"
            ? record.request.state
            : rows[0]!.interrupted === 1
              ? "interrupted"
              : "completed",
      },
    });
  });
  const recordQuery = (ownerCommitId: MercurianCommitId, threadId: ThreadId) =>
    transaction(owner(ownerCommitId, threadId));
  const response = (ownerCommitId: MercurianCommitId) =>
    transaction(
      Effect.gen(function* () {
        const record = yield* read(ownerCommitId);
        if (record !== null) yield* repairResponse(record);
      }),
    );
  const attach = (input: {
    readonly ownerCommitId: MercurianCommitId;
    readonly lineRootCommitId: MercurianCommitId;
    readonly capture: PlanCheckpointCapture;
  }) =>
    transaction(
      Effect.gen(function* () {
        const record = yield* owner(input.ownerCommitId);
        if (record === null) return null;
        const roots =
          yield* sql`SELECT c.commit_id FROM commits c JOIN plans p ON p.history_id = c.history_id
      WHERE c.commit_id = ${input.lineRootCommitId} AND p.plan_id = ${record.planId}`;
        if (
          roots.length !== 1 ||
          (record.request !== undefined &&
            record.lineRootCommitId !== undefined &&
            record.lineRootCommitId !== input.lineRootCommitId)
        )
          return yield* failure(
            "Checkpoint line root must belong to the owning history and preserve request ownership.",
          );
        return yield* write({
          ...record,
          lineRootCommitId: input.lineRootCommitId,
          capture: mergeCheckpointCapture(record.capture, input.capture),
        });
      }),
    );
  const eventCursor = sql<{
    event_sequence: number;
  }>`SELECT event_sequence FROM checkpoint_record_clock WHERE singleton = 1`.pipe(
    Effect.map((rows) => rows[0]!.event_sequence),
    Effect.mapError(failure),
  );
  const findTurn = Effect.fn("CheckpointRecordStore.findTurn")(function* (
    threadId: ThreadId,
    turnId: TurnId,
  ) {
    const rows = yield* sql<{
      record_json: string;
    }>`SELECT record_json FROM checkpoint_records WHERE thread_id = ${threadId} AND turn_id = ${turnId}`;
    return rows[0] === undefined ? null : yield* decodeRecord(rows[0].record_json);
  });
  const capture = Effect.fn("CheckpointRecordStore.capture")(function* (
    threadId: ThreadId,
    turnId: TurnId,
    requestMessageId: MessageId | undefined,
    facts: PlanCheckpointCapture,
  ) {
    const record =
      requestMessageId === undefined
        ? yield* findTurn(threadId, turnId)
        : yield* owner(MercurianCommitId.make(requestMessageId), threadId);
    if (
      record === null ||
      record.request === undefined ||
      record.request.threadId !== threadId ||
      (record.request.turnId !== undefined && record.request.turnId !== turnId)
    ) {
      const knownThread =
        yield* sql`SELECT owner_commit_id FROM checkpoint_records WHERE thread_id = ${threadId} LIMIT 1`;
      if (knownThread.length === 0) return;
      const old = yield* sql<{
        capture_json: string;
        request_message_id: string | null;
      }>`SELECT capture_json, request_message_id FROM checkpoint_unresolved WHERE thread_id = ${threadId} AND turn_id = ${turnId}`;
      const json = yield* encodeCapture(
        mergeCheckpointCapture(
          old[0] === undefined ? undefined : yield* decodeCapture(old[0].capture_json),
          facts,
        ),
      );
      yield* sql`INSERT INTO checkpoint_unresolved VALUES (${threadId}, ${turnId}, ${requestMessageId ?? old[0]?.request_message_id ?? null}, ${json})
        ON CONFLICT(thread_id, turn_id) DO UPDATE SET request_message_id = excluded.request_message_id, capture_json = excluded.capture_json`;
      return;
    }
    const merged = mergeCheckpointCapture(record.capture, facts);
    yield* repairResponse(
      yield* write({
        ...record,
        request: {
          ...record.request,
          turnId,
          state: merged.terminal ? (merged.partial ? "interrupted" : "completed") : "submitted",
        },
        capture: merged,
      }),
    );
    yield* sql`DELETE FROM checkpoint_unresolved WHERE thread_id = ${threadId} AND turn_id = ${turnId}`;
  });
  /** Cursor advancement and every record changed by this event share one transaction. */
  const consume = (event: OrchestrationEvent, requestMessageId?: MessageId) =>
    transaction(
      Effect.gen(function* () {
        if (event.sequence <= (yield* eventCursor)) return;
        if (event.type === "thread.turn-start-requested") {
          const record = yield* owner(
            MercurianCommitId.make(event.payload.messageId),
            event.payload.threadId,
          );
          if (record?.request !== undefined)
            yield* repairResponse(
              yield* write({
                ...record,
                request: {
                  ...record.request,
                  state: record.request.state === "unanswered" ? "preparing" : record.request.state,
                },
              }),
            );
        } else if (event.type === "thread.turn-diff-completed") {
          const { payload } = event;
          yield* capture(
            payload.threadId,
            payload.turnId,
            payload.requestMessageId ?? requestMessageId,
            {
              status: payload.status,
              terminal:
                payload.captureTerminal ??
                (payload.status !== "missing" || payload.partial === true),
              files: payload.files,
              ...(payload.repositories === undefined ? {} : { repositories: payload.repositories }),
              ...(payload.summaryStatus === undefined
                ? {}
                : { summaryStatus: payload.summaryStatus }),
              ...(payload.summaryError === undefined ? {} : { summaryError: payload.summaryError }),
              ...(payload.partial === undefined ? {} : { partial: payload.partial }),
              ...(payload.snapshotKind === undefined ? {} : { snapshotKind: payload.snapshotKind }),
              ...(payload.branchMovement === undefined
                ? {}
                : { branchMovement: payload.branchMovement }),
              ...(payload.departedRef === undefined ? {} : { departedRef: payload.departedRef }),
            },
          );
        } else if (
          event.type === "thread.session-set" &&
          event.payload.session.activeTurnId !== null &&
          requestMessageId !== undefined
        ) {
          const record = yield* owner(
            MercurianCommitId.make(requestMessageId),
            event.payload.threadId,
          );
          if (record?.request !== undefined && record.request.turnId === undefined)
            yield* write({
              ...record,
              request: {
                ...record.request,
                turnId: event.payload.session.activeTurnId,
                state: "submitted",
              },
            });
        } else if (
          event.type === "thread.turn-interrupt-requested" ||
          event.type === "thread.session-stop-requested" ||
          event.type === "thread.deleted" ||
          (event.type === "thread.session-set" &&
            ["error", "stopped"].includes(event.payload.session.status))
        ) {
          const rows = yield* sql<{
            record_json: string;
          }>`SELECT record_json FROM checkpoint_records WHERE thread_id = ${event.payload.threadId}`;
          for (const row of rows) {
            const record = yield* decodeRecord(row.record_json);
            if (
              event.type === "thread.turn-interrupt-requested" &&
              event.payload.turnId !== undefined
            ) {
              if (
                record.request?.turnId === event.payload.turnId &&
                record.capture?.terminal !== true
              )
                yield* write({ ...record, request: { ...record.request, state: "interrupted" } });
              continue;
            }

            if (
              event.type === "thread.deleted" &&
              record.request !== undefined &&
              record.capture?.terminal !== true &&
              record.request.turnId !== undefined
            ) {
              yield* write({ ...record, request: { ...record.request, state: "unknown" } });
              continue;
            }
            if (
              record.request === undefined ||
              record.request.turnId !== undefined ||
              !["preparing", "interrupted"].includes(record.request.state)
            )
              continue;
            yield* write({
              ...record,
              request: {
                ...record.request,
                state:
                  event.type === "thread.session-set" && event.payload.session.status === "error"
                    ? "failed"
                    : "cancelled",
              },
            });
          }
        }
        yield* sql`UPDATE checkpoint_record_clock SET event_sequence = ${event.sequence} WHERE singleton = 1`;
      }),
    );
  /** A restart repairs exact immutable response links, including append-before-attachment crashes. */
  const repair = transaction(
    Effect.gen(function* () {
      const rows = yield* sql<{
        record_json: string;
      }>`SELECT record_json FROM checkpoint_records WHERE thread_id IS NOT NULL`;
      for (const row of rows) yield* repairResponse(yield* decodeRecord(row.record_json));
      const pending = yield* sql<{
        thread_id: ThreadId;
        turn_id: TurnId;
        request_message_id: MessageId | null;
        capture_json: string;
      }>`SELECT * FROM checkpoint_unresolved WHERE request_message_id IS NOT NULL`;
      for (const row of pending)
        yield* capture(
          row.thread_id,
          row.turn_id,
          row.request_message_id ?? undefined,
          yield* decodeCapture(row.capture_json),
        );
    }),
  );
  const unfinished = Effect.gen(function* () {
    const rows = yield* sql<{
      record_json: string;
    }>`SELECT record_json FROM checkpoint_records WHERE thread_id IS NOT NULL
      AND json_extract(record_json, '$.capture.terminal') IS NOT 1
      AND json_extract(record_json, '$.request.state') IN ('preparing', 'submitted', 'completed', 'interrupted')`;
    return yield* Effect.forEach(rows, (row) => decodeRecord(row.record_json));
  }).pipe(Effect.mapError(failure));
  const recoverRequest = (
    ownerCommitId: MercurianCommitId,
    turnId: TurnId | undefined,
    running: boolean,
  ) =>
    transaction(
      Effect.gen(function* () {
        const record = yield* read(ownerCommitId);
        if (record?.request === undefined || record.capture?.terminal === true) return;
        yield* write({
          ...record,
          request: {
            ...record.request,
            ...(turnId === undefined ? {} : { turnId }),
            state: running ? "submitted" : "unknown",
          },
        });
      }),
    );
  const unresolved = sql<{
    thread_id: ThreadId;
    turn_id: TurnId;
  }>`SELECT thread_id, turn_id FROM checkpoint_unresolved`.pipe(Effect.mapError(failure));
  const resolve = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    transaction(
      Effect.gen(function* () {
        const rows = yield* sql<{
          capture_json: string;
        }>`SELECT capture_json FROM checkpoint_unresolved WHERE thread_id = ${threadId} AND turn_id = ${turnId}`;
        if (rows[0] !== undefined)
          yield* capture(threadId, turnId, messageId, yield* decodeCapture(rows[0].capture_json));
      }),
    );
  const highWater = (planId: PlanId) =>
    sql<{
      sequence: number;
    }>`SELECT COALESCE(MAX(update_sequence), 0) AS sequence FROM checkpoint_records WHERE plan_id = ${planId}`.pipe(
      Effect.map((rows) => rows[0]!.sequence),
      Effect.mapError(failure),
    );
  const snapshot = (planId: PlanId) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const checkpointSequence = yield* highWater(planId);
          const rows = yield* sql<{
            record_json: string;
          }>`SELECT record_json FROM checkpoint_records WHERE plan_id = ${planId} ORDER BY update_sequence`;
          return {
            checkpoints: yield* Effect.forEach(rows, (row) => decodeRecord(row.record_json)),
            checkpointSequence,
          };
        }),
      )
      .pipe(Effect.mapError(failure));
  const listSince = (planId: PlanId, after: number, through: number, limit = 128) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        record_json: string;
      }>`SELECT record_json FROM checkpoint_records WHERE plan_id = ${planId} AND update_sequence > ${after} AND update_sequence <= ${through} ORDER BY update_sequence LIMIT ${Math.max(1, Math.min(limit, 128))}`;
      return yield* Effect.forEach(rows, (row) => decodeRecord(row.record_json));
    }).pipe(Effect.mapError(failure));
  const get = (planId: PlanId, ownerCommitId: MercurianCommitId) =>
    read(ownerCommitId).pipe(
      Effect.map((record) => (record?.planId === planId ? record : null)),
      Effect.mapError(failure),
    );
  return {
    unfinished,
    recoverRequest,
    unresolved,
    resolve,
    get,
    recordQuery,
    response,
    attach,
    consume,
    repair,
    eventCursor,
    highWater,
    snapshot,
    listSince,
    getByTurn: (threadId: ThreadId, turnId: TurnId) =>
      findTurn(threadId, turnId).pipe(Effect.mapError(failure)),
    changes: Stream.fromPubSub(changed),
    subscribeChanges: PubSub.subscribe(changed).pipe(Effect.map(Stream.fromSubscription)),
  };
});
export class CheckpointRecordStore extends Context.Service<
  CheckpointRecordStore,
  Effect.Success<typeof make>
>()("t3/mercurian/planning/CheckpointRecordStore") {}
export const layer = Layer.effect(CheckpointRecordStore, make);
