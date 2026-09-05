import { PlanReconstruction, type PlanId, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceSqlError } from "../../persistence/Errors.ts";

export class ReconstructionStore extends Context.Service<
  ReconstructionStore,
  {
    readonly get: (
      planId: PlanId,
      id: string,
    ) => Effect.Effect<PlanReconstruction | null, PersistenceSqlError>;
    readonly save: (record: PlanReconstruction) => Effect.Effect<void, PersistenceSqlError>;
    readonly current: (threadId: ThreadId) => Effect.Effect<string | null, PersistenceSqlError>;
    readonly prepare: (
      threadId: ThreadId,
      messageId: string,
      id: string,
      cleanStart?: boolean,
    ) => Effect.Effect<void, PersistenceSqlError, Scope.Scope>;
    readonly finish: (
      threadId: ThreadId,
      messageId: string,
      submitted: boolean,
    ) => Effect.Effect<void, PersistenceSqlError>;
    readonly forMessage: (
      threadId: ThreadId,
      messageId: string,
    ) => Effect.Effect<string | null, PersistenceSqlError>;
  }
>()("t3/mercurian/assistant/ReconstructionStore") {}

const recordJson = Schema.fromJsonString(PlanReconstruction);
const decodeRecord = Schema.decodeUnknownEffect(recordJson);
const encodeRecord = Schema.encodeEffect(recordJson);

export const layer = Layer.effect(
  ReconstructionStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const pending = new Map<string, Deferred.Deferred<void>>();
    const key = (threadId: ThreadId, messageId: string) => JSON.stringify([threadId, messageId]);
    const failure = (cause: unknown) =>
      new PersistenceSqlError({ operation: "ReconstructionStore", cause });
    const get = Effect.fn("ReconstructionStore.get")(function* (planId: PlanId, id: string) {
      const rows = yield* sql<{
        record_json: string;
      }>`SELECT record_json FROM session_reconstructions WHERE plan_id = ${planId} AND reconstruction_id = ${id}`;
      return rows[0] === undefined ? null : yield* decodeRecord(rows[0].record_json);
    }, Effect.mapError(failure));
    const save = Effect.fn("ReconstructionStore.save")(function* (record: PlanReconstruction) {
      const json = yield* encodeRecord(record);
      yield* sql`INSERT INTO session_reconstructions (reconstruction_id, plan_id, record_json) VALUES (${record.id}, ${record.planId}, ${json})`;
    }, Effect.mapError(failure));
    const current = Effect.fn("ReconstructionStore.current")(function* (threadId: ThreadId) {
      const rows = yield* sql<{
        reconstruction_id: string;
        status: string;
      }>`SELECT reconstruction_id, status FROM reconstruction_attempts WHERE thread_id = ${threadId} AND (status = 'submitted' OR clean_start = 1) ORDER BY sequence DESC LIMIT 1`;
      return rows[0]?.status === "submitted" ? rows[0].reconstruction_id : null;
    }, Effect.mapError(failure));
    const finish = Effect.fn("ReconstructionStore.finish")(function* (
      threadId: ThreadId,
      messageId: string,
      submitted: boolean,
    ) {
      const entryKey = key(threadId, messageId);
      const deferred = pending.get(entryKey);
      yield* Effect.uninterruptibleMask((restore) =>
        restore(
          sql`UPDATE reconstruction_attempts SET status = ${submitted ? "submitted" : "failed"} WHERE thread_id = ${threadId} AND message_id = ${messageId} AND status = 'prepared'`,
        ).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              if (pending.get(entryKey) === deferred) pending.delete(entryKey);
              if (deferred !== undefined) yield* Deferred.succeed(deferred, undefined);
            }),
          ),
        ),
      );
    }, Effect.mapError(failure));
    const prepare = Effect.fn("ReconstructionStore.prepare")(function* (
      threadId: ThreadId,
      messageId: string,
      id: string,
      cleanStart = false,
    ) {
      yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const entryKey = key(threadId, messageId);
          const deferred = yield* Deferred.make<void>();
          // Install ownership before the interruptible SQL boundary. Scope closure
          // releases settlement even when preparation never returns its callbacks.
          yield* Effect.addFinalizer(() =>
            pending.get(entryKey) === deferred
              ? finish(threadId, messageId, false).pipe(Effect.ignoreCause())
              : Effect.void,
          );
          if (pending.has(entryKey))
            return yield* Effect.die(new Error("Reconstruction attempt already pending"));
          pending.set(entryKey, deferred);
          yield* restore(
            sql`INSERT INTO reconstruction_attempts (thread_id, message_id, reconstruction_id, clean_start, status) VALUES (${threadId}, ${messageId}, ${id}, ${cleanStart ? 1 : 0}, 'prepared')`,
          ).pipe(
            Effect.onError(() => finish(threadId, messageId, false).pipe(Effect.ignoreCause())),
          );
        }),
      );
    }, Effect.mapError(failure));
    const forMessage = Effect.fn("ReconstructionStore.forMessage")(function* (
      threadId: ThreadId,
      messageId: string,
    ) {
      const waiting = pending.get(key(threadId, messageId));
      if (waiting !== undefined) yield* Deferred.await(waiting);
      const rows = yield* sql<{
        reconstruction_id: string;
      }>`SELECT reconstruction_id FROM reconstruction_attempts WHERE thread_id = ${threadId} AND message_id = ${messageId} AND status = 'submitted'`;
      return rows[0]?.reconstruction_id ?? null;
    }, Effect.mapError(failure));
    return ReconstructionStore.of({ get, save, current, prepare, finish, forMessage });
  }),
);
