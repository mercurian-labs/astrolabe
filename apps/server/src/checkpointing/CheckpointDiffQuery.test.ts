import {
  CheckpointRef,
  MercurianCommitId,
  MercurianRepositoryId,
  PlanId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import { describe, expect } from "vite-plus/test";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { chainParentRef, checkpointRefForThreadTurn } from "./Utils.ts";
import * as CheckpointDiffQuery from "./CheckpointDiffQuery.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import { CheckpointRefUnavailableError, CheckpointThreadNotFoundError } from "./Errors.ts";
import * as CodingSessionStore from "../mercurian/codingSessions/CodingSessionStore.ts";
import * as LineBranchStore from "../mercurian/commitTree/LineBranchStore.ts";
import * as RepositoryStore from "../mercurian/repositories/RepositoryStore.ts";

const lineDiffDependencies = Layer.mergeAll(
  Layer.mock(CodingSessionStore.CodingSessionStore)({
    getByThreadId: () => Effect.succeed(Option.none()),
  }),
  Layer.mock(LineBranchStore.LineBranchStore)({ listAll: Effect.succeed([]) }),
  Layer.mock(RepositoryStore.RepositoryStore)({
    getSnapshot: Effect.succeed({ repositories: [], projectRepositories: [] }),
  }),
);

function makeThreadCheckpointContext(input: {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
}): ProjectionSnapshotQuery.ProjectionThreadCheckpointContext {
  return {
    threadId: input.threadId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    worktreePath: input.worktreePath,
    checkpoints: [
      {
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: input.checkpointTurnCount,
        checkpointRef: input.checkpointRef,
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

describe("CheckpointDiffQuery.layer", () => {
  it.effect("diffs the line branch to its latest snapshot", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-line-diff");
      const repositoryId = MercurianRepositoryId.make("repository-line-diff");
      const lineRootCommitId = MercurianCommitId.make("line-root");
      const calls: Array<{
        readonly cwd: string;
        readonly from: string;
        readonly to: string;
        readonly ignoreWhitespace: boolean;
      }> = [];
      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({})),
        Layer.provideMerge(
          Layer.mock(CodingSessionStore.CodingSessionStore)({
            getByThreadId: () =>
              Effect.succeed(
                Option.some({
                  commitId: MercurianCommitId.make("session"),
                  planId: PlanId.make("plan"),
                  repositoryId,
                  threadId,
                  branch: "mercurian/line",
                  worktreePath: "/tmp/line",
                  baseRef: "main",
                  startedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                  endedAt: null,
                  outcome: null,
                  prUrl: null,
                  settledCommitOid: null,
                  partial: false,
                  snapshotOid: "snapshot",
                  snapshotKind: "settled",
                  departedRef: null,
                  branchMovement: { kind: "unchanged" },
                  lineBranchMissingOid: null,
                }),
              ),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(LineBranchStore.LineBranchStore)({
            listAll: Effect.succeed([
              {
                lineRootCommitId,
                repositoryId,
                branch: "mercurian/line",
                baseOid: "base",
                built: true,
                repointHold: null,
                createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
              },
            ]),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(RepositoryStore.RepositoryStore)({
            getSnapshot: Effect.succeed({
              repositories: [
                {
                  repositoryId,
                  name: "repository",
                  path: "/repositories/line",
                  scripts: [],
                  hasGit: true,
                  hosting: null,
                  createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                  updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                },
              ],
              projectRepositories: [],
            }),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(CheckpointStore.CheckpointStore)({
            diffCheckpoints: ({ cwd, fromCheckpointRef, toCheckpointRef, ignoreWhitespace }) =>
              Effect.sync(() => {
                calls.push({ cwd, from: fromCheckpointRef, to: toCheckpointRef, ignoreWhitespace });
                return "line patch";
              }),
          }),
        ),
      );
      const result = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getLineUncommittedDiff({ threadId });
      }).pipe(Effect.provide(layer));
      expect(result.diff).toBe("line patch");
      expect(calls).toEqual([
        {
          cwd: "/repositories/line",
          from: "refs/heads/mercurian/line",
          to: "refs/t3/lines/bGluZS1yb290/snapshot",
          ignoreWhitespace: false,
        },
      ]);
    }),
  );

  it.effect("fails typed when the session branch has no line-branch row", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-missing-line");
      const repositoryId = MercurianRepositoryId.make("repository-missing-line");
      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({})),
        Layer.provideMerge(
          Layer.mock(CodingSessionStore.CodingSessionStore)({
            getByThreadId: () =>
              Effect.succeed(
                Option.some({
                  commitId: MercurianCommitId.make("session"),
                  planId: PlanId.make("plan"),
                  repositoryId,
                  threadId,
                  branch: "mercurian/missing",
                  worktreePath: "/stale/slot/path",
                  baseRef: "main",
                  startedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                  endedAt: null,
                  outcome: null,
                  prUrl: null,
                  settledCommitOid: null,
                  partial: false,
                  snapshotOid: "snapshot",
                  snapshotKind: "settled",
                  departedRef: null,
                  branchMovement: { kind: "unchanged" },
                  lineBranchMissingOid: null,
                }),
              ),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(LineBranchStore.LineBranchStore)({ listAll: Effect.succeed([]) }),
        ),
        Layer.provideMerge(
          Layer.mock(RepositoryStore.RepositoryStore)({
            getSnapshot: Effect.die("repository lookup must follow the line lookup"),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(CheckpointStore.CheckpointStore)({
            diffCheckpoints: () => Effect.die("diff must not run without a line"),
          }),
        ),
      );

      const error = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getLineUncommittedDiff({ threadId });
      }).pipe(Effect.provide(layer), Effect.flip);

      expect(error).toBeInstanceOf(CheckpointRefUnavailableError);
      expect(error).toMatchObject({
        operation: "CheckpointDiffQuery.getLineUncommittedDiff",
        threadId,
      });
    }),
  );

  it.effect("uses the narrow full-thread context lookup for all-turns diffs", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-full-thread");
      const threadId = ThreadId.make("thread-full-thread");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 4);
      let getThreadCheckpointContextCalls = 0;
      let getFullThreadDiffContextCalls = 0;
      const diffCheckpointsCalls: Array<{
        readonly fromCheckpointRef: CheckpointRef;
        readonly toCheckpointRef: CheckpointRef;
        readonly cwd: string;
        readonly ignoreWhitespace: boolean;
      }> = [];

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, ignoreWhitespace }) =>
          Effect.sync(() => {
            diffCheckpointsCalls.push({
              fromCheckpointRef,
              toCheckpointRef,
              cwd,
              ignoreWhitespace,
            });
            return "full thread diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(lineDiffDependencies),
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () =>
              Effect.sync(() => {
                getThreadCheckpointContextCalls += 1;
                return Option.none();
              }),
            getFullThreadDiffContext: () =>
              Effect.sync(() => {
                getFullThreadDiffContextCalls += 1;
                return Option.some({
                  threadId,
                  projectId,
                  workspaceRoot: "/tmp/workspace",
                  worktreePath: "/tmp/worktree",
                  latestCheckpointTurnCount: 4,
                  toCheckpointRef,
                });
              }),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getFullThreadDiff({
          threadId,
          toTurnCount: 4,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer));

      expect(getThreadCheckpointContextCalls).toBe(0);
      expect(getFullThreadDiffContextCalls).toBe(1);
      expect(diffCheckpointsCalls).toEqual([
        {
          cwd: "/tmp/worktree",
          fromCheckpointRef: checkpointRefForThreadTurn(threadId, 0),
          toCheckpointRef,
          ignoreWhitespace: true,
        },
      ]);
      expect(result).toEqual({
        threadId,
        fromTurnCount: 0,
        toTurnCount: 4,
        diff: "full thread diff patch",
      });
    }),
  );

  it.effect("uses the chain parent when both snapshot parents resolve", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-1");
      const threadId = ThreadId.make("thread-1");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      const diffCheckpointsCalls: Array<{
        readonly fromCheckpointRef: CheckpointRef;
        readonly toCheckpointRef: CheckpointRef;
        readonly cwd: string;
        readonly ignoreWhitespace: boolean;
      }> = [];

      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/tmp/workspace",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, ignoreWhitespace }) =>
          Effect.sync(() => {
            diffCheckpointsCalls.push({
              fromCheckpointRef,
              toCheckpointRef,
              cwd,
              ignoreWhitespace,
            });
            return "diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(lineDiffDependencies),
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer));

      const expectedFromRef = chainParentRef(toCheckpointRef);
      expect(diffCheckpointsCalls).toEqual([
        {
          cwd: "/tmp/workspace",
          fromCheckpointRef: expectedFromRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        },
      ]);
      expect(result).toEqual({
        threadId,
        fromTurnCount: 0,
        toTurnCount: 1,
        diff: "diff patch",
      });
    }),
  );

  it.effect("defaults to hide whitespace changes", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-default-whitespace");
      const threadId = ThreadId.make("thread-default-whitespace");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      const diffCheckpointsCalls: Array<{ readonly ignoreWhitespace: boolean }> = [];

      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/tmp/workspace",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ ignoreWhitespace }) =>
          Effect.sync(() => {
            diffCheckpointsCalls.push({ ignoreWhitespace });
            return "diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(lineDiffDependencies),
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer));

      expect(diffCheckpointsCalls).toEqual([{ ignoreWhitespace: true }]);
    }),
  );

  it.effect("does not use a root snapshot's sole HEAD parent as the chain diff base", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-no-preflight");
      const threadId = ThreadId.make("thread-no-preflight");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      let hasCheckpointRefCallCount = 0;
      let diffFromRef: CheckpointRef | undefined;

      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/tmp/workspace",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: ({ checkpointRef }) =>
          Effect.sync(() => {
            hasCheckpointRefCallCount += 1;
            return checkpointRef.endsWith("^1");
          }),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ fromCheckpointRef }) =>
          Effect.sync(() => {
            diffFromRef = fromCheckpointRef;
            return "diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(lineDiffDependencies),
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer));

      expect(hasCheckpointRefCallCount).toBe(2);
      expect(diffFromRef).toBe(checkpointRefForThreadTurn(threadId, 0));
    }),
  );

  it.effect("fails when the thread is missing from the snapshot", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-missing");

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: () => Effect.succeed(""),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(lineDiffDependencies),
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.none()),
            getFullThreadDiffContext: () => Effect.succeed(Option.none()),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      const error = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer), Effect.flip);

      expect(error).toBeInstanceOf(CheckpointThreadNotFoundError);
      expect(error).toMatchObject({
        operation: "CheckpointDiffQuery.getTurnDiff",
        threadId,
      });
      expect(error.message).toBe(
        "Checkpoint invariant violation in CheckpointDiffQuery.getTurnDiff: Thread 'thread-missing' not found.",
      );
    }),
  );
});
