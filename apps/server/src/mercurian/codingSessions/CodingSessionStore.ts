import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  BranchMovement,
  MercurianRepositoryId,
  PlanId,
  SnapshotKind,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";

import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";
import {
  CodingSessionOutcome,
  CodingSessionRecord,
  CodingSessionRepositoryRecord,
} from "./schema.ts";

export type CodingSessionStoreError = PersistenceSqlError | PersistenceDecodeError;

export const RecordCodingSessionInput = CodingSessionRecord;
export type RecordCodingSessionInput = typeof RecordCodingSessionInput.Type;

export const EndCodingSessionInput = Schema.Struct({
  threadId: ThreadId,
  endedAt: Schema.DateTimeUtcFromString,
  outcome: CodingSessionOutcome,
});
export type EndCodingSessionInput = typeof EndCodingSessionInput.Type;

export const AttachPullRequestInput = Schema.Struct({
  threadId: ThreadId,
  repositoryId: MercurianRepositoryId,
  prUrl: Schema.String,
});
export type AttachPullRequestInput = typeof AttachPullRequestInput.Type;

export const RecordSnapshotInput = Schema.Struct({
  snapshotOid: TrimmedNonEmptyString,
  kind: SnapshotKind,
  branchTipOid: TrimmedNonEmptyString,
  departedRef: Schema.NullOr(Schema.String),
  branchMovement: BranchMovement,
});
export type RecordSnapshotInput = typeof RecordSnapshotInput.Type;

