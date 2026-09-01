import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  type CheckpointRef,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../../config.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as LineBranchStore from "../commitTree/LineBranchStore.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as SlotRegistry from "./SlotRegistry.ts";
import * as SlotStore from "./SlotStore.ts";
import { make, SlotPoolAtCapacityError } from "./SlotService.ts";
import { type WorktreeSlot, WorktreeSlotId } from "./schema.ts";

const repositoryA = MercurianRepositoryId.make("repository-a");
const repositoryB = MercurianRepositoryId.make("repository-b");
const projectId = MercurianProjectId.make("project-one");
const otherProjectId = MercurianProjectId.make("project-two");
const lineA = MercurianCommitId.make("line-a");
const lineB = MercurianCommitId.make("line-b");
const now = DateTime.makeUnsafe("2026-08-31T12:00:00.000Z");
const holder = (threadId: string) => ({ kind: "turn" as const, threadId });

const slot = (lineRootCommitId: MercurianCommitId): WorktreeSlot => ({
  slotId: WorktreeSlotId.make("project-one:slot-1"),
  projectId,
  path: "/worktrees/project-one/slot-1",
  currentLineRootCommitId: lineRootCommitId,
  members: [
    {
      repositoryId: repositoryA,
      relativePath: "a",
      currentBranch: `mercurian/${lineRootCommitId}-a`,
    },
    {
      repositoryId: repositoryB,
      relativePath: "b",
      currentBranch: `mercurian/${lineRootCommitId}-b`,
    },
  ],
  createdAt: now,
  lastUsedAt: now,
});

interface HarnessOptions {
  readonly poolSize?: number;
  readonly initialSlots?: ReadonlyArray<WorktreeSlot>;
  readonly dirtyPaths?: ReadonlyArray<string>;
  readonly materializeGate?: Deferred.Deferred<void>;
  readonly failCreateAtCwd?: string;
  readonly links?: ReadonlyArray<{
    readonly projectId: MercurianProjectId;
    readonly repositoryId: MercurianRepositoryId;
  }>;
}

