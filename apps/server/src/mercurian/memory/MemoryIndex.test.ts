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
} from "@t3tools/contracts";

import * as ProcessRunner from "../../processRunner.ts";
import { ServerConfig } from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as MemoryIndex from "./MemoryIndex.ts";
import * as MemorySourceStore from "./MemorySourceStore.ts";
import * as MemoryReviewStore from "./MemoryReviewStore.ts";
import * as CodingSessionStore from "../codingSessions/CodingSessionStore.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
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
  PlanTurnRegistry.layer,
  SlotRegistry.layer,
  Layer.mock(CodingSessionStore.CodingSessionStore)({
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
const lineRef = { planId: linePlan, commitId: lineRoot } as const;

function lineServices(
  fixture: {
    readonly root: string;
    readonly projectId: MercurianProjectId;
    readonly repositoryId: MercurianRepositoryId;
  },
  input: {
    readonly branch: string;
    readonly baseOid: string;
    readonly slotPath?: string;
    readonly appended?: Array<unknown>;
    readonly timeline?: ReadonlyArray<unknown>;
    readonly requestedLineRoots?: Array<MercurianCommitId>;
    readonly turns?: PlanTurnRegistry.PlanTurnRegistry["Service"];
    readonly leases?: SlotRegistry.SlotRegistry["Service"];
    readonly reviewed?: Set<string>;
    readonly captureTree?: SnapshotChain["Service"]["captureTree"];
  },
) {
  const createdAt = DateTime.makeUnsafe("2026-09-04T00:00:00.000Z");
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
    input.turns === undefined
      ? PlanTurnRegistry.layer
      : Layer.succeed(PlanTurnRegistry.PlanTurnRegistry, input.turns),
    input.leases === undefined
      ? SlotRegistry.layer
      : Layer.succeed(SlotRegistry.SlotRegistry, input.leases),
    Layer.mock(CodingSessionStore.CodingSessionStore)({
      getByThreadId: () => Effect.succeed(Option.none()),
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
          codingSessions: [],
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
          return Option.some({
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
  const turns = yield* PlanTurnRegistry.make;
  const leases = yield* SlotRegistry.make;
  const configured = { ...input, turns, leases };
  const index = yield* MemoryIndex.make.pipe(
    Effect.provide(lineServices(fixture, configured)),
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
    Effect.provideService(ProcessRunner.ProcessRunner, runner),
    Effect.provideService(MemorySourceStore.MemorySourceStore, sourceStore),
    Effect.provideService(GitVcsDriver.GitVcsDriver, git),
  );
  return { index, turns, leases };
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

  it.effect("reads a line from its branch and moving chain-head ref without stale cache", () =>
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

      yield* runGit(fixture.root, ["update-ref", String(lineSnapshotRef(lineRoot)), baseOid]);
      const chain = yield* index.readNote(fixture.projectId, "Plans", lineRef);
      assert.strictEqual(chain.markdown, "Main\n");
    }),
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

      yield* runGit(fixture.root, ["update-ref", String(lineSnapshotRef(lineRoot)), branchTip]);
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
