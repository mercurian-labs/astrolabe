import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { PlanId, ThreadId } from "@t3tools/contracts";

import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";
import { CodingSessionOutcome, CodingSessionRecord } from "./schema.ts";

export type CodingSessionStoreError = PersistenceSqlError | PersistenceDecodeError;

export const RecordCodingSessionInput = CodingSessionRecord;
export type RecordCodingSessionInput = typeof RecordCodingSessionInput.Type;

export const EndCodingSessionInput = Schema.Struct({
  threadId: ThreadId,
  endedAt: Schema.DateTimeUtcFromString,
  outcome: CodingSessionOutcome,
});
export type EndCodingSessionInput = typeof EndCodingSessionInput.Type;

export const AttachPullRequestInput = Schema.Struct({ threadId: ThreadId, prUrl: Schema.String });
export type AttachPullRequestInput = typeof AttachPullRequestInput.Type;

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
    readonly recordSettledCommit: (
      threadId: ThreadId,
      settledCommitOid: string,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    readonly recordPartial: (
      threadId: ThreadId,
      partial: boolean,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    readonly end: (input: EndCodingSessionInput) => Effect.Effect<void, CodingSessionStoreError>;
    readonly attachPullRequest: (
      input: AttachPullRequestInput,
    ) => Effect.Effect<void, CodingSessionStoreError>;
    readonly changes: Stream.Stream<PlanId>;
  }
>()("t3/mercurian/codingSessions/CodingSessionStore") {}

const PlanRequest = Schema.Struct({ planId: PlanId });
const ThreadRequest = Schema.Struct({ threadId: ThreadId });
const WorktreeRequest = Schema.Struct({ worktreePath: Schema.String });
const BranchLookupRequest = Schema.Struct({ branch: Schema.String });
const BranchRequest = Schema.Struct({ threadId: ThreadId, branch: Schema.String });
const SettledCommitRequest = Schema.Struct({ threadId: ThreadId, settledCommitOid: Schema.String });
const PartialRequest = Schema.Struct({ threadId: ThreadId, partial: Schema.Boolean });
const NoRequest = Schema.Struct({});

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
    outcome AS "outcome", pr_url AS "prUrl", settled_commit_oid AS "settledCommitOid",
    partial AS "partial"
  `;

  const insert = SqlSchema.void({
    Request: CodingSessionRecord,
    execute: (row) => sql`
      INSERT INTO coding_sessions (
        commit_id, plan_id, repository_id, thread_id, branch, worktree_path,
        base_ref, started_at, ended_at, outcome, pr_url, settled_commit_oid, partial
      ) VALUES (
        ${row.commitId}, ${row.planId}, ${row.repositoryId}, ${row.threadId}, ${row.branch},
        ${row.worktreePath}, ${row.baseRef}, ${row.startedAt}, ${row.endedAt}, ${row.outcome},
        ${row.prUrl}, ${row.settledCommitOid}, ${row.partial ? 1 : 0}
      )
    `,
  });
  const listForPlanRows = SqlSchema.findAll({
    Request: PlanRequest,
    Result: CodingSessionRecord,
    execute: ({ planId }) => sql`
      SELECT ${columns} FROM coding_sessions WHERE plan_id = ${planId}
      ORDER BY started_at ASC, commit_id ASC
    `,
  });
  const listAllRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: CodingSessionRecord,
    execute: () =>
      sql`SELECT ${columns} FROM coding_sessions ORDER BY started_at ASC, commit_id ASC`,
  });
  const findByThread = SqlSchema.findOneOption({
    Request: ThreadRequest,
    Result: CodingSessionRecord,
    execute: ({ threadId }) =>
      sql`SELECT ${columns} FROM coding_sessions WHERE thread_id = ${threadId}`,
  });
  const findByWorktree = SqlSchema.findOneOption({
    Request: WorktreeRequest,
    Result: CodingSessionRecord,
    execute: ({ worktreePath }) =>
      sql`SELECT ${columns} FROM coding_sessions WHERE worktree_path = ${worktreePath}`,
  });
  const findByBranch = SqlSchema.findOneOption({
    Request: BranchLookupRequest,
    Result: CodingSessionRecord,
    execute: ({ branch }) => sql`SELECT ${columns} FROM coding_sessions WHERE branch = ${branch}`,
  });
  const updateBranchRow = SqlSchema.void({
    Request: BranchRequest,
    execute: ({ threadId, branch }) => sql`
      UPDATE coding_sessions SET branch = ${branch} WHERE thread_id = ${threadId}
    `,
  });
  const settledCommitRow = SqlSchema.void({
    Request: SettledCommitRequest,
    execute: ({ threadId, settledCommitOid }) => sql`
      UPDATE coding_sessions SET settled_commit_oid = ${settledCommitOid} WHERE thread_id = ${threadId}
    `,
  });
  const partialRow = SqlSchema.void({
    Request: PartialRequest,
    execute: ({ threadId, partial }) => sql`
      UPDATE coding_sessions SET partial = ${partial ? 1 : 0} WHERE thread_id = ${threadId}
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
    execute: ({ threadId, prUrl }) => sql`
      UPDATE coding_sessions SET pr_url = ${prUrl} WHERE thread_id = ${threadId}
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
    announce: (planId) => PubSub.publish(changesPubSub, planId).pipe(Effect.asVoid),
    listForPlan: (planId) =>
      mapError(listForPlanRows({ planId }), "CodingSessionStore.listForPlan"),
    listAll: mapError(listAllRows({}), "CodingSessionStore.listAll"),
    getByThreadId: (threadId) =>
      mapError(findByThread({ threadId }), "CodingSessionStore.getByThreadId"),
    getByWorktreePath: (worktreePath) =>
      mapError(findByWorktree({ worktreePath }), "CodingSessionStore.getByWorktreePath"),
    getByBranch: (branch) => mapError(findByBranch({ branch }), "CodingSessionStore.getByBranch"),
    updateBranch: (threadId, branch) =>
      mapError(
        updateBranchRow({ threadId, branch }).pipe(Effect.andThen(announceThread(threadId))),
        "CodingSessionStore.updateBranch",
      ),
    recordSettledCommit: (threadId, settledCommitOid) =>
      mapError(
        settledCommitRow({ threadId, settledCommitOid }).pipe(
          Effect.andThen(announceThread(threadId)),
        ),
        "CodingSessionStore.recordSettledCommit",
      ),
    recordPartial: (threadId, partial) =>
      mapError(
        partialRow({ threadId, partial }).pipe(Effect.andThen(announceThread(threadId))),
        "CodingSessionStore.recordPartial",
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
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  });
});

export const layer = Layer.effect(CodingSessionStore, make);
