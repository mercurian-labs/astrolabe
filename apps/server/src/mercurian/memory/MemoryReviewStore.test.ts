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
      yield* store.markReviewed(review);
      yield* store.markReviewed(review);
      assert.deepStrictEqual(yield* store.listReviewed(review), [review]);
    }),
  );
});
