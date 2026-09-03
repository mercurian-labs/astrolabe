import { assert, describe, it } from "@effect/vitest";
import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../../serverSettings.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as SlotStore from "../worktreeSlots/SlotStore.ts";
import { WorktreeSlotId } from "../worktreeSlots/schema.ts";
import { make } from "./LineBranchReactor.ts";
import * as LineBranchStore from "./LineBranchStore.ts";

const planId = PlanId.make("plan-one");
const projectId = MercurianProjectId.make("project-one");
const repositoryA = MercurianRepositoryId.make("repository-a");
const repositoryB = MercurianRepositoryId.make("repository-b");
const root = MercurianCommitId.make("root");
const mainChild = MercurianCommitId.make("main-child");
const forkChild = MercurianCommitId.make("fork-child");
const sessionCommit = MercurianCommitId.make("session-commit");
const sessionLeaf = MercurianCommitId.make("session-leaf");
const sessionMainChild = MercurianCommitId.make("session-main-child");
const sessionForkChild = MercurianCommitId.make("session-fork-child");
const createdAt = DateTime.makeUnsafe("2026-08-31T12:00:00.000Z");

const detail = {
  plan: { planId, projectId, title: "Line branches" },
  timeline: [
    { _tag: "plan-revision", commitId: root, parents: [], sequence: 1, createdAt },
    {
      _tag: "message",
      commitId: mainChild,
      parents: [root],
      sequence: 2,
      createdAt,
    },
    {
      _tag: "message",
      commitId: forkChild,
      parents: [root],
      sequence: 3,
      createdAt,
    },
  ],
  codingSessions: [],
} as never;

const repositoryFacts = (overrides: Record<string, unknown>) => ({
  snapshotOid: null,
  snapshotKind: null,
  branchTipOid: null,
  departedRef: null,
  branchMovement: null,
  prUrl: null,
  ...overrides,
});

/** A session leaf on the root line: project-scoped (rows per repository) or legacy (one repository on the record). */
const detailWithSession = (legacy: boolean): PlanningStore.PlanDetail =>
  ({
    plan: { planId, projectId, title: "Line branches" },
    timeline: [
      { _tag: "plan-revision", commitId: root, parents: [], sequence: 1, createdAt },
      {
        _tag: "coding-session",
        commitId: sessionLeaf,
        parents: [root],
        sequence: 2,
        createdAt,
        ...(legacy ? { repositoryId: repositoryA, repositoryName: "a" } : {}),
      },
      {
        _tag: "message",
        commitId: sessionMainChild,
        parents: [sessionLeaf],
        sequence: 3,
        createdAt,
      },
      {
        _tag: "message",
        commitId: sessionForkChild,
        parents: [sessionLeaf],
        sequence: 4,
        createdAt,
      },
    ],
    codingSessions: [
      {
        commitId: sessionLeaf,
        ...(legacy ? { repositoryId: repositoryA } : {}),
        settledCommitOid: legacy ? "legacy-oid-a" : null,
        snapshotOid: legacy ? "legacy-snapshot-a" : null,
        ...(legacy
          ? {}
          : {
              repositories: [
                repositoryFacts({
                  repositoryId: repositoryA,
                  repositoryName: "a",
                  snapshotOid: "snapshot-a",
                  branchTipOid: "tip-a",
                }),
                repositoryFacts({ repositoryId: repositoryB, repositoryName: "b" }),
              ],
            }),
      },
    ],
  }) as never;

