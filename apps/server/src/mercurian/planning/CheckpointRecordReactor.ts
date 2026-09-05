import type { OrchestrationEvent } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { forkParked } from "../../serverActivation.ts";
import { CheckpointRecordStore } from "./CheckpointRecordStore.ts";

export class CheckpointRecordConsumerError extends Schema.TaggedErrorClass<CheckpointRecordConsumerError>()(
  "CheckpointRecordConsumerError",
  { cause: Schema.Defect() },
) {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const records = yield* CheckpointRecordStore;
  const turns = yield* ProjectionTurnRepository;
  const seen = yield* SubscriptionRef.make(0);
  const reconciled = yield* Deferred.make<void>();
  const stopped = yield* Deferred.make<never, CheckpointRecordConsumerError>();
  const consume = Effect.fn("CheckpointRecordReactor.consume")(function* (
    event: OrchestrationEvent,
  ) {
    // Replay and the already-acquired live subscription can contain the same event.
    if (event.sequence <= (yield* SubscriptionRef.get(seen))) return;
    const turnId =
      event.type === "thread.turn-diff-completed"
        ? event.payload.turnId
        : event.type === "thread.session-set"
          ? event.payload.session.activeTurnId
          : null;
    const projection =
      turnId === null || !("threadId" in event.payload)
        ? undefined
        : Option.getOrUndefined(
            yield* turns.getByTurnId({
              threadId: event.payload.threadId,
              turnId,
            }),
          );
    yield* records.consume(event, projection?.pendingMessageId ?? undefined);
    if (turnId !== null && projection?.pendingMessageId != null)
      yield* records.resolve(projection.threadId, turnId, projection.pendingMessageId);
    yield* SubscriptionRef.update(seen, (value) => Math.max(value, event.sequence));
  });
  const reconcile = Effect.gen(function* () {
    for (const row of yield* records.unresolved) {
      const projection = Option.getOrUndefined(
        yield* turns.getByTurnId({ threadId: row.thread_id, turnId: row.turn_id }),
      );
      if (projection?.pendingMessageId != null)
        yield* records.resolve(row.thread_id, row.turn_id, projection.pendingMessageId);
    }
    yield* records.repair;
    for (const record of yield* records.unfinished) {
      if (record.request === undefined) continue;
      const candidates = yield* turns.listByThreadId({ threadId: record.request.threadId });
      const exact = candidates.find(
        (turn) => turn.pendingMessageId === record.request?.messageId && turn.turnId !== null,
      );
      yield* records.recoverRequest(
        record.ownerCommitId,
        exact?.turnId ?? undefined,
        exact?.state === "running",
      );
    }
  });
  yield* forkParked(
    Effect.gen(function* () {
      // Acquire the actual subscription, not a lazy stream, before replay reads.
      const live = yield* engine.subscribeDomainEvents;
      let cursor = yield* records.eventCursor;
      while (true) {
        const page = yield* Stream.runCollect(engine.readEvents(cursor, 256));
        if (page.length === 0) break;
        for (const event of page) yield* consume(event);
        cursor = page[page.length - 1]!.sequence;
      }
      yield* reconcile;
      yield* SubscriptionRef.set(seen, cursor);
      yield* Deferred.succeed(reconciled, undefined);
      yield* Stream.runForEach(live, (event) => consume(event));
    }).pipe(
      Effect.catchCause((cause) =>
        Deferred.fail(stopped, new CheckpointRecordConsumerError({ cause })).pipe(
          Effect.andThen(
            Effect.logError("checkpoint record consumer stopped; durable cursor retained", {
              cause,
            }),
          ),
        ),
      ),
    ),
  );
  return {
    drainThrough: Effect.fn("CheckpointRecordReactor.drainThrough")(function* (sequence: number) {
      // Replayed events can reach the cursor before startup repairs have completed.
      yield* Effect.gen(function* () {
        yield* Deferred.await(reconciled);
        yield* SubscriptionRef.changes(seen).pipe(
          Stream.filter((value) => value >= sequence),
          Stream.runHead,
        );
      }).pipe(Effect.raceFirst(Deferred.await(stopped)));
    }),
  };
});
export class CheckpointRecordReactor extends Context.Service<
  CheckpointRecordReactor,
  Effect.Success<typeof make>
>()("t3/mercurian/planning/CheckpointRecordReactor") {}
export const layer = Layer.effect(CheckpointRecordReactor, make);
