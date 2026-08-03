import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { MercurianProjectId, PlanId } from "@t3tools/contracts";

import * as CommitStore from "../commitTree/CommitStore.ts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as PlanningStore from "./PlanningStore.ts";

const layer = it.layer(
  PlanningStore.layer.pipe(
    Layer.provideMerge(CommitStore.layer),
    Layer.provideMerge(MercurianSqlite.layerMemory),
    Layer.provide(NodeServicesLayer),
  ),
);

const at = (iso: string) => DateTime.makeUnsafe(iso);

layer("PlanningStore", (it) => {
  it.effect("round-trips a project, which starts with no plans", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      assert.strictEqual(project.name, "Astrolabe");

      const snapshot = yield* store.getTreeSnapshot;
      assert.ok(snapshot.projects.some((entry) => entry.projectId === project.projectId));
      assert.deepStrictEqual(
        snapshot.plans.filter((plan) => plan.projectId === project.projectId),
        [],
      );
    }),
  );

  it.effect("births a plan at its first commit, and only there", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;
      const sql = yield* SqlClient.SqlClient;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });

      const detail = yield* store.createPlan({
        projectId: project.projectId,
        message: "Reshape the sidebar into the project tree",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      const path = yield* commits.listCommits({
        historyId: detail.plan.historyId,
        visibility: "all",
      });
      assert.strictEqual(path.length, 1);
      const root = path[0]!;
      assert.deepStrictEqual([...root.parents], []);
      assert.strictEqual(root.kind, "message");
      assert.strictEqual(root.authorKind, "human");
      assert.strictEqual(root.published, false);

      const snapshot = yield* store.getTreeSnapshot;
      assert.deepStrictEqual(
        snapshot.plans
          .filter((plan) => plan.projectId === project.projectId)
          .map((plan) => plan.planId),
        [detail.plan.planId],
      );

      // Every plan names a history, and every history a plan created has a
      // plan: there is no API shape that leaves an empty row behind.
      const [counts] = yield* sql<{
        readonly plans: number;
        readonly histories: number;
      }>`
        SELECT
          (SELECT COUNT(*) FROM plans) AS "plans",
          (SELECT COUNT(*) FROM commit_histories) AS "histories"
      `;
      assert.strictEqual(counts?.plans, counts?.histories);
    }),
  );

  it.effect("appends at the tip, bumps the plan, and reorders the project", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const first = yield* store.createPlan({
        projectId: project.projectId,
        message: "First plan",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const second = yield* store.createPlan({
        projectId: project.projectId,
        message: "Second plan",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });

      const plansOf = (snapshot: {
        readonly plans: ReadonlyArray<{ readonly projectId: string; readonly planId: string }>;
      }) =>
        snapshot.plans
          .filter((plan) => plan.projectId === project.projectId)
          .map((plan) => plan.planId);

      const beforeAppend = yield* store.getTreeSnapshot;
      assert.deepStrictEqual(plansOf(beforeAppend), [second.plan.planId, first.plan.planId]);

      const appended = yield* store.appendMessage({
        planId: first.plan.planId,
        text: "A second message",
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });
      assert.strictEqual(appended.text, "A second message");

      const detail = yield* store.getPlan({ planId: first.plan.planId });
      assert.deepStrictEqual(
        detail.messages.map((message) => message.text),
        ["First plan", "A second message"],
      );
      assert.deepStrictEqual(detail.messages.map((message) => message.commitId).slice(1), [
        appended.commitId,
      ]);

      const afterAppend = yield* store.getTreeSnapshot;
      assert.deepStrictEqual(plansOf(afterAppend), [first.plan.planId, second.plan.planId]);
    }),
  );

  it.effect("derives a plan title from the message's first line", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });

      const titled = yield* store.createPlan({
        projectId: project.projectId,
        message: "  Trim the sidebar  \nand the rest of the message",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      assert.strictEqual(titled.plan.title, "Trim the sidebar");

      const long = yield* store.createPlan({
        projectId: project.projectId,
        message: "x".repeat(200),
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      assert.strictEqual(long.plan.title.length, 80);

      const blank = yield* store.createPlan({
        projectId: project.projectId,
        message: "   \n\n  ",
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });
      assert.strictEqual(blank.plan.title, "Untitled plan");
    }),
  );

  it.effect("refuses an unknown project or plan", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const missingProject = yield* Effect.flip(
        store.createPlan({
          projectId: MercurianProjectId.make("nope"),
          message: "Anything",
          createdAt: at("2026-08-03T00:00:00.000Z"),
        }),
      );
      assert.strictEqual(missingProject._tag, "MercurianProjectNotFoundError");

      const missingPlan = yield* Effect.flip(store.getPlan({ planId: PlanId.make("nope") }));
      assert.strictEqual(missingPlan._tag, "PlanNotFoundError");

      const missingPlanAppend = yield* Effect.flip(
        store.appendMessage({
          planId: PlanId.make("nope"),
          text: "Anything",
          createdAt: at("2026-08-03T00:00:00.000Z"),
        }),
      );
      assert.strictEqual(missingPlanAppend._tag, "PlanNotFoundError");
    }),
  );

  it.effect("signals a change on every mutation", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      // Take before mutating: the signal is live, not replayed.
      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 2)), {
        startImmediately: true,
      });

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      yield* store.createPlan({
        projectId: project.projectId,
        message: "First plan",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      const signals = yield* Fiber.join(changes);
      assert.strictEqual(signals.length, 2);
    }),
  );
});
