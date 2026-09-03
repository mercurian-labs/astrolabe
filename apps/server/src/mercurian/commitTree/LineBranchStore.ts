import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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

export const LineBranch = Schema.Struct({
  lineRootCommitId: MercurianCommitId,
  repositoryId: MercurianRepositoryId,
  branch: TrimmedNonEmptyString,
  baseOid: TrimmedNonEmptyString,
  built: Schema.Boolean,
  repointHold: Schema.NullOr(Schema.Literals(["checked-out", "name-missing"])),
  createdAt: Schema.DateTimeUtcFromString,
});
export type LineBranch = typeof LineBranch.Type;

const LineBranchRow = Schema.Struct({
  ...LineBranch.fields,
  built: Schema.Number,
});
const Key = Schema.Struct({
  lineRootCommitId: MercurianCommitId,
  repositoryId: MercurianRepositoryId,
});
const Repoint = Schema.Struct({ ...Key.fields, baseOid: TrimmedNonEmptyString });
const Rename = Schema.Struct({ ...Key.fields, branch: TrimmedNonEmptyString });
const RepointHold = Schema.Struct({
  ...Key.fields,
  reason: Schema.NullOr(Schema.Literals(["checked-out", "name-missing"])),
});

export type LineBranchStoreError = PersistenceSqlError | PersistenceDecodeError;

export class LineBranchStore extends Context.Service<
  LineBranchStore,
  {
    readonly listAll: Effect.Effect<ReadonlyArray<LineBranch>, LineBranchStoreError>;
    readonly get: (
      input: typeof Key.Type,
    ) => Effect.Effect<Option.Option<LineBranch>, LineBranchStoreError>;
    readonly create: (input: LineBranch) => Effect.Effect<void, LineBranchStoreError>;
    readonly repointIfUnbuilt: (
      input: typeof Repoint.Type,
    ) => Effect.Effect<boolean, LineBranchStoreError>;
    readonly markBuilt: (input: typeof Key.Type) => Effect.Effect<void, LineBranchStoreError>;
    readonly rename: (input: typeof Rename.Type) => Effect.Effect<void, LineBranchStoreError>;
    readonly recordRepointHold: (
      input: typeof RepointHold.Type,
    ) => Effect.Effect<void, LineBranchStoreError>;
    readonly changes: Stream.Stream<void>;
  }
>()("t3/mercurian/commitTree/LineBranchStore") {}

const toError =
  (operation: string) =>
  (cause: unknown): LineBranchStoreError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(`${operation}:decode`, cause)
      : isPersistenceError(cause)
        ? cause
        : new PersistenceSqlError({ operation, cause });

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<void>();
  const columns = sql`
    line_root_commit_id AS "lineRootCommitId", repository_id AS "repositoryId",
    branch AS "branch", base_oid AS "baseOid", built AS "built",
    repoint_hold AS "repointHold", created_at AS "createdAt"
  `;
  const listRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: LineBranchRow,
    execute: () =>
      sql`SELECT ${columns} FROM line_branches ORDER BY created_at, line_root_commit_id, repository_id`,
  });
  const findRow = SqlSchema.findOneOption({
    Request: Key,
    Result: LineBranchRow,
    execute: ({ lineRootCommitId, repositoryId }) => sql`
      SELECT ${columns} FROM line_branches
      WHERE line_root_commit_id = ${lineRootCommitId} AND repository_id = ${repositoryId}
    `,
  });
  const insertRow = SqlSchema.void({
    Request: LineBranch,
    execute: (row) => sql`
      INSERT INTO line_branches (
        line_root_commit_id, repository_id, branch, base_oid, built, repoint_hold, created_at
      ) VALUES (
        ${row.lineRootCommitId}, ${row.repositoryId}, ${row.branch}, ${row.baseOid},
        ${row.built ? 1 : 0}, ${row.repointHold}, ${row.createdAt}
      ) ON CONFLICT(line_root_commit_id, repository_id) DO NOTHING
    `,
  });
  const repointRow = SqlSchema.findAll({
    Request: Repoint,
    Result: Key,
    execute: ({ lineRootCommitId, repositoryId, baseOid }) => sql`
      UPDATE line_branches SET base_oid = ${baseOid}
      WHERE line_root_commit_id = ${lineRootCommitId} AND repository_id = ${repositoryId} AND built = 0
      RETURNING line_root_commit_id AS "lineRootCommitId", repository_id AS "repositoryId"
    `,
  });
  const markBuiltRow = SqlSchema.void({
    Request: Key,
    execute: ({ lineRootCommitId, repositoryId }) => sql`
      UPDATE line_branches SET built = 1
      WHERE line_root_commit_id = ${lineRootCommitId} AND repository_id = ${repositoryId}
    `,
  });
  const renameRow = SqlSchema.void({
    Request: Rename,
    execute: ({ lineRootCommitId, repositoryId, branch }) => sql`
      UPDATE line_branches SET branch = ${branch}
      WHERE line_root_commit_id = ${lineRootCommitId} AND repository_id = ${repositoryId}
    `,
  });
  const recordRepointHoldRow = SqlSchema.void({
    Request: RepointHold,
    execute: ({ lineRootCommitId, repositoryId, reason }) => sql`
      UPDATE line_branches SET repoint_hold = ${reason}
      WHERE line_root_commit_id = ${lineRootCommitId} AND repository_id = ${repositoryId}
    `,
  });
  const decode = (row: typeof LineBranchRow.Type): LineBranch => ({
    ...row,
    built: row.built !== 0,
  });
  const map = <A, E, R>(effect: Effect.Effect<A, E, R>, operation: string) =>
    effect.pipe(Effect.mapError(toError(operation)));
  const announce = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

  return LineBranchStore.of({
    listAll: map(
      listRows({}).pipe(Effect.map((rows) => rows.map(decode))),
      "LineBranchStore.listAll",
    ),
    get: (input) => map(findRow(input).pipe(Effect.map(Option.map(decode))), "LineBranchStore.get"),
    create: (input) =>
      map(
        sql.withTransaction(insertRow(input)).pipe(Effect.andThen(announce)),
        "LineBranchStore.create",
      ),
    repointIfUnbuilt: (input) =>
      map(
        sql
          .withTransaction(repointRow(input))
          .pipe(
            Effect.flatMap((rows) =>
              rows.length > 0 ? announce.pipe(Effect.as(true)) : Effect.succeed(false),
            ),
          ),
        "LineBranchStore.repointIfUnbuilt",
      ),
    markBuilt: (input) =>
      map(
        sql.withTransaction(markBuiltRow(input)).pipe(Effect.andThen(announce)),
        "LineBranchStore.markBuilt",
      ),
    rename: (input) =>
      map(
        sql.withTransaction(renameRow(input)).pipe(Effect.andThen(announce)),
        "LineBranchStore.rename",
      ),
    recordRepointHold: (input) =>
      map(
        sql.withTransaction(recordRepointHoldRow(input)).pipe(Effect.andThen(announce)),
        "LineBranchStore.recordRepointHold",
      ),
    get changes() {
      return Stream.fromPubSub(changes);
    },
  });
});

export const layer = Layer.effect(LineBranchStore, make);
