import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { MercurianCommitId, MercurianRepositoryId } from "@t3tools/contracts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as MemoryReviewStore from "./MemoryReviewStore.ts";

const layer = it.layer(
  MemoryReviewStore.layer.pipe(Layer.provideMerge(MercurianSqlite.layerMemory)),
);
layer("MemoryReviewStore", (it) => {
  it.effect("marks and lists reviews idempotently", () =>
    Effect.gen(function* () {
      const store = yield* MemoryReviewStore.MemoryReviewStore;
      const review = {
        lineRootCommitId: MercurianCommitId.make("line"),
        repositoryId: MercurianRepositoryId.make("repository"),
        commitOid: "abc123",
        reviewedAt: DateTime.makeUnsafe("2026-09-04T00:00:00.000Z"),
      };
      const pull = yield* Stream.toPull(store.changes);
      const first = yield* pull.pipe(Effect.forkChild({ startImmediately: true }));
      const otherClientPull = yield* Stream.toPull(store.changes);
      const otherClient = yield* otherClientPull.pipe(Effect.forkChild({ startImmediately: true }));
      yield* store.markReviewed(review);
      assert.deepStrictEqual(yield* Fiber.join(otherClient), [
        { repositoryId: review.repositoryId, lineRootCommitId: review.lineRootCommitId },
      ]);
      assert.strictEqual((yield* Fiber.join(first)).length, 1);
      yield* store.markReviewed(review);
      assert.strictEqual((yield* pull).length, 1);
      yield* store.invalidate(review);
      assert.strictEqual((yield* pull).length, 1);
      assert.deepStrictEqual(yield* store.listReviewed(review), [review]);
    }),
  );
});