const makeHarness = (options: HarnessOptions = {}) => {
  const rows = [...(options.initialSlots ?? [])];
  const dirty = new Set(options.dirtyPaths ?? []);
  const gitCalls: Array<{
    readonly operation: string;
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
  }> = [];
  const materializedPaths: Array<string> = [];
  const removedPaths: Array<string> = [];
  const captures: Array<{ readonly cwd: string; readonly checkpointRef: CheckpointRef }> = [];
  let activeMaterializations = 0;
  let maxActiveMaterializations = 0;

  const dependencies = Layer.mergeAll(
    Layer.mock(SlotStore.SlotStore)({
      list: (id) => Effect.succeed(rows.filter((candidate) => candidate.projectId === id)),
      listAll: Effect.sync(() => [...rows]),
      get: (slotId) =>
        Effect.succeed(Option.fromNullishOr(rows.find((row) => row.slotId === slotId))),
      create: (created) => Effect.sync(() => rows.push(created)),
      assign: (assignment) =>
        Effect.sync(() => {
          const index = rows.findIndex((row) => row.slotId === assignment.slotId);
          if (index < 0) return;
          const branches = new Map(
            assignment.members.map((member) => [member.repositoryId, member.currentBranch]),
          );
          rows[index] = {
            ...rows[index]!,
            currentLineRootCommitId: assignment.lineRootCommitId,
            members: rows[index]!.members.map((member) => ({
              ...member,
              currentBranch: branches.get(member.repositoryId) ?? null,
            })),
            lastUsedAt: assignment.lastUsedAt,
          };
        }),
      changes: Stream.empty,
    }),
    SlotRegistry.layer,
    Layer.mock(LineBranchStore.LineBranchStore)({
      get: ({ lineRootCommitId, repositoryId }) =>
        Effect.succeed(
          Option.some({
            lineRootCommitId,
            repositoryId,
            branch: `mercurian/${lineRootCommitId}-${repositoryId === repositoryA ? "a" : "b"}`,
            baseOid: "base-oid",
            built: false,
            createdAt: now,
          }),
        ),
    }),
    Layer.mock(RepositoryStore.RepositoryStore)({
      getSnapshot: Effect.succeed({
        repositories: [
          {
            repositoryId: repositoryA,
            name: "repository-a",
            path: "/repositories/team/a",
            scripts: [],
            hasGit: true,
            hosting: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            repositoryId: repositoryB,
            name: "repository-b",
            path: "/repositories/team/b",
            scripts: [],
            hasGit: true,
            hosting: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        projectRepositories: options.links ?? [
          { projectId, repositoryId: repositoryA },
          { projectId, repositoryId: repositoryB },
        ],
      }),
      changes: Stream.empty,
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed({ worktreePoolSize: options.poolSize ?? 3 } as never),
    }),
    Layer.mock(ServerConfig.ServerConfig)({
      worktreesDir: "/worktrees",
    } as ServerConfig.ServerConfig["Service"]),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      createWorktree: ({ cwd, path }) =>
        Effect.gen(function* () {
          activeMaterializations += 1;
          maxActiveMaterializations = Math.max(maxActiveMaterializations, activeMaterializations);
          if (options.materializeGate !== undefined) yield* Deferred.await(options.materializeGate);
          activeMaterializations -= 1;
          if (cwd === options.failCreateAtCwd) return yield* Effect.die(new Error("create failed"));
          materializedPaths.push(path!);
          return {} as never;
        }),
      removeWorktree: ({ path }) => Effect.sync(() => removedPaths.push(path)),
    }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (input) =>
        Effect.sync(() => {
          gitCalls.push({ operation: input.operation, cwd: input.cwd, args: input.args });
          if (input.args[0] === "status") {
            return {
              exitCode: 0,
              stdout: dirty.has(input.cwd) ? " M file.ts\n" : "",
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }
          if (input.args[0] === "checkout" || input.args[0] === "clean") dirty.delete(input.cwd);
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        }) as never,
    }),
    Layer.mock(CheckpointStore.CheckpointStore)({
      captureCheckpoint: (input) => Effect.sync(() => captures.push(input)),
      hasCheckpointRef: () => Effect.succeed(false),
      restoreCheckpoint: () => Effect.succeed(true),
    }),
  );

  return Effect.gen(function* () {
    const registry = yield* SlotRegistry.SlotRegistry;
    const service = yield* make;
    return {
      service,
      registry,
      rows,
      gitCalls,
      captures,
      materializedPaths,
      removedPaths,
      stats: () => ({ maxActiveMaterializations }),
    };
  }).pipe(Effect.provide(Layer.merge(dependencies, NodeServicesLayer)));
};

