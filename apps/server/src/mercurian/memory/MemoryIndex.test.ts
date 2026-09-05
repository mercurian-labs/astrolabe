import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { make as makeExitGate } from "./MemoryRepositoryExitGate.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import * as MemoryDashboard from "./MemoryDashboard.ts";
import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isProductMapAlreadyExistsError,
  MercurianProjectId,
  MercurianRepositoryId,
  MercurianCommitId,
  PlanId,
  PlanTurnId,
  ThreadId,
  ProjectId,
  TurnId,
  MessageId,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";

import * as ProcessRunner from "../../processRunner.ts";
import { ServerConfig } from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as MemoryIndex from "./MemoryIndex.ts";
import * as MemorySourceStore from "./MemorySourceStore.ts";
import * as MemoryReviewStore from "./MemoryReviewStore.ts";
import * as LegacySessionStore from "../lineRuntimes/LegacySessionStore.ts";
import * as LineRuntimeStore from "../lineRuntimes/LineRuntimeStore.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as PlanTurnRegistry from "../planning/PlanTurnRegistry.ts";
import * as LineBranchStore from "../commitTree/LineBranchStore.ts";
import { CommitId } from "../commitTree/schema.ts";
import * as SlotStore from "../worktreeSlots/SlotStore.ts";
import * as SlotRegistry from "../worktreeSlots/SlotRegistry.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import {
  lineSnapshotRef,
  make as makeSnapshotChain,
  SnapshotChain,
} from "../worktreeSlots/SnapshotChain.ts";
import { WorktreeSlotId } from "../worktreeSlots/schema.ts";

const gitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "memory-index-test-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServicesLayer),
);
const defaultLineServices = Layer.mergeAll(
  Layer.mock(ProjectionSnapshotQuery)({
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
  }),
  PlanTurnRegistry.layer,
  SlotRegistry.layer,
  Layer.mock(LineRuntimeStore.LineRuntimeStore)({
    getByThreadId: () => Effect.succeed(Option.none()),
  }),
  Layer.mock(LegacySessionStore.LegacySessionStore)({
    getByThreadId: () => Effect.succeed(Option.none()),
  }),
  Layer.mock(PlanningStore.PlanningStore)({
    getPlanSnapshot: () => Effect.die("No line is configured for this memory-index test"),
  }),
  Layer.mock(LineBranchStore.LineBranchStore)({
    get: () => Effect.succeed(Option.none()),
  }),
  Layer.mock(SlotStore.SlotStore)({ list: () => Effect.succeed([]) }),
  Layer.mock(CheckpointStore.CheckpointStore)({
    diffCheckpoints: () => Effect.succeed(""),
  }),
  Layer.mock(MemoryReviewStore.MemoryReviewStore)({
    listReviewed: () => Effect.succeed([]),
    markReviewed: () => Effect.void,
    invalidate: Effect.void,
  }),
  Layer.mock(SnapshotChain)({ captureTree: () => Effect.die("not used") }),
  Layer.mock(RepositoryStore.RepositoryStore)({
    getSnapshot: Effect.succeed({ repositories: [], projectRepositories: [] }),
  }),
  Layer.mock(ServerSettings.ServerSettingsService)({
    getSettings: Effect.succeed({ newWorktreesStartFromOrigin: false } as never),
  }),
);
const layer = it.layer(
  MemoryIndex.layer.pipe(
    Layer.provideMerge(MemorySourceStore.layer.pipe(Layer.provide(gitLayer))),
    Layer.provideMerge(defaultLineServices),
    Layer.provideMerge(gitLayer),
    Layer.provideMerge(MercurianSqlite.layerMemory),
    Layer.provideMerge(ProcessRunner.layer),
    Layer.provideMerge(NodeServicesLayer),
  ),
);
const now = DateTime.makeUnsafe("2026-08-27T00:00:00.000Z");

const runGit = Effect.fn("test.runGit")(function* (cwd: string, args: ReadonlyArray<string>) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const result = yield* runner.run({ command: "git", args: ["-C", cwd, ...args] });
  assert.strictEqual(result.code, 0, result.stderr);
  return result.stdout.trim();
});

