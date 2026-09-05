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
  MercurianCommitId,
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
import { CodingSessionRepositoryRecord } from "./LegacySessionSchema.ts";
import { CreateLineRuntimeInput, LineRuntimeRecord } from "./schema.ts";

export type LineRuntimeStoreError = PersistenceSqlError | PersistenceDecodeError;

export const RecordSnapshotInput = Schema.Struct({
  snapshotOid: TrimmedNonEmptyString,
  kind: SnapshotKind,
  branchTipOid: TrimmedNonEmptyString,
  departedRef: Schema.NullOr(Schema.String),
  branchMovement: BranchMovement,
});
export type RecordSnapshotInput = typeof RecordSnapshotInput.Type;

export const AttachPullRequestInput = Schema.Struct({
  threadId: ThreadId,
  repositoryId: MercurianRepositoryId,
  prUrl: Schema.String,
});

export class LineRuntimeStore extends Context.Service<
  LineRuntimeStore,
  {
    readonly getOrNone: (
      planId: PlanId,
      lineRootCommitId: MercurianCommitId,
    ) => Effect.Effect<Option.Option<LineRuntimeRecord>, LineRuntimeStoreError>;
    readonly getByThreadId: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<LineRuntimeRecord>, LineRuntimeStoreError>;
    readonly listByPlan: (
      planId: PlanId,
    ) => Effect.Effect<ReadonlyArray<LineRuntimeRecord>, LineRuntimeStoreError>;
    readonly getByBranch: (
      branch: string,
    ) => Effect.Effect<Option.Option<LineRuntimeRecord>, LineRuntimeStoreError>;
    readonly create: (input: CreateLineRuntimeInput) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly rootPending: (
      threadId: ThreadId,
      lineRootCommitId: MercurianCommitId,
    ) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly deleteByThread: (threadId: ThreadId) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly updateWorkspace: (
      threadId: ThreadId,
      input: { readonly branch: string; readonly worktreePath: string },
    ) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly recordSnapshot: (
      threadId: ThreadId,
      input: RecordSnapshotInput,
    ) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly recordRepositorySnapshot: (
      threadId: ThreadId,
      repositoryId: MercurianRepositoryId,
      input: RecordSnapshotInput,
    ) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly recordLineBranchMissing: (
      threadId: ThreadId,
      oid: string | null,
    ) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly attachPullRequest: (
      input: typeof AttachPullRequestInput.Type,
    ) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly recordPullRequestState: (
      threadId: ThreadId,
      state: "open" | "closed" | "merged" | null,
    ) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly recordMemoryMergedHome: (
      threadId: ThreadId,
      mergedAt: DateTime.Utc,
    ) => Effect.Effect<void, LineRuntimeStoreError>;
    readonly changes: Stream.Stream<PlanId>;
    readonly memoryChanges: Stream.Stream<{
      readonly planId: PlanId;
      readonly threadId: ThreadId;
      readonly lineRootCommitId: MercurianCommitId | null;
    }>;
  }
>()("t3/mercurian/lineRuntimes/LineRuntimeStore") {}

const LineRequest = Schema.Struct({ planId: PlanId, lineRootCommitId: MercurianCommitId });
const PlanRequest = Schema.Struct({ planId: PlanId });
const ThreadRequest = Schema.Struct({ threadId: ThreadId });
const BranchLookupRequest = Schema.Struct({ branch: Schema.String });
const WorkspaceRequest = Schema.Struct({
  threadId: ThreadId,
  branch: Schema.String,
  worktreePath: Schema.String,
});
const MissingRequest = Schema.Struct({
  threadId: ThreadId,
  oid: Schema.NullOr(TrimmedNonEmptyString),
});
const PullRequestStateRequest = Schema.Struct({
  threadId: ThreadId,
  state: Schema.NullOr(Schema.Literals(["open", "closed", "merged"])),
});
const MemoryMergedHomeRequest = Schema.Struct({
  threadId: ThreadId,
  mergedAt: Schema.DateTimeUtcFromString,
});
const SnapshotRequest = Schema.Struct({ threadId: ThreadId, ...RecordSnapshotInput.fields });
const RepositorySnapshotRequest = Schema.Struct({
  threadId: ThreadId,
  repositoryId: MercurianRepositoryId,
  ...RecordSnapshotInput.fields,
});
const LineRuntimeRow = Schema.Struct({
  ...LineRuntimeRecord.fields,
  forkParentCommitId: Schema.NullOr(MercurianCommitId),
  branchMovement: Schema.NullOr(Schema.fromJsonString(BranchMovement)),
});
const RepositoryRow = Schema.Struct({
  ...CodingSessionRepositoryRecord.fields,
  branchMovement: Schema.NullOr(Schema.fromJsonString(BranchMovement)),
});
const encodeBranchMovement = Schema.encodeSync(Schema.fromJsonString(BranchMovement));
const encodeUnreachableRepositories = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(TrimmedNonEmptyString)),
);

