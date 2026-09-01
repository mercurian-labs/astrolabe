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
import { make } from "./LineBranchReactor.ts";
import * as LineBranchStore from "./LineBranchStore.ts";

const planId = PlanId.make("plan-one");
const projectId = MercurianProjectId.make("project-one");
const repositoryA = MercurianRepositoryId.make("repository-a");
const repositoryB = MercurianRepositoryId.make("repository-b");
const root = MercurianCommitId.make("root");
const mainChild = MercurianCommitId.make("main-child");
const forkChild = MercurianCommitId.make("fork-child");
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

const makeHarness = (initial: ReadonlyArray<LineBranchStore.LineBranch> = [], oid = "base-new") => {
  const rows = [...initial];
  const gitCalls: Array<{ readonly cwd: string; readonly args: ReadonlyArray<string> }> = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(PlanningStore.PlanningStore)({
      getTreeSnapshot: Effect.succeed({
        plans: [{ planId, projectId, title: "Line branches" }],
      } as never),
      getPlanSnapshot: () => Effect.succeed(detail),
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
    }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (input) =>
        Effect.sync(() => {
          gitCalls.push({ cwd: input.cwd, args: input.args });
          return {
            exitCode: input.args[0] === "symbolic-ref" ? 1 : 0,
            stdout: input.args[0] === "rev-parse" ? `${oid}\n` : "",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          };
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

  it.effect("re-points an unbuilt line when its resolved base changes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([
        {
          lineRootCommitId: root,
          repositoryId: repositoryA,
          branch: "mercurian/line-branches-root",
          baseOid: "base-old",
          built: false,
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

  it.effect("never moves a built line branch", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([
        {
          lineRootCommitId: root,
          repositoryId: repositoryA,
          branch: "mercurian/line-branches-root",
          baseOid: "base-old",
          built: true,
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
});
