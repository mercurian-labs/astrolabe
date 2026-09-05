import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  MercurianProjectId,
  PlanId,
  PlanTurnId,
  ProviderDriverKind,
  ThreadId,
  TrackerConnectionId,
} from "@t3tools/contracts";

import * as CommitStore from "../commitTree/CommitStore.ts";
import * as LegacySessionStore from "../lineRuntimes/LegacySessionStore.ts";
import * as LineRuntimeStore from "../lineRuntimes/LineRuntimeStore.ts";
import * as Config from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { CommitId, HistoryId } from "../commitTree/schema.ts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as PlanningStore from "./PlanningStore.ts";
import * as PlanTurnRegistry from "./PlanTurnRegistry.ts";

const layer = it.layer(
  PlanningStore.layer.pipe(
    Layer.provideMerge(LegacySessionStore.layer),
    Layer.provideMerge(LineRuntimeStore.layer),
    Layer.provideMerge(RepositoryStore.layer),
    Layer.provideMerge(PlanTurnRegistry.layer),
    Layer.provideMerge(CommitStore.layer),
    Layer.provideMerge(MercurianSqlite.layerMemory),
    Layer.provideMerge(ProcessRunner.layer),
    Layer.provideMerge(Config.layerTest(process.cwd(), { prefix: "planning-store-" })),
    Layer.provide(NodeServicesLayer),
  ),
);

const at = (iso: string) => DateTime.makeUnsafe(iso);
const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");

it.effect("decodes legacy spec payloads into the two prose fields", () =>
  Effect.gen(function* () {
    const nested = yield* PlanningStore.decodeSpecRevisionPayload({
      document: { title: "Outcome", description: "- [ ] Observable behavior" },
      source: {
        kind: "tracker-reconciliation",
        issueId: "M-109",
        upstream: { title: "Upstream outcome", description: "- [ ] Upstream behavior" },
      },
    });
    assert.deepStrictEqual(nested, {
      document: { goal: "Outcome", acceptanceCriteria: "- [ ] Observable behavior" },
      source: {
        kind: "tracker-reconciliation",
        issueId: "M-109",
        upstream: {
          goal: "Upstream outcome",
          acceptanceCriteria: "- [ ] Upstream behavior",
        },
      },
    });

    const flat = yield* PlanningStore.decodeSpecRevisionPayload({
      title: "Imported issue",
      description: "Original tracker body",
    });
    assert.deepStrictEqual(flat, {
      document: { goal: "Imported issue", acceptanceCriteria: "Original tracker body" },
    });
  }),
);