const toStoreError =
  (operation: string) =>
  (cause: unknown): LineRuntimeStoreError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(`${operation}:decodeRow`, cause)
      : isPersistenceError(cause)
        ? cause
        : new PersistenceSqlError({ operation: `${operation}:query`, cause });

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changesPubSub = yield* PubSub.unbounded<PlanId>();
  const memoryChanges = yield* PubSub.unbounded<{
    readonly planId: PlanId;
    readonly threadId: ThreadId;
    readonly lineRootCommitId: MercurianCommitId | null;
  }>();
  const columns = sql`
    plan_id AS "planId", line_root_commit_id AS "lineRootCommitId",
    fork_parent_commit_id AS "forkParentCommitId", thread_id AS "threadId",
    home_repository_id AS "homeRepositoryId", branch AS "branch", worktree_path AS "worktreePath",
    unreachable_repositories_json AS "unreachableRepositories", snapshot_oid AS "snapshotOid",
    snapshot_kind AS "snapshotKind", departed_ref AS "departedRef",
    branch_movement AS "branchMovement", line_branch_missing_oid AS "lineBranchMissingOid",
    pr_state AS "prState", memory_merged_home_at AS "memoryMergedHomeAt",
    created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  const findLine = SqlSchema.findOneOption({
    Request: LineRequest,
    Result: LineRuntimeRow,
    execute: ({ planId, lineRootCommitId }) => sql`
      SELECT ${columns} FROM line_runtimes
      WHERE plan_id = ${planId} AND line_root_commit_id = ${lineRootCommitId}
    `,
  });
  const findThread = SqlSchema.findOneOption({
    Request: ThreadRequest,
    Result: LineRuntimeRow,
    execute: ({ threadId }) =>
      sql`SELECT ${columns} FROM line_runtimes WHERE thread_id = ${threadId}`,
  });
  const listPlan = SqlSchema.findAll({
    Request: PlanRequest,
    Result: LineRuntimeRow,
    execute: ({ planId }) => sql`
      SELECT ${columns} FROM line_runtimes WHERE plan_id = ${planId}
      ORDER BY created_at ASC, line_root_commit_id ASC
    `,
  });
  const findBranch = SqlSchema.findOneOption({
    Request: BranchLookupRequest,
    Result: LineRuntimeRow,
    execute: ({ branch }) => sql`SELECT ${columns} FROM line_runtimes WHERE branch = ${branch}`,
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
  const updateWorkspace = SqlSchema.void({
    Request: WorkspaceRequest,
    execute: ({ threadId, branch, worktreePath }) => sql`
      UPDATE line_runtimes SET branch = ${branch}, worktree_path = ${worktreePath},
        updated_at = CURRENT_TIMESTAMP
      WHERE thread_id = ${threadId}
    `,
  });
  const rootPending = SqlSchema.void({
    Request: Schema.Struct({ threadId: ThreadId, lineRootCommitId: MercurianCommitId }),
    execute: ({ threadId, lineRootCommitId }) => sql`
      UPDATE line_runtimes
      SET line_root_commit_id = ${lineRootCommitId}, fork_parent_commit_id = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE thread_id = ${threadId} AND line_root_commit_id IS NULL
    `,
  });
  const deleteRepositoriesByThread = SqlSchema.void({
    Request: ThreadRequest,
    execute: ({ threadId }) =>
      sql`DELETE FROM line_runtime_repositories WHERE thread_id = ${threadId}`,
  });
  const deleteRuntimeByThread = SqlSchema.void({
    Request: ThreadRequest,
    execute: ({ threadId }) => sql`DELETE FROM line_runtimes WHERE thread_id = ${threadId}`,
  });
  const snapshot = SqlSchema.void({
    Request: SnapshotRequest,
    execute: ({ threadId, snapshotOid, kind, departedRef, branchMovement }) => sql`
      UPDATE line_runtimes SET snapshot_oid = ${snapshotOid}, snapshot_kind = ${kind},
        departed_ref = ${departedRef}, branch_movement = ${encodeBranchMovement(branchMovement)},
        updated_at = CURRENT_TIMESTAMP WHERE thread_id = ${threadId}
    `,
  });
  const repositorySnapshot = SqlSchema.void({
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
      INSERT INTO line_runtime_repositories
        (thread_id, repository_id, snapshot_oid, snapshot_kind, branch_tip_oid, departed_ref, branch_movement)
      VALUES (${threadId}, ${repositoryId}, ${snapshotOid}, ${kind}, ${branchTipOid}, ${departedRef},
        ${encodeBranchMovement(branchMovement)})
      ON CONFLICT(thread_id, repository_id) DO UPDATE SET snapshot_oid = excluded.snapshot_oid,
        snapshot_kind = excluded.snapshot_kind, branch_tip_oid = excluded.branch_tip_oid,
        departed_ref = excluded.departed_ref, branch_movement = excluded.branch_movement
    `,
  });
  const missing = SqlSchema.void({
    Request: MissingRequest,
    execute: ({ threadId, oid }) => sql`
      UPDATE line_runtimes SET line_branch_missing_oid = ${oid}, updated_at = CURRENT_TIMESTAMP
      WHERE thread_id = ${threadId}
    `,
  });
  const attachPr = SqlSchema.void({
    Request: AttachPullRequestInput,
    execute: ({ threadId, repositoryId, prUrl }) => sql`
      INSERT INTO line_runtime_repositories (thread_id, repository_id, pr_url)
      VALUES (${threadId}, ${repositoryId}, ${prUrl})
      ON CONFLICT(thread_id, repository_id) DO UPDATE SET pr_url = excluded.pr_url
    `,
  });
  const recordPrState = SqlSchema.void({
    Request: PullRequestStateRequest,
    execute: ({ threadId, state }) => sql`
      UPDATE line_runtimes SET pr_state = ${state}, updated_at = CURRENT_TIMESTAMP
      WHERE thread_id = ${threadId}
    `,
  });
  const recordMergedHome = SqlSchema.void({
    Request: MemoryMergedHomeRequest,
    execute: ({ threadId, mergedAt }) => sql`
      UPDATE line_runtimes SET memory_merged_home_at = ${mergedAt},
        updated_at = CURRENT_TIMESTAMP WHERE thread_id = ${threadId}
    `,
  });
  const mapError = <A, E, R>(effect: Effect.Effect<A, E, R>, operation: string) =>
    effect.pipe(Effect.mapError(toStoreError(operation)));
  const hydrate = (row: typeof LineRuntimeRow.Type) => {
    const { forkParentCommitId, ...record } = row;
    const normalized: LineRuntimeRecord = {
      ...record,
      ...(forkParentCommitId === null ? {} : { forkParentCommitId }),
    };
    return mapError(
      listRepositories({ threadId: record.threadId }),
      "LineRuntimeStore.repositories",
    ).pipe(
      Effect.map((repositories) => ({
        ...normalized,
        ...(repositories.length === 0 ? {} : { repositories }),
      })),
    );
  };
  const hydrateOption = (record: Option.Option<typeof LineRuntimeRow.Type>) =>
    Option.isNone(record)
      ? Effect.succeed(Option.none<LineRuntimeRecord>())
      : hydrate(record.value).pipe(Effect.map(Option.some));
  const announceThread = Effect.fn("LineRuntimeStore.announceThread")(function* (
    threadId: ThreadId,
    memory = true,
  ) {
    const record = yield* findThread({ threadId });
    if (Option.isSome(record)) {
      yield* PubSub.publish(changesPubSub, record.value.planId);
      if (memory)
        yield* PubSub.publish(memoryChanges, {
          planId: record.value.planId,
          threadId,
          lineRootCommitId: record.value.lineRootCommitId,
        });
    }
  });

  return LineRuntimeStore.of({
    getOrNone: (planId, lineRootCommitId) =>
      mapError(findLine({ planId, lineRootCommitId }), "LineRuntimeStore.getOrNone").pipe(
        Effect.flatMap(hydrateOption),
      ),
    getByThreadId: (threadId) =>
      mapError(findThread({ threadId }), "LineRuntimeStore.getByThreadId").pipe(
        Effect.flatMap(hydrateOption),
      ),
    listByPlan: (planId) =>
      mapError(listPlan({ planId }), "LineRuntimeStore.listByPlan").pipe(
        Effect.flatMap((records) => Effect.forEach(records, hydrate)),
      ),
    getByBranch: (branch) =>
      mapError(findBranch({ branch }), "LineRuntimeStore.getByBranch").pipe(
        Effect.flatMap(hydrateOption),
      ),
    create: (input) =>
      mapError(
        sql
          .withTransaction(
            Effect.gen(function* () {
              const createdAt = DateTime.formatIso(input.createdAt);
              yield* sql`
              INSERT INTO line_runtimes (
                plan_id, line_root_commit_id, fork_parent_commit_id, thread_id,
                home_repository_id, branch, worktree_path,
                unreachable_repositories_json, created_at, updated_at
              ) VALUES (${input.planId}, ${input.lineRootCommitId}, ${input.forkParentCommitId ?? null},
                ${input.threadId},
                ${input.homeRepositoryId}, ${input.branch}, ${input.worktreePath},
                ${encodeUnreachableRepositories(input.unreachableRepositories)}, ${createdAt}, ${createdAt})
            `;
              yield* Effect.forEach(
                input.repositoryIds,
                (repositoryId) => sql`
                INSERT OR IGNORE INTO line_runtime_repositories (thread_id, repository_id)
                VALUES (${input.threadId}, ${repositoryId})
              `,
                { discard: true },
              );
            }),
          )
          .pipe(Effect.andThen(announceThread(input.threadId)), Effect.asVoid),
        "LineRuntimeStore.create",
      ),
    rootPending: (threadId, lineRootCommitId) =>
      mapError(
        rootPending({ threadId, lineRootCommitId }).pipe(Effect.andThen(announceThread(threadId))),
        "LineRuntimeStore.rootPending",
      ),
    deleteByThread: (threadId) =>
      mapError(
        sql.withTransaction(
          deleteRepositoriesByThread({ threadId }).pipe(
            Effect.andThen(deleteRuntimeByThread({ threadId })),
          ),
        ),
        "LineRuntimeStore.deleteByThread",
      ),
    updateWorkspace: (threadId, input) =>
      mapError(
        updateWorkspace({ threadId, ...input }).pipe(Effect.andThen(announceThread(threadId))),
        "LineRuntimeStore.updateWorkspace",
      ),
    recordSnapshot: (threadId, input) =>
      mapError(
        snapshot({ threadId, ...input }).pipe(Effect.andThen(announceThread(threadId))),
        "LineRuntimeStore.recordSnapshot",
      ),
    recordRepositorySnapshot: (threadId, repositoryId, input) =>
      mapError(
        repositorySnapshot({ threadId, repositoryId, ...input }).pipe(
          Effect.andThen(announceThread(threadId)),
        ),
        "LineRuntimeStore.recordRepositorySnapshot",
      ),
    recordLineBranchMissing: (threadId, oid) =>
      mapError(
        missing({ threadId, oid }).pipe(Effect.andThen(announceThread(threadId))),
        "LineRuntimeStore.recordLineBranchMissing",
      ),
    attachPullRequest: (input) =>
      mapError(
        attachPr(input).pipe(Effect.andThen(announceThread(input.threadId, false))),
        "LineRuntimeStore.attachPullRequest",
      ),
    recordPullRequestState: (threadId, state) =>
      mapError(
        recordPrState({ threadId, state }).pipe(Effect.andThen(announceThread(threadId, false))),
        "LineRuntimeStore.recordPullRequestState",
      ),
    recordMemoryMergedHome: (threadId, mergedAt) =>
      mapError(
        recordMergedHome({ threadId, mergedAt }).pipe(Effect.andThen(announceThread(threadId))),
        "LineRuntimeStore.recordMemoryMergedHome",
      ),
    memoryChanges: Stream.fromPubSub(memoryChanges),
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  });
});

export const layer = Layer.effect(LineRuntimeStore, make);