export class CodingSessionStore extends Context.Service<
  CodingSessionStore,
  {
    readonly record: (
      input: RecordCodingSessionInput,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    /** Transaction participant for PlanningStore; caller announces after commit. */
    readonly recordInTransaction: (
      input: RecordCodingSessionInput,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    readonly recordRepositoriesInTransaction: (
      threadId: ThreadId,
      repositoryIds: ReadonlyArray<MercurianRepositoryId>,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    readonly announce: (planId: PlanId) => Effect.Effect<void>;
    readonly listForPlan: (
      planId: PlanId,
    ) => Effect.Effect<ReadonlyArray<CodingSessionRecord>, CodingSessionStoreError>;
    readonly listAll: Effect.Effect<ReadonlyArray<CodingSessionRecord>, CodingSessionStoreError>;
    readonly getByThreadId: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<CodingSessionRecord>, CodingSessionStoreError>;
    readonly getByWorktreePath: (
      worktreePath: string,
    ) => Effect.Effect<Option.Option<CodingSessionRecord>, CodingSessionStoreError>;
    readonly getByBranch: (
      branch: string,
    ) => Effect.Effect<Option.Option<CodingSessionRecord>, CodingSessionStoreError>;
    readonly updateBranch: (
      threadId: ThreadId,
      branch: string,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    readonly recordSnapshot: (
      threadId: ThreadId,
      input: RecordSnapshotInput,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    /** A member's snapshot facts, one row per repository the session spans. */
    readonly recordRepositorySnapshot: (
      threadId: ThreadId,
      repositoryId: MercurianRepositoryId,
      input: RecordSnapshotInput,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    readonly recordLineBranchMissing: (
      threadId: ThreadId,
      oid: string | null,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    readonly end: (input: EndCodingSessionInput) => Effect.Effect<void, CodingSessionStoreError>;
    readonly attachPullRequest: (
      input: AttachPullRequestInput,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    readonly listRepositories: (
      threadId: ThreadId,
    ) => Effect.Effect<
      ReadonlyArray<typeof CodingSessionRepositoryRecord.Type>,
      CodingSessionStoreError
    >;
    readonly changes: Stream.Stream<PlanId>;
  }
>()("t3/mercurian/codingSessions/CodingSessionStore") {}

const PlanRequest = Schema.Struct({ planId: PlanId });
const ThreadRequest = Schema.Struct({ threadId: ThreadId });
const WorktreeRequest = Schema.Struct({ worktreePath: Schema.String });
const BranchLookupRequest = Schema.Struct({ branch: Schema.String });
const BranchRequest = Schema.Struct({ threadId: ThreadId, branch: Schema.String });
const SnapshotRequest = Schema.Struct({ threadId: ThreadId, ...RecordSnapshotInput.fields });
const RepositorySnapshotRequest = Schema.Struct({
  threadId: ThreadId,
  repositoryId: MercurianRepositoryId,
  ...RecordSnapshotInput.fields,
});
const LineBranchMissingRequest = Schema.Struct({
  threadId: ThreadId,
  oid: Schema.NullOr(TrimmedNonEmptyString),
});
const NoRequest = Schema.Struct({});

const CodingSessionRow = Schema.Struct({
  ...CodingSessionRecord.fields,
  prState: Schema.NullOr(Schema.String),
  memoryMergedHomeAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  branchMovement: Schema.NullOr(Schema.fromJsonString(BranchMovement)),
});
const CodingSessionRepositoryRow = Schema.Struct({
  ...CodingSessionRepositoryRecord.fields,
  branchMovement: Schema.NullOr(Schema.fromJsonString(BranchMovement)),
});

function toStoreError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): CodingSessionStoreError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
      : isPersistenceError(cause)
        ? cause
        : new PersistenceSqlError({ operation: sqlOperation, cause });
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changesPubSub = yield* PubSub.unbounded<PlanId>();
  const columns = sql`
    commit_id AS "commitId", plan_id AS "planId", repository_id AS "repositoryId",
    thread_id AS "threadId", branch AS "branch", worktree_path AS "worktreePath",
    base_ref AS "baseRef", started_at AS "startedAt", ended_at AS "endedAt",
    outcome AS "outcome", pr_url AS "prUrl", pr_state AS "prState",
    memory_merged_home_at AS "memoryMergedHomeAt", settled_commit_oid AS "settledCommitOid",
    partial AS "partial", snapshot_oid AS "snapshotOid", snapshot_kind AS "snapshotKind",
    departed_ref AS "departedRef", branch_movement AS "branchMovement",
    line_branch_missing_oid AS "lineBranchMissingOid",
    unreachable_repositories_json AS "unreachableRepositories"
  `;

  const insert = (row: RecordCodingSessionInput) => sql`
      INSERT INTO coding_sessions (
        commit_id, plan_id, repository_id, thread_id, branch, worktree_path,
        base_ref, started_at, ended_at, outcome, pr_url, pr_state, memory_merged_home_at,
        settled_commit_oid, partial,
        snapshot_oid, snapshot_kind, departed_ref, branch_movement, line_branch_missing_oid,
        unreachable_repositories_json
      ) VALUES (
        ${row.commitId}, ${row.planId}, ${row.repositoryId ?? null}, ${row.threadId}, ${row.branch},
        ${row.worktreePath}, ${row.baseRef}, ${DateTime.formatIso(row.startedAt)},
        ${row.endedAt === null ? null : DateTime.formatIso(row.endedAt)}, ${row.outcome},
        ${row.prUrl}, ${row.prState ?? null},
        ${row.memoryMergedHomeAt == null ? null : DateTime.formatIso(row.memoryMergedHomeAt)},
        ${row.settledCommitOid}, ${row.partial ? 1 : 0}, ${row.snapshotOid},
        ${row.snapshotKind}, ${row.departedRef},
        ${row.branchMovement === null ? null : JSON.stringify(row.branchMovement)},
        ${row.lineBranchMissingOid}, ${JSON.stringify(row.unreachableRepositories)}
      )
    `;
  const insertRepositoryRows = (input: {
    readonly threadId: ThreadId;
    readonly repositoryIds: ReadonlyArray<MercurianRepositoryId>;
  }) =>
    Effect.forEach(
      input.repositoryIds,
      (repositoryId) => sql`
        INSERT OR IGNORE INTO coding_session_repositories (thread_id, repository_id)
        VALUES (${input.threadId}, ${repositoryId})
      `,
      { discard: true },
    );
  const listForPlanRows = SqlSchema.findAll({
    Request: PlanRequest,
    Result: CodingSessionRow,
    execute: ({ planId }) => sql`
      SELECT ${columns} FROM coding_sessions WHERE plan_id = ${planId}
      ORDER BY started_at ASC, commit_id ASC
    `,
  });
  const listAllRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: CodingSessionRow,
    execute: () =>
      sql`SELECT ${columns} FROM coding_sessions ORDER BY started_at ASC, commit_id ASC`,
  });
  const findByThread = SqlSchema.findOneOption({
    Request: ThreadRequest,
    Result: CodingSessionRow,
    execute: ({ threadId }) =>
      sql`SELECT ${columns} FROM coding_sessions WHERE thread_id = ${threadId}`,
  });
  const findByWorktree = SqlSchema.findOneOption({
    Request: WorktreeRequest,
    Result: CodingSessionRow,
    execute: ({ worktreePath }) =>
      sql`SELECT ${columns} FROM coding_sessions WHERE worktree_path = ${worktreePath}`,
  });
  const findByBranch = SqlSchema.findOneOption({
    Request: BranchLookupRequest,
    Result: CodingSessionRow,
    execute: ({ branch }) => sql`SELECT ${columns} FROM coding_sessions WHERE branch = ${branch}`,
  });
  const updateBranchRow = SqlSchema.void({
    Request: BranchRequest,
    execute: ({ threadId, branch }) => sql`
      UPDATE coding_sessions SET branch = ${branch} WHERE thread_id = ${threadId}
    `,
  });
  const snapshotRow = SqlSchema.void({
    Request: SnapshotRequest,
    execute: ({ threadId, snapshotOid, kind, branchTipOid, departedRef, branchMovement }) => sql`
      UPDATE coding_sessions SET
        snapshot_oid = ${snapshotOid}, snapshot_kind = ${kind}, departed_ref = ${departedRef},
        branch_movement = ${JSON.stringify(branchMovement)},
        partial = CASE WHEN ${kind} = 'settled' THEN 0 WHEN ${kind} = 'partial' THEN 1 ELSE partial END,
        settled_commit_oid = ${branchTipOid}
      WHERE thread_id = ${threadId}
    `,
  });
  const repositorySnapshotRow = SqlSchema.void({
    Request: RepositorySnapshotRequest,
    execute: ({
      threadId,
      repositoryId,
      snapshotOid,
      kind,
      branchTipOid,
      departedRef,
      branchMovement,
    }) => sql`
      INSERT INTO coding_session_repositories (
        thread_id, repository_id, snapshot_oid, snapshot_kind, branch_tip_oid, departed_ref,
        branch_movement
      ) VALUES (
        ${threadId}, ${repositoryId}, ${snapshotOid}, ${kind}, ${branchTipOid}, ${departedRef},
        ${JSON.stringify(branchMovement)}
      )
      ON CONFLICT(thread_id, repository_id) DO UPDATE SET
        snapshot_oid = excluded.snapshot_oid, snapshot_kind = excluded.snapshot_kind,
        branch_tip_oid = excluded.branch_tip_oid, departed_ref = excluded.departed_ref,
        branch_movement = excluded.branch_movement
    `,
  });
  const lineBranchMissingRow = SqlSchema.void({
    Request: LineBranchMissingRequest,
    execute: ({ threadId, oid }) => sql`
      UPDATE coding_sessions SET line_branch_missing_oid = ${oid} WHERE thread_id = ${threadId}
    `,
  });
  const endRow = SqlSchema.void({
    Request: EndCodingSessionInput,
    execute: ({ threadId, endedAt, outcome }) => sql`
      UPDATE coding_sessions SET ended_at = ${endedAt}, outcome = ${outcome}
      WHERE thread_id = ${threadId}
    `,
  });
  const attachPrRow = SqlSchema.void({
    Request: AttachPullRequestInput,
    execute: ({ threadId, repositoryId, prUrl }) => sql`
      INSERT INTO coding_session_repositories (thread_id, repository_id, pr_url)
      VALUES (${threadId}, ${repositoryId}, ${prUrl})
      ON CONFLICT(thread_id, repository_id)
      DO UPDATE SET pr_url = excluded.pr_url
    `,
  });
  const listRepositoryRows = SqlSchema.findAll({
    Request: ThreadRequest,
    Result: CodingSessionRepositoryRow,
    execute: ({ threadId }) => sql`
      SELECT
        session.repository_id AS "repositoryId",
        repository.name AS "repositoryName",
        session.snapshot_oid AS "snapshotOid",
        session.snapshot_kind AS "snapshotKind",
        session.branch_tip_oid AS "branchTipOid",
        session.departed_ref AS "departedRef",
        session.branch_movement AS "branchMovement",
        session.pr_url AS "prUrl"
      FROM coding_session_repositories session
      JOIN repositories repository ON repository.repository_id = session.repository_id
      WHERE session.thread_id = ${threadId}
      ORDER BY repository.created_at ASC, repository.repository_id ASC
    `,
  });

  const announceThread = Effect.fn("CodingSessionStore.announceThread")(function* (
    threadId: ThreadId,
  ) {
    const found = yield* findByThread({ threadId });
    if (Option.isSome(found)) yield* PubSub.publish(changesPubSub, found.value.planId);
  });
  const mapError = <A, E, R>(effect: Effect.Effect<A, E, R>, operation: string) =>
    effect.pipe(Effect.mapError(toStoreError(`${operation}:query`, `${operation}:decodeRow`)));

  const withRepositories = (record: CodingSessionRecord) =>
    mapError(
      listRepositoryRows({ threadId: record.threadId }),
      "CodingSessionStore.listRepositories",
    ).pipe(
      Effect.map((repositories) => ({
        ...record,
        ...(repositories.length === 0 ? {} : { repositories }),
      })),
    );
  const withRepositoriesOption = (record: Option.Option<CodingSessionRecord>) =>
    Option.isNone(record)
      ? Effect.succeed(Option.none<CodingSessionRecord>())
      : withRepositories(record.value).pipe(Effect.map(Option.some));

  return CodingSessionStore.of({
    record: (input) =>
      mapError(
        sql
          .withTransaction(insert(input))
          .pipe(Effect.andThen(PubSub.publish(changesPubSub, input.planId)), Effect.asVoid),
        "CodingSessionStore.record",
      ),
    recordInTransaction: (input) =>
      mapError(insert(input), "CodingSessionStore.recordInTransaction"),
    recordRepositoriesInTransaction: (threadId, repositoryIds) =>
      mapError(
        insertRepositoryRows({ threadId, repositoryIds }),
        "CodingSessionStore.recordRepositoriesInTransaction",
      ),
    announce: (planId) => PubSub.publish(changesPubSub, planId).pipe(Effect.asVoid),
    listForPlan: (planId) =>
      mapError(listForPlanRows({ planId }), "CodingSessionStore.listForPlan").pipe(
        Effect.flatMap((records) => Effect.forEach(records, withRepositories)),
      ),
    listAll: mapError(listAllRows({}), "CodingSessionStore.listAll").pipe(
      Effect.flatMap((records) => Effect.forEach(records, withRepositories)),
    ),
    getByThreadId: (threadId) =>
      mapError(findByThread({ threadId }), "CodingSessionStore.getByThreadId").pipe(
        Effect.flatMap(withRepositoriesOption),
      ),
    getByWorktreePath: (worktreePath) =>
      mapError(findByWorktree({ worktreePath }), "CodingSessionStore.getByWorktreePath").pipe(
        Effect.flatMap(withRepositoriesOption),
      ),
    getByBranch: (branch) =>
      mapError(findByBranch({ branch }), "CodingSessionStore.getByBranch").pipe(
        Effect.flatMap(withRepositoriesOption),
      ),
    updateBranch: (threadId, branch) =>
      mapError(
        updateBranchRow({ threadId, branch }).pipe(Effect.andThen(announceThread(threadId))),
        "CodingSessionStore.updateBranch",
      ),
    recordSnapshot: (threadId, input) =>
      mapError(
        snapshotRow({ threadId, ...input }).pipe(Effect.andThen(announceThread(threadId))),
        "CodingSessionStore.recordSnapshot",
      ),
    recordRepositorySnapshot: (threadId, repositoryId, input) =>
      mapError(
        repositorySnapshotRow({ threadId, repositoryId, ...input }),
        "CodingSessionStore.recordRepositorySnapshot",
      ),
    recordLineBranchMissing: (threadId, oid) =>
      mapError(
        lineBranchMissingRow({ threadId, oid }).pipe(Effect.andThen(announceThread(threadId))),
        "CodingSessionStore.recordLineBranchMissing",
      ),
    end: (input) =>
      mapError(
        endRow(input).pipe(Effect.andThen(announceThread(input.threadId))),
        "CodingSessionStore.end",
      ),
    attachPullRequest: (input) =>
      mapError(
        attachPrRow(input).pipe(Effect.andThen(announceThread(input.threadId))),
        "CodingSessionStore.attachPullRequest",
      ),
    listRepositories: (threadId) =>
      mapError(listRepositoryRows({ threadId }), "CodingSessionStore.listRepositories"),
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  });
});

export const layer = Layer.effect(CodingSessionStore, make);