const makeHarness = (
  initial: ReadonlyArray<LineBranchStore.LineBranch> = [],
  oid = "base-new",
  planDetail: PlanningStore.PlanDetail = detail,
  options: {
    readonly checkedOutBranch?: string;
    readonly missingBranches?: ReadonlyArray<string>;
    readonly slotChanges?: Stream.Stream<void>;
    readonly failBranchCwd?: string;
  } = {},
) => {
  const rows = [...initial];
  const gitCalls: Array<{ readonly cwd: string; readonly args: ReadonlyArray<string> }> = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(PlanningStore.PlanningStore)({
      getTreeSnapshot: Effect.succeed({
        plans: [{ planId, projectId, title: "Line branches" }],
      } as never),
      getPlanSnapshot: () => Effect.succeed(planDetail),
      changes: Stream.empty,
    }),
    Layer.mock(RepositoryStore.RepositoryStore)({
      getSnapshot: Effect.succeed({
        repositories: [
          {
            repositoryId: repositoryA,
            name: "a",
            path: "/repositories/a",
            scripts: [],
            hasGit: true,
          },
          {
            repositoryId: repositoryB,
            name: "b",
            path: "/repositories/b",
            scripts: [],
            hasGit: true,
          },
        ],
        projectRepositories: [
          { projectId, repositoryId: repositoryA },
          { projectId, repositoryId: repositoryB },
        ],
      } as never),
      changes: Stream.empty,
    }),
    Layer.mock(LineBranchStore.LineBranchStore)({
      get: (key) =>
        Effect.succeed(
          Option.fromNullishOr(
            rows.find(
              (row) =>
                row.lineRootCommitId === key.lineRootCommitId &&
                row.repositoryId === key.repositoryId,
            ),
          ),
        ),
      create: (row) => Effect.sync(() => rows.push(row)),
      repointIfUnbuilt: (input) =>
        Effect.sync(() => {
          const index = rows.findIndex(
            (row) =>
              row.lineRootCommitId === input.lineRootCommitId &&
              row.repositoryId === input.repositoryId &&
              !row.built,
          );
          if (index < 0) return false;
          rows[index] = { ...rows[index]!, baseOid: input.baseOid };
          return true;
        }),
      recordRepointHold: ({ lineRootCommitId, repositoryId, reason }) =>
        Effect.sync(() => {
          const index = rows.findIndex(
            (row) => row.lineRootCommitId === lineRootCommitId && row.repositoryId === repositoryId,
          );
          if (index >= 0) rows[index] = { ...rows[index]!, repointHold: reason };
        }),
    }),
    Layer.mock(SlotStore.SlotStore)({
      listAll:
        options.checkedOutBranch === undefined
          ? Effect.succeed([])
          : Effect.succeed([
              {
                slotId: WorktreeSlotId.make("slot-one"),
                projectId,
                path: "/worktrees/slot-one",
                currentLineRootCommitId: root,
                members: [
                  {
                    repositoryId: repositoryA,
                    relativePath: "a",
                    currentBranch: options.checkedOutBranch,
                  },
                ],
                createdAt,
                lastUsedAt: createdAt,
              },
            ]),
      changes: options.slotChanges ?? Stream.empty,
    }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (input) =>
        Effect.suspend(() => {
          gitCalls.push({ cwd: input.cwd, args: input.args });
          const branchRef = input.args.at(-1)?.replace("refs/heads/", "");
          const missing =
            input.args[0] === "rev-parse" &&
            branchRef !== undefined &&
            options.missingBranches?.includes(branchRef);
          return input.args[0] === "branch" && input.cwd === options.failBranchCwd
            ? Effect.die(`git failed in ${input.cwd}`)
            : Effect.succeed({
                exitCode: input.args[0] === "symbolic-ref" || missing ? 1 : 0,
                stdout: input.args[0] === "rev-parse" ? `${oid}\n` : "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              });
        }) as never,
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed({ newWorktreesStartFromOrigin: false } as never),
    }),
  );
  return make.pipe(
    Effect.map((reactor) => ({ reactor, rows, gitCalls })),
    Effect.provide(dependencies),
  );
};