describe("SlotService", () => {
  it.effect("materializes every linked repository at its project-relative path", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const claimed = yield* harness.service.claim({
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });
      assert.deepStrictEqual(harness.materializedPaths, [
        "/worktrees/project-one/slot-1/a",
        "/worktrees/project-one/slot-1/b",
      ]);
      assert.deepStrictEqual(
        claimed.members.map((member) => member.relativePath),
        ["a", "b"],
      );
    }),
  );

  it.effect("removes already-created members when whole-project materialization fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ failCreateAtCwd: "/repositories/team/b" });
      yield* harness.service
        .claim({
          projectId,
          lineRootCommitId: lineA,
          holder: holder("thread-a"),
        })
        .pipe(Effect.exit);
      assert.strictEqual(harness.rows.length, 0);
      assert.deepStrictEqual(harness.removedPaths, ["/worktrees/project-one/slot-1/a"]);
    }),
  );

  it.effect("reuses an unleased project slot already assigned to the line", () =>
    Effect.gen(function* () {
      const existing = slot(lineA);
      const harness = yield* makeHarness({ initialSlots: [existing] });
      const claimed = yield* harness.service.claim({
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });
      assert.strictEqual(claimed.slotId, existing.slotId);
      assert.strictEqual(harness.materializedPaths.length, 0);
      assert.ok(!harness.gitCalls.some((call) => call.args[0] === "checkout"));
    }),
  );

  it.effect("snapshots every dirty member before switching the project slot", () =>
    Effect.gen(function* () {
      const existing = slot(lineA);
      const harness = yield* makeHarness({
        initialSlots: [existing],
        dirtyPaths: ["/worktrees/project-one/slot-1/a", "/worktrees/project-one/slot-1/b"],
      });
      const claimed = yield* harness.service.claim({
        projectId,
        lineRootCommitId: lineB,
        holder: holder("thread-b"),
      });
      assert.strictEqual(harness.captures.length, 2);
      assert.strictEqual(claimed.currentLineRootCommitId, lineB);
      assert.deepStrictEqual(
        claimed.members.map((member) => member.currentBranch),
        ["mercurian/line-b-a", "mercurian/line-b-b"],
      );
      assert.strictEqual(harness.gitCalls.filter((call) => call.args[0] === "checkout").length, 2);
    }),
  );

  it.effect("snapshots dirty affinity members during restart recovery", () =>
    Effect.gen(function* () {
      const existing = slot(lineA);
      const harness = yield* makeHarness({
        initialSlots: [existing],
        dirtyPaths: ["/worktrees/project-one/slot-1/b"],
      });
      yield* harness.service.claim({
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });
      assert.deepStrictEqual(
        harness.captures.map((capture) => capture.cwd),
        ["/worktrees/project-one/slot-1/b"],
      );
    }),
  );

  it.effect("fails typed when every project slot is leased", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ poolSize: 1 });
      yield* harness.service.claim({ projectId, lineRootCommitId: lineA, holder: holder("a") });
      const refusal = yield* harness.service
        .claim({
          projectId,
          lineRootCommitId: lineB,
          holder: holder("b"),
        })
        .pipe(Effect.flip);
      assert.ok(Schema.is(SlotPoolAtCapacityError)(refusal));
      if (Schema.is(SlotPoolAtCapacityError)(refusal)) {
        assert.strictEqual(refusal.projectId, projectId);
        assert.strictEqual(refusal.poolSize, 1);
      }
    }),
  );

  it.effect("keeps terminal holds after the turn releases and locks every member", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const claimed = yield* harness.service.claim({
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });
      const terminal = {
        kind: "terminal" as const,
        threadId: "thread-a",
        terminalId: "terminal-a",
      };
      yield* harness.service.retain(claimed.slotId, terminal);
      assert.strictEqual(yield* harness.service.release(claimed.slotId, holder("thread-a")), false);
      assert.strictEqual(yield* harness.service.release(claimed.slotId, terminal), true);
      assert.strictEqual(harness.gitCalls.filter((call) => call.args[1] === "lock").length, 4);
      assert.strictEqual(harness.gitCalls.filter((call) => call.args[1] === "unlock").length, 2);
    }),
  );

  it.effect("serializes materialization decisions for one project", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const harness = yield* makeHarness({ poolSize: 2, materializeGate: gate });
      const first = yield* Effect.forkChild(
        harness.service.claim({ projectId, lineRootCommitId: lineA, holder: holder("a") }),
        { startImmediately: true },
      );
      yield* Effect.yieldNow;
      const second = yield* Effect.forkChild(
        harness.service.claim({ projectId, lineRootCommitId: lineB, holder: holder("b") }),
        { startImmediately: true },
      );
      yield* Effect.yieldNow;
      assert.strictEqual(harness.materializedPaths.length, 0);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.strictEqual(harness.stats().maxActiveMaterializations, 1);
      assert.strictEqual(harness.rows.length, 2);
    }),
  );

  it.effect("does not share a repository slot across projects", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        links: [
          { projectId, repositoryId: repositoryA },
          { projectId: otherProjectId, repositoryId: repositoryA },
        ],
      });
      const first = yield* harness.service.claim({
        projectId,
        lineRootCommitId: lineA,
        holder: holder("a"),
      });
      const second = yield* harness.service.claim({
        projectId: otherProjectId,
        lineRootCommitId: lineB,
        holder: holder("b"),
      });
      assert.notStrictEqual(first.slotId, second.slotId);
      assert.notStrictEqual(first.path, second.path);
      assert.strictEqual(harness.rows.length, 2);
    }),
  );
});
