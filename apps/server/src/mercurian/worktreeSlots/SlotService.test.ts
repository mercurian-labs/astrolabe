import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
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
import * as MemorySourceStore from "../memory/MemorySourceStore.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as SlotRegistry from "./SlotRegistry.ts";
import * as SlotStore from "./SlotStore.ts";
import * as SnapshotChain from "./SnapshotChain.ts";
import { LineBranchMissingError, make, SlotPoolAtCapacityError } from "./SlotService.ts";
import { type WorktreeSlot, WorktreeSlotId } from "./schema.ts";

const repositoryA = MercurianRepositoryId.make("repository-a");
const repositoryB = MercurianRepositoryId.make("repository-b");
const projectId = MercurianProjectId.make("project-one");
const otherProjectId = MercurianProjectId.make("project-two");
const planId = PlanId.make("plan-one");
const otherPlanId = PlanId.make("plan-two");
const lineA = MercurianCommitId.make("line-a");
const lineB = MercurianCommitId.make("line-b");
const now = DateTime.makeUnsafe("2026-08-31T12:00:00.000Z");
const holder = (threadId: string) => ({ kind: "turn" as const, threadId });
const isLineBranchMissingError = Schema.is(LineBranchMissingError);
const isSlotPoolAtCapacityError = Schema.is(SlotPoolAtCapacityError);

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
  readonly headRefs?: Readonly<Record<string, string | null>>;
  readonly driftedPaths?: ReadonlyArray<string>;
  readonly checkpointExists?: boolean;
  readonly standings?: Readonly<Record<string, SnapshotChain.LineStanding>>;
  readonly missingRefs?: ReadonlyArray<string>;
  readonly links?: ReadonlyArray<{
    readonly projectId: MercurianProjectId;
    readonly repositoryId: MercurianRepositoryId;
  }>;
  readonly standaloneMemory?: boolean;
  readonly missingLineBranches?: boolean;
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
  const restores: Array<{ readonly cwd: string; readonly checkpointRef: CheckpointRef }> = [];
  const events: Array<string> = [];
  const lineRenames: Array<{ readonly repositoryId: string; readonly branch: string }> = [];
  const memberRenames: Array<{ readonly repositoryId: string; readonly branch: string }> = [];
  const lineBranchRows: Array<LineBranchStore.LineBranch> = [];
  const requestedPlanIds: Array<PlanId> = [];
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
      updateMemberBranch: ({ slotId, repositoryId, currentBranch }) =>
        Effect.sync(() => {
          memberRenames.push({ repositoryId, branch: currentBranch });
          const index = rows.findIndex((row) => row.slotId === slotId);
          if (index < 0) return;
          rows[index] = {
            ...rows[index]!,
            members: rows[index]!.members.map((member) =>
              member.repositoryId === repositoryId ? { ...member, currentBranch } : member,
            ),
          };
        }),
      changes: Stream.empty,
    }),
    SlotRegistry.layer,
    Layer.mock(LineBranchStore.LineBranchStore)({
      get: ({ lineRootCommitId, repositoryId }) =>
        Effect.succeed(
          options.missingLineBranches === true
            ? Option.fromNullishOr(
                lineBranchRows.find(
                  (row) =>
                    row.lineRootCommitId === lineRootCommitId && row.repositoryId === repositoryId,
                ),
              )
            : Option.some({
                lineRootCommitId,
                repositoryId,
                branch: `mercurian/${lineRootCommitId}-${repositoryId === repositoryA ? "a" : "b"}`,
                baseOid: "base-oid",
                built: false,
                repointHold: null,
                createdAt: now,
              }),
        ),
      create: (row) =>
        Effect.sync(() => {
          if (
            !lineBranchRows.some(
              (current) =>
                current.lineRootCommitId === row.lineRootCommitId &&
                current.repositoryId === row.repositoryId,
            )
          ) {
            lineBranchRows.push(row);
          }
        }),
      rename: ({ repositoryId, branch }) =>
        Effect.sync(() => lineRenames.push({ repositoryId, branch })),
    }),
    Layer.mock(PlanningStore.PlanningStore)({
      getPlanSnapshot: ({ planId: requestedPlanId }) =>
        Effect.sync(() => {
          requestedPlanIds.push(requestedPlanId);
          return {
            plan: {
              planId: requestedPlanId,
              projectId: requestedPlanId === planId ? projectId : otherProjectId,
              title: requestedPlanId === planId ? "Plan one" : "Plan two",
            },
            timeline: [
              {
                _tag: "plan-revision",
                commitId: lineA,
                parents: [],
                sequence: 1,
                createdAt: now,
              },
              {
                _tag: "message",
                commitId: lineB,
                parents: [lineA],
                sequence: 2,
                createdAt: now,
              },
            ],
            codingSessions: [],
          } as never;
        }),
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
    Layer.mock(MemorySourceStore.MemorySourceStore)({
      getSource: () =>
        Effect.succeed(
          options.standaloneMemory
            ? Option.some({
                projectId,
                repositoryId: repositoryB,
                subpath: null,
                createdAt: now,
                updatedAt: now,
              })
            : Option.none(),
        ),
      getSnapshot: Effect.succeed(
        options.standaloneMemory
          ? [
              {
                projectId,
                repositoryId: repositoryB,
                subpath: null,
                createdAt: now,
                updatedAt: now,
              },
            ]
          : [],
      ),
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed({
        worktreePoolSize: options.poolSize ?? 3,
        newWorktreesStartFromOrigin: false,
      } as never),
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
          events.push(`git:${input.cwd}:${input.args[0]}`);
          if (input.args[0] === "status") {
            return {
              exitCode: 0,
              stdout: dirty.has(input.cwd) ? " M file.ts\n" : "",
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }
          if (input.args[0] === "symbolic-ref") {
            const current =
              options.headRefs?.[input.cwd] ??
              options.initialSlots
                ?.flatMap((slot) =>
                  slot.members.map((member) => ({
                    path: `${slot.path}/${member.relativePath}`,
                    branch: member.currentBranch,
                  })),
                )
                .find((entry) => entry.path === input.cwd)?.branch;
            return {
              exitCode: current === null || current === undefined ? 1 : 0,
              stdout: current === null || current === undefined ? "" : `refs/heads/${current}\n`,
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }
          if (
            input.args[0] === "rev-parse" &&
            options.missingRefs?.includes(input.args.at(-1) ?? "")
          ) {
            return {
              exitCode: 1,
              stdout: "",
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }
          if (input.args[0] === "checkout" || input.args[0] === "clean") dirty.delete(input.cwd);
          return {
            exitCode: 0,
            stdout: input.args[0] === "rev-parse" ? "base-oid\n" : "",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        }) as never,
    }),
    Layer.mock(CheckpointStore.CheckpointStore)({
      captureCheckpoint: (input) => Effect.sync(() => captures.push(input)),
      hasCheckpointRef: () => Effect.succeed(options.checkpointExists ?? false),
      restoreCheckpoint: (input) =>
        Effect.sync(() => {
          restores.push(input);
          return true;
        }),
    }),
    Layer.mock(SnapshotChain.SnapshotChain)({
      capture: (input) =>
        Effect.sync(() => {
          events.push(`capture:${input.cwd}:${input.kind}`);
          captures.push({ cwd: input.cwd, checkpointRef: input.ref });
          return {
            oid: "snapshot",
            previousOid: "previous",
            headOid: "head",
            headRef: "refs/heads/main",
            built: true,
          };
        }),
      branchMovement: () => Effect.succeed({ kind: "unchanged" }),
      readStanding: ({ cwd, lineBranch }) =>
        Effect.succeed(
          options.standings?.[cwd] ??
            (options.headRefs?.[cwd] === undefined ||
            options.headRefs?.[cwd] === `refs/heads/${lineBranch}`
              ? { _tag: "on-line" as const }
              : {
                  _tag: "departed" as const,
                  ref: options.headRefs[cwd] ?? "detached",
                  recordedMissing: false,
                }),
        ),
      lineCommit: () => Effect.succeed("chain-head"),
      adoptRename: ({ repositoryId, branch }) =>
        Effect.sync(() => {
          lineRenames.push({ repositoryId, branch });
          for (let index = 0; index < rows.length; index += 1) {
            if (!rows[index]!.members.some((member) => member.repositoryId === repositoryId)) {
              continue;
            }
            memberRenames.push({ repositoryId, branch });
            rows[index] = {
              ...rows[index]!,
              members: rows[index]!.members.map((member) =>
                member.repositoryId === repositoryId
                  ? { ...member, currentBranch: branch }
                  : member,
              ),
            };
          }
        }),
      isDrifted: ({ cwd }) =>
        Effect.succeed(new Set(options.driftedPaths ?? options.dirtyPaths ?? []).has(cwd)),
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
      events,
      captures,
      restores,
      materializedPaths,
      removedPaths,
      lineRenames,
      memberRenames,
      lineBranchRows,
      requestedPlanIds,
      stats: () => ({ maxActiveMaterializations }),
    };
  }).pipe(Effect.provide(Layer.merge(dependencies, NodeServicesLayer)));
};

describe("SlotService", () => {
  it.effect("mints missing line branches before claiming a slot", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ missingLineBranches: true });
      const claimed = yield* harness.service.claim({
        planId,
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });

      assert.strictEqual(harness.lineBranchRows.length, 2);
      assert.strictEqual(harness.gitCalls.filter((call) => call.args[0] === "branch").length, 2);
      assert.strictEqual(claimed.members.length, 2);
      assert.deepStrictEqual(harness.requestedPlanIds, [planId]);
    }),
  );

  it.effect("materializes every linked repository at its project-relative path", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const claimed = yield* harness.service.claim({
        planId,
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

  it.effect("materializes a standalone memory repository as a slot member", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        links: [{ projectId, repositoryId: repositoryA }],
        standaloneMemory: true,
      });
      const claimed = yield* harness.service.claim({
        planId,
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-memory"),
      });
      assert.deepStrictEqual(
        claimed.members.map((member) => member.repositoryId),
        [repositoryA, repositoryB],
      );
      assert.deepStrictEqual(harness.materializedPaths, [
        "/worktrees/project-one/slot-1/a",
        "/worktrees/project-one/slot-1/b",
      ]);
    }),
  );

  it.effect("restores an inherited line snapshot into newly materialized members", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ checkpointExists: true });
      yield* harness.service.claim({
        planId,
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });
      assert.deepStrictEqual(
        harness.restores.map((restore) => restore.cwd),
        ["/worktrees/project-one/slot-1/a", "/worktrees/project-one/slot-1/b"],
      );
      assert.ok(
        harness.restores.every(
          (restore) => restore.checkpointRef === SnapshotChain.lineSnapshotRef(lineA),
        ),
      );
    }),
  );

  it.effect("removes already-created members when whole-project materialization fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ failCreateAtCwd: "/repositories/team/b" });
      yield* harness.service
        .claim({
          planId,
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
        planId,
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });
      assert.strictEqual(claimed.slotId, existing.slotId);
      assert.strictEqual(harness.materializedPaths.length, 0);
      assert.strictEqual(harness.captures.length, 0);
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
        planId,
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

  it.effect("leaves drift on an affinity member for the turn-start external capture", () =>
    Effect.gen(function* () {
      const existing = slot(lineA);
      const harness = yield* makeHarness({
        initialSlots: [existing],
        dirtyPaths: ["/worktrees/project-one/slot-1/b"],
      });
      yield* harness.service.claim({
        planId,
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });
      assert.strictEqual(harness.captures.length, 0);
    }),
  );

  it.effect("captures a departed affinity member once before resetting it", () =>
    Effect.gen(function* () {
      const existing = slot(lineA);
      const memberPath = "/worktrees/project-one/slot-1/a";
      const harness = yield* makeHarness({
        initialSlots: [existing],
        headRefs: { [memberPath]: "refs/heads/sibling" },
        dirtyPaths: [memberPath],
        checkpointExists: true,
      });
      yield* harness.service.claim({
        planId,
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });
      const memberCalls = harness.gitCalls
        .filter((call) => call.cwd === memberPath)
        .map((call) => call.args.slice(0, 2));
      assert.deepStrictEqual(memberCalls.slice(0, 3), [
        ["reset", "--hard"],
        ["clean", "-fd"],
        ["checkout", "mercurian/line-a-a"],
      ]);
      assert.deepStrictEqual(
        harness.captures.map((capture) => capture.cwd),
        [memberPath],
      );
      const captureIndex = harness.events.indexOf(`capture:${memberPath}:recovery`);
      const resetIndex = harness.events.indexOf(`git:${memberPath}:reset`);
      assert.ok(captureIndex >= 0);
      assert.ok(captureIndex < resetIndex);
      assert.ok(
        harness.gitCalls.some((call) => call.cwd === memberPath && call.args[0] === "checkout"),
      );
      assert.ok(harness.restores.some((restore) => restore.cwd === memberPath));
    }),
  );

  it.effect("adopts an affinity member renamed at the line commit without cleaning it", () =>
    Effect.gen(function* () {
      const existing = slot(lineA);
      const memberPath = "/worktrees/project-one/slot-1/a";
      const harness = yield* makeHarness({
        initialSlots: [existing],
        standings: { [memberPath]: { _tag: "renamed", branch: "renamed-by-hand" } },
      });
      const claimed = yield* harness.service.claim({
        planId,
        projectId,
        lineRootCommitId: lineA,
        holder: holder("thread-a"),
      });
      assert.strictEqual(claimed.members[0]?.currentBranch, "renamed-by-hand");
      assert.deepStrictEqual(harness.lineRenames, [
        { repositoryId: repositoryA, branch: "renamed-by-hand" },
      ]);
      assert.deepStrictEqual(harness.memberRenames, [
        { repositoryId: repositoryA, branch: "renamed-by-hand" },
      ]);
      assert.ok(
        !harness.gitCalls.some(
          (call) =>
            call.cwd === memberPath &&
            (call.args[0] === "reset" || call.args[0] === "clean" || call.args[0] === "checkout"),
        ),
      );
    }),
  );

  it.effect("reports the chain head when an affinity branch name is missing", () =>
    Effect.gen(function* () {
      const existing = slot(lineA);
      const memberPath = "/worktrees/project-one/slot-1/a";
      const harness = yield* makeHarness({
        initialSlots: [existing],
        standings: {
          [memberPath]: {
            _tag: "departed",
            ref: "refs/heads/elsewhere",
            recordedMissing: true,
          },
        },
      });
      const failure = yield* harness.service
        .claim({ planId, projectId, lineRootCommitId: lineA, holder: holder("thread-a") })
        .pipe(Effect.flip);
      assert.ok(isLineBranchMissingError(failure));
      if (isLineBranchMissingError(failure)) {
        assert.strictEqual(failure.commitOid, "chain-head");
        assert.strictEqual(failure.branch, "mercurian/line-a-a");
      }
    }),
  );

  it.effect("verifies every desired branch before switching a slot", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        initialSlots: [slot(lineA)],
        missingRefs: ["refs/heads/mercurian/line-b-a"],
      });
      const failure = yield* harness.service
        .claim({ planId, projectId, lineRootCommitId: lineB, holder: holder("thread-b") })
        .pipe(Effect.flip);
      assert.ok(isLineBranchMissingError(failure));
      assert.ok(!harness.gitCalls.some((call) => call.args[0] === "checkout"));
    }),
  );

  it.effect("fails typed when every project slot is leased", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ poolSize: 1 });
      yield* harness.service.claim({
        planId,
        projectId,
        lineRootCommitId: lineA,
        holder: holder("a"),
      });
      const refusal = yield* harness.service
        .claim({
          planId,
          projectId,
          lineRootCommitId: lineB,
          holder: holder("b"),
        })
        .pipe(Effect.flip);
      assert.ok(isSlotPoolAtCapacityError(refusal));
      if (isSlotPoolAtCapacityError(refusal)) {
        assert.strictEqual(refusal.projectId, projectId);
        assert.strictEqual(refusal.poolSize, 1);
      }
    }),
  );

  it.effect("keeps terminal holds after the turn releases and locks every member", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const claimed = yield* harness.service.claim({
        planId,
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
        harness.service.claim({ planId, projectId, lineRootCommitId: lineA, holder: holder("a") }),
        { startImmediately: true },
      );
      yield* Effect.yieldNow;
      const second = yield* Effect.forkChild(
        harness.service.claim({ planId, projectId, lineRootCommitId: lineB, holder: holder("b") }),
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
        planId,
        projectId,
        lineRootCommitId: lineA,
        holder: holder("a"),
      });
      const second = yield* harness.service.claim({
        planId: otherPlanId,
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
