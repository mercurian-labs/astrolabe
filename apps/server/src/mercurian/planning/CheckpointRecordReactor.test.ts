import { assert, it } from "@effect/vitest";
import type { OrchestrationEvent } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { CheckpointRecordStore, layer as storeLayer } from "./CheckpointRecordStore.ts";
import { CheckpointRecordReactor, layer } from "./CheckpointRecordReactor.ts";
import { seed, planId, query, start, interrupted, captured } from "./CheckpointRecordTestUtils.ts";

const testLayer = storeLayer.pipe(Layer.provideMerge(NodeSqliteClient.layerMemory()));
it.effect(
  "subscribes before replay, deduplicates overlap, and resumes its durable cursor after restart",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      const bus = yield* PubSub.unbounded<OrchestrationEvent>();
      const events = [start()];
      let attached = false;
      let injected = false;
      const readCursors: number[] = [];
      const engine = Layer.mock(OrchestrationEngineService)({
        subscribeDomainEvents: Effect.gen(function* () {
          const queue = yield* PubSub.subscribe(bus);
          attached = true;
          return Stream.fromSubscription(queue);
        }),
        readEvents: (after, limit) =>
          Stream.unwrap(
            Effect.gen(function* () {
              assert.strictEqual(attached, true);
              readCursors.push(after);
              const page = events.filter((event) => event.sequence > after).slice(0, limit);
              if (!injected) {
                injected = true;
                const event = captured();
                events.push(event);
                yield* PubSub.publish(bus, event);
              }
              return Stream.fromIterable(page);
            }),
          ),
      });
      const reactorLayer = layer.pipe(
        Layer.provide(engine),
        Layer.provide(
          Layer.mock(ProjectionTurnRepository)({
            getByTurnId: () => Effect.succeed(Option.none()),
            listByThreadId: () => Effect.succeed([]),
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const reactor = yield* CheckpointRecordReactor;
        yield* reactor.drainThrough(2);
        assert.strictEqual((yield* store.get(planId, query))?.capture?.terminal, true);
      }).pipe(Effect.scoped, Effect.provide(reactorLayer));
      const revision = (yield* store.get(planId, query))?.revision;
      attached = false;
      readCursors.length = 0;
      yield* Effect.gen(function* () {
        const reactor = yield* CheckpointRecordReactor;
        yield* reactor.drainThrough(2);
        assert.strictEqual(readCursors[0], 2);
        assert.strictEqual((yield* store.get(planId, query))?.revision, revision);
        events.push(interrupted(3));
        yield* PubSub.publish(bus, events[2]!);
        yield* reactor.drainThrough(3);
        assert.strictEqual((yield* store.get(planId, query))?.request?.turnId, "provider-turn");
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(reactorLayer)));
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect(
  "replays pre-provider cancellation to terminal request state without a projection or runtime",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const subscribed = yield* Deferred.make<void>();
      const events = [start(), interrupted()];
      const reactorLayer = layer.pipe(
        Layer.provide(
          Layer.mock(OrchestrationEngineService)({
            subscribeDomainEvents: Deferred.succeed(subscribed, undefined).pipe(
              Effect.as(Stream.never),
            ),
            readEvents: (after) =>
              Stream.fromIterable(events.filter((event) => event.sequence > after)),
          }),
        ),
        Layer.provide(
          Layer.mock(ProjectionTurnRepository)({
            getByTurnId: () => Effect.succeed(Option.none()),
            listByThreadId: () => Effect.succeed([]),
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const reactor = yield* CheckpointRecordReactor;
        yield* reactor.drainThrough(2);
        const record = yield* (yield* CheckpointRecordStore).get(planId, query);
        assert.strictEqual(record?.request?.state, "cancelled");
        assert.strictEqual(record?.request?.turnId, undefined);
      }).pipe(Effect.scoped, Effect.provide(reactorLayer));
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
