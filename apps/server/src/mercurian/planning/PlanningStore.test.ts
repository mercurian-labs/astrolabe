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
import { CommitId, HistoryId } from "../commitTree/schema.ts";
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

      const detail = yield* store.getPlanSnapshot({ planId: first.plan.planId });
      assert.deepStrictEqual(
        detail.timeline.map((item) => (item._tag === "message" ? item.text : null)),
        ["First plan", "A second message"],
      );
      assert.deepStrictEqual(detail.timeline.map((item) => item.commitId).slice(1), [
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

      const missingPlan = yield* Effect.flip(
        store.getPlanSnapshot({ planId: PlanId.make("nope") }),
      );
      assert.strictEqual(missingPlan._tag, "PlanNotFoundError");

      const missingPlanRevision = yield* Effect.flip(
        store.savePlanRevision({
          planId: PlanId.make("nope"),
          text: "Anything",
          createdAt: at("2026-08-03T00:00:00.000Z"),
        }),
      );
      assert.strictEqual(missingPlanRevision._tag, "PlanNotFoundError");

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

  it.effect("is born blank: an empty artifact, and no revision to show for it", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      assert.strictEqual(created.planText, "");
      assert.deepStrictEqual(
        created.timeline.map((item) => item._tag),
        ["message"],
      );

      const detail = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      assert.strictEqual(detail.planText, "");
      assert.strictEqual(detail.snapshotSequence, created.snapshotSequence);

      const path = yield* commits.listCommits({
        historyId: created.plan.historyId,
        visibility: "all",
      });
      assert.deepStrictEqual(
        path.filter((commit) => commit.kind === "plan-revision"),
        [],
      );
    }),
  );

  it.effect("lands a direct edit as a commit at the tip, attributable and dated", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 1)), {
        startImmediately: true,
      });

      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Approach\n\nStart from the tree.",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });

      assert.strictEqual(revision.authorKind, "human");
      assert.strictEqual(DateTime.formatIso(revision.createdAt), "2026-08-03T00:02:00.000Z");

      // The revision hangs from the message that preceded it: one history,
      // not an edit log beside it.
      const path = yield* commits.listCommits({
        historyId: created.plan.historyId,
        visibility: "all",
      });
      const landed = path.find((commit) => commit.commitId === revision.commitId);
      assert.strictEqual(landed?.kind, "plan-revision");
      assert.deepStrictEqual([...(landed?.parents ?? [])], [path[0]!.commitId]);

      const detail = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      assert.strictEqual(detail.planText, "# Approach\n\nStart from the tree.");
      // An edit is activity: the tree's recency ordering feels it.
      assert.strictEqual(DateTime.formatIso(detail.plan.updatedAt), "2026-08-03T00:02:00.000Z");

      const signals = yield* Fiber.join(changes);
      assert.strictEqual(signals.length, 1);
    }),
  );

  it.effect("interleaves revisions and messages in one history at the same standing", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "First draft",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      yield* store.appendMessage({
        planId: created.plan.planId,
        text: "What about the tree?",
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });
      yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "Second draft",
        createdAt: at("2026-08-03T00:04:00.000Z"),
      });

      const detail = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      assert.deepStrictEqual(
        detail.timeline.map((item) => item._tag),
        ["message", "plan-revision", "message", "plan-revision"],
      );
      // Every item carries its attribution and its place in the order.
      assert.ok(detail.timeline.every((item) => item.authorKind === "human"));
      assert.deepStrictEqual(
        [...detail.timeline].sort((left, right) => left.sequence - right.sequence),
        [...detail.timeline],
      );
      // The artifact is the fold: the last revision on the path, not a column.
      assert.strictEqual(detail.planText, "Second draft");

      // No separate edit history: everything that happened is in the one
      // history, and nothing else records it.
      const path = yield* commits.listCommits({
        historyId: created.plan.historyId,
        visibility: "all",
      });
      assert.strictEqual(path.length, detail.timeline.length);
      assert.strictEqual(detail.snapshotSequence, path.at(-1)?.sequence);
    }),
  );

  it.effect("derives the artifact without assuming a blank root", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;
      const sql = yield* SqlClient.SqlClient;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });

      // The import shape: a history whose *root* is a plan revision. Nothing
      // in the derivation may assume revision one arrives after a message.
      const historyId = HistoryId.make("imported-history");
      yield* commits.createHistory({
        historyId,
        rootCommit: {
          commitId: CommitId.make("imported-root"),
          kind: "plan-revision",
          authorKind: "human",
          createdAt: at("2026-08-03T00:01:00.000Z"),
          payload: { text: "Imported plan body" },
        },
        rootPublished: true,
      });
      const planId = PlanId.make("imported-plan");
      yield* sql`
        INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at)
        VALUES (
          ${planId},
          ${project.projectId},
          ${historyId},
          ${"Imported plan"},
          ${"2026-08-03T00:01:00.000Z"},
          ${"2026-08-03T00:01:00.000Z"}
        )
      `;

      const detail = yield* store.getPlanSnapshot({ planId });
      assert.strictEqual(detail.planText, "Imported plan body");
      assert.deepStrictEqual(
        detail.timeline.map((item) => item._tag),
        ["plan-revision"],
      );
    }),
  );

  it.effect("reads only what landed after a cursor, artifact text and all", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      const nothingYet = yield* store.listTimelineSince({
        planId: created.plan.planId,
        afterSequence: created.snapshotSequence,
      });
      assert.deepStrictEqual(nothingYet, []);

      yield* store.appendMessage({
        planId: created.plan.planId,
        text: "What about the tree?",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "First draft",
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });

      const since = yield* store.listTimelineSince({
        planId: created.plan.planId,
        afterSequence: created.snapshotSequence,
      });
      assert.deepStrictEqual(
        since.map((event) => event.item._tag),
        ["message", "plan-revision"],
      );
      // Text rides only on the event that changed the artifact.
      assert.deepStrictEqual(
        since.map((event) => event.planText),
        [undefined, "First draft"],
      );
      assert.strictEqual(since.at(-1)?.item.commitId, revision.commitId);
    }),
  );

  it.effect("treats clearing the plan as an edit, not an error", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "Something",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "",
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });

      const detail = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      assert.strictEqual(detail.planText, "");
      assert.deepStrictEqual(
        detail.timeline.map((item) => item._tag),
        ["message", "plan-revision", "plan-revision"],
      );
    }),
  );

  it.effect("refuses a second plan on one planning space", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const sql = yield* SqlClient.SqlClient;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      // One plan per planning space is structural, not a convention the
      // service is trusted to keep: the row refuses below the store.
      const second = yield* Effect.flip(sql`
        INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at)
        VALUES (
          ${"second-plan"},
          ${project.projectId},
          ${created.plan.historyId},
          ${"A second plan"},
          ${"2026-08-03T00:02:00.000Z"},
          ${"2026-08-03T00:02:00.000Z"}
        )
      `);
      assert.strictEqual(second._tag, "SqlError");

      const [counts] = yield* sql<{ readonly plans: number }>`
        SELECT COUNT(*) AS "plans" FROM plans WHERE history_id = ${created.plan.historyId}
      `;
      assert.strictEqual(counts?.plans, 1);
    }),
  );
});