layer("PlanningStore", (it) => {
  it.effect("announces memory amendments without visits or ordinary planning activity", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const now = at("2026-09-05T00:00:00Z");
      const project = yield* store.createProject({ name: "Memory", createdAt: now });
      const plan = yield* store.createPlan({
        projectId: project.projectId,
        message: "Start",
        lastUsed: null,
        createdAt: now,
      });
      const pull = yield* Stream.toPull(store.memoryChanges);
      const first = yield* pull.pipe(Effect.forkChild({ startImmediately: true }));
      yield* store.recordPlanVisit({ planId: plan.plan.planId, visitedAt: now });
      yield* store.markPlanUnread({ planId: plan.plan.planId });
      const reply = yield* store.appendAssistantMessage({
        planId: plan.plan.planId,
        parentCommitId: plan.timeline[0]!.commitId,
        text: "No memory edit",
        createdAt: now,
      });
      const amendment = yield* store.appendMemoryAmendment({
        planId: plan.plan.planId,
        parentCommitId: reply.commitId,
        title: "Memory capture",
        memoryCommitSha: "abc",
        branch: "line",
        notes: ["A.md"],
        createdAt: now,
      });
      assert.deepStrictEqual(yield* Fiber.join(first), [
        { planId: plan.plan.planId, commitId: amendment.commitId },
      ]);
    }),
  );

  it("classifies refreshes against the ancestry-derived upstream baseline", () => {
    const base = { goal: "Contract", acceptanceCriteria: "Original" };
    const upstream = { goal: "Contract", acceptanceCriteria: "Upstream" };
    const local = { goal: "Contract", acceptanceCriteria: "Local" };
    assert.deepStrictEqual(PlanningStore.classifySpecRefresh({ base, local, upstream: base }), {
      kind: "unchanged",
    });
    assert.deepStrictEqual(PlanningStore.classifySpecRefresh({ base, local: base, upstream }), {
      kind: "committed",
      document: upstream,
    });
    assert.deepStrictEqual(PlanningStore.classifySpecRefresh({ base, local: upstream, upstream }), {
      kind: "committed-converged",
      document: upstream,
    });
    assert.deepStrictEqual(PlanningStore.classifySpecRefresh({ base, local, upstream }), {
      kind: "reconciliation-required",
      base,
      local,
      upstream,
    });
  });

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
        lastUsed: null,
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

  it.effect("stamps explicit and last-used pairs on turn-opening messages", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });

      const overridden = yield* store.createPlan({
        projectId: project.projectId,
        message: "Use Codex here",
        modelChoice: {
          provider: codex,
          model: "gpt-5.4",
          options: [{ id: "effort", value: "high" }],
        },
        lastUsed: { provider: claude, model: "opus" },
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const overrideRoot = overridden.timeline[0]!;
      assert.ok(overrideRoot._tag === "message");
      assert.deepStrictEqual(overrideRoot.ranUnder, {
        provider: codex,
        model: "gpt-5.4",
        options: [{ id: "effort", value: "high" }],
      });

      const seeded = yield* store.createPlan({
        projectId: project.projectId,
        message: "Seed from the last-used pair",
        lastUsed: {
          provider: claude,
          model: "sonnet",
          options: [{ id: "effort", value: "max" }],
        },
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      const seededRoot = seeded.timeline[0]!;
      assert.ok(seededRoot._tag === "message");
      assert.deepStrictEqual(seededRoot.ranUnder, {
        provider: claude,
        model: "sonnet",
        options: [{ id: "effort", value: "max" }],
      });

      const roundTripped = yield* store.getPlanSnapshot({ planId: overridden.plan.planId });
      const roundTrippedRoot = roundTripped.timeline[0]!;
      assert.ok(roundTrippedRoot._tag === "message");
      assert.deepStrictEqual(roundTrippedRoot.ranUnder, overrideRoot.ranUnder);

      const unset = yield* store.createPlan({
        projectId: project.projectId,
        message: "Nothing has run yet",
        lastUsed: null,
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });
      const unsetRoot = unset.timeline[0]!;
      assert.ok(unsetRoot._tag === "message");
      assert.strictEqual(unsetRoot.ranUnder, undefined);
    }),
  );

  it.effect("inherits and re-stamps the nearest branch choice across a fork", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:10:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Override this branch",
        modelChoice: {
          provider: codex,
          model: "gpt-5.4",
          options: [{ id: "effort", value: "high" }],
        },
        lastUsed: { provider: claude, model: "opus" },
        createdAt: at("2026-08-03T00:11:00.000Z"),
      });
      const root = created.timeline[0]!.commitId;

      const onward = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root,
        text: "Inherit without a directive",
        lastUsed: { provider: claude, model: "sonnet" },
        createdAt: at("2026-08-03T00:12:00.000Z"),
      });
      assert.deepStrictEqual(onward.ranUnder, {
        provider: codex,
        model: "gpt-5.4",
        options: [{ id: "effort", value: "high" }],
      });

      const fork = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root,
        text: "Fork from the override",
        lastUsed: { provider: claude, model: "sonnet" },
        createdAt: at("2026-08-03T00:13:00.000Z"),
      });
      assert.deepStrictEqual(fork.ranUnder, onward.ranUnder);
      assert.deepStrictEqual(
        yield* store.standingModelChoice({
          planId: created.plan.planId,
          commitId: fork.commitId,
        }),
        {
          provider: codex,
          model: "gpt-5.4",
          options: [{ id: "effort", value: "high" }],
        },
      );

      const switched = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: onward.commitId,
        text: "Switch this branch",
        modelChoice: { provider: claude, model: "sonnet" },
        lastUsed: { provider: claude, model: "sonnet" },
        createdAt: at("2026-08-03T00:14:00.000Z"),
      });
      assert.deepStrictEqual(
        yield* store.standingModelChoice({
          planId: created.plan.planId,
          commitId: switched.commitId,
        }),
        { provider: claude, model: "sonnet" },
      );
      const inheritedSwitch = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: switched.commitId,
        text: "Inherit the switched pair",
        lastUsed: { provider: claude, model: "opus" },
        createdAt: at("2026-08-03T00:15:00.000Z"),
      });
      assert.deepStrictEqual(inheritedSwitch.ranUnder, {
        provider: claude,
        model: "sonnet",
      });
    }),
  );

  it.effect("walks past interleaved spec and plan revisions for the standing choice", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:16:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Keep this branch on Codex",
        modelChoice: { provider: codex, model: "gpt-5.4" },
        lastUsed: { provider: claude, model: "opus" },
        createdAt: at("2026-08-03T00:17:00.000Z"),
      });
      const root = created.timeline[0]!.commitId;
      const spec = yield* store.saveSpecRevision({
        planId: created.plan.planId,
        parentCommitId: root,
        expectedSpecRevisionCommitId: null,
        document: {
          goal: "Preserve the recorded branch model",
          acceptanceCriteria: "Artifact edits do not carry model state.",
        },
        createdAt: at("2026-08-03T00:18:00.000Z"),
      });
      const plan = yield* store.savePlanRevision({
        planId: created.plan.planId,
        parentCommitId: spec.commitId,
        text: "# Continue with the recorded model",
        createdAt: at("2026-08-03T00:19:00.000Z"),
      });

      assert.deepStrictEqual(
        yield* store.standingModelChoice({
          planId: created.plan.planId,
          commitId: plan.commitId,
        }),
        { provider: codex, model: "gpt-5.4" },
      );
      const next = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: plan.commitId,
        text: "Inherit across both artifacts",
        lastUsed: { provider: claude, model: "sonnet" },
        createdAt: at("2026-08-03T00:20:00.000Z"),
      });
      assert.deepStrictEqual(next.ranUnder, { provider: codex, model: "gpt-5.4" });

      const path = yield* commits.listCommits({
        historyId: created.plan.historyId,
        visibility: "all",
      });
      for (const artifact of path.filter((commit) => commit.kind !== "message")) {
        assert.ok(
          typeof artifact.payload !== "object" ||
            artifact.payload === null ||
            !("ranUnder" in artifact.payload),
        );
      }
    }),
  );

  it.effect("decodes bare history and persists assistant model attribution", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:20:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Written before model records existed",
        lastUsed: null,
        createdAt: at("2026-08-03T00:21:00.000Z"),
      });
      const root = created.timeline[0]!.commitId;
      const [storedRoot] = yield* commits.listCommits({
        historyId: created.plan.historyId,
        visibility: "all",
      });
      assert.deepStrictEqual(storedRoot?.payload, {
        text: "Written before model records existed",
      });
      assert.strictEqual(
        yield* store.standingModelChoice({ planId: created.plan.planId, commitId: root }),
        null,
      );

      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE commits
        SET payload_json = json_object(
          'text', 'Written before model records existed',
          'ranUnder', json_object(
            'provider', 'claudeAgent',
            'model', 'opus',
            'followedDefault', json('true')
          )
        )
        WHERE commit_id = ${root}
      `;
      const oldPayload = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const oldRoot = oldPayload.timeline[0]!;
      assert.ok(oldRoot._tag === "message");
      assert.deepStrictEqual(oldRoot.ranUnder, { provider: claude, model: "opus" });
      assert.deepStrictEqual(
        yield* store.standingModelChoice({ planId: created.plan.planId, commitId: root }),
        { provider: claude, model: "opus" },
      );

      const reply = yield* store.appendAssistantMessage({
        planId: created.plan.planId,
        parentCommitId: root,
        text: "A reply",
        sourceUserMessageId: root,
        generatedBy: {
          provider: claude,
          model: "opus",
          options: [{ id: "effort", value: "high" }],
        },
        createdAt: at("2026-08-03T00:22:00.000Z"),
      });
      assert.deepStrictEqual(reply.generatedBy, {
        provider: claude,
        model: "opus",
        options: [{ id: "effort", value: "high" }],
      });

      const decoded = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const decodedRoot = decoded.timeline[0]!;
      assert.ok(decodedRoot._tag === "message");
      assert.deepStrictEqual(decodedRoot.ranUnder, { provider: claude, model: "opus" });
      assert.strictEqual(decodedRoot.generatedBy, undefined);
      const decodedReply = decoded.timeline[1]!;
      assert.ok(decodedReply._tag === "message");
      assert.strictEqual(decodedReply.sourceUserMessageId, root);
      assert.deepStrictEqual(decodedReply.generatedBy, {
        provider: claude,
        model: "opus",
        options: [{ id: "effort", value: "high" }],
      });
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
        lastUsed: null,
        projectId: project.projectId,
        message: "First plan",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const second = yield* store.createPlan({
        lastUsed: null,
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
        lastUsed: null,
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
        lastUsed: null,
        projectId: project.projectId,
        message: "  Trim the sidebar  \nand the rest of the message",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      assert.strictEqual(titled.plan.title, "Trim the sidebar");

      const long = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "x".repeat(200),
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      assert.strictEqual(long.plan.title.length, 80);

      const blank = yield* store.createPlan({
        lastUsed: null,
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
          lastUsed: null,
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
          lastUsed: null,
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
        lastUsed: null,
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
        lastUsed: null,
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
        lastUsed: null,
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

  it.effect("drafts a blank plan's spec and guards later edits with the path revision", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Plan from a blank contract",
        lastUsed: null,
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const root = created.timeline[0]!;
      assert.strictEqual(created.spec, null);

      const revision = yield* store.saveSpecRevision({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        expectedSpecRevisionCommitId: null,
        document: {
          goal: "Sidebar remains navigable",
          acceptanceCriteria: "Users can change projects without leaving the planning space.",
        },
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      assert.strictEqual(revision.authorKind, "human");
      assert.strictEqual(revision.cause, "direct");

      const before = yield* store.getSpecAt({
        planId: created.plan.planId,
        commitId: root.commitId,
      });
      assert.strictEqual(before, null);

      const current = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      assert.strictEqual(current.spec?.revisionCommitId, revision.commitId);
      assert.strictEqual(current.spec?.document.goal, "Sidebar remains navigable");

      const stale = yield* Effect.flip(
        store.saveSpecRevision({
          planId: created.plan.planId,
          parentCommitId: revision.commitId,
          expectedSpecRevisionCommitId: null,
          document: { goal: "Stale edit", acceptanceCriteria: "Must not land." },
          createdAt: at("2026-08-03T00:03:00.000Z"),
        }),
      );
      assert.strictEqual(stale._tag, "SpecRevisionOutdatedError");

      const unchanged = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      assert.strictEqual(unchanged.spec?.revisionCommitId, revision.commitId);
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
        lastUsed: null,
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
        lastUsed: null,
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
        lastUsed: null,
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
        lastUsed: null,
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
        lastUsed: null,
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
        lastUsed: null,
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

  it.effect("carries each commit's edges and its published state onto the timeline", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "First draft",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });

      const detail = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const [root, revision] = detail.timeline;
      assert.deepStrictEqual([...(root?.parents ?? [])], []);
      assert.deepStrictEqual([...(revision?.parents ?? [])], [root?.commitId]);
      // Everything written in-app is born private; publishing has no write
      // path yet, so the explorer's distinction runs against a uniform input.
      assert.ok(detail.timeline.every((item) => item.published === false));
    }),
  );

  it.effect("reads the artifact as of any commit on the path", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const rootCommitId = created.timeline[0]!.commitId;

      // A plan born blank has nothing above its root: the empty artifact is a
      // real answer, not a missing one.
      assert.strictEqual(
        yield* store.getPlanTextAt({ planId: created.plan.planId, commitId: rootCommitId }),
        "",
      );

      const first = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "First draft",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      const message = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "What about the tree?",
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });
      const cleared = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "",
        createdAt: at("2026-08-03T00:04:00.000Z"),
      });

      assert.strictEqual(
        yield* store.getPlanTextAt({ planId: created.plan.planId, commitId: first.commitId }),
        "First draft",
      );
      // A message leaves the artifact exactly as the revision below it left it.
      assert.strictEqual(
        yield* store.getPlanTextAt({ planId: created.plan.planId, commitId: message.commitId }),
        "First draft",
      );
      // Clearing is an edit: the answer is the empty artifact, not the text
      // before it.
      assert.strictEqual(
        yield* store.getPlanTextAt({ planId: created.plan.planId, commitId: cleared.commitId }),
        "",
      );
      // The root still answers from its own past, unmoved by what came after.
      assert.strictEqual(
        yield* store.getPlanTextAt({ planId: created.plan.planId, commitId: rootCommitId }),
        "",
      );
    }),
  );

  it.effect("answers each fork's leaf from its own path", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const rootCommitId = created.timeline[0]!.commitId;
      const shared = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "Shared ground",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });

      // Forking has no UI yet, so the branch is built through the commit store
      // directly — human-authored, which is the only way a fork is legal.
      const branch = (commitId: string, text: string, iso: string) =>
        commits.append({
          historyId: created.plan.historyId,
          commitId: CommitId.make(commitId),
          kind: "plan-revision",
          authorKind: "human",
          parents: [shared.commitId],
          createdAt: at(iso),
          payload: { text },
        });

      const left = yield* branch("fork-left", "Left branch", "2026-08-03T00:03:00.000Z");
      const right = yield* branch("fork-right", "Right branch", "2026-08-03T00:04:00.000Z");

      assert.strictEqual(
        yield* store.getPlanTextAt({ planId: created.plan.planId, commitId: left.commitId }),
        "Left branch",
      );
      // The later sibling does not leak down the other path: each leaf reads
      // its own ancestry.
      assert.strictEqual(
        yield* store.getPlanTextAt({ planId: created.plan.planId, commitId: right.commitId }),
        "Right branch",
      );
      assert.strictEqual(
        yield* store.getPlanTextAt({ planId: created.plan.planId, commitId: shared.commitId }),
        "Shared ground",
      );
      assert.strictEqual(
        yield* store.getPlanTextAt({ planId: created.plan.planId, commitId: rootCommitId }),
        "",
      );
    }),
  );

  it.effect("refuses a commit that does not exist for the plan asked about", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const first = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "First plan",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const second = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Second plan",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });

      const missingPlan = yield* Effect.flip(
        store.getPlanTextAt({
          planId: PlanId.make("nope"),
          commitId: first.timeline[0]!.commitId,
        }),
      );
      assert.strictEqual(missingPlan._tag, "PlanNotFoundError");

      const missingCommit = yield* Effect.flip(
        store.getPlanTextAt({ planId: first.plan.planId, commitId: CommitId.make("nope") }),
      );
      assert.strictEqual(missingCommit._tag, "CommitNotFoundError");

      // A real commit of another plan's history does not exist *for this plan*.
      const foreignCommit = yield* Effect.flip(
        store.getPlanTextAt({
          planId: first.plan.planId,
          commitId: second.timeline[0]!.commitId,
        }),
      );
      assert.strictEqual(foreignCommit._tag, "CommitNotFoundError");
    }),
  );

  it.effect("continues the conversation when the sender names its tip", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const rootCommitId = created.timeline[0]!.commitId;

      const second = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "Start from the tree",
        parentCommitId: rootCommitId,
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      assert.deepStrictEqual([...second.parents], [rootCommitId]);

      // Naming the tip and naming nothing are the same act while the history
      // is one line.
      const third = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "And the explorer?",
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });
      assert.deepStrictEqual([...third.parents], [second.commitId]);
    }),
  );

  it.effect("lands a fork when the sender names a commit that already has a child", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const rootCommitId = created.timeline[0]!.commitId;

      const onward = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "Start from the tree",
        parentCommitId: rootCommitId,
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });

      // Standing back at the root and sending: the fork is the append, and
      // this message is the branch's first commit.
      const sibling = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "Start from the composer instead",
        parentCommitId: rootCommitId,
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });

      assert.deepStrictEqual([...sibling.parents], [rootCommitId]);

      const path = yield* commits.listCommits({
        historyId: created.plan.historyId,
        visibility: "all",
      });
      // Nothing was rewritten: three commits, and the root now has two
      // children the explorer can draw.
      assert.strictEqual(path.length, 3);
      const childrenOfRoot = path.filter((commit) =>
        commit.parents.some((parentId) => parentId === rootCommitId),
      );
      assert.deepStrictEqual(
        childrenOfRoot.map((commit) => commit.commitId).sort(),
        [onward.commitId, sibling.commitId].sort(),
      );

      // Both lines are real, and each answers from its own path.
      assert.strictEqual(
        yield* store.getPlanTextAt({
          planId: created.plan.planId,
          commitId: sibling.commitId,
        }),
        "",
      );
    }),
  );

  it.effect("saves a revision onto the branch its author was standing on", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const rootCommitId = created.timeline[0]!.commitId;

      const left = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "Left",
        parentCommitId: rootCommitId,
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      const right = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "Right",
        parentCommitId: rootCommitId,
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });

      const leftRevision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "The left plan",
        parentCommitId: left.commitId,
        createdAt: at("2026-08-03T00:04:00.000Z"),
      });
      const rightRevision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "The right plan",
        parentCommitId: right.commitId,
        createdAt: at("2026-08-03T00:05:00.000Z"),
      });

      assert.deepStrictEqual([...leftRevision.parents], [left.commitId]);
      assert.deepStrictEqual([...rightRevision.parents], [right.commitId]);

      // The later edit does not leak onto the other branch: each leaf reads
      // the artifact from its own ancestry.
      assert.strictEqual(
        yield* store.getPlanTextAt({
          planId: created.plan.planId,
          commitId: leftRevision.commitId,
        }),
        "The left plan",
      );
      assert.strictEqual(
        yield* store.getPlanTextAt({
          planId: created.plan.planId,
          commitId: rightRevision.commitId,
        }),
        "The right plan",
      );
    }),
  );

  it.effect("refuses a parent that does not exist for the plan being written", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const first = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "First plan",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const second = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Second plan",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });

      const unknownParent = yield* Effect.flip(
        store.appendMessage({
          lastUsed: null,
          planId: first.plan.planId,
          text: "From nowhere",
          parentCommitId: CommitId.make("nope"),
          createdAt: at("2026-08-03T00:03:00.000Z"),
        }),
      );
      assert.strictEqual(unknownParent._tag, "CommitNotFoundError");

      // A real commit of another plan's history does not exist *for this plan*
      // — the same rule reading the artifact reads by.
      const foreignParent = yield* Effect.flip(
        store.savePlanRevision({
          planId: first.plan.planId,
          text: "Somewhere else entirely",
          parentCommitId: second.timeline[0]!.commitId,
          createdAt: at("2026-08-03T00:04:00.000Z"),
        }),
      );
      assert.strictEqual(foreignParent._tag, "CommitNotFoundError");

      // A refused write left nothing behind.
      const detail = yield* store.getPlanSnapshot({ planId: first.plan.planId });
      assert.strictEqual(detail.timeline.length, 1);
    }),
  );

  it.effect("carries a message's images as metadata, and decodes one without them", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Here is the mock",
        attachments: [
          {
            type: "image",
            id: "plan-0000-mock",
            name: "mock.png",
            mimeType: "image/png",
            sizeBytes: 2048,
          },
        ],
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      const born = created.timeline[0]!;
      assert.strictEqual(born._tag, "message");
      assert.deepStrictEqual(
        born._tag === "message" ? born.attachments?.map((entry) => entry.id) : null,
        ["plan-0000-mock"],
      );

      yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "And no image here",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });

      const detail = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const [withImage, without] = detail.timeline;
      assert.strictEqual(withImage?._tag === "message" ? withImage.attachments?.length : null, 1);
      // A message written before images could ride one decodes as a message,
      // not as a broken one.
      assert.strictEqual(
        without?._tag === "message" ? without.attachments : "not-a-message",
        undefined,
      );
    }),
  );

  it.effect("archives a plan out of the tree, idempotently, without moving it", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      assert.strictEqual(created.plan.archivedAt, null);

      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 2)), {
        startImmediately: true,
      });

      yield* store.archivePlan({
        planId: created.plan.planId,
        archivedAt: at("2026-08-04T00:00:00.000Z"),
      });
      // A second archive keeps the first stamp: "archived 3 days ago" should
      // not reset because someone clicked again.
      yield* store.archivePlan({
        planId: created.plan.planId,
        archivedAt: at("2026-08-05T00:00:00.000Z"),
      });

      const snapshot = yield* store.getTreeSnapshot;
      const archived = snapshot.plans.find((plan) => plan.planId === created.plan.planId);
      assert.strictEqual(
        archived?.archivedAt === null || archived?.archivedAt === undefined
          ? null
          : DateTime.formatIso(archived.archivedAt),
        "2026-08-04T00:00:00.000Z",
      );
      // Archiving is not activity: `updatedAt` is untouched, so restoring
      // returns the plan to its old place rather than to the top.
      assert.strictEqual(
        DateTime.formatIso(archived!.updatedAt),
        DateTime.formatIso(created.plan.updatedAt),
      );

      const signals = yield* Fiber.join(changes);
      assert.strictEqual(signals.length, 2);
    }),
  );

  it.effect("restores an archived plan", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      yield* store.archivePlan({
        planId: created.plan.planId,
        archivedAt: at("2026-08-04T00:00:00.000Z"),
      });
      yield* store.unarchivePlan({ planId: created.plan.planId });

      const detail = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      assert.strictEqual(detail.plan.archivedAt, null);
      // The space itself was never touched: archiving destroys nothing, so the
      // history is exactly what it was.
      assert.strictEqual(detail.timeline.length, 1);
    }),
  );

  it.effect("refuses to archive or restore a plan that does not exist", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const missing = PlanId.make("no-such-plan");

      const archive = yield* Effect.flip(
        store.archivePlan({ planId: missing, archivedAt: at("2026-08-04T00:00:00.000Z") }),
      );
      assert.strictEqual(archive._tag, "PlanNotFoundError");

      const restore = yield* Effect.flip(store.unarchivePlan({ planId: missing }));
      assert.strictEqual(restore._tag, "PlanNotFoundError");
    }),
  );

  it.effect("deletes a fully private plan without a trace", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const sql = yield* SqlClient.SqlClient;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        attachments: [
          {
            type: "image",
            id: "plan-0000-mock",
            name: "mock.png",
            mimeType: "image/png",
            sizeBytes: 2048,
          },
        ],
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "First draft",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });

      const deletion = yield* store.deletePlan({ planId: created.plan.planId });
      // The rows are the store's to destroy; the bytes the ids name are the
      // boundary's, and this is how it learns which.
      assert.deepStrictEqual([...deletion.attachmentIds], ["plan-0000-mock"]);

      const [counts] = yield* sql<{
        readonly plans: number;
        readonly commits: number;
        readonly parents: number;
        readonly histories: number;
      }>`
        SELECT
          (SELECT COUNT(*) FROM plans WHERE plan_id = ${created.plan.planId}) AS "plans",
          (SELECT COUNT(*) FROM commits WHERE history_id = ${created.plan.historyId}) AS "commits",
          (
            SELECT COUNT(*) FROM commit_parents
            WHERE commit_id IN (SELECT commit_id FROM commits WHERE history_id = ${created.plan.historyId})
          ) AS "parents",
          (
            SELECT COUNT(*) FROM commit_histories WHERE history_id = ${created.plan.historyId}
          ) AS "histories"
      `;
      assert.deepStrictEqual(counts, { plans: 0, commits: 0, parents: 0, histories: 0 });

      // Nothing left to find: this is what makes re-importing the origin issue
      // of a deleted plan start fresh rather than resurface anything.
      const gone = yield* Effect.flip(store.getPlanSnapshot({ planId: created.plan.planId }));
      assert.strictEqual(gone._tag, "PlanNotFoundError");
    }),
  );

  it.effect("refuses to delete a plan once any of its commits is published", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;
      const sql = yield* SqlClient.SqlClient;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });

      // The imported-plan shape: the root itself is published, so the plan is
      // archive-only from birth.
      const born = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Imported from an issue",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      const [root] = yield* commits.listCommits({
        historyId: born.plan.historyId,
        visibility: "all",
      });
      yield* commits.publish({ commitId: root!.commitId });

      const refused = yield* Effect.flip(store.deletePlan({ planId: born.plan.planId }));
      assert.strictEqual(refused._tag, "PlanDeleteBlockedError");

      // And the same the other way round: a plan that starts private and
      // publishes something later loses delete at that moment.
      const later = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      const midCommit = yield* store.appendMessage({
        lastUsed: null,
        planId: later.plan.planId,
        text: "Second thought",
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });
      yield* store.appendMessage({
        lastUsed: null,
        planId: later.plan.planId,
        text: "Third thought",
        createdAt: at("2026-08-03T00:04:00.000Z"),
      });
      yield* commits.publish({ commitId: midCommit.commitId });

      const alsoRefused = yield* Effect.flip(store.deletePlan({ planId: later.plan.planId }));
      assert.strictEqual(alsoRefused._tag, "PlanDeleteBlockedError");

      // Archive is what a published plan has instead, and it destroys nothing:
      // the row and its history survive, which is what lets re-importing the
      // origin issue resurface this plan rather than duplicate it.
      yield* store.archivePlan({
        planId: born.plan.planId,
        archivedAt: at("2026-08-04T00:00:00.000Z"),
      });
      const [survivors] = yield* sql<{ readonly plans: number; readonly commits: number }>`
        SELECT
          (SELECT COUNT(*) FROM plans WHERE plan_id = ${born.plan.planId}) AS "plans",
          (SELECT COUNT(*) FROM commits WHERE history_id = ${born.plan.historyId}) AS "commits"
      `;
      assert.deepStrictEqual(survivors, { plans: 1, commits: 1 });
    }),
  );

  it.effect("reports whether a plan's history has been published", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;

      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-03T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Reshape the sidebar",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      // The flag is the tree's, not the planning space's: the surfaces that
      // decide between archive and delete both read this snapshot.
      const readFlag = store.getTreeSnapshot.pipe(
        Effect.map(
          (tree) =>
            tree.plans.find((plan) => plan.planId === created.plan.planId)?.hasPublishedCommits,
        ),
      );

      assert.strictEqual(yield* readFlag, false);

      const [root] = yield* commits.listCommits({
        historyId: created.plan.historyId,
        visibility: "all",
      });
      yield* commits.publish({ commitId: root!.commitId });

      // No column moved: the flag is an EXISTS over the commits, so it flips
      // the moment publishing lands.
      assert.strictEqual(yield* readFlag, true);
    }),
  );

  const seedPlan = Effect.fn("seedPlan")(function* (createdAt: string) {
    const store = yield* PlanningStore.PlanningStore;
    const project = yield* store.createProject({
      name: "Astrolabe",
      createdAt: at(createdAt),
    });
    return yield* store.createPlan({
      lastUsed: null,
      projectId: project.projectId,
      message: "Reshape the sidebar",
      createdAt: at(createdAt),
    });
  });

  const treeRow = Effect.fn("treeRow")(function* (planId: PlanId) {
    const store = yield* PlanningStore.PlanningStore;
    const snapshot = yield* store.getTreeSnapshot;
    return snapshot.plans.find((plan) => plan.planId === planId);
  });

  it.effect("a plan nobody has opened has no visit at all", () =>
    Effect.gen(function* () {
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");
      const row = yield* treeRow(created.plan.planId);
      assert.strictEqual(row?.visitedAt, undefined);
    }),
  );

  it.effect("records a visit that changes seen-ness, and announces it", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");

      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 1)), {
        startImmediately: true,
      });
      yield* store.recordPlanVisit({
        planId: created.plan.planId,
        visitedAt: at("2026-08-03T00:05:00.000Z"),
      });
      const signals = yield* Fiber.join(changes);
      assert.strictEqual(signals.length, 1);

      const row = yield* treeRow(created.plan.planId);
      assert.strictEqual(
        row?.visitedAt === undefined ? null : DateTime.formatIso(row.visitedAt),
        "2026-08-03T00:05:00.000Z",
      );
    }),
  );

  it.effect("a visit on an already-seen plan writes nothing and stays silent", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");
      yield* store.recordPlanVisit({
        planId: created.plan.planId,
        visitedAt: at("2026-08-03T00:05:00.000Z"),
      });

      // The receipt is the *next* signal: a silent visit lets the message that
      // follows it be the first thing the stream carries.
      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 1)), {
        startImmediately: true,
      });
      yield* store.recordPlanVisit({
        planId: created.plan.planId,
        visitedAt: at("2026-08-03T00:06:00.000Z"),
      });
      yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "Something happened",
        createdAt: at("2026-08-03T00:07:00.000Z"),
      });
      yield* Fiber.join(changes);

      // The redundant visit left the stored one alone.
      const row = yield* treeRow(created.plan.planId);
      assert.strictEqual(
        row?.visitedAt === undefined ? null : DateTime.formatIso(row.visitedAt),
        "2026-08-03T00:05:00.000Z",
      );
    }),
  );

  it.effect("activity after a visit is unseen, and visiting again clears it", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");

      yield* store.recordPlanVisit({
        planId: created.plan.planId,
        visitedAt: at("2026-08-03T00:05:00.000Z"),
      });
      yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "Landed while you were away",
        createdAt: at("2026-08-03T00:06:00.000Z"),
      });

      const unseen = yield* treeRow(created.plan.planId);
      assert.ok(
        unseen?.visitedAt !== undefined && DateTime.isLessThan(unseen.visitedAt, unseen.updatedAt),
      );

      yield* store.recordPlanVisit({
        planId: created.plan.planId,
        visitedAt: at("2026-08-03T00:07:00.000Z"),
      });
      const seen = yield* treeRow(created.plan.planId);
      assert.ok(
        seen?.visitedAt !== undefined &&
          DateTime.isGreaterThanOrEqualTo(seen.visitedAt, seen.updatedAt),
      );
    }),
  );

  it.effect("mark unread stands the visit just before the latest activity", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");
      yield* store.recordPlanVisit({
        planId: created.plan.planId,
        visitedAt: at("2026-08-03T00:05:00.000Z"),
      });

      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 1)), {
        startImmediately: true,
      });
      yield* store.markPlanUnread({ planId: created.plan.planId });
      const signals = yield* Fiber.join(changes);
      assert.strictEqual(signals.length, 1);

      const rearmed = yield* treeRow(created.plan.planId);
      assert.strictEqual(
        rearmed?.visitedAt === undefined ? null : DateTime.formatIso(rearmed.visitedAt),
        "2026-08-02T23:59:59.999Z",
      );
      assert.ok(
        rearmed?.visitedAt !== undefined &&
          DateTime.isLessThan(rearmed.visitedAt, rearmed.updatedAt),
      );

      // And opening it clears it again.
      yield* store.recordPlanVisit({
        planId: created.plan.planId,
        visitedAt: at("2026-08-03T00:08:00.000Z"),
      });
      const cleared = yield* treeRow(created.plan.planId);
      assert.ok(
        cleared?.visitedAt !== undefined &&
          DateTime.isGreaterThanOrEqualTo(cleared.visitedAt, cleared.updatedAt),
      );
    }),
  );

  it.effect("visiting is attention, not activity: the tree's order does not move", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");

      yield* store.recordPlanVisit({
        planId: created.plan.planId,
        visitedAt: at("2026-08-03T00:05:00.000Z"),
      });
      yield* store.markPlanUnread({ planId: created.plan.planId });

      const row = yield* treeRow(created.plan.planId);
      assert.strictEqual(
        row === undefined ? null : DateTime.formatIso(row.updatedAt),
        DateTime.formatIso(created.plan.updatedAt),
      );
    }),
  );

  it.effect("both visit acts refuse a plan that does not exist", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;

      const visit = yield* Effect.flip(
        store.recordPlanVisit({
          planId: PlanId.make("nope"),
          visitedAt: at("2026-08-03T00:00:00.000Z"),
        }),
      );
      assert.strictEqual(visit._tag, "PlanNotFoundError");

      const unread = yield* Effect.flip(store.markPlanUnread({ planId: PlanId.make("nope") }));
      assert.strictEqual(unread._tag, "PlanNotFoundError");
    }),
  );

  it.effect("lands the assistant's reply with its whole turn record", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");
      const root = created.timeline[0]!;

      const message = yield* store.appendAssistantMessage({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        reconstructionId: "recorded-input",
        text: "Here is how I would shape it",
        interrupted: true,
        grounding: [{ kind: "file-read", label: "apps/web/src/sidebar.tsx" }],
        groundingScope: { unreachableRepositories: ["almagest"] },
        question: {
          questions: [
            {
              id: "q1",
              header: "Scope",
              question: "Web first?",
              options: [{ label: "Yes", description: "Start narrow" }],
            },
          ],
          answers: { q1: "Yes" },
        },
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      assert.strictEqual(message.authorKind, "assistant");
      assert.deepStrictEqual([...message.parents], [root.commitId]);

      // The record survives the round trip through the payload schemas.
      const snapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const landed = snapshot.timeline.at(-1);
      assert.ok(landed !== undefined && landed._tag === "message");
      assert.strictEqual(landed.interrupted, true);
      assert.strictEqual(landed.reconstructionId, "recorded-input");
      assert.deepStrictEqual(landed.grounding?.[0]?.label, "apps/web/src/sidebar.tsx");
      assert.deepStrictEqual(landed.groundingScope?.unreachableRepositories, ["almagest"]);
      assert.deepStrictEqual(landed.question?.answers, { q1: "Yes" });
    }),
  );

  it.effect("the assistant revises the plan at equal standing, on its named parent", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");
      const root = created.timeline[0]!;

      const revision = yield* store.saveAssistantPlanRevision({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "# Sidebar plan",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });
      assert.strictEqual(revision.authorKind, "assistant");

      const snapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      assert.strictEqual(snapshot.planText, "# Sidebar plan");
    }),
  );

  it.effect(
    "an assistant write onto a parent with a child is the commit store's fork refusal",
    () =>
      Effect.gen(function* () {
        const store = yield* PlanningStore.PlanningStore;
        const created = yield* seedPlan("2026-08-03T00:00:00.000Z");
        const root = created.timeline[0]!;

        yield* store.appendMessage({
          lastUsed: null,
          planId: created.plan.planId,
          text: "A human continues",
          createdAt: at("2026-08-03T00:01:00.000Z"),
        });

        const refused = yield* Effect.flip(
          store.appendAssistantMessage({
            planId: created.plan.planId,
            parentCommitId: root.commitId,
            text: "This would fork",
            createdAt: at("2026-08-03T00:02:00.000Z"),
          }),
        );
        assert.strictEqual(refused._tag, "AssistantForkError");
      }),
  );

  it.effect("human writes refuse while a turn is active, and land after it closes", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const registry = yield* PlanTurnRegistry.PlanTurnRegistry;
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");
      const root = created.timeline[0]!;

      yield* registry.open({
        planId: created.plan.planId,
        turnId: PlanTurnId.make("turn-1"),
        threadId: ThreadId.make("thread-1"),
        parentCommitId: root.commitId,
        tipCommitId: root.commitId,
      });

      const messageRefused = yield* Effect.flip(
        store.appendMessage({
          lastUsed: null,
          planId: created.plan.planId,
          text: "Racing the settle",
          createdAt: at("2026-08-03T00:01:00.000Z"),
        }),
      );
      assert.strictEqual(messageRefused._tag, "PlanTurnActiveError");

      const revisionRefused = yield* Effect.flip(
        store.savePlanRevision({
          planId: created.plan.planId,
          text: "Racing edit",
          createdAt: at("2026-08-03T00:01:00.000Z"),
        }),
      );
      assert.strictEqual(revisionRefused._tag, "PlanTurnActiveError");

      // The assistant's own path is not guarded — the turn is why it writes.
      yield* store.saveAssistantPlanRevision({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "# Mid-turn revision",
        createdAt: at("2026-08-03T00:01:30.000Z"),
      });

      yield* registry.close(created.plan.planId, PlanTurnId.make("turn-1"));
      const landed = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "After the turn",
        createdAt: at("2026-08-03T00:02:00.000Z"),
      });
      assert.strictEqual(landed.authorKind, "human");
    }),
  );

  it.effect("a write on another branch lands while a turn streams elsewhere", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const registry = yield* PlanTurnRegistry.PlanTurnRegistry;
      const created = yield* seedPlan("2026-08-03T00:00:00.000Z");
      const root = created.timeline[0]!;
      const branchA = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Branch A",
        createdAt: at("2026-08-03T00:01:00.000Z"),
      });

      // The turn claims branch A's chain, revision included.
      yield* registry.open({
        planId: created.plan.planId,
        turnId: PlanTurnId.make("turn-a"),
        threadId: ThreadId.make("thread-a"),
        parentCommitId: branchA.commitId,
        tipCommitId: branchA.commitId,
      });
      const midTurnRevision = yield* store.saveAssistantPlanRevision({
        planId: created.plan.planId,
        parentCommitId: branchA.commitId,
        text: "# Mid-turn",
        createdAt: at("2026-08-03T00:01:30.000Z"),
      });
      yield* registry.advanceTip(
        created.plan.planId,
        PlanTurnId.make("turn-a"),
        midTurnRevision.commitId,
      );

      // On the claimed chain: refused, opening parent and grown tip alike.
      for (const claimed of [branchA.commitId, midTurnRevision.commitId]) {
        const refused = yield* Effect.flip(
          store.appendMessage({
            lastUsed: null,
            planId: created.plan.planId,
            parentCommitId: claimed,
            text: "Onto the streaming chain",
            createdAt: at("2026-08-03T00:02:00.000Z"),
          }),
        );
        assert.strictEqual(refused._tag, "PlanTurnActiveError");
      }

      // Another branch from the shared root: lands mid-turn — a message, a
      // plan revision, and a spec revision alike.
      const branchB = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Branch B, while A streams",
        createdAt: at("2026-08-03T00:03:00.000Z"),
      });
      assert.deepStrictEqual([...branchB.parents], [root.commitId]);
      const revisionB = yield* store.savePlanRevision({
        planId: created.plan.planId,
        parentCommitId: branchB.commitId,
        text: "# Branch B plan",
        createdAt: at("2026-08-03T00:04:00.000Z"),
      });
      yield* store.saveSpecRevision({
        planId: created.plan.planId,
        parentCommitId: revisionB.commitId,
        expectedSpecRevisionCommitId: null,
        document: {
          goal: "Branch B goal",
          acceptanceCriteria: "Lands while A streams.",
        },
        createdAt: at("2026-08-03T00:05:00.000Z"),
      });
    }),
  );

  // ===============================
  // Issue import
  // ===============================

  const CONNECTION = TrackerConnectionId.make("connection-1");

  const seedProject = Effect.fn("seedProject")(function* (createdAt: string) {
    const store = yield* PlanningStore.PlanningStore;
    return yield* store.createProject({ name: "Astrolabe", createdAt: at(createdAt) });
  });

  /**
   * The store's database outlives each test in this suite, so every import
   * test names its own issue: the whole point of an origin is that the same one
   * twice is the same plan.
   */
  const importIssue = Effect.fn("importIssue")(function* (input: {
    readonly projectId: MercurianProjectId;
    readonly issueId: string;
    readonly connectionId?: string;
    readonly title?: string;
    readonly description?: string;
    readonly createdAt?: string;
  }) {
    const store = yield* PlanningStore.PlanningStore;
    return yield* store.importPlan({
      projectId: input.projectId,
      connectionId:
        input.connectionId === undefined
          ? CONNECTION
          : TrackerConnectionId.make(input.connectionId),
      issueId: input.issueId,
      issueUrl: `https://linear.app/mercurian/issue/${input.issueId}`,
      title: input.title ?? "Issue Import",
      description: input.description ?? "Import an issue as the root of a plan.",
      createdAt: at(input.createdAt ?? "2026-08-08T00:01:00.000Z"),
    });
  });

  const originRows = Effect.fn("originRows")(function* (issueId: string) {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql<{
      readonly plan_id: string;
      readonly connection_id: string;
      readonly issue_id: string;
      readonly issue_url: string;
      readonly imported_at: string;
    }>`SELECT * FROM plan_origins WHERE issue_id = ${issueId}`;
  });

  it.effect("imports an issue as a plan rooted at the issue itself", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;
      const project = yield* seedProject("2026-08-08T00:00:00.000Z");

      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 1)), {
        startImmediately: true,
      });
      const imported = yield* importIssue({ projectId: project.projectId, issueId: "M-101" });
      assert.strictEqual((yield* Fiber.join(changes)).length, 1);

      assert.strictEqual(imported.outcome, "created");
      assert.strictEqual(imported.detail.plan.title, "Issue Import");
      assert.strictEqual(imported.detail.plan.archivedAt, null);
      // The issue is what you plan from, not the plan: the artifact is born
      // empty, and only a plan revision fills it.
      assert.strictEqual(imported.detail.planText, "");

      const path = yield* commits.listCommits({
        historyId: imported.detail.plan.historyId,
        visibility: "all",
      });
      assert.strictEqual(path.length, 1);
      const root = path[0]!;
      assert.deepStrictEqual([...root.parents], []);
      assert.strictEqual(root.kind, "message");
      assert.strictEqual(root.authorKind, "human");
      assert.strictEqual(root.published, true);
      assert.deepStrictEqual(
        imported.detail.timeline.map((item) => item._tag),
        ["message"],
      );
      const item = imported.detail.timeline[0]!;
      assert.ok(item._tag === "message");
      assert.ok(item.text.includes("https://linear.app/mercurian/issue/M-101"));
      assert.strictEqual(imported.detail.spec, null);

      const origins = yield* originRows("M-101");
      assert.deepStrictEqual(origins, [
        {
          plan_id: imported.detail.plan.planId,
          connection_id: CONNECTION,
          issue_id: "M-101",
          issue_url: "https://linear.app/mercurian/issue/M-101",
          imported_at: "2026-08-08T00:01:00.000Z",
        },
      ]);

      // The plan appears in the tree, published from birth.
      const row = yield* treeRow(imported.detail.plan.planId);
      assert.strictEqual(row?.hasPublishedCommits, true);
    }),
  );

  it.effect("caps a long issue title the way every other plan title is capped", () =>
    Effect.gen(function* () {
      const project = yield* seedProject("2026-08-08T00:00:00.000Z");
      const imported = yield* importIssue({
        projectId: project.projectId,
        issueId: "M-long",
        title: "x".repeat(120),
      });
      assert.strictEqual(imported.detail.plan.title.length, 80);
      assert.ok(imported.detail.plan.title.endsWith("…"));
    }),
  );

  it.effect("is born published, and everything after the root is a private draft", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const project = yield* seedProject("2026-08-08T00:00:00.000Z");
      const imported = yield* importIssue({ projectId: project.projectId, issueId: "M-published" });

      const appended = yield* store.appendMessage({
        lastUsed: null,
        planId: imported.detail.plan.planId,
        text: "Here is how I would approach it",
        createdAt: at("2026-08-08T00:02:00.000Z"),
      });
      assert.strictEqual(appended.published, false);

      // Published from the first second means archive-only from the first
      // second: delete is gone from every surface, and refused underneath.
      const refused = yield* Effect.flip(store.deletePlan({ planId: imported.detail.plan.planId }));
      assert.strictEqual(refused._tag, "PlanDeleteBlockedError");
    }),
  );

  it.effect("born blank still roots private: the carve-out cuts one way", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const commits = yield* CommitStore.CommitStore;
      const project = yield* seedProject("2026-08-08T00:00:00.000Z");

      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Born blank",
        createdAt: at("2026-08-08T00:01:00.000Z"),
      });
      const path = yield* commits.listCommits({
        historyId: created.plan.historyId,
        visibility: "all",
      });
      assert.strictEqual(path[0]?.published, false);
    }),
  );

  it.effect("re-importing an origin goes to the plan it already has", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const sql = yield* SqlClient.SqlClient;
      const project = yield* seedProject("2026-08-08T00:00:00.000Z");
      const first = yield* importIssue({ projectId: project.projectId, issueId: "M-idempotent" });

      // The receipt is the *next* signal: a re-import that changed nothing must
      // not cost the tree a re-emit.
      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 1)), {
        startImmediately: true,
      });
      const again = yield* importIssue({
        projectId: project.projectId,
        issueId: "M-idempotent",
        createdAt: "2026-08-08T00:05:00.000Z",
      });
      yield* store.appendMessage({
        lastUsed: null,
        planId: first.detail.plan.planId,
        text: "Something happened",
        createdAt: at("2026-08-08T00:06:00.000Z"),
      });
      yield* Fiber.join(changes);

      assert.strictEqual(again.outcome, "existing");
      assert.strictEqual(again.detail.plan.planId, first.detail.plan.planId);

      const [counts] = yield* sql<{
        readonly plans: number;
        readonly commits: number;
        readonly origins: number;
      }>`
        SELECT
          (SELECT COUNT(*) FROM plans WHERE project_id = ${project.projectId}) AS "plans",
          (SELECT COUNT(*) FROM commits
             WHERE history_id = ${first.detail.plan.historyId}) AS "commits",
          (SELECT COUNT(*) FROM plan_origins WHERE issue_id = 'M-idempotent') AS "origins"
      `;
      // One plan, one origin, and the re-import wrote no second root.
      assert.deepStrictEqual(counts, { plans: 1, commits: 2, origins: 1 });
    }),
  );

  it.effect("re-importing an archived plan's origin resurfaces it", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const project = yield* seedProject("2026-08-08T00:00:00.000Z");
      const first = yield* importIssue({ projectId: project.projectId, issueId: "M-archived" });
      yield* store.archivePlan({
        planId: first.detail.plan.planId,
        archivedAt: at("2026-08-08T00:03:00.000Z"),
      });

      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 1)), {
        startImmediately: true,
      });
      const again = yield* importIssue({
        projectId: project.projectId,
        issueId: "M-archived",
        createdAt: "2026-08-08T00:04:00.000Z",
      });
      assert.strictEqual((yield* Fiber.join(changes)).length, 1);

      assert.strictEqual(again.outcome, "resurfaced");
      assert.strictEqual(again.detail.plan.planId, first.detail.plan.planId);
      assert.strictEqual(again.detail.plan.archivedAt, null);
      // Resurfacing is not activity: the plan returns to its old place rather
      // than jumping to the top of the tree.
      assert.strictEqual(
        DateTime.formatIso(again.detail.plan.updatedAt),
        DateTime.formatIso(first.detail.plan.updatedAt),
      );
    }),
  );

  it.effect("two windows importing one issue land on one plan", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const project = yield* seedProject("2026-08-08T00:00:00.000Z");

      const [left, right] = yield* Effect.all(
        [
          importIssue({ projectId: project.projectId, issueId: "M-race" }),
          importIssue({
            projectId: project.projectId,
            issueId: "M-race",
            createdAt: "2026-08-08T00:01:01.000Z",
          }),
        ],
        { concurrency: 2 },
      );

      assert.strictEqual(left.detail.plan.planId, right.detail.plan.planId);
      assert.deepStrictEqual([left.outcome, right.outcome].sort(), ["created", "existing"]);

      const [counts] = yield* sql<{ readonly plans: number; readonly origins: number }>`
        SELECT
          (SELECT COUNT(*) FROM plans WHERE project_id = ${project.projectId}) AS "plans",
          (SELECT COUNT(*) FROM plan_origins WHERE issue_id = 'M-race') AS "origins"
      `;
      assert.deepStrictEqual(counts, { plans: 1, origins: 1 });
    }),
  );

  it.effect("the same issue key through another connection is another origin", () =>
    Effect.gen(function* () {
      const project = yield* seedProject("2026-08-08T00:00:00.000Z");
      const first = yield* importIssue({ projectId: project.projectId, issueId: "M-shared-key" });
      const second = yield* importIssue({
        projectId: project.projectId,
        issueId: "M-shared-key",
        connectionId: "connection-2",
        createdAt: "2026-08-08T00:02:00.000Z",
      });

      assert.strictEqual(second.outcome, "created");
      assert.notStrictEqual(second.detail.plan.planId, first.detail.plan.planId);
    }),
  );

  it.effect("refuses to import into a project that does not exist", () =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(
        importIssue({ projectId: MercurianProjectId.make("nope"), issueId: "M-nowhere" }),
      );
      assert.strictEqual(refused._tag, "MercurianProjectNotFoundError");
    }),
  );

  it.effect("deleting a plan takes its origin with it, so re-import starts fresh", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const project = yield* seedProject("2026-08-08T00:00:00.000Z");
      const first = yield* importIssue({ projectId: project.projectId, issueId: "M-deleted" });

      // Delete is refused while anything is published, and an imported plan is
      // published from birth. Stripping the flag is what lets this test reach
      // the delete walk at all — the point under test is that the walk takes
      // the origin row with it.
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE commits SET published = 0 WHERE history_id = ${first.detail.plan.historyId}
      `;

      yield* store.deletePlan({ planId: first.detail.plan.planId });
      assert.deepStrictEqual(yield* originRows("M-deleted"), []);

      const again = yield* importIssue({
        projectId: project.projectId,
        issueId: "M-deleted",
        createdAt: "2026-08-08T00:07:00.000Z",
      });
      assert.strictEqual(again.outcome, "created");
      assert.notStrictEqual(again.detail.plan.planId, first.detail.plan.planId);
    }),
  );

  it.effect("appends a stamped assistant memory amendment inside an active turn", () =>
    Effect.gen(function* () {
      const store = yield* PlanningStore.PlanningStore;
      const registry = yield* PlanTurnRegistry.PlanTurnRegistry;
      const created = yield* seedPlan("2026-08-09T03:00:00.000Z");
      const parent = created.timeline[0]!.commitId;
      const turnId = PlanTurnId.make("memory-amendment-active");
      yield* registry.open({
        planId: created.plan.planId,
        turnId,
        threadId: ThreadId.make("memory-amendment-thread"),
        parentCommitId: parent,
        tipCommitId: parent,
      });
      const landed = yield* store.appendMemoryAmendment({
        planId: created.plan.planId,
        parentCommitId: parent,
        title: "Record the memory boundary",
        memoryCommitSha: "abc123",
        branch: "mercurian/memory",
        notes: ["Memory", "Composer"],
        createdAt: at("2026-08-09T03:01:00.000Z"),
      });
      assert.strictEqual(landed.authorKind, "assistant");
      assert.strictEqual(landed.text, "Record the memory boundary");
      assert.deepStrictEqual(landed.memoryAmendment, {
        title: "Record the memory boundary",
        memoryCommitSha: "abc123",
        branch: "mercurian/memory",
        notes: ["Memory", "Composer"],
      });
      assert.strictEqual((yield* registry.getTurns(created.plan.planId)).length, 1);
    }),
  );
});
