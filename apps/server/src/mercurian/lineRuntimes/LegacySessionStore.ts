import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { BranchMovement, PlanId, ThreadId } from "@t3tools/contracts";

import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";
import { CodingSessionRecord, CodingSessionRepositoryRecord } from "./LegacySessionSchema.ts";

export type LegacySessionStoreError = PersistenceSqlError | PersistenceDecodeError;

export class LegacySessionStore extends Context.Service<
  LegacySessionStore,
  {
    readonly listByPlan: (
      planId: PlanId,
    ) => Effect.Effect<ReadonlyArray<CodingSessionRecord>, LegacySessionStoreError>;
    readonly getByThreadId: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<CodingSessionRecord>, LegacySessionStoreError>;
    readonly getByBranch: (
      branch: string,
    ) => Effect.Effect<Option.Option<CodingSessionRecord>, LegacySessionStoreError>;
  }
>()("t3/mercurian/lineRuntimes/LegacySessionStore") {}

const PlanRequest = Schema.Struct({ planId: PlanId });
const ThreadRequest = Schema.Struct({ threadId: ThreadId });
const BranchRequest = Schema.Struct({ branch: Schema.String });
const LegacySessionRow = Schema.Struct({
  ...CodingSessionRecord.fields,
  branchMovement: Schema.NullOr(Schema.fromJsonString(BranchMovement)),
});
const RepositoryRow = Schema.Struct({
  ...CodingSessionRepositoryRecord.fields,
  branchMovement: Schema.NullOr(Schema.fromJsonString(BranchMovement)),
});

const toStoreError =
  (operation: string) =>
  (cause: unknown): LegacySessionStoreError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(`${operation}:decodeRow`, cause)
      : isPersistenceError(cause)
        ? cause
        : new PersistenceSqlError({ operation: `${operation}:query`, cause });

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = sql`
    commit_id AS "commitId", plan_id AS "planId", repository_id AS "repositoryId",
    thread_id AS "threadId", branch AS "branch", worktree_path AS "worktreePath",
    base_ref AS "baseRef", started_at AS "startedAt", ended_at AS "endedAt",
    outcome AS "outcome", pr_url AS "prUrl", settled_commit_oid AS "settledCommitOid",
    partial AS "partial", snapshot_oid AS "snapshotOid", snapshot_kind AS "snapshotKind",
    departed_ref AS "departedRef", branch_movement AS "branchMovement",
    line_branch_missing_oid AS "lineBranchMissingOid",
    unreachable_repositories_json AS "unreachableRepositories"
  `;
  const listRows = SqlSchema.findAll({
    Request: PlanRequest,
    Result: LegacySessionRow,
    execute: ({ planId }) => sql`
      SELECT ${columns} FROM coding_sessions WHERE plan_id = ${planId}
      ORDER BY started_at ASC, commit_id ASC
    `,
  });
  const findThread = SqlSchema.findOneOption({
    Request: ThreadRequest,
    Result: LegacySessionRow,
    execute: ({ threadId }) =>
      sql`SELECT ${columns} FROM coding_sessions WHERE thread_id = ${threadId}`,
  });
  const findBranch = SqlSchema.findOneOption({
    Request: BranchRequest,
    Result: LegacySessionRow,
    execute: ({ branch }) => sql`SELECT ${columns} FROM coding_sessions WHERE branch = ${branch}`,
  });
  const listRepositories = SqlSchema.findAll({
    Request: ThreadRequest,
    Result: RepositoryRow,
    execute: ({ threadId }) => sql`
      SELECT member.repository_id AS "repositoryId", repository.name AS "repositoryName",
        member.snapshot_oid AS "snapshotOid", member.snapshot_kind AS "snapshotKind",
        member.branch_tip_oid AS "branchTipOid", member.departed_ref AS "departedRef",
        member.branch_movement AS "branchMovement", member.pr_url AS "prUrl"
      FROM line_runtime_repositories member
      JOIN repositories repository ON repository.repository_id = member.repository_id
      WHERE member.thread_id = ${threadId}
      ORDER BY repository.created_at ASC, repository.repository_id ASC
    `,
  });
  const mapError = <A, E, R>(effect: Effect.Effect<A, E, R>, operation: string) =>
    effect.pipe(Effect.mapError(toStoreError(operation)));
  const withRepositories = (record: CodingSessionRecord) =>
    mapError(
      listRepositories({ threadId: record.threadId }),
      "LegacySessionStore.repositories",
    ).pipe(
      Effect.map((repositories) => ({
        ...record,
        ...(repositories.length === 0 ? {} : { repositories }),
      })),
    );
  const hydrate = (record: Option.Option<CodingSessionRecord>) =>
    Option.isNone(record)
      ? Effect.succeed(Option.none<CodingSessionRecord>())
      : withRepositories(record.value).pipe(Effect.map(Option.some));

  return LegacySessionStore.of({
    listByPlan: (planId) =>
      mapError(listRows({ planId }), "LegacySessionStore.listByPlan").pipe(
        Effect.flatMap((records) => Effect.forEach(records, withRepositories)),
      ),
    getByThreadId: (threadId) =>
      mapError(findThread({ threadId }), "LegacySessionStore.getByThreadId").pipe(
        Effect.flatMap(hydrate),
      ),
    getByBranch: (branch) =>
      mapError(findBranch({ branch }), "LegacySessionStore.getByBranch").pipe(
        Effect.flatMap(hydrate),
      ),
  });
});

export const layer = Layer.effect(LegacySessionStore, make);