describe("LineBranchReactor", () => {
  it.effect("includes slot changes in its reconciliation stream", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([], "base-new", detail, {
        slotChanges: Stream.make(undefined),
      });
      assert.ok(Option.isSome(yield* Stream.runHead(harness.reactor.changes)));
    }),
  );

  it.effect("mints root and fork line branches in every linked repository", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.reactor.reconcile();
      assert.strictEqual(harness.rows.length, 4);
      assert.deepStrictEqual(
        new Set(harness.rows.map((row) => row.lineRootCommitId)),
        new Set([root, forkChild]),
      );
      assert.deepStrictEqual(
        new Set(harness.rows.map((row) => row.repositoryId)),
        new Set([repositoryA, repositoryB]),
      );
      assert.strictEqual(harness.gitCalls.filter((call) => call.args[0] === "branch").length, 4);
      assert.ok(!harness.gitCalls.some((call) => call.args.includes("push")));
    }),
  );

  it.effect(
    "inherits each repository's branch tip and snapshot from a project-scoped session",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([], "repository-default", detailWithSession(false));
        yield* harness.reactor.reconcile();

        const forkRow = (repositoryId: MercurianRepositoryId) =>
          harness.rows.find(
            (row) => row.lineRootCommitId === sessionForkChild && row.repositoryId === repositoryId,
          );
        assert.strictEqual(forkRow(repositoryA)?.baseOid, "tip-a");
        assert.strictEqual(forkRow(repositoryB)?.baseOid, "repository-default");
        const seeded = harness.gitCalls.filter((call) => call.args[0] === "update-ref");
        assert.strictEqual(seeded.length, 1);
        assert.strictEqual(seeded[0]?.cwd, "/repositories/a");
        assert.strictEqual(seeded[0]?.args[2], "snapshot-a");
      }),
  );

  it.effect("still inherits a legacy session's singular facts", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([], "repository-default", detailWithSession(true));
      yield* harness.reactor.reconcile();

      const forkRow = (repositoryId: MercurianRepositoryId) =>
        harness.rows.find(
          (row) => row.lineRootCommitId === sessionForkChild && row.repositoryId === repositoryId,
        );
      assert.strictEqual(forkRow(repositoryA)?.baseOid, "legacy-oid-a");
      assert.strictEqual(forkRow(repositoryB)?.baseOid, "repository-default");
      const seeded = harness.gitCalls.filter((call) => call.args[0] === "update-ref");
      assert.deepStrictEqual(
        seeded.map((call) => [call.cwd, call.args[2]]),
        [["/repositories/a", "legacy-snapshot-a"]],
      );
    }),
  );

  it.effect("re-points an unbuilt line when its resolved base changes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([
        {
          lineRootCommitId: root,
          repositoryId: repositoryA,
          branch: "mercurian/line-branches-root",
          baseOid: "base-old",
          built: false,
          repointHold: null,
          createdAt,
        },
      ]);
      yield* harness.reactor.reconcile();
      assert.ok(
        harness.gitCalls.some((call) => call.args[0] === "branch" && call.args[1] === "-f"),
      );
      assert.strictEqual(
        harness.rows.find(
          (row) => row.lineRootCommitId === root && row.repositoryId === repositoryA,
        )?.baseOid,
        "base-new",
      );
    }),
  );

  it.effect("continues reconciling after git fails for one repository", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([], "base-new", detail, {
        failBranchCwd: "/repositories/a",
      });
      yield* harness.reactor.reconcile();

      assert.strictEqual(harness.rows.filter((row) => row.repositoryId === repositoryA).length, 0);
      assert.deepStrictEqual(
        new Set(
          harness.rows
            .filter((row) => row.repositoryId === repositoryB)
            .map((row) => row.lineRootCommitId),
        ),
        new Set([root, forkChild]),
      );
    }),
  );

  it.effect("never moves a built line branch", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([
        {
          lineRootCommitId: root,
          repositoryId: repositoryA,
          branch: "mercurian/line-branches-root",
          baseOid: "base-old",
          built: true,
          repointHold: null,
          createdAt,
        },
      ]);
      yield* harness.reactor.reconcile();
      assert.ok(
        !harness.gitCalls.some(
          (call) =>
            call.cwd === "/repositories/a" && call.args[0] === "branch" && call.args[1] === "-f",
        ),
      );
      assert.strictEqual(harness.rows[0]?.baseOid, "base-old");
    }),
  );

  it.effect("holds an unbuilt line while its branch is checked out in a slot", () =>
    Effect.gen(function* () {
      const branch = "mercurian/line-branches-root";
      const harness = yield* makeHarness(
        [
          {
            lineRootCommitId: root,
            repositoryId: repositoryA,
            branch,
            baseOid: "base-old",
            built: false,
            repointHold: null,
            createdAt,
          },
        ],
        "base-new",
        detail,
        { checkedOutBranch: branch },
      );
      yield* harness.reactor.reconcile();
      assert.ok(
        !harness.gitCalls.some(
          (call) =>
            call.cwd === "/repositories/a" && call.args[0] === "branch" && call.args[1] === "-f",
        ),
      );
      assert.strictEqual(harness.rows[0]?.repointHold, "checked-out");
    }),
  );

  it.effect("holds a missing name and clears the hold after a successful re-point", () =>
    Effect.gen(function* () {
      const branch = "mercurian/line-branches-root";
      const row: LineBranchStore.LineBranch = {
        lineRootCommitId: root,
        repositoryId: repositoryA,
        branch,
        baseOid: "base-old",
        built: false,
        repointHold: null,
        createdAt,
      };
      const missing = yield* makeHarness([row], "base-new", detail, {
        missingBranches: [branch],
      });
      yield* missing.reactor.reconcile();
      assert.strictEqual(missing.rows[0]?.repointHold, "name-missing");
      assert.ok(
        !missing.gitCalls.some(
          (call) =>
            call.cwd === "/repositories/a" && call.args[0] === "branch" && call.args[1] === "-f",
        ),
      );

      const available = yield* makeHarness([{ ...row, repointHold: "name-missing" }]);
      yield* available.reactor.reconcile();
      assert.strictEqual(available.rows[0]?.baseOid, "base-new");
      assert.strictEqual(available.rows[0]?.repointHold, null);
    }),
  );

  it.effect("seeds only an inherited line snapshot from its ancestor session", () =>
    Effect.gen(function* () {
      const inheritedDetail = {
        plan: { planId, projectId, title: "Line branches" },
        timeline: [
          { _tag: "plan-revision", commitId: root, parents: [], sequence: 1, createdAt },
          {
            _tag: "coding-session",
            commitId: sessionCommit,
            repositoryId: repositoryA,
            parents: [root],
            sequence: 2,
            createdAt,
          },
          {
            _tag: "message",
            commitId: mainChild,
            parents: [sessionCommit],
            sequence: 3,
            createdAt,
          },
          {
            _tag: "message",
            commitId: forkChild,
            parents: [sessionCommit],
            sequence: 4,
            createdAt,
          },
        ],
        codingSessions: [
          {
            commitId: sessionCommit,
            repositoryId: repositoryA,
            settledCommitOid: "branch-tip",
            snapshotOid: "ancestor-snapshot",
          },
        ],
      } as never;
      const harness = yield* makeHarness([], "base-new", inheritedDetail);
      yield* harness.reactor.reconcile();
      const inheritedUpdates = harness.gitCalls.filter((call) => call.args[0] === "update-ref");
      assert.strictEqual(inheritedUpdates.length, 1);
      assert.strictEqual(inheritedUpdates[0]?.args[2], "ancestor-snapshot");
      assert.ok(inheritedUpdates[0]?.args[1]?.endsWith("/snapshot"));
    }),
  );
});
