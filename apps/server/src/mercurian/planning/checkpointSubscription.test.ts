import { assert, it } from "@effect/vitest";
import { MercurianCommitId, PlanId, type PlanStreamItem } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { CheckpointRecordStore, layer } from "./CheckpointRecordStore.ts";
import { checkpointCatchUp } from "./checkpointSubscription.ts";
import { seed, planId, query, addQuery } from "./CheckpointRecordTestUtils.ts";

const testLayer = layer.pipe(Layer.provideMerge(NodeSqliteClient.layerMemory()));
const facts = {
  status: "ready" as const,
  terminal: true,
  files: [],
  summaryStatus: "ready" as const,
};
it.effect(
  "pages bounded indexed changes, omits unchanged history, and catches mutations beyond a fixed high-water",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      for (let index = 0; index < 260; index++) {
        const id = `act-${index}`;
        yield* addQuery(id);
        yield* store.attach({
          ownerCommitId: MercurianCommitId.make(id),
          lineRootCommitId: query,
          capture: facts,
        });
      }
      const snapshot = yield* store.snapshot(planId);
      assert.strictEqual(snapshot.checkpoints.length, 260);
      assert.strictEqual(
        snapshot.checkpointSequence,
        Math.max(...snapshot.checkpoints.map((row) => row.updateSequence)),
      );
      const old = snapshot.checkpointSequence;
      const unchanged = yield* Stream.runCollect(checkpointCatchUp(store, planId, old, old));
      assert.deepStrictEqual(
        unchanged.map((item) => item.kind),
        ["checkpoint-synchronized"],
      );
      yield* store.attach({
        ownerCommitId: MercurianCommitId.make("act-0"),
        lineRootCommitId: query,
        capture: { ...facts, partial: true },
      });
      const updated = yield* Stream.runCollect(
        checkpointCatchUp(store, planId, old, yield* store.highWater(planId)),
      );
      assert.strictEqual(updated.filter((item) => item.kind === "checkpoint-update").length, 1);
      assert.strictEqual(
        updated[0]?.kind === "checkpoint-update" ? updated[0].record.ownerCommitId : null,
        "act-0",
      );
      const high = yield* store.highWater(planId);
      const sizes: number[] = [];
      let mutated = false;
      const observed = {
        ...store,
        listSince: (id: PlanId, after: number, through: number) =>
          store.listSince(id, after, through).pipe(
            Effect.tap((page) =>
              Effect.gen(function* () {
                sizes.push(page.length);
                if (mutated || page.length === 0) return;
                mutated = true;
                yield* store.attach({
                  ownerCommitId: MercurianCommitId.make("act-259"),
                  lineRootCommitId: query,
                  capture: { ...facts, partial: true },
                });
              }),
            ),
          ),
      };
      const catchup = yield* Stream.runCollect(checkpointCatchUp(observed, planId, 0, high));
      assert.ok(sizes.length >= 3);
      assert.ok(sizes.every((size) => size <= 128));
      assert.strictEqual(catchup.at(-1)?.kind, "checkpoint-synchronized");
      const late = yield* Stream.runCollect(
        checkpointCatchUp(store, planId, high, yield* store.highWater(planId)),
      );
      assert.strictEqual(
        late[0]?.kind === "checkpoint-update" ? late[0].record.ownerCommitId : null,
        "act-259",
      );
      assert.deepStrictEqual(
        yield* store.listSince(PlanId.make("other-plan"), 0, Number.MAX_SAFE_INTEGER),
        [],
      );
    }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "subscribes before an atomic snapshot so capture during the read remains discoverable",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      const signals = yield* store.subscribeChanges;
      const snapshot = yield* store.snapshot(planId);
      yield* store.attach({ ownerCommitId: query, lineRootCommitId: query, capture: facts });
      const items: PlanStreamItem[] = [
        ...(yield* Stream.runCollect(
          signals.pipe(
            Stream.take(1),
            Stream.flatMap(() =>
              Stream.unwrap(
                Effect.map(store.highWater(planId), (high) =>
                  checkpointCatchUp(store, planId, snapshot.checkpointSequence, high),
                ),
              ),
            ),
          ),
        )),
      ];
      assert.strictEqual(items[0]?.kind, "checkpoint-update");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