const makeFixture = Effect.fn("test.makeMemoryFixture")(function* (
  suffix: string,
  options: { readonly git?: boolean } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: `mercurian-memory-${suffix}-` });
  if (options.git === true) {
    yield* runGit(root, ["init"]);
    yield* runGit(root, ["config", "user.name", "Memory Test"]);
    yield* runGit(root, ["config", "user.email", "memory@example.com"]);
  }
  const repositoryId = MercurianRepositoryId.make(`memory-index-${suffix}`);
  const projectId = MercurianProjectId.make(`memory-index-project-${suffix}`);
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO repositories (repository_id, name, path, created_at, updated_at)
    VALUES (${repositoryId}, ${suffix}, ${root}, '2026-08-27', '2026-08-27')
  `;
  const store = yield* MemorySourceStore.MemorySourceStore;
  yield* store.designate({ projectId, repositoryId, now });
  return { root, projectId, repositoryId };
});

const lineRoot = MercurianCommitId.make("memory-line-root");
const linePlan = PlanId.make("memory-line-plan");
const lineThread = ThreadId.make("memory-line-thread");
const lineTurn = PlanTurnId.make("memory-line-turn");
const lineSessionCommit = MercurianCommitId.make("memory-line-session");
const lineSessionThread = ThreadId.make("memory-line-session-thread");
const lineRef = { planId: linePlan, commitId: lineRoot } as const;

const mergeTimeline = (createdAt: DateTime.Utc) =>
  [
    {
      _tag: "plan-revision",
      commitId: lineRoot,
      parents: [],
      sequence: 1,
      createdAt,
      authorKind: "human",
      text: "",
    },
    {
      _tag: "coding-session",
      commitId: lineSessionCommit,
      parents: [lineRoot],
      sequence: 2,
      createdAt,
      authorKind: "human",
      planRevisionCommitId: lineRoot,
    },
  ] as const;

function lineServices(
  fixture: {
    readonly root: string;
    readonly projectId: MercurianProjectId;
    readonly repositoryId: MercurianRepositoryId;
  },
  input: {
    readonly branch: string;
    readonly baseOid: string;
    readonly checkpoints?: ReadonlyArray<OrchestrationCheckpointSummary>;
    readonly slotPath?: string;
    readonly slotProjectId?: MercurianProjectId;
    readonly appended?: Array<unknown>;
    readonly timeline?: ReadonlyArray<unknown>;
    readonly requestedLineRoots?: Array<MercurianCommitId>;
    readonly turns?: PlanTurnRegistry.PlanTurnRegistry["Service"];
    readonly leases?: SlotRegistry.SlotRegistry["Service"];
    readonly reviewed?: Set<string>;
    readonly reviewStore?: MemoryReviewStore.MemoryReviewStore["Service"];
    readonly beforeCapture?: Effect.Effect<void, import("@t3tools/contracts").GitCommandError>;
    readonly captureTree?: SnapshotChain["Service"]["captureTree"];
    readonly sessions?: ReadonlyArray<{
      readonly commitId: MercurianCommitId;
      readonly threadId: ThreadId;
    }>;
    readonly runtimes?: ReadonlyArray<{ readonly threadId: ThreadId }>;
    readonly recordedMergedHome?: Array<ThreadId>;
    readonly memoryRepositoryLinked?: boolean;
    readonly gitVersion?: { readonly major: number; readonly minor: number };
    readonly startFromOrigin?: boolean;
    readonly missingBranch?: boolean;
  },
) {
  const createdAt = DateTime.makeUnsafe("2026-09-04T00:00:00.000Z");
  const runtimeRecords = (input.runtimes ?? []).map(({ threadId }) => ({
    planId: linePlan,
    lineRootCommitId: lineRoot,
    threadId,
    homeRepositoryId: fixture.repositoryId,
    branch: input.branch,
    worktreePath: input.slotPath ?? fixture.root,
    unreachableRepositories: [],
    snapshotOid: null,
    snapshotKind: null,
    departedRef: null,
    branchMovement: null,
    lineBranchMissingOid: null,
    prState: null,
    memoryMergedHomeAt: null,
    createdAt,
    updatedAt: createdAt,
  }));
  const configuredSlots =
    input.slotPath === undefined
      ? []
      : [
          {
            slotId: WorktreeSlotId.make("memory-slot"),
            projectId: input.slotProjectId ?? fixture.projectId,
            path: input.slotPath,
            currentLineRootCommitId: lineRoot,
            members: [
              {
                repositoryId: fixture.repositoryId,
                relativePath: ".",
                currentBranch: input.branch,
              },
            ],
            createdAt,
            lastUsedAt: createdAt,
          },
        ];
  return Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadCheckpointContext: (threadId) =>
        Effect.succeed(
          Option.some({
            threadId,
            projectId: ProjectId.make("memory-test"),
            workspaceRoot: fixture.root,
            worktreePath: null,
            checkpoints: input.checkpoints ?? [],
          }),
        ),
    }),
    input.turns === undefined
      ? PlanTurnRegistry.layer
      : Layer.succeed(PlanTurnRegistry.PlanTurnRegistry, input.turns),
    input.leases === undefined
      ? SlotRegistry.layer
      : Layer.succeed(SlotRegistry.SlotRegistry, input.leases),
    Layer.mock(LineRuntimeStore.LineRuntimeStore)({
      getByThreadId: (threadId) =>
        Effect.succeed(
          Option.fromNullishOr(runtimeRecords.find((runtime) => runtime.threadId === threadId)),
        ),
      recordMemoryMergedHome: (threadId) =>
        Effect.sync(() => input.recordedMergedHome?.push(threadId)),
    }),
    Layer.mock(LegacySessionStore.LegacySessionStore)({
      getByThreadId: () => Effect.succeed(Option.none()),
      recordMemoryMergedHome: (threadId) =>
        Effect.sync(() => input.recordedMergedHome?.push(threadId)),
    }),
    Layer.mock(PlanningStore.PlanningStore)({
      getPlanSnapshot: () =>
        Effect.succeed({
          plan: { planId: linePlan, projectId: fixture.projectId, title: "Memory line" },
          planText: "",
          spec: null,
          timeline: input.timeline ?? [
            {
              _tag: "plan-revision",
              commitId: lineRoot,
              parents: [],
              sequence: 1,
              createdAt,
              authorKind: "human",
              text: "",
            },
          ],
          snapshotSequence: 1,
          codingSessions: input.sessions ?? [],
          lineRuntimes: runtimeRecords,
        } as never),
      appendMemoryAmendment: (appendInput) =>
        Effect.sync(() => {
          input.appended?.push(appendInput);
          return {
            _tag: "message",
            commitId: MercurianCommitId.make("memory-amendment-plan-commit"),
          } as never;
        }),
    }),
    Layer.mock(LineBranchStore.LineBranchStore)({
      get: ({ lineRootCommitId }) =>
        Effect.sync(() => {
          input.requestedLineRoots?.push(lineRootCommitId);
          return input.missingBranch === true
            ? Option.none()
            : Option.some({
                lineRootCommitId,
                repositoryId: fixture.repositoryId,
                branch: input.branch,
                baseOid: input.baseOid,
                built: true,
                repointHold: null,
                createdAt,
              });
        }),
    }),
    Layer.mock(SlotStore.SlotStore)({
      list: () => Effect.succeed(configuredSlots),
      listAll: Effect.succeed(configuredSlots),
    }),
    Layer.mock(CheckpointStore.CheckpointStore)({
      restoreCheckpoint: (i) =>
        runGit(i.cwd, ["read-tree", "--reset", "-u", String(i.checkpointRef)]).pipe(
          Effect.asVoid,
        ) as never,
      diffCheckpoints: (diffInput) =>
        Effect.gen(function* () {
          const driver = yield* GitVcsDriver.makeVcsDriverShape();
          return yield* driver.checkpoints.diffCheckpoints(diffInput);
        }) as never,
    }),
    input.reviewStore
      ? Layer.succeed(MemoryReviewStore.MemoryReviewStore, input.reviewStore)
      : Layer.mock(MemoryReviewStore.MemoryReviewStore)({
          invalidate: Effect.void,
          listReviewed: () =>
            Effect.sync(() =>
              [...(input.reviewed ?? [])].map((commitOid) => ({
                lineRootCommitId: lineRoot,
                repositoryId: fixture.repositoryId,
                commitOid,
                reviewedAt: createdAt,
              })),
            ),
          markReviewed: ({ commitOid }) => Effect.sync(() => input.reviewed?.add(commitOid)),
        }),
    Layer.mock(SnapshotChain)({
      captureTree: input.captureTree ?? (() => Effect.die("not used")),
    }),
    Layer.mock(RepositoryStore.RepositoryStore)({
      getSnapshot: Effect.succeed({
        repositories: [],
        projectRepositories:
          input.memoryRepositoryLinked === true
            ? [{ projectId: fixture.projectId, repositoryId: fixture.repositoryId }]
            : [],
      }),
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed({
        newWorktreesStartFromOrigin: input.startFromOrigin ?? false,
      } as never),
    }),
  );
}

const makeLineIndex = Effect.fn("test.makeLineMemoryIndex")(function* (
  fixture: Parameters<typeof lineServices>[0],
  input: Parameters<typeof lineServices>[1],
  fileSystem?: FileSystem.FileSystem,
) {
  const fs = fileSystem ?? (yield* FileSystem.FileSystem);
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const sourceStore = yield* MemorySourceStore.MemorySourceStore;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const effectiveGit =
    input.gitVersion === undefined
      ? git
      : GitVcsDriver.GitVcsDriver.of({
          ...git,
          gitVersion: Effect.succeed(input.gitVersion),
        });
  const turns = yield* PlanTurnRegistry.make;
  const leases = yield* SlotRegistry.make;
  const configured = { ...input, reviewed: input.reviewed ?? new Set<string>(), turns, leases };
  const chain = yield* makeSnapshotChain.pipe(
    Effect.provide(lineServices(fixture, configured)),
    Effect.provideService(GitVcsDriver.GitVcsDriver, effectiveGit),
  );
  configured.captureTree ??= (i) =>
    (input.beforeCapture ?? Effect.void).pipe(Effect.andThen(chain.captureTree(i)));
  const index = yield* MemoryIndex.make.pipe(
    Effect.provide(lineServices(fixture, configured)),
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
    Effect.provideService(ProcessRunner.ProcessRunner, runner),
    Effect.provideService(MemorySourceStore.MemorySourceStore, sourceStore),
    Effect.provideService(GitVcsDriver.GitVcsDriver, effectiveGit),
  );
  const dashboard = yield* MemoryDashboard.make.pipe(
    Effect.provide(lineServices(fixture, configured)),
    Effect.provideService(MemoryIndex.MemoryIndex, index),
    Effect.provideService(GitVcsDriver.GitVcsDriver, effectiveGit),
  );
  return { index, turns, leases, dashboard, chain };
});

const curationVersion = Effect.fn("test.curationVersion")(function* (
  dashboard: MemoryDashboard.MemoryDashboard["Service"],
  projectId: MercurianProjectId,
) {
  const current = yield* dashboard.readDashboard({
    projectId,
    line: lineRef,
    position: { kind: "latest" },
  });
  assert(current.kind === "available");
  return current.curationVersion;
});

const reviewAndMerge = Effect.fn("test.reviewAndMerge")(function* (
  index: MemoryIndex.MemoryIndex["Service"],
  projectId: MercurianProjectId,
) {
  const input = { projectId, line: lineRef };
  const prepared = yield* index.mergeHome(input);
  assert.strictEqual(prepared.kind, "review-required");
  if (prepared.kind !== "review-required") return prepared;
  for (const commitOid of prepared.review.unreviewedIds)
    yield* index.markChangeReviewed({ ...input, commitOid });
  const reviewed = yield* index.mergeHome(input);
  assert.strictEqual(reviewed.kind, "review-required");
  if (reviewed.kind !== "review-required") return reviewed;
  return yield* index.mergeHome({
    ...input,
    expectedVersion: reviewed.review.version,
    reviewedUnmarkedId: reviewed.review.unmarkedId,
  });
});

layer("MemoryIndex", (it) => {
  it.effect("resolves an explicit planning commit to its own line", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("explicit-plan-line", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, "Plans.md"), "Main\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* runGit(fixture.root, ["branch", "memory-line"]);
      const firstChild = MercurianCommitId.make("memory-first-child");
      const forkRoot = MercurianCommitId.make("memory-fork-root");
      const requestedLineRoots: Array<MercurianCommitId> = [];
      const createdAt = DateTime.makeUnsafe("2026-09-04T00:00:00.000Z");
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        requestedLineRoots,
        timeline: [
          {
            _tag: "plan-revision",
            commitId: lineRoot,
            parents: [],
            sequence: 1,
            createdAt,
            authorKind: "human",
            text: "",
          },
          {
            _tag: "message",
            commitId: firstChild,
            parents: [lineRoot],
            sequence: 2,
            createdAt,
            authorKind: "human",
            text: "First line",
          },
          {
            _tag: "message",
            commitId: forkRoot,
            parents: [lineRoot],
            sequence: 3,
            createdAt,
            authorKind: "human",
            text: "Fork line",
          },
        ],
      });

      yield* index.resolveLineSource({
        projectId: fixture.projectId,
        line: { planId: linePlan, commitId: firstChild },
      });
      assert.deepStrictEqual(requestedLineRoots, [lineRoot]);
    }),
  );

  it.effect("resolves a unified runtime thread through its current line ownership", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fixture = yield* makeFixture("runtime-thread-line", { git: true });
      yield* fs.writeFileString(`${fixture.root}/Plans.md`, "Main\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* runGit(fixture.root, ["branch", "memory-line"]);
      const requestedLineRoots: Array<MercurianCommitId> = [];
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        requestedLineRoots,
        runtimes: [{ threadId: lineThread }],
      });

      const note = yield* index.readNote(fixture.projectId, "Plans", { threadId: lineThread });

      assert.strictEqual(note.markdown, "Main\n");
      assert.deepStrictEqual(requestedLineRoots, [lineRoot]);
    }),
  );

  it.effect(
    "resolves immutable line trees without letting an older capture hide later amendments",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeFixture("ref-reads", { git: true });
        const notePath = path.join(fixture.root, "Plans.md");
        yield* fs.writeFileString(notePath, "Main\n");
        yield* runGit(fixture.root, ["add", "Plans.md"]);
        yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
        const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
        yield* runGit(fixture.root, ["checkout", "-b", "memory-line"]);
        yield* fs.writeFileString(notePath, "Branch one\n");
        yield* runGit(fixture.root, ["commit", "-am", "Branch one"]);

        const { index } = yield* makeLineIndex(fixture, { branch: "memory-line", baseOid });
        const first = yield* index.readNote(fixture.projectId, "Plans", lineRef);
        assert.strictEqual(first.markdown, "Branch one\n");
        yield* fs.writeFileString(notePath, "Branch two\n");
        yield* runGit(fixture.root, ["commit", "-am", "Branch two"]);
        const second = yield* index.readNote(fixture.projectId, "Plans", lineRef);
        assert.strictEqual(second.markdown, "Branch two\n");

        const captured = yield* runGit(fixture.root, [
          "commit-tree",
          `${baseOid}^{tree}`,
          "-p",
          baseOid,
          "-m",
          "t3 snapshot kind=settled",
        ]);
        yield* runGit(fixture.root, ["update-ref", String(lineSnapshotRef(lineRoot)), captured]);
        const chain = yield* index.readNote(fixture.projectId, "Plans", lineRef);
        assert.strictEqual(chain.markdown, "Branch two\n");
      }),
  );

  it.effect("refuses an unminted line while preserving explicit global reads", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("unminted-line-read", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, "Plans.md"), "Main\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      yield* runGit(fixture.root, ["branch", "-M", "main"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "main"]);
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        missingBranch: true,
      });

      for (const read of [
        index.readLineChanges({ projectId: fixture.projectId, line: lineRef }).pipe(Effect.asVoid),
        index.readNote(fixture.projectId, "Plans", lineRef).pipe(Effect.asVoid),
        index.readIndex(fixture.projectId, lineRef).pipe(Effect.asVoid),
      ]) {
        const failure = yield* read.pipe(Effect.flip);
        assert.equal(failure._tag, "MemoryReadUnavailableError");
        assert("reason" in failure && failure.reason === "line-missing");
      }
      const note = yield* index.readNote(fixture.projectId, "Plans");
      assert.strictEqual(note.markdown, "Main\n");
    }),
  );

  it.effect(
    "shares latest and explicit historical positions across index, notes, changes and dashboard",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* makeFixture("shared-position", { git: true });
        yield* fs.writeFileString(`${fixture.root}/Plans.md`, "Before\n");
        yield* runGit(fixture.root, ["add", "."]);
        yield* runGit(fixture.root, ["commit", "-m", "Base"]);
        const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
        yield* runGit(fixture.root, ["checkout", "-b", "memory-line"]);
        yield* fs.writeFileString(`${fixture.root}/Loose.md`, "Unmarked\n");
        yield* runGit(fixture.root, ["add", "."]);
        const tree = yield* runGit(fixture.root, ["write-tree"]);
        const ref = checkpointRefForThreadTurn(lineThread, 1);
        const snapshot = yield* runGit(fixture.root, [
          "commit-tree",
          tree,
          "-p",
          baseOid,
          "-m",
          `t3 snapshot kind=settled ref=${ref}`,
        ]);
        yield* runGit(fixture.root, ["update-ref", ref, snapshot]);
        yield* runGit(fixture.root, ["update-ref", lineSnapshotRef(lineRoot), snapshot]);
        yield* runGit(fixture.root, ["reset", "HEAD"]);
        yield* fs.writeFileString(`${fixture.root}/Plans.md`, "After amendment\n");
        yield* fs.writeFileString(`${fixture.root}/Later.md`, "New after capture\n");
        yield* runGit(fixture.root, ["add", "Plans.md", "Later.md"]);
        yield* runGit(fixture.root, [
          "commit",
          "-m",
          "Marked\n\nAstrolabe-Amendment: after-capture",
        ]);
        const { index, dashboard } = yield* makeLineIndex(fixture, {
          branch: "memory-line",
          baseOid,
          runtimes: [{ threadId: lineThread }],
          checkpoints: [
            {
              turnId: TurnId.make("captured"),
              checkpointTurnCount: 1,
              checkpointRef: ref,
              status: "ready",
              files: [],
              assistantMessageId: MessageId.make("captured-reply"),
              completedAt: "2026-09-04T00:00:00Z",
            },
          ],
        });
        const overview = yield* dashboard.readDashboard({
          projectId: fixture.projectId,
          line: lineRef,
          position: { kind: "latest" },
        });
        assert(overview.kind === "available");
        const latest = yield* index.readNote(fixture.projectId, "Plans", lineRef);
        assert.equal(latest.markdown, "After amendment\n");
        assert.equal(
          (yield* runGit(fixture.root, ["show", `${overview.position.treeOid}:Plans.md`])) + "\n",
          latest.markdown,
        );
        assert.deepEqual(
          (yield* index.readIndex(fixture.projectId, lineRef)).notes.map((n) => n.name),
          ["Later", "Loose", "Plans"],
        );
        const at = { kind: "turn" as const, threadId: lineThread, turnCount: 1 };
        assert.equal(
          (yield* index.readNote(fixture.projectId, "Plans", lineRef, at)).markdown,
          "Before\n",
        );
        assert.equal(
          (yield* index.readNote(fixture.projectId, "Later", lineRef, at)).exists,
          false,
        );
        assert.deepEqual(
          (yield* index.readIndex(fixture.projectId, lineRef, at)).notes.map((n) => n.name),
          ["Loose", "Plans"],
        );
        const changes = yield* index.readLineChanges({
          projectId: fixture.projectId,
          line: lineRef,
          position: at,
        });
        assert.deepEqual(changes.marked, []);
        assert(changes.unmarked?.diff.includes("Unmarked"));
        const currentChanges = yield* index.readLineChanges({
          projectId: fixture.projectId,
          line: lineRef,
        });
        assert.equal(currentChanges.marked.length, 1);
        assert(!currentChanges.unmarked?.diff.includes("After amendment"));
        yield* runGit(fixture.root, ["update-ref", "-d", ref]);
        const missing = yield* index
          .readNote(fixture.projectId, "Later", lineRef, at)
          .pipe(Effect.flip);
        assert.equal(missing._tag, "MemoryReadUnavailableError");
        assert("reason" in missing && missing.reason === "object-missing");
        const noLine = yield* index
          .readNote(fixture.projectId, "Plans", undefined, at)
          .pipe(Effect.flip);
        assert.equal(noLine._tag, "MemoryReadUnavailableError");
        const sources = yield* MemorySourceStore.MemorySourceStore;
        yield* sources.remove(fixture.projectId);
        assert.deepEqual(
          yield* dashboard.readDashboard({
            projectId: fixture.projectId,
            line: lineRef,
            position: { kind: "latest" },
          }),
          { kind: "unavailable", reason: "not-designated" },
        );
        assert.equal(
          (yield* index.readIndex(fixture.projectId).pipe(Effect.flip))._tag,
          "MemoryNotDesignatedError",
        );
      }).pipe(Effect.scoped),
  );

  it.effect("lands a marked amendment in the held line member and leaves main untouched", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("land", { git: true });
      const mainNote = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(mainNote, "Main\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      const slotPath = yield* fs.makeTempDirectoryScoped({ prefix: "memory-slot-" });
      yield* fs.remove(slotPath, { recursive: true });
      yield* runGit(fixture.root, ["worktree", "add", "-b", "memory-line", slotPath, "HEAD"]);
      const appended: Array<unknown> = [];
      const { index, turns, leases } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        slotPath,
        appended,
      });
      yield* turns.open({
        planId: linePlan,
        turnId: lineTurn,
        threadId: lineThread,
        parentCommitId: CommitId.make(lineRoot),
        tipCommitId: CommitId.make(lineRoot),
      });
      yield* leases.acquire(
        WorktreeSlotId.make("memory-slot"),
        { kind: "turn", threadId: lineThread },
        "2026-09-04T00:00:00.000Z",
      );
      const result = yield* index.landAmendment({
        projectId: fixture.projectId,
        threadId: lineThread,
        turnId: lineTurn,
        amendment: {
          title: "Record the line truth",
          notes: [{ name: "Plans", markdown: "Line\n" }],
          placements: [],
        },
      });
      assert.strictEqual(result.branch, "memory-line");
      assert.strictEqual(yield* fs.readFileString(mainNote), "Main\n");
      assert.strictEqual(yield* fs.readFileString(path.join(slotPath, "Plans.md")), "Line\n");
      assert.include(
        yield* runGit(slotPath, ["log", "-1", "--pretty=%B"]),
        `Astrolabe-Amendment: ${lineTurn}`,
      );
      assert.strictEqual(appended.length, 1);
    }),
  );

  it.effect("refuses an amendment when memory changes after its before-read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("stale-amendment", { git: true });
      const notePath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(notePath, "Main\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      const slotPath = yield* fs.makeTempDirectoryScoped({ prefix: "memory-stale-slot-" });
      yield* fs.remove(slotPath, { recursive: true });
      yield* runGit(fixture.root, ["worktree", "add", "-b", "memory-line", slotPath, "HEAD"]);
      const slotNotePath = path.join(slotPath, "Plans.md");
      let changed = false;
      const swappingFileSystem = FileSystem.FileSystem.of({
        ...fs,
        readFileString: (file, options) =>
          fs.readFileString(file, options).pipe(
            Effect.tap(() => {
              if (changed || file !== slotNotePath) return Effect.void;
              changed = true;
              return fs.writeFileString(slotNotePath, "Concurrent\n");
            }),
          ),
      });
      const {
        index: racyIndex,
        turns,
        leases,
      } = yield* makeLineIndex(
        fixture,
        {
          branch: "memory-line",
          baseOid,
          slotPath,
        },
        swappingFileSystem,
      );
      yield* turns.open({
        planId: linePlan,
        turnId: lineTurn,
        threadId: lineThread,
        parentCommitId: CommitId.make(lineRoot),
        tipCommitId: CommitId.make(lineRoot),
      });
      yield* leases.acquire(
        WorktreeSlotId.make("memory-slot"),
        { kind: "turn", threadId: lineThread },
        "2026-09-04T00:00:00.000Z",
      );
      const error = yield* Effect.flip(
        racyIndex.landAmendment({
          projectId: fixture.projectId,
          threadId: lineThread,
          turnId: lineTurn,
          amendment: {
            title: "Stale truth",
            notes: [{ name: "Plans", markdown: "Line\n" }],
            placements: [],
          },
        }),
      );
      assert.strictEqual(error._tag, "MemoryAmendmentValidationError");
      if (error._tag === "MemoryAmendmentValidationError") {
        assert.strictEqual(error.reason, "memory-changed");
      }
      assert.strictEqual(yield* fs.readFileString(slotNotePath), "Concurrent\n");
      assert.strictEqual(yield* runGit(slotPath, ["rev-parse", "HEAD"]), baseOid);
    }),
  );

  it.effect("lists marked, hand-written, and unmarked line memory changes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("line-changes", { git: true });
      const notePath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(notePath, "Base\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* runGit(fixture.root, ["checkout", "-b", "memory-line"]);
      yield* fs.writeFileString(notePath, "Marked\n");
      yield* runGit(fixture.root, [
        "commit",
        "-am",
        `Marked truth\n\nAstrolabe-Amendment: ${lineTurn}`,
      ]);
      const markedOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* fs.writeFileString(notePath, "Hand\n");
      yield* runGit(fixture.root, ["commit", "-am", "Hand edit"]);
      const branchTip = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* fs.writeFileString(notePath, "Snapshot-only\n");
      yield* runGit(fixture.root, ["commit", "-am", "Snapshot-only edit"]);
      const snapshotOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* runGit(fixture.root, ["reset", "--hard", branchTip]);
      yield* runGit(fixture.root, ["update-ref", String(lineSnapshotRef(lineRoot)), snapshotOid]);
      const reviewed = new Set([markedOid]);
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        reviewed,
      });
      const changed = yield* index.readLineChanges({ projectId: fixture.projectId, line: lineRef });
      assert.strictEqual(changed.marked.length, 1);
      assert.strictEqual(changed.marked[0]?.turnId, lineTurn);
      assert.isTrue(changed.marked[0]?.reviewed);
      assert.include(changed.marked[0]?.diff ?? "", "Plans.md");
      assert.strictEqual(changed.hand.length, 1);
      assert.strictEqual(changed.hand[0]?.title, "Hand edit");
      assert.isFalse(changed.hand[0]?.reviewed);
      assert.include(changed.unmarked?.diff ?? "", "Snapshot-only");
      assert.strictEqual(changed.unreviewedCount, 2);

      const cleanSnapshot = yield* runGit(fixture.root, [
        "commit-tree",
        `${branchTip}^{tree}`,
        "-p",
        branchTip,
        "-m",
        "Clean snapshot",
      ]);
      yield* runGit(fixture.root, ["update-ref", String(lineSnapshotRef(lineRoot)), cleanSnapshot]);
      const clean = yield* index.readLineChanges({ projectId: fixture.projectId, line: lineRef });
      assert.strictEqual(clean.unmarked, null);
      assert.strictEqual(clean.unreviewedCount, 1);
    }),
  );

  it.effect("reverts a marked commit on the line and refreshes its member", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("revert-marked", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, "Plans.md"), "Base\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      const slotPath = yield* fs.makeTempDirectoryScoped({ prefix: "memory-revert-slot-" });
      yield* fs.remove(slotPath, { recursive: true });
      yield* runGit(fixture.root, ["worktree", "add", "-b", "memory-line", slotPath, "HEAD"]);
      yield* fs.writeFileString(path.join(slotPath, "Plans.md"), "Changed\n");
      yield* fs.writeFileString(path.join(slotPath, "Added.md"), "Added\n");
      yield* runGit(slotPath, ["add", "Plans.md", "Added.md"]);
      yield* runGit(slotPath, [
        "commit",
        "-m",
        `Change memory\n\nAstrolabe-Amendment: ${lineTurn}`,
      ]);
      const changedOid = yield* runGit(slotPath, ["rev-parse", "HEAD"]);
      const reviewed = new Set<string>();
      const { index, dashboard } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        slotPath,
        reviewed,
      });

      yield* index.revertChange({
        expectedVersion: yield* curationVersion(dashboard, fixture.projectId),
        projectId: fixture.projectId,
        line: lineRef,
        target: { kind: "commit", commitOid: changedOid },
      });

      const revertedOid = yield* runGit(fixture.root, ["rev-parse", "refs/heads/memory-line"]);
      assert.notStrictEqual(revertedOid, changedOid);
      assert.strictEqual(
        yield* runGit(fixture.root, ["rev-parse", `${revertedOid}^1`]),
        changedOid,
      );
      assert.include(
        yield* runGit(fixture.root, ["show", "-s", "--format=%B", revertedOid]),
        `Astrolabe-Amendment: revert:${changedOid}`,
      );
      assert.strictEqual(
        yield* runGit(fixture.root, ["show", "-s", "--format=%s", revertedOid]),
        "Reverted: Change memory",
      );
      assert.strictEqual(yield* fs.readFileString(path.join(slotPath, "Plans.md")), "Base\n");
      assert.isFalse(yield* fs.exists(path.join(slotPath, "Added.md")));
      assert.strictEqual(yield* runGit(slotPath, ["status", "--porcelain"]), "");
      assert.strictEqual(yield* fs.readFileString(path.join(fixture.root, "Plans.md")), "Base\n");
      assert.isTrue(reviewed.has(revertedOid));
    }),
  );

  it.effect("refuses a commit outside the line's post-base range", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("revert-outside-line", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, "Plans.md"), "Base\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* runGit(fixture.root, ["branch", "memory-line"]);
      yield* fs.writeFileString(path.join(fixture.root, "Plans.md"), "Main only\n");
      yield* runGit(fixture.root, ["commit", "-am", "Main-only change"]);
      const unrelatedOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      const { index, dashboard } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
      });

      for (const commitOid of [baseOid, unrelatedOid]) {
        const error = yield* Effect.flip(
          index.revertChange({
            expectedVersion: yield* curationVersion(dashboard, fixture.projectId),
            projectId: fixture.projectId,
            line: lineRef,
            target: { kind: "commit", commitOid },
          }),
        );
        assert.strictEqual(error._tag, "MemoryReviewBlockedError");
        if (error._tag === "MemoryReviewBlockedError") {
          assert.strictEqual(error.reason, "not-on-line");
        }
      }
      assert.strictEqual(
        yield* runGit(fixture.root, ["rev-parse", "refs/heads/memory-line"]),
        baseOid,
      );
    }),
  );

  it.effect("reverts unmarked memory with a curated snapshot", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const fixture = yield* makeFixture("revert-unmarked", { git: true });
      yield* fs.makeDirectory(path.join(fixture.root, "memory"));
      yield* fs.writeFileString(path.join(fixture.root, "memory", "Plans.md"), "Branch\n");
      yield* fs.writeFileString(path.join(fixture.root, "Outside.txt"), "Outside base\n");
      const sourceStore = yield* MemorySourceStore.MemorySourceStore;
      yield* sourceStore.designate({
        projectId: fixture.projectId,
        repositoryId: fixture.repositoryId,
        subpath: "memory",
        now,
      });
      yield* runGit(fixture.root, ["add", "memory/Plans.md", "Outside.txt"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      const slotPath = yield* fs.makeTempDirectoryScoped({ prefix: "memory-curated-slot-" });
      yield* fs.remove(slotPath, { recursive: true });
      yield* runGit(fixture.root, ["worktree", "add", "-b", "memory-line", slotPath, "HEAD"]);
      yield* fs.writeFileString(path.join(slotPath, "memory", "Plans.md"), "Snapshot only\n");
      yield* fs.writeFileString(path.join(slotPath, "Outside.txt"), "Outside snapshot\n");
      yield* runGit(slotPath, [
        "commit",
        "-am",
        `t3 snapshot kind=curated ref=${lineSnapshotRef(lineRoot).replace(/\/snapshot$/u, "/snapshots/test")}`,
      ]);
      const previousSnapshot = yield* runGit(slotPath, ["rev-parse", "HEAD"]);
      yield* runGit(slotPath, ["reset", "--hard", baseOid]);
      yield* runGit(fixture.root, [
        "update-ref",
        String(lineSnapshotRef(lineRoot)),
        previousSnapshot,
      ]);
      yield* fs.writeFileString(
        path.join(slotPath, "memory", "Later.md"),
        "Later committed note\n",
      );
      yield* runGit(slotPath, ["add", "memory/Later.md"]);
      yield* runGit(slotPath, ["commit", "-m", "Later independent amendment"]);
      const laterHead = yield* runGit(slotPath, ["rev-parse", "HEAD"]);
      yield* fs.writeFileString(path.join(slotPath, "memory", "Plans.md"), "Snapshot only\n");
      yield* fs.writeFileString(path.join(slotPath, "Outside.txt"), "Outside snapshot\n");
      const services = lineServices(fixture, { branch: "memory-line", baseOid, slotPath });
      const chain = yield* makeSnapshotChain.pipe(
        Effect.provide(services),
        Effect.provideService(GitVcsDriver.GitVcsDriver, git),
      );
      const { index, dashboard } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        slotPath,
        captureTree: chain.captureTree,
      });

      const prepared = yield* index.mergeHome({ projectId: fixture.projectId, line: lineRef });
      assert.strictEqual(prepared.kind, "review-required");
      if (prepared.kind !== "review-required") return;
      yield* index.revertChange({
        expectedVersion: yield* curationVersion(dashboard, fixture.projectId),
        projectId: fixture.projectId,
        line: lineRef,
        target: { kind: "unmarked" },
      });

      const curated = yield* runGit(fixture.root, ["rev-parse", String(lineSnapshotRef(lineRoot))]);
      assert.strictEqual(
        yield* runGit(fixture.root, ["rev-parse", `${curated}^1`]),
        previousSnapshot,
      );
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", `${curated}^2`]), laterHead);
      assert.include(
        yield* runGit(fixture.root, ["show", "-s", "--format=%s", curated]),
        "kind=curated",
      );
      assert.strictEqual(
        yield* runGit(fixture.root, ["show", `${curated}:memory/Plans.md`]),
        "Branch",
      );
      assert.strictEqual(
        yield* runGit(fixture.root, ["show", `${curated}:Outside.txt`]),
        "Outside snapshot",
      );
      assert.strictEqual(
        (yield* index.readNote(fixture.projectId, "Later", lineRef)).markdown,
        "Later committed note\n",
      );
      assert.strictEqual(
        yield* fs.readFileString(path.join(slotPath, "memory", "Plans.md")),
        "Branch\n",
      );
      const changes = yield* index.readLineChanges({ projectId: fixture.projectId, line: lineRef });
      assert.strictEqual(changes.unmarked, null);
    }),
  );

  it.effect("refuses revert while a turn holds the line's slot", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("revert-active", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, "Plans.md"), "Base\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      const { index, leases, dashboard } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        slotPath: fixture.root,
      });
      yield* runGit(fixture.root, ["branch", "memory-line"]);
      yield* leases.acquire(
        WorktreeSlotId.make("memory-slot"),
        { kind: "turn", threadId: lineThread },
        "2026-09-04T00:00:00.000Z",
      );
      const error = yield* Effect.flip(
        index.revertChange({
          expectedVersion: yield* curationVersion(dashboard, fixture.projectId),
          projectId: fixture.projectId,
          line: lineRef,
          target: { kind: "unmarked" },
        }),
      );
      assert.strictEqual(error._tag, "MemoryReviewBlockedError");
      if (error._tag === "MemoryReviewBlockedError")
        assert.strictEqual(error.reason, "turn-active");
    }),
  );

  it.effect("ignores a line commit made after a clean snapshot when merging home", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("merge-home-post-snapshot", { git: true });
      const notePath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(notePath, "Base\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      yield* runGit(fixture.root, ["branch", "-M", "main"]);
      const mainBefore = yield* runGit(fixture.root, ["rev-parse", "main"]);
      yield* runGit(fixture.root, ["checkout", "-b", "memory-line"]);
      const snapshotOid = yield* runGit(fixture.root, [
        "commit-tree",
        `${mainBefore}^{tree}`,
        "-p",
        mainBefore,
        "-m",
        "Clean snapshot",
      ]);
      yield* runGit(fixture.root, ["update-ref", String(lineSnapshotRef(lineRoot)), snapshotOid]);
      yield* fs.writeFileString(notePath, "Post-snapshot amendment\n");
      yield* runGit(fixture.root, [
        "commit",
        "-am",
        `Post-snapshot memory\n\nAstrolabe-Amendment: ${lineTurn}`,
      ]);
      const lineTip = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* runGit(fixture.root, ["checkout", "main"]);
      const { index, dashboard } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid: mainBefore,
      });

      const changes = yield* index.readLineChanges({
        projectId: fixture.projectId,
        line: lineRef,
      });
      assert.strictEqual(changes.unmarked, null);

      yield* index.revertChange({
        expectedVersion: yield* curationVersion(dashboard, fixture.projectId),
        projectId: fixture.projectId,
        line: lineRef,
        target: { kind: "unmarked" },
      });
      assert.strictEqual(
        yield* runGit(fixture.root, ["rev-parse", String(lineSnapshotRef(lineRoot))]),
        snapshotOid,
      );
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "memory-line"]), lineTip);

      const result = yield* reviewAndMerge(index, fixture.projectId);
      assert.strictEqual(result.kind, "merged");
      if (result.kind !== "merged") return;
      assert.deepStrictEqual(
        (yield* runGit(fixture.root, ["show", "-s", "--format=%P", result.commitOid])).split(" "),
        [mainBefore, lineTip],
      );
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "memory-line"]), lineTip);
      assert.notStrictEqual(
        yield* runGit(fixture.root, ["show", "-s", "--format=%s", lineTip]),
        "Unmarked memory changes",
      );
      assert.strictEqual(yield* fs.readFileString(notePath), "Post-snapshot amendment\n");
    }),
  );

  it.effect("lands unmarked memory, merges it home, and refreshes the clean checkout", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("merge-home-clean", { git: true });
      const notePath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(notePath, "Base\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      yield* runGit(fixture.root, ["branch", "-M", "main"]);
      const mainBefore = yield* runGit(fixture.root, ["rev-parse", "main"]);
      yield* runGit(fixture.root, ["checkout", "-b", "memory-line"]);
      yield* fs.writeFileString(notePath, "Marked\n");
      yield* runGit(fixture.root, [
        "commit",
        "-am",
        `Marked memory\n\nAstrolabe-Amendment: ${lineTurn}`,
      ]);
      const markedTip = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* fs.writeFileString(notePath, "Snapshot only\n");
      yield* runGit(fixture.root, [
        "commit",
        "-am",
        `t3 snapshot kind=curated ref=${lineSnapshotRef(lineRoot).replace(/\/snapshot$/u, "/snapshots/test")}`,
      ]);
      const snapshotOid = yield* runGit(fixture.root, ["rev-parse", "HEAD"]);
      yield* runGit(fixture.root, ["reset", "--hard", markedTip]);
      yield* runGit(fixture.root, ["update-ref", String(lineSnapshotRef(lineRoot)), snapshotOid]);
      yield* runGit(fixture.root, ["checkout", "main"]);
      const reviewed = new Set<string>();
      const recordedMergedHome: Array<ThreadId> = [];
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid: mainBefore,
        reviewed,
        recordedMergedHome,
        runtimes: [{ threadId: lineSessionThread }],
      });

      const result = yield* reviewAndMerge(index, fixture.projectId);
      assert.strictEqual(result.kind, "merged");
      if (result.kind !== "merged") return;
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "main"]), result.commitOid);
      assert.deepStrictEqual(
        (yield* runGit(fixture.root, ["show", "-s", "--format=%P", result.commitOid])).split(" "),
        [mainBefore, yield* runGit(fixture.root, ["rev-parse", "memory-line"])],
      );
      const landed = yield* runGit(fixture.root, ["rev-parse", "memory-line"]);
      assert.strictEqual(
        yield* runGit(fixture.root, ["show", "-s", "--format=%s", landed]),
        "Unmarked memory changes",
      );
      assert.include(
        yield* runGit(fixture.root, ["show", "-s", "--format=%B", landed]),
        "Astrolabe-Amendment: unmarked",
      );
      assert.isTrue(reviewed.has(landed));
      assert.strictEqual(yield* fs.readFileString(notePath), "Snapshot only\n");
      assert.deepStrictEqual(recordedMergedHome, [lineSessionThread]);
    }),
  );

  it.effect("refuses a dirty designated checkout before moving main", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("merge-home-dirty", { git: true });
      const notePath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(notePath, "Base\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      yield* runGit(fixture.root, ["branch", "-M", "main"]);
      const mainBefore = yield* runGit(fixture.root, ["rev-parse", "main"]);
      yield* runGit(fixture.root, ["branch", "memory-line"]);
      yield* fs.writeFileString(notePath, "Dirty\n");
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid: mainBefore,
      });

      const error = yield* Effect.flip(
        index.mergeHome({ projectId: fixture.projectId, line: lineRef }),
      );
      assert.strictEqual(error._tag, "MergeMemoryHomeBlockedError");
      if (error._tag === "MergeMemoryHomeBlockedError") {
        assert.strictEqual(error.reason, "checkout-dirty");
      }
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "main"]), mainBefore);
    }),
  );

  it.effect("merges onto local main when it is ahead of origin", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("merge-home-local-main", { git: true });
      const remote = yield* fs.makeTempDirectoryScoped({ prefix: "memory-index-origin-" });
      const notePath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(notePath, "Base\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      yield* runGit(fixture.root, ["branch", "-M", "main"]);
      yield* runGit(remote, ["init", "--bare"]);
      yield* runGit(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
      yield* runGit(fixture.root, ["remote", "add", "origin", remote]);
      yield* runGit(fixture.root, ["push", "-u", "origin", "main"]);
      yield* runGit(fixture.root, ["remote", "set-head", "origin", "main"]);
      const originMain = yield* runGit(fixture.root, ["rev-parse", "origin/main"]);

      yield* fs.writeFileString(path.join(fixture.root, "Local.md"), "Local main\n");
      yield* runGit(fixture.root, ["add", "Local.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Local main"]);
      const localMain = yield* runGit(fixture.root, ["rev-parse", "main"]);
      yield* runGit(fixture.root, ["checkout", "-b", "memory-line", "origin/main"]);
      yield* fs.writeFileString(notePath, "Line memory\n");
      yield* runGit(fixture.root, ["commit", "-am", "Line memory"]);
      const lineTip = yield* runGit(fixture.root, ["rev-parse", "memory-line"]);
      yield* runGit(fixture.root, ["checkout", "main"]);
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid: originMain,
        startFromOrigin: true,
      });

      const result = yield* reviewAndMerge(index, fixture.projectId);
      assert.strictEqual(result.kind, "merged");
      if (result.kind !== "merged") return;
      assert.deepStrictEqual(
        (yield* runGit(fixture.root, ["show", "-s", "--format=%P", result.commitOid])).split(" "),
        [localMain, lineTip],
      );
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "origin/main"]), originMain);
    }),
  );

  it.effect("returns conflicting memory paths without moving main", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("merge-home-conflict", { git: true });
      const notePath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(notePath, "Base\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      yield* runGit(fixture.root, ["branch", "-M", "main"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "main"]);
      yield* runGit(fixture.root, ["checkout", "-b", "memory-line"]);
      yield* fs.writeFileString(notePath, "Line\n");
      yield* runGit(fixture.root, ["commit", "-am", "Line memory"]);
      yield* runGit(fixture.root, ["checkout", "main"]);
      yield* fs.writeFileString(notePath, "Main\n");
      yield* runGit(fixture.root, ["commit", "-am", "Main memory"]);
      const mainBefore = yield* runGit(fixture.root, ["rev-parse", "main"]);
      const { index } = yield* makeLineIndex(fixture, { branch: "memory-line", baseOid });

      const result = yield* reviewAndMerge(index, fixture.projectId);
      assert.deepStrictEqual(result, { kind: "conflict", conflicts: [{ path: "Plans.md" }] });
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "main"]), mainBefore);
    }),
  );

  it.effect("approves subpath memory for repository exit without recording merged-home", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture("merge-home-subpath", { git: true });
      yield* fs.makeDirectory(path.join(fixture.root, "memory"));
      yield* fs.writeFileString(path.join(fixture.root, "memory", "Plans.md"), "Base\n");
      const sourceStore = yield* MemorySourceStore.MemorySourceStore;
      yield* sourceStore.designate({
        projectId: fixture.projectId,
        repositoryId: fixture.repositoryId,
        subpath: "memory",
        now,
      });
      yield* runGit(fixture.root, ["add", "."]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      yield* runGit(fixture.root, ["branch", "-M", "main"]);
      const mainBefore = yield* runGit(fixture.root, ["rev-parse", "main"]);
      yield* runGit(fixture.root, ["branch", "memory-line"]);
      const recordedMergedHome: Array<ThreadId> = [];
      const createdAt = DateTime.makeUnsafe("2026-09-04T00:00:00.000Z");
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid: mainBefore,
        recordedMergedHome,
        sessions: [{ commitId: lineSessionCommit, threadId: lineSessionThread }],
        timeline: mergeTimeline(createdAt),
      });

      assert.deepStrictEqual(yield* reviewAndMerge(index, fixture.projectId), {
        kind: "deferred-to-push",
      });
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "main"]), mainBefore);
      assert.deepStrictEqual(recordedMergedHome, []);
    }),
  );

  it.effect("refuses Git below 2.38 and a line with an active turn", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture("merge-home-refusals", { git: true });
      yield* runGit(fixture.root, ["commit", "--allow-empty", "-m", "Seed"]);
      yield* runGit(fixture.root, ["branch", "-M", "main"]);
      const baseOid = yield* runGit(fixture.root, ["rev-parse", "main"]);
      yield* runGit(fixture.root, ["branch", "memory-line"]);
      const old = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        gitVersion: { major: 2, minor: 37 },
      });
      const oldError = yield* Effect.flip(
        old.index.mergeHome({ projectId: fixture.projectId, line: lineRef }),
      );
      assert.strictEqual(oldError._tag, "MergeMemoryHomeBlockedError");
      if (oldError._tag === "MergeMemoryHomeBlockedError") {
        assert.strictEqual(oldError.reason, "git-too-old");
      }

      const active = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        slotPath: fixture.root,
      });
      yield* active.leases.acquire(
        WorktreeSlotId.make("memory-slot"),
        { kind: "turn", threadId: lineThread },
        "2026-09-04T00:00:00.000Z",
      );
      const activeError = yield* Effect.flip(
        active.index.mergeHome({ projectId: fixture.projectId, line: lineRef }),
      );
      assert.strictEqual(activeError._tag, "MemoryReviewBlockedError");
      if (activeError._tag === "MemoryReviewBlockedError") {
        assert.strictEqual(activeError.reason, "turn-active");
      }
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "main"]), baseOid);
    }),
  );
  it.effect("uses git discovery so the memory's gitignore governs", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("gitignore", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, ".gitignore"), "logseq/\n");
      yield* fs.writeFileString(path.join(fixture.root, "Visible.md"), "visible");
      yield* fs.makeDirectory(path.join(fixture.root, "logseq"));
      yield* fs.writeFileString(path.join(fixture.root, "logseq", "Ignored.md"), "ignored");

      const result = yield* index.readIndex(fixture.projectId);
      assert.deepStrictEqual(
        result.notes.map(({ name }) => name),
        ["Visible"],
      );
    }),
  );

  it.effect("classifies skill maps before notes and surfaces legacy YAML maps as refusals", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("walk");
      yield* fs.writeFileString(path.join(fixture.root, "Visible.md"), "visible");
      yield* fs.makeDirectory(path.join(fixture.root, ".private"));
      yield* fs.writeFileString(path.join(fixture.root, ".private", "Hidden.md"), "hidden");
      yield* fs.makeDirectory(path.join(fixture.root, "maps"));
      yield* fs.writeFileString(path.join(fixture.root, "maps", "NotANote.md"), "map");
      yield* fs.writeFileString(
        path.join(fixture.root, "Product.skillmap.md"),
        "---\nname: Product\npurpose: Structure\ntypes:\n  contains: Child territory.\nedges: []\n---\nTeaching.\n",
      );
      yield* fs.writeFileString(
        path.join(fixture.root, "maps", "old.yaml"),
        "name: Old\npurpose: Old shape\narrangement: []\n",
      );

      const result = yield* index.readIndex(fixture.projectId);
      assert.deepStrictEqual(
        result.notes.map(({ name }) => name),
        ["Visible"],
      );
      assert.strictEqual(result.maps.length, 2);
      assert.deepStrictEqual(
        result.maps.find((map) => !("refusal" in map)),
        {
          file: "Product.skillmap.md",
          name: "Product",
          purpose: "Structure",
          types: [{ name: "contains", meaning: "Child territory." }],
          edges: [],
          body: "Teaching.\n",
        },
      );
      const legacy = result.maps.find((map) => "refusal" in map);
      assert.include(
        legacy !== undefined && "refusal" in legacy ? legacy.refusal : "",
        "maps/old.yaml: superseded tree-YAML map — rewrite it as a .skillmap.md skill map",
      );
    }),
  );

  it.effect("reflects an external edit on the next read and reads red links", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("freshness");
      const plansPath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(plansPath, "No links.");
      assert.deepStrictEqual((yield* index.readIndex(fixture.projectId)).unresolved, []);

      yield* fs.writeFileString(plansPath, "Now links to [[Future Design]].");
      assert.deepStrictEqual((yield* index.readIndex(fixture.projectId)).unresolved, [
        { name: "Future Design", referencedBy: ["Plans"] },
      ]);
      const unwritten = yield* index.readNote(fixture.projectId, "Future Design");
      assert.strictEqual(unwritten.exists, false);
      assert.deepStrictEqual(unwritten.backlinks, ["Plans"]);
      const plans = yield* index.readNote(fixture.projectId, "Plans");
      assert.strictEqual(plans.exists, true);
      assert.deepStrictEqual(plans.links, [{ name: "Future Design", exists: false }]);
    }),
  );

  it.effect("writes and commits a generated product map, then refuses replacement", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("generate", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, "Product.md"), "contains:: [[Composer]]\n");
      yield* fs.writeFileString(path.join(fixture.root, "Composer.md"), "A component.\n");
      yield* runGit(fixture.root, ["add", "Product.md", "Composer.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed memory"]);

      const offer = (yield* index.readIndex(fixture.projectId)).productMapOffer;
      assert.deepStrictEqual(offer, { declarationCount: 1 });
      yield* index.generateProductMap(fixture.projectId);
      const productPath = path.join(fixture.root, "Product.skillmap.md");
      assert.isTrue(yield* fs.exists(productPath));
      assert.include(
        yield* fs.readFileString(productPath),
        "Use this map to orient by containment",
      );
      assert.strictEqual(
        yield* runGit(fixture.root, ["log", "-1", "--pretty=%s"]),
        "Generate product map from containment declarations",
      );
      assert.deepStrictEqual((yield* index.readIndex(fixture.projectId)).productMapOffer, null);

      const error = yield* Effect.flip(index.generateProductMap(fixture.projectId));
      assert.isTrue(isProductMapAlreadyExistsError(error));
      assert.strictEqual(error.message, "Product.skillmap.md already exists");
    }),
  );

  it.effect("prepares a note edit that removes an Open Decisions heading", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("remove-open-decision-heading", { git: true });
      const notePath = path.join(fixture.root, "Plans.md");
      const before = "# Plans\n\n## Open Decisions\n\n### Which shape?\n\nStill open.\n";
      const after = "# Plans\n\n## Open Decisions\n\nNo outstanding questions.\n";
      yield* fs.writeFileString(notePath, before);
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed memory"]);

      const proposal = yield* index.prepareAmendment({
        projectId: fixture.projectId,
        turnId: PlanTurnId.make("turn-remove-open-decision-heading"),
        amendment: {
          title: "Retire the answered question",
          notes: [{ name: "Plans", markdown: after }],
          placements: [],
        },
      });

      assert.deepStrictEqual(proposal.changes, [{ path: "Plans.md", before, after }]);
      assert.include(proposal.patch, "-### Which shape?");
    }),
  );
  it.effect(
    "reviews only visible identities, is idempotent, and invalidates a changed unmarked delta",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const f = yield* makeFixture("exact-review", { git: true });
        yield* fs.writeFileString(`${f.root}/Note.md`, "base\n");
        yield* runGit(f.root, ["add", "."]);
        yield* runGit(f.root, ["commit", "-m", "base"]);
        yield* runGit(f.root, ["branch", "-M", "main"]);
        const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
        yield* runGit(f.root, ["checkout", "-b", "memory-line"]);
        yield* fs.writeFileString(`${f.root}/Note.md`, "A\n");
        yield* runGit(f.root, ["commit", "-am", "A"]);
        const amendment = yield* runGit(f.root, ["rev-parse", "HEAD"]);
        yield* fs.writeFileString(`${f.root}/Code.ts`, "not a visible memory document\n");
        yield* runGit(f.root, ["add", "Code.ts"]);
        yield* runGit(f.root, ["commit", "-m", "Code-only commit"]);
        const codeOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);

        const reviewed = new Set<string>();
        const h = yield* makeLineIndex(f, { branch: "memory-line", baseOid, reviewed });
        const input = { projectId: f.projectId, line: lineRef };
        for (const commitOid of [baseOid, "a".repeat(40), "unmarked"]) {
          const error = yield* Effect.flip(h.index.markChangeReviewed({ ...input, commitOid }));
          assert.strictEqual(error._tag, "MemoryReviewBlockedError");
        }
        yield* h.index.markChangeReviewed({ ...input, commitOid: amendment });
        yield* h.index.markChangeReviewed({ ...input, commitOid: amendment });
        assert.strictEqual(reviewed.size, 1);
        yield* h.index.markChangeReviewed({ ...input, commitOid: codeOid });
        const historical = yield* Effect.flip(
          h.index.markChangeReviewed({
            ...input,
            commitOid: amendment,
            position: { kind: "checkpoint", commitId: lineRoot },
          }),
        );
        assert.strictEqual(historical._tag, "MemoryReviewBlockedError");
        const historicalPosition = { kind: "checkpoint" as const, commitId: lineRoot };
        const historicalRevert = yield* Effect.flip(
          h.index.revertChange({
            expectedVersion: yield* curationVersion(h.dashboard, f.projectId),
            ...input,
            position: historicalPosition,
            target: { kind: "commit", commitOid: amendment },
          }),
        );
        const historicalMerge = yield* Effect.flip(
          h.index.mergeHome({ ...input, position: historicalPosition }),
        );
        assert.strictEqual(historicalRevert._tag, "MemoryReviewBlockedError");
        assert.strictEqual(historicalMerge._tag, "MemoryReviewBlockedError");
        const capture = Effect.fn(function* (text: string) {
          yield* fs.writeFileString(`${f.root}/Note.md`, text);
          yield* runGit(f.root, ["add", "."]);
          const tree = yield* runGit(f.root, ["write-tree"]);
          yield* h.chain.captureTree({
            cwd: f.root,
            lineRootCommitId: lineRoot,
            repositoryId: f.repositoryId,
            lineBranch: "memory-line",
            kind: "curated",
            treeOid: tree,
          });
        });
        yield* capture("unmarked one\n");
        const first = yield* h.dashboard.readDashboard({ ...input, position: { kind: "latest" } });
        assert.strictEqual(first.kind, "available");
        if (first.kind !== "available") return;
        const id = first.amendments.find((a) => a.kind === "unmarked")!.id;
        yield* h.index.markChangeReviewed({ ...input, commitOid: id });
        const done = yield* h.dashboard.readDashboard({ ...input, position: { kind: "latest" } });
        assert.strictEqual(done.kind === "available" && done.unreviewedCount, 0);
        yield* capture("unmarked two\n");
        const changed = yield* h.dashboard.readDashboard({
          ...input,
          position: { kind: "latest" },
        });
        assert.strictEqual(changed.kind === "available" && changed.unreviewedCount, 1);
        const stale = yield* Effect.flip(h.index.markChangeReviewed({ ...input, commitOid: id }));
        assert.strictEqual(stale._tag, "MemoryReviewBlockedError");
      }),
  );

  it.effect("inverts A while retaining B and captured independent edits in the same file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const f = yield* makeFixture("inverse-independent", { git: true });
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
      yield* fs.writeFileString(`${f.root}/Note.md`, lines.join("\n") + "\n");
      yield* runGit(f.root, ["add", "."]);
      yield* runGit(f.root, ["commit", "-m", "base"]);
      const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
      yield* runGit(f.root, ["checkout", "-b", "memory-line"]);
      lines[1] = "A";
      yield* fs.writeFileString(`${f.root}/Note.md`, lines.join("\n") + "\n");
      yield* runGit(f.root, ["commit", "-am", "A"]);
      const a = yield* runGit(f.root, ["rev-parse", "HEAD"]);
      lines[15] = "B";
      yield* fs.writeFileString(`${f.root}/Note.md`, lines.join("\n") + "\n");
      yield* runGit(f.root, ["commit", "-am", "B"]);
      const h = yield* makeLineIndex(f, { branch: "memory-line", baseOid, slotPath: f.root });
      lines[27] = "captured unmarked";
      yield* fs.writeFileString(`${f.root}/Note.md`, lines.join("\n") + "\n");
      yield* fs.writeFileString(`${f.root}/Other.md`, "unrelated captured\n");
      yield* runGit(f.root, ["add", "."]);
      const tree = yield* runGit(f.root, ["write-tree"]);
      yield* h.chain.captureTree({
        cwd: f.root,
        repositoryId: f.repositoryId,
        lineRootCommitId: lineRoot,
        lineBranch: "memory-line",
        kind: "curated",
        treeOid: tree,
      });
      yield* h.index.revertChange({
        expectedVersion: yield* curationVersion(h.dashboard, f.projectId),
        projectId: f.projectId,
        line: lineRef,
        target: { kind: "commit", commitOid: a },
      });
      lines[1] = "line 1";
      assert.strictEqual(yield* fs.readFileString(`${f.root}/Note.md`), lines.join("\n") + "\n");
      assert.strictEqual(
        (yield* h.index.readNote(f.projectId, "Note", lineRef)).markdown,
        lines.join("\n") + "\n",
      );
      assert.strictEqual(
        (yield* h.index.readNote(f.projectId, "Other", lineRef)).markdown,
        "unrelated captured\n",
      );
      const committed = yield* runGit(f.root, ["show", "HEAD:Note.md"]);
      assert.include(committed, "B");
      assert.notInclude(committed, "captured unmarked");
      const snapshot = yield* runGit(f.root, ["rev-parse", lineSnapshotRef(lineRoot)]);
      assert.strictEqual(yield* runGit(f.root, ["show", `${snapshot}:Note.md`]), lines.join("\n"));
      assert.strictEqual(
        yield* runGit(f.root, ["rev-parse", `${snapshot}^2`]),
        yield* runGit(f.root, ["rev-parse", "HEAD"]),
      );
      // This is the exact restoration used when the next slot claims the line.
      yield* runGit(f.root, ["reset", "--hard", "HEAD"]);
      yield* runGit(f.root, ["read-tree", "--reset", "-u", snapshot]);
      assert.strictEqual(yield* fs.readFileString(`${f.root}/Note.md`), lines.join("\n") + "\n");
      const d = yield* h.dashboard.readDashboard({
        projectId: f.projectId,
        line: lineRef,
        position: { kind: "latest" },
      });
      assert.isTrue(
        d.kind === "available" &&
          d.amendments.some((amendment) => amendment.revertsAmendmentId === a),
      );
    }),
  );

  it.effect("returns a typed inverse conflict without restoring the old whole file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const f = yield* makeFixture("inverse-overlap", { git: true });
      yield* fs.writeFileString(`${f.root}/Note.md`, "base\n");
      yield* runGit(f.root, ["add", "."]);
      yield* runGit(f.root, ["commit", "-m", "base"]);
      const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
      yield* runGit(f.root, ["checkout", "-b", "memory-line"]);
      yield* fs.writeFileString(`${f.root}/Note.md`, "A\n");
      yield* runGit(f.root, ["commit", "-am", "A"]);
      const a = yield* runGit(f.root, ["rev-parse", "HEAD"]);
      yield* fs.writeFileString(`${f.root}/Note.md`, "overlapping B\n");
      yield* runGit(f.root, ["commit", "-am", "B"]);
      const before = yield* runGit(f.root, ["show-ref"]);
      const h = yield* makeLineIndex(f, { branch: "memory-line", baseOid });
      const error = yield* Effect.flip(
        h.index.revertChange({
          expectedVersion: yield* curationVersion(h.dashboard, f.projectId),
          projectId: f.projectId,
          line: lineRef,
          target: { kind: "commit", commitOid: a },
        }),
      );
      assert.strictEqual(error._tag, "MemoryReviewBlockedError");
      if (error._tag === "MemoryReviewBlockedError") {
        assert.strictEqual(error.reason, "conflict");
        assert.deepStrictEqual(error.paths, ["Note.md"]);
        assert.include(error.reconciliationSeed!, a);
      }
      assert.strictEqual(yield* runGit(f.root, ["show-ref"]), before);
      assert.strictEqual(yield* fs.readFileString(`${f.root}/Note.md`), "overlapping B\n");
    }),
  );

  for (const operation of ["add", "delete", "rename"] as const)
    it.effect(`inverts ${operation} while retaining an unrelated captured note`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const f = yield* makeFixture(`inverse-${operation}`, { git: true });
        yield* fs.writeFileString(`${f.root}/Old.md`, "original note\n");
        yield* runGit(f.root, ["add", "."]);
        yield* runGit(f.root, ["commit", "-m", "base"]);
        const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
        yield* runGit(f.root, ["checkout", "-b", "memory-line"]);
        if (operation === "add") yield* fs.writeFileString(`${f.root}/New.md`, "new note\n");
        else if (operation === "delete") yield* runGit(f.root, ["rm", "Old.md"]);
        else yield* runGit(f.root, ["mv", "Old.md", "New.md"]);
        yield* runGit(f.root, ["add", "."]);
        yield* runGit(f.root, ["commit", "-m", operation]);
        const a = yield* runGit(f.root, ["rev-parse", "HEAD"]);
        const h = yield* makeLineIndex(f, { branch: "memory-line", baseOid });
        yield* fs.writeFileString(`${f.root}/Other.md`, "retain me\n");
        yield* runGit(f.root, ["add", "."]);
        yield* h.chain.captureTree({
          cwd: f.root,
          repositoryId: f.repositoryId,
          lineRootCommitId: lineRoot,
          lineBranch: "memory-line",
          kind: "curated",
          treeOid: yield* runGit(f.root, ["write-tree"]),
        });
        yield* h.index.revertChange({
          expectedVersion: yield* curationVersion(h.dashboard, f.projectId),
          projectId: f.projectId,
          line: lineRef,
          target: { kind: "commit", commitOid: a },
        });
        assert.strictEqual(
          (yield* h.index.readNote(f.projectId, "Old", lineRef)).markdown,
          "original note\n",
        );
        assert.isFalse((yield* h.index.readNote(f.projectId, "New", lineRef)).exists);
        assert.strictEqual(
          (yield* h.index.readNote(f.projectId, "Other", lineRef)).markdown,
          "retain me\n",
        );
      }),
    );

  for (const mutation of ["amendment", "home", "capture", "review"] as const)
    it.effect(
      `invalidates merge confirmation after another device's ${mutation} before any ref write`,
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const f = yield* makeFixture(`confirm-stale-${mutation}`, { git: true });
          yield* fs.writeFileString(`${f.root}/Note.md`, "base\n");
          yield* runGit(f.root, ["add", "."]);
          yield* runGit(f.root, ["commit", "-m", "base"]);
          yield* runGit(f.root, ["branch", "-M", "main"]);
          const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
          yield* runGit(f.root, ["checkout", "-b", "memory-line"]);
          yield* fs.writeFileString(`${f.root}/Note.md`, "A\n");
          yield* runGit(f.root, ["commit", "-am", "A"]);
          const reviewed = new Set<string>();
          const h = yield* makeLineIndex(f, { branch: "memory-line", baseOid, reviewed });
          const input = { projectId: f.projectId, line: lineRef };
          if (mutation !== "review")
            yield* h.index.markChangeReviewed({
              ...input,
              commitOid: yield* runGit(f.root, ["rev-parse", "HEAD"]),
            });
          yield* runGit(f.root, ["checkout", "main"]);
          const prepared = yield* h.index.mergeHome(input);
          assert.strictEqual(prepared.kind, "review-required");
          if (prepared.kind !== "review-required") return;
          if (mutation === "review")
            yield* h.index.markChangeReviewed({
              ...input,
              commitOid: yield* runGit(f.root, ["rev-parse", "memory-line"]),
            });
          else if (mutation === "capture") {
            yield* fs.writeFileString(`${f.root}/Other.md`, "new delta\n");
            yield* runGit(f.root, ["add", "."]);
            yield* h.chain.captureTree({
              cwd: f.root,
              repositoryId: f.repositoryId,
              lineRootCommitId: lineRoot,
              lineBranch: "memory-line",
              kind: "curated",
              treeOid: yield* runGit(f.root, ["write-tree"]),
            });
          } else {
            const parent =
              mutation === "home" ? baseOid : yield* runGit(f.root, ["rev-parse", "memory-line"]);
            const oid = yield* runGit(f.root, [
              "commit-tree",
              `${parent}^{tree}`,
              "-p",
              parent,
              "-m",
              "other device",
            ]);
            yield* runGit(f.root, [
              "update-ref",
              mutation === "home" ? "refs/heads/main" : "refs/heads/memory-line",
              oid,
              parent,
            ]);
          }
          yield* runGit(f.root, ["reset", "--hard", "main"]);
          const before = yield* runGit(f.root, ["show-ref"]);
          const result = yield* h.index.mergeHome({
            ...input,
            expectedVersion: prepared.review.version,
          });
          assert.strictEqual(result.kind, "review-required");
          assert.strictEqual(yield* runGit(f.root, ["show-ref"]), before);
        }),
    );

  it.effect("holds the claim exclusion through curation ref movement", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const f = yield* makeFixture("curation-claim", { git: true });
      yield* fs.writeFileString(`${f.root}/Note.md`, "base\n");
      yield* runGit(f.root, ["add", "."]);
      yield* runGit(f.root, ["commit", "-m", "base"]);
      const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
      yield* runGit(f.root, ["checkout", "-b", "memory-line"]);
      yield* fs.writeFileString(`${f.root}/Note.md`, "A\n");
      yield* runGit(f.root, ["commit", "-am", "A"]);
      const selected = yield* runGit(f.root, ["rev-parse", "HEAD"]);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const attempted = yield* Deferred.make<void>();
      const h = yield* makeLineIndex(f, {
        branch: "memory-line",
        baseOid,
        beforeCapture: Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        ),
      });
      const curation = yield* h.index
        .revertChange({
          expectedVersion: yield* curationVersion(h.dashboard, f.projectId),
          projectId: f.projectId,
          line: lineRef,
          target: { kind: "commit", commitOid: selected },
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const claim = yield* Deferred.succeed(attempted, undefined).pipe(
        Effect.andThen(
          h.leases.withProjectLock(
            f.projectId,
            Effect.gen(function* () {
              yield* h.leases.acquire(
                WorktreeSlotId.make("memory-slot"),
                { kind: "turn", threadId: lineThread },
                "2026-09-04T00:00:00Z",
              );
              return yield* runGit(f.root, ["show", "memory-line:Note.md"]);
            }),
          ),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(attempted);
      assert.strictEqual(yield* runGit(f.root, ["rev-parse", "memory-line"]), selected);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(curation);
      assert.strictEqual(yield* Fiber.join(claim), "base");
    }),
  );

  it.effect("a stale CAS cannot partially advance line, home or snapshot refs", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const f = yield* makeFixture("curation-cas", { git: true });
      yield* fs.writeFileString(`${f.root}/Note.md`, "base\n");
      yield* runGit(f.root, ["add", "."]);
      yield* runGit(f.root, ["commit", "-m", "base"]);
      yield* runGit(f.root, ["branch", "-M", "main"]);
      const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
      yield* runGit(f.root, ["checkout", "-b", "memory-line"]);
      yield* fs.writeFileString(`${f.root}/Note.md`, "A\n");
      yield* runGit(f.root, ["commit", "-am", "A"]);
      const a = yield* runGit(f.root, ["rev-parse", "HEAD"]);
      const external = yield* runGit(f.root, [
        "commit-tree",
        `${a}^{tree}`,
        "-p",
        a,
        "-m",
        "external",
      ]);
      const h = yield* makeLineIndex(f, {
        branch: "memory-line",
        baseOid,
        beforeCapture: git
          .execute({
            operation: "test.externalMutation",
            cwd: f.root,
            args: ["update-ref", "refs/heads/memory-line", external, a],
          })
          .pipe(Effect.asVoid),
      });
      yield* fs.writeFileString(`${f.root}/Unmarked.md`, "captured\n");
      yield* runGit(f.root, ["add", "."]);
      const captured = yield* h.chain.captureTree({
        cwd: f.root,
        repositoryId: f.repositoryId,
        lineRootCommitId: lineRoot,
        lineBranch: "memory-line",
        kind: "curated",
        treeOid: yield* runGit(f.root, ["write-tree"]),
      });
      yield* runGit(f.root, ["reset", "--hard", a]);
      yield* runGit(f.root, ["checkout", "main"]);
      const input = { projectId: f.projectId, line: lineRef };
      const first = yield* h.index.mergeHome(input);
      assert.strictEqual(first.kind, "review-required");
      if (first.kind !== "review-required") return;
      const refsBeforeReview = yield* runGit(f.root, ["show-ref"]);
      const unreviewed = yield* h.index.mergeHome({
        ...input,
        expectedVersion: first.review.version,
        reviewedUnmarkedId: first.review.unmarkedId,
      });
      assert.strictEqual(unreviewed.kind, "review-required");
      assert.strictEqual(yield* runGit(f.root, ["show-ref"]), refsBeforeReview);
      for (const commitOid of first.review.unreviewedIds)
        yield* h.index.markChangeReviewed({ ...input, commitOid });
      const ready = yield* h.index.mergeHome(input);
      if (ready.kind !== "review-required") return;
      const refreshed = yield* h.index.mergeHome({
        ...input,
        expectedVersion: ready.review.version,
        reviewedUnmarkedId: ready.review.unmarkedId,
      });
      assert.strictEqual(refreshed.kind, "review-required");
      assert.strictEqual(yield* runGit(f.root, ["rev-parse", "main"]), baseOid);
      assert.strictEqual(yield* runGit(f.root, ["rev-parse", "memory-line"]), external);
      assert.strictEqual(
        yield* runGit(f.root, ["rev-parse", lineSnapshotRef(lineRoot)]),
        captured.oid,
      );
      assert.strictEqual(
        (yield* runGit(f.root, [
          "for-each-ref",
          "--format=%(refname)",
          lineSnapshotRef(lineRoot).replace(/\/snapshot$/u, "/snapshots/"),
        ])).split("\n").length,
        1,
      );
    }),
  );

  it.effect(
    "matches an unavailable designated worktree from its healthy linked repository and refuses without approval",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const sql = yield* SqlClient.SqlClient;
        const f = yield* makeFixture("missing-matched", { git: true });
        yield* fs.makeDirectory(`${f.root}/memory`);
        yield* fs.writeFileString(`${f.root}/memory/Note.md`, "base\n");
        yield* runGit(f.root, ["add", "."]);
        yield* runGit(f.root, ["commit", "-m", "base"]);
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "matched-worktree-" });
        const missing = `${directory}/checkout`;
        yield* runGit(f.root, ["worktree", "add", "-b", "memory-line", missing]);
        yield* sql`UPDATE repositories SET path = ${missing} WHERE repository_id = ${f.repositoryId}`;
        const source = yield* MemorySourceStore.MemorySourceStore;
        yield* source.designate({
          projectId: f.projectId,
          repositoryId: f.repositoryId,
          subpath: "memory",
          now,
        });
        yield* fs.remove(missing, { recursive: true });
        const gate = yield* makeExitGate;
        let promoted = false;
        const result = yield* Effect.flip(
          gate.withExit(
            f.root,
            Effect.sync(() => {
              promoted = true;
            }),
          ),
        );
        assert.strictEqual(result._tag, "GitManagerError");
        assert.isFalse(promoted);
        assert.strictEqual(
          (yield* Effect.flip(gate.checkRemoteAction(f.root)))._tag,
          "GitManagerError",
        );
      }),
  );

  for (const delta of ["unrelated", "same-file", "staged-only"] as const) {
    it.effect(`refuses curation before refs move for uncaptured ${delta} slot edits`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const f = yield* makeFixture(`idle-${delta}`, { git: true });
        const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
        yield* fs.writeFileString(`${f.root}/Note.md`, lines.join("\n") + "\n");
        yield* fs.writeFileString(`${f.root}/Code.ts`, "original code\n");
        yield* runGit(f.root, ["add", "."]);
        yield* runGit(f.root, ["commit", "-m", "base"]);
        yield* runGit(f.root, ["branch", "-M", "main"]);
        const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
        const slotPath = yield* fs.makeTempDirectoryScoped({ prefix: "idle-slot-" });
        yield* fs.remove(slotPath, { recursive: true });
        yield* runGit(f.root, ["worktree", "add", "-b", "memory-line", slotPath]);
        lines[1] = "amendment A";
        yield* fs.writeFileString(`${slotPath}/Note.md`, lines.join("\n") + "\n");
        yield* runGit(slotPath, ["commit", "-am", "A"]);
        const a = yield* runGit(slotPath, ["rev-parse", "HEAD"]);
        const h = yield* makeLineIndex(f, { branch: "memory-line", baseOid, slotPath });
        yield* fs.writeFileString(`${slotPath}/Captured.md`, "captured unmarked\n");
        yield* runGit(slotPath, ["add", "."]);
        yield* h.chain.captureTree({
          cwd: slotPath,
          repositoryId: f.repositoryId,
          lineRootCommitId: lineRoot,
          lineBranch: "memory-line",
          kind: "curated",
          treeOid: yield* runGit(slotPath, ["write-tree"]),
        });
        if (delta === "same-file") {
          lines[27] = "idle editor B";
          yield* fs.writeFileString(`${slotPath}/Note.md`, lines.join("\n") + "\n");
        } else {
          yield* fs.writeFileString(`${slotPath}/Code.ts`, "idle terminal B\n");
          if (delta === "staged-only") {
            yield* runGit(slotPath, ["add", "Code.ts"]);
            yield* fs.writeFileString(`${slotPath}/Code.ts`, "original code\n");
          }
        }
        const refs = yield* runGit(f.root, ["show-ref"]);
        const indexPath = yield* runGit(slotPath, [
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "index",
        ]);
        const index = yield* fs.readFile(indexPath);
        const note = yield* fs.readFileString(`${slotPath}/Note.md`);
        const code = yield* fs.readFileString(`${slotPath}/Code.ts`);
        const input = { projectId: f.projectId, line: lineRef };
        const reverted = yield* Effect.flip(
          h.index.revertChange({
            expectedVersion: yield* curationVersion(h.dashboard, f.projectId),
            ...input,
            target: { kind: "commit", commitOid: a },
          }),
        );
        assert.strictEqual(reverted._tag, "MemoryReviewBlockedError");
        if (reverted._tag === "MemoryReviewBlockedError")
          assert.strictEqual(reverted.reason, "slot-dirty");
        const merged = yield* Effect.flip(reviewAndMerge(h.index, f.projectId));
        assert.strictEqual(merged._tag, "MemoryReviewBlockedError");
        const prepared = yield* h.index.mergeHome(input);
        assert(prepared.kind === "review-required");
        const unmarked = yield* Effect.flip(
          h.index.revertChange({
            ...input,
            target: { kind: "unmarked" },
            expectedVersion: yield* curationVersion(h.dashboard, f.projectId),
          }),
        );
        assert.strictEqual(unmarked._tag, "MemoryReviewBlockedError");
        assert.strictEqual(yield* runGit(f.root, ["show-ref"]), refs);
        assert.deepStrictEqual(yield* fs.readFile(indexPath), index);
        assert.strictEqual(yield* fs.readFileString(`${slotPath}/Note.md`), note);
        assert.strictEqual(yield* fs.readFileString(`${slotPath}/Code.ts`), code);
        assert.strictEqual(
          yield* fs.readFileString(`${slotPath}/Captured.md`),
          "captured unmarked\n",
        );
      }),
    );
  }

  for (const owner of ["other-project", "terminal", "preview"] as const) {
    it.effect(`refuses curation of a matching slot owned by ${owner}`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const f = yield* makeFixture(`slot-owner-${owner}`, { git: true });
        yield* fs.writeFileString(`${f.root}/Note.md`, "base\n");
        yield* runGit(f.root, ["add", "."]);
        yield* runGit(f.root, ["commit", "-m", "base"]);
        const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
        yield* runGit(f.root, ["checkout", "-b", "memory-line"]);
        yield* fs.writeFileString(`${f.root}/Note.md`, "A\n");
        yield* runGit(f.root, ["commit", "-am", "A"]);
        const a = yield* runGit(f.root, ["rev-parse", "HEAD"]);
        const h = yield* makeLineIndex(f, {
          branch: "memory-line",
          baseOid,
          slotPath: f.root,
          ...(owner === "other-project"
            ? { slotProjectId: MercurianProjectId.make("other-project") }
            : {}),
        });
        if (owner !== "other-project")
          yield* h.leases.acquire(
            WorktreeSlotId.make("memory-slot"),
            owner === "terminal"
              ? { kind: "terminal", threadId: "thread", terminalId: "terminal" }
              : { kind: "preview", threadId: "thread", previewId: "preview" },
            "2026-09-04T00:00:00Z",
          );
        const refs = yield* runGit(f.root, ["show-ref"]);
        const result = yield* Effect.flip(
          h.index.revertChange({
            expectedVersion: yield* curationVersion(h.dashboard, f.projectId),
            projectId: f.projectId,
            line: lineRef,
            target: { kind: "commit", commitOid: a },
          }),
        );
        assert.strictEqual(result._tag, "MemoryReviewBlockedError");
        if (result._tag === "MemoryReviewBlockedError")
          assert.strictEqual(result.reason, "slot-busy");
        assert.strictEqual(yield* runGit(f.root, ["show-ref"]), refs);
        assert.strictEqual(yield* fs.readFileString(`${f.root}/Note.md`), "A\n");
      }),
    );
  }

  for (const targetKind of ["commit", "unmarked"] as const) {
    it.effect(
      `binds ${targetKind} reverts to the displayed capture without merge-home preconditions`,
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const f = yield* makeFixture(`view-version-${targetKind}`, { git: true });
          yield* fs.writeFileString(`${f.root}/Note.md`, "base\n");
          yield* runGit(f.root, ["add", "."]);
          yield* runGit(f.root, ["commit", "-m", "base"]);
          yield* runGit(f.root, ["branch", "-M", "main"]);
          const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
          const slotPath = yield* fs.makeTempDirectoryScoped({ prefix: "memory-version-slot-" });
          yield* fs.remove(slotPath, { recursive: true });
          yield* runGit(f.root, ["worktree", "add", "-b", "memory-line", slotPath]);
          yield* fs.writeFileString(`${slotPath}/Asset.json`, '{"review":true}\n');
          yield* runGit(slotPath, ["add", "."]);
          yield* runGit(slotPath, ["commit", "-m", "asset only"]);
          const commitOid = yield* runGit(slotPath, ["rev-parse", "HEAD"]);
          const h = yield* makeLineIndex(f, { branch: "memory-line", baseOid, slotPath });
          const input = { projectId: f.projectId, line: lineRef };
          const capture = Effect.fn(function* (body: string) {
            yield* fs.writeFileString(`${slotPath}/Tail.json`, body);
            yield* runGit(slotPath, ["add", "."]);
            yield* h.chain.captureTree({
              cwd: f.root,
              repositoryId: f.repositoryId,
              lineRootCommitId: lineRoot,
              lineBranch: "memory-line",
              kind: "curated",
              treeOid: yield* runGit(slotPath, ["write-tree"]),
            });
          });
          yield* capture("first\n");
          const viewed = yield* h.dashboard.readDashboard({
            ...input,
            position: { kind: "latest" },
          });
          assert(viewed.kind === "available");
          assert.deepStrictEqual(viewed.documents, []);
          assert.deepStrictEqual(viewed.graph, { nodes: [], edges: [], outsideReferences: [] });
          assert.deepStrictEqual(
            viewed.amendments.map((a) => a.comparison.paths),
            [["Asset.json"], ["Tail.json"]],
          );
          const mergeReview = yield* h.index.mergeHome(input);
          assert(mergeReview.kind === "review-required");
          assert.deepStrictEqual(
            mergeReview.review.unreviewedIds,
            viewed.amendments.map((a) => a.id),
          );
          const target =
            targetKind === "commit"
              ? { kind: "commit" as const, commitOid }
              : { kind: "unmarked" as const };
          yield* capture("new unseen capture\n");
          const refs = yield* runGit(f.root, ["show-ref"]);
          const stale = yield* Effect.flip(
            h.index.revertChange({ ...input, target, expectedVersion: viewed.curationVersion }),
          );
          assert(stale._tag === "MemoryReviewBlockedError");
          assert.strictEqual(stale.reason, "stale-review");
          assert.strictEqual(yield* runGit(f.root, ["show-ref"]), refs);
          const missing = yield* Effect.flip(h.index.revertChange({ ...input, target }));
          assert(missing._tag === "MemoryReviewBlockedError");
          assert.strictEqual(missing.reason, "stale-review");
          assert.strictEqual(yield* runGit(f.root, ["show-ref"]), refs);
          yield* fs.writeFileString(`${f.root}/Note.md`, "dirty standalone home\n");
          const dirtyMerge = yield* Effect.flip(h.index.mergeHome(input));
          assert(dirtyMerge._tag === "MergeMemoryHomeBlockedError");
          assert.strictEqual(dirtyMerge.reason, "checkout-dirty");
          // A fresh dashboard is an explicit new review, not hidden preparation on click.
          const refreshed = yield* h.dashboard.readDashboard({
            ...input,
            position: { kind: "latest" },
          });
          assert(refreshed.kind === "available");
          assert.notStrictEqual(refreshed.curationVersion, viewed.curationVersion);
          yield* h.index.revertChange({
            ...input,
            target,
            expectedVersion: refreshed.curationVersion,
          });
          assert.strictEqual(
            yield* fs.readFileString(`${f.root}/Note.md`),
            "dirty standalone home\n",
          );
          const after = yield* h.dashboard.readDashboard({
            ...input,
            position: { kind: "latest" },
          });
          assert(after.kind === "available");
          assert.deepStrictEqual(after.documents, []);
          assert.deepStrictEqual(after.graph, { nodes: [], edges: [], outsideReferences: [] });
          if (targetKind === "commit") {
            assert.isFalse(yield* fs.exists(`${slotPath}/Asset.json`));
            assert.strictEqual(
              yield* fs.readFileString(`${slotPath}/Tail.json`),
              "new unseen capture\n",
            );
            assert(after.amendments.some((a) => a.revertsAmendmentId === commitOid && a.reviewed));
          } else {
            assert.isFalse(yield* fs.exists(`${slotPath}/Tail.json`));
            assert.isTrue(yield* fs.exists(`${slotPath}/Asset.json`));
          }
        }),
    );
  }

  it.effect(
    "shares fork-inherited unmarked presence, identity and exact diff with legacy reads",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const f = yield* makeFixture("fork-legacy-delta", { git: true });
        yield* fs.writeFileString(`${f.root}/Note.md`, "base\n");
        yield* runGit(f.root, ["add", "."]);
        yield* runGit(f.root, ["commit", "-m", "base"]);
        const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
        yield* runGit(f.root, ["checkout", "-b", "memory-line"]);
        yield* fs.writeFileString(`${f.root}/Inherited.md`, "inherited uncaptured\n");
        yield* runGit(f.root, ["add", "."]);
        const inherited = yield* runGit(f.root, [
          "commit-tree",
          yield* runGit(f.root, ["write-tree"]),
          "-p",
          baseOid,
          "-m",
          "fork boundary",
        ]);
        yield* runGit(f.root, ["update-ref", lineSnapshotRef(lineRoot), inherited]);
        const h = yield* makeLineIndex(f, { branch: "memory-line", baseOid });
        const input = { projectId: f.projectId, line: lineRef };
        const before = yield* h.dashboard.readDashboard({ ...input, position: { kind: "latest" } });
        assert(before.kind === "available");
        assert.deepStrictEqual(before.amendments, []);
        assert.strictEqual((yield* h.index.readLineChanges(input)).unmarked, null);
        yield* runGit(f.root, ["commit", "-m", "Record inherited memory"]);
        const inheritedDashboard = yield* h.dashboard.readDashboard({
          ...input,
          position: { kind: "latest" },
        });
        assert(inheritedDashboard.kind === "available");
        assert.deepStrictEqual(inheritedDashboard.amendments, []);
        const inheritedLegacy = yield* h.index.readLineChanges(input);
        assert.deepStrictEqual(inheritedLegacy.hand, []);
        assert.deepStrictEqual(inheritedLegacy.marked, []);
        assert.strictEqual(inheritedLegacy.unreviewedCount, 0);
        yield* fs.writeFileString(`${f.root}/Own.json`, "new fork asset\n");
        yield* runGit(f.root, ["add", "."]);
        yield* h.chain.captureTree({
          cwd: f.root,
          repositoryId: f.repositoryId,
          lineRootCommitId: lineRoot,
          lineBranch: "memory-line",
          kind: "curated",
          treeOid: yield* runGit(f.root, ["write-tree"]),
        });
        const current = yield* h.dashboard.readDashboard({
          ...input,
          position: { kind: "latest" },
        });
        assert(current.kind === "available");
        const unmarked = current.amendments.find((a) => a.kind === "unmarked")!;
        assert.deepStrictEqual(unmarked.comparison.paths, ["Own.json"]);
        const legacy = yield* h.index.readLineChanges(input);
        assert.strictEqual(legacy.unmarked?.id, unmarked.id);
        assert.include(legacy.unmarked!.diff, "new fork asset");
        assert.notInclude(legacy.unmarked!.diff, "Inherited.md");
        yield* h.index.markChangeReviewed({ ...input, commitOid: legacy.unmarked!.id });
        assert.strictEqual((yield* h.index.readLineChanges(input)).unreviewedCount, 0);
      }),
  );

  it.effect(
    "the actual shared repository push requires the versioned review and rejects a stale approval",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const sql = yield* SqlClient.SqlClient;
        const f = yield* makeFixture("actual-exit", { git: true });
        yield* fs.makeDirectory(`${f.root}/memory`);
        yield* fs.writeFileString(`${f.root}/memory/Note.md`, "base\n");
        yield* runGit(f.root, ["add", "."]);
        yield* runGit(f.root, ["commit", "-m", "base"]);
        yield* runGit(f.root, ["branch", "-M", "main"]);
        const baseOid = yield* runGit(f.root, ["rev-parse", "HEAD"]);
        const slotPath = yield* fs.makeTempDirectoryScoped({ prefix: "memory-exit-slot-" });
        yield* fs.remove(slotPath, { recursive: true });
        yield* runGit(f.root, ["worktree", "add", "-b", "memory-line", slotPath]);
        yield* fs.writeFileString(`${slotPath}/memory/Note.md`, "A\n");
        yield* runGit(slotPath, ["commit", "-am", "A"]);
        const source = yield* MemorySourceStore.MemorySourceStore;
        yield* source.designate({
          projectId: f.projectId,
          repositoryId: f.repositoryId,
          subpath: "memory",
          now,
        });
        yield* sql`INSERT INTO line_branches (line_root_commit_id, repository_id, branch, base_oid, built, created_at) VALUES (${lineRoot}, ${f.repositoryId}, 'memory-line', ${baseOid}, 1, '2026-09-04T00:00:00Z')`;
        const reviewStore = yield* MemoryReviewStore.make;
        const h = yield* makeLineIndex(f, {
          branch: "memory-line",
          baseOid,
          slotPath,
          reviewStore,
        });
        const gate = yield* makeExitGate.pipe(
          Effect.provideService(SlotRegistry.SlotRegistry, h.leases),
        );
        for (const branch of ["main", "manual-feature"]) {
          if (branch !== "main") yield* runGit(f.root, ["checkout", "-b", branch]);
          const nonline = yield* Effect.flip(gate.check(f.root));
          assert.include(nonline.detail, "unregistered branch (including main)");
          assert.include(nonline.detail, "external Git");
          assert.notInclude(nonline.detail, "confirm Merge home");
        }
        yield* runGit(f.root, ["checkout", "main"]);
        const missing = yield* makeFixture("offline-unrelated", { git: true });
        yield* fs.makeDirectory(`${missing.root}/memory`);
        yield* source.designate({
          projectId: missing.projectId,
          repositoryId: missing.repositoryId,
          subpath: "memory",
          now,
        });
        yield* sql`UPDATE repositories SET path = ${`${missing.root}/gone`} WHERE repository_id = ${missing.repositoryId}`;
        const unrelated = yield* fs.makeTempDirectoryScoped({ prefix: "unrelated-git-" });
        yield* runGit(unrelated, ["init"]);
        let unrelatedExited = false;
        yield* gate.withExit(
          unrelated,
          Effect.sync(() => {
            unrelatedExited = true;
          }),
        );
        assert.isTrue(unrelatedExited);
        yield* gate.checkRemoteAction(unrelated);
        const remote = yield* fs.makeTempDirectoryScoped({ prefix: "memory-exit-remote-" });
        yield* runGit(remote, ["init", "--bare"]);
        yield* runGit(slotPath, ["remote", "add", "origin", remote]);
        const push = gate.withExit(
          slotPath,
          runGit(slotPath, ["push", "origin", "HEAD:refs/heads/memory-line"]),
        );
        const blocked = yield* Effect.flip(push);
        assert.strictEqual(blocked._tag, "GitManagerError");
        assert.strictEqual(yield* runGit(remote, ["for-each-ref", "--format=%(objectname)"]), "");
        assert.deepStrictEqual(yield* reviewAndMerge(h.index, f.projectId), {
          kind: "deferred-to-push",
        });
        yield* push;
        const pushed = yield* runGit(remote, ["rev-parse", "memory-line"]);
        yield* fs.writeFileString(`${slotPath}/Code.ts`, "new code state\n");
        yield* runGit(slotPath, ["add", "."]);
        const pending = yield* Effect.flip(push);
        assert.strictEqual(pending._tag, "GitManagerError");
        yield* runGit(slotPath, ["commit", "-m", "new repository state"]);
        const stale = yield* Effect.flip(push);
        assert.strictEqual(stale._tag, "GitManagerError");
        assert.strictEqual(yield* runGit(remote, ["rev-parse", "memory-line"]), pushed);
        const remoteAction = yield* Effect.flip(gate.checkRemoteAction(slotPath));
        assert.strictEqual(remoteAction._tag, "GitManagerError");
        const remoteRevert = yield* Effect.flip(gate.checkRemoteAction(slotPath, "revert"));
        assert.include(remoteRevert.detail, "publishes a new remote commit and PR");
        assert.deepStrictEqual(yield* reviewAndMerge(h.index, f.projectId), {
          kind: "deferred-to-push",
        });
        yield* push;
        assert.strictEqual(
          yield* runGit(remote, ["rev-parse", "memory-line"]),
          yield* runGit(slotPath, ["rev-parse", "HEAD"]),
        );
      }),
  );
});
