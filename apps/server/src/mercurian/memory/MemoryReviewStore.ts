import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  MercurianCommitId,
  MercurianRepositoryId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";

const Key = Schema.Struct({
  lineRootCommitId: MercurianCommitId,
  repositoryId: MercurianRepositoryId,
});
const Review = Schema.Struct({
  ...Key.fields,
  commitOid: TrimmedNonEmptyString,
  reviewedAt: Schema.DateTimeUtcFromString,
});
export type MemoryReview = typeof Review.Type;
export interface MemoryReviewInvalidation {
  readonly repositoryId: MercurianRepositoryId;
  /** Absent when shared memory home moved for every line using this repository. */
  readonly lineRootCommitId?: MercurianCommitId;
}
export type MemoryReviewStoreError = PersistenceSqlError | PersistenceDecodeError;

export class MemoryReviewStore extends Context.Service<
  MemoryReviewStore,
  {
    readonly listReviewed: (
      input: typeof Key.Type,
    ) => Effect.Effect<ReadonlyArray<MemoryReview>, MemoryReviewStoreError>;
    readonly markReviewed: (input: MemoryReview) => Effect.Effect<void, MemoryReviewStoreError>;
    readonly changes: Stream.Stream<MemoryReviewInvalidation>;
    readonly invalidate: (input: MemoryReviewInvalidation) => Effect.Effect<void>;
  }
>()("t3/mercurian/memory/MemoryReviewStore") {}

const toError =
  (operation: string) =>
  (cause: unknown): MemoryReviewStoreError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(`${operation}:decode`, cause)
      : isPersistenceError(cause)
        ? cause
        : new PersistenceSqlError({ operation, cause });

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<MemoryReviewInvalidation>();
  const listRows = SqlSchema.findAll({
    Request: Key,
    Result: Review,
    execute: ({ lineRootCommitId, repositoryId }) => sql`
      SELECT line_root_commit_id AS "lineRootCommitId", repository_id AS "repositoryId",
        commit_oid AS "commitOid", reviewed_at AS "reviewedAt"
      FROM memory_amendment_reviews
      WHERE line_root_commit_id = ${lineRootCommitId} AND repository_id = ${repositoryId}
      ORDER BY reviewed_at, commit_oid
    `,
  });
  const insert = SqlSchema.void({
    Request: Review,
    execute: (row) => sql`
      INSERT INTO memory_amendment_reviews (line_root_commit_id, repository_id, commit_oid, reviewed_at)
      VALUES (${row.lineRootCommitId}, ${row.repositoryId}, ${row.commitOid}, ${row.reviewedAt})
      ON CONFLICT(line_root_commit_id, repository_id, commit_oid) DO NOTHING
    `,
  });
  const announce = (input: MemoryReviewInvalidation) =>
    PubSub.publish(changes, {
      repositoryId: input.repositoryId,
      ...(input.lineRootCommitId === undefined ? {} : { lineRootCommitId: input.lineRootCommitId }),
    }).pipe(Effect.asVoid);
  return MemoryReviewStore.of({
    listReviewed: (input) =>
      listRows(input).pipe(Effect.mapError(toError("MemoryReviewStore.listReviewed"))),
    markReviewed: (input) =>
      sql
        .withTransaction(insert(input))
        .pipe(
          Effect.andThen(announce(input)),
          Effect.mapError(toError("MemoryReviewStore.markReviewed")),
        ),
    invalidate: announce,
    get changes() {
      return Stream.fromPubSub(changes);
    },
  });
});

export const layer = Layer.effect(MemoryReviewStore, make);
