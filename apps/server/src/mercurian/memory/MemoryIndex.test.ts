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
    readonly appended?: Array<unknown>;
    readonly timeline?: ReadonlyArray<unknown>;
    readonly requestedLineRoots?: Array<MercurianCommitId>;
    readonly turns?: PlanTurnRegistry.PlanTurnRegistry["Service"];
    readonly leases?: SlotRegistry.SlotRegistry["Service"];
    readonly reviewed?: Set<string>;
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
            projectId: fixture.projectId,
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
      diffCheckpoints: (diffInput) =>
        Effect.gen(function* () {
          const git = yield* GitVcsDriver.GitVcsDriver;
          const result = yield* git.execute({
            operation: "MemoryIndex.test.diffCheckpoints",
            cwd: diffInput.cwd,
            args: [
              "diff",
              String(diffInput.fromCheckpointRef),
              String(diffInput.toCheckpointRef),
              "--",
              ...(diffInput.paths ?? []),
            ],
          });
          return result.stdout;
        }) as never,
    }),
    Layer.mock(MemoryReviewStore.MemoryReviewStore)({
      listReviewed: () =>
        Effect.succeed(
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
  const configured = { ...input, turns, leases };
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
  return { index, turns, leases, dashboard };
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
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        slotPath,
        reviewed,
      });

      yield* index.revertChange({
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
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
      });

      for (const commitOid of [baseOid, unrelatedOid]) {
        const error = yield* Effect.flip(
          index.revertChange({
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
      yield* runGit(slotPath, ["commit", "-am", "Snapshot only"]);
      const previousSnapshot = yield* runGit(slotPath, ["rev-parse", "HEAD"]);
      yield* runGit(slotPath, ["reset", "--hard", baseOid]);
      yield* runGit(fixture.root, [
        "update-ref",
        String(lineSnapshotRef(lineRoot)),
        previousSnapshot,
      ]);
      const services = lineServices(fixture, { branch: "memory-line", baseOid, slotPath });
      const chain = yield* makeSnapshotChain.pipe(
        Effect.provide(services),
        Effect.provideService(GitVcsDriver.GitVcsDriver, git),
      );
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid,
        slotPath,
        captureTree: chain.captureTree,
      });

      yield* index.revertChange({
        projectId: fixture.projectId,
        line: lineRef,
        target: { kind: "unmarked" },
      });

      const curated = yield* runGit(fixture.root, ["rev-parse", String(lineSnapshotRef(lineRoot))]);
      assert.strictEqual(
        yield* runGit(fixture.root, ["rev-parse", `${curated}^1`]),
        previousSnapshot,
      );
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", `${curated}^2`]), baseOid);
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
      const { index, leases } = yield* makeLineIndex(fixture, {
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
      const { index } = yield* makeLineIndex(fixture, {
        branch: "memory-line",
        baseOid: mainBefore,
      });

      const changes = yield* index.readLineChanges({
        projectId: fixture.projectId,
        line: lineRef,
      });
      assert.strictEqual(changes.unmarked, null);

      yield* index.revertChange({
        projectId: fixture.projectId,
        line: lineRef,
        target: { kind: "unmarked" },
      });
      assert.strictEqual(
        yield* runGit(fixture.root, ["rev-parse", String(lineSnapshotRef(lineRoot))]),
        snapshotOid,
      );
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "memory-line"]), lineTip);

      const result = yield* index.mergeHome({ projectId: fixture.projectId, line: lineRef });
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
      yield* runGit(fixture.root, ["commit", "-am", "Snapshot state"]);
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

      const result = yield* index.mergeHome({ projectId: fixture.projectId, line: lineRef });
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

      const result = yield* index.mergeHome({ projectId: fixture.projectId, line: lineRef });
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

      const result = yield* index.mergeHome({ projectId: fixture.projectId, line: lineRef });
      assert.deepStrictEqual(result, { kind: "conflict", conflicts: [{ path: "Plans.md" }] });
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "main"]), mainBefore);
    }),
  );

  it.effect("defers subpath memory to the pull request and records the line's sessions", () =>
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

      assert.deepStrictEqual(
        yield* index.mergeHome({ projectId: fixture.projectId, line: lineRef }),
        { kind: "deferred-to-push" },
      );
      assert.strictEqual(yield* runGit(fixture.root, ["rev-parse", "main"]), mainBefore);
      assert.deepStrictEqual(recordedMergedHome, [lineSessionThread]);
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
});
