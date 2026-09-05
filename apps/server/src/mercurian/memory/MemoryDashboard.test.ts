import * as Schema from "effect/Schema";
import {
  MemoryDashboard as MemoryDashboardSchema,
  MemoryCatalog as MemoryCatalogSchema,
} from "@t3tools/contracts";
import { MemorySourceStore } from "./MemorySourceStore.ts";
import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  MercurianProjectId,
  MercurianRepositoryId,
  MercurianCommitId,
  PlanId,
  ThreadId,
  TurnId,
  MessageId,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { lineSnapshotRef } from "../worktreeSlots/SnapshotChain.ts";
import { MemoryIndex } from "./MemoryIndex.ts";
import { MemoryReviewStore } from "./MemoryReviewStore.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { makeMemoryPosition, type MemoryLineContext } from "./MemoryPosition.ts";
import * as Dashboard from "./MemoryDashboard.ts";
import { CommitId } from "../commitTree/schema.ts";

const encodeDashboard = Schema.encodeSync(Schema.fromJsonString(MemoryDashboardSchema));
const encodeCatalog = Schema.encodeSync(Schema.fromJsonString(MemoryCatalogSchema));
const encodeMeasurement = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      files: Schema.Number,
      overviewBytes: Schema.Number,
      catalogBytes: Schema.Number,
    }),
  ),
);

const layer = it.layer(
  GitVcsDriver.layer.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "memory-dashboard-test-" })),
    Layer.provideMerge(VcsProcess.layer),
    Layer.provideMerge(NodeServicesLayer),
  ),
);
const fixture = Effect.fn("memory.fixture")(function* (suffix = "one") {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "memory-dashboard-" });
  const commands: string[][] = [];
  const execute: typeof git.execute = (input) => {
    commands.push([...input.args]);
    return git.execute(input);
  };
  const run = Effect.fn(function* (args: readonly string[]) {
    return (yield* execute({ operation: "test", cwd, args })).stdout.trim();
  });
  yield* run(["init", "-b", "main"]);
  yield* run(["config", "user.name", "Memory Test"]);
  yield* run(["config", "user.email", "memory@example.com"]);
  yield* fs.writeFileString(`${cwd}/A.md`, "base\n");
  yield* run(["add", "."]);
  yield* run(["commit", "-m", "base"]);
  const base = yield* run(["rev-parse", "HEAD"]);
  yield* run(["checkout", "-b", "line"]);
  const projectId = MercurianProjectId.make(`project-${suffix}`);
  const repositoryId = MercurianRepositoryId.make(`repo-${suffix}`);
  const threadId = ThreadId.make(`thread-${suffix}`);
  const rootId = MercurianCommitId.make(`root-${suffix}`);
  const now = DateTime.makeUnsafe("2026-09-01T00:00:00Z");
  const context: MemoryLineContext = {
    planId: PlanId.make(`plan-${suffix}`),
    lineRootCommitId: rootId,
    source: {
      projectId,
      repositoryId,
      repositoryName: suffix,
      repositoryPath: cwd,
      rootPath: cwd,
      subpath: null,
      createdAt: now,
      updatedAt: now,
    },
    branch: {
      repositoryId,
      lineRootCommitId: rootId,
      branch: "line",
      baseOid: base,
      built: true,
      repointHold: null,
      createdAt: now,
    },
    detail: {
      plan: { projectId },
      timeline: [
        { _tag: "message", commitId: CommitId.make(rootId), parents: [], sequence: 1 },
        {
          _tag: "message",
          commitId: CommitId.make("after-one"),
          parents: [CommitId.make(rootId)],
          sequence: 2,
        },
        {
          _tag: "plan-revision",
          commitId: CommitId.make("no-memory-change"),
          parents: [CommitId.make("after-one")],
          sequence: 3,
        },
      ],
      codingSessions: [],
      lineRuntimes: [{ threadId, lineRootCommitId: rootId, homeRepositoryId: repositoryId }],
    } as unknown as MemoryLineContext["detail"],
  };
  const checkpoints: OrchestrationCheckpointSummary[] = [];
  const projection = ProjectionSnapshotQuery.of({
    getThreadCheckpointContext: () => Effect.succeed(Option.some({ threadId, checkpoints })),
  } as unknown as ProjectionSnapshotQuery["Service"]);
  const gitService = { ...git, execute };
  const positions = yield* makeMemoryPosition.pipe(
    Effect.provideService(ProjectionSnapshotQuery, projection),
    Effect.provideService(GitVcsDriver.GitVcsDriver, gitService),
  );
  const dashboard = yield* Dashboard.make.pipe(
    Effect.provideService(ProjectionSnapshotQuery, projection),
    Effect.provideService(GitVcsDriver.GitVcsDriver, gitService),
    Effect.provideService(
      MemorySourceStore,
      MemorySourceStore.of({
        getSource: (id: MercurianProjectId) =>
          Effect.succeed(id === projectId ? Option.some(context.source) : Option.none()),
      } as unknown as MemorySourceStore["Service"]),
    ),
    Effect.provideService(
      MemoryIndex,
      MemoryIndex.of({
        getLineContext: () => Effect.succeed(context),
      } as unknown as MemoryIndex["Service"]),
    ),
    Effect.provideService(
      MemoryReviewStore,
      MemoryReviewStore.of({
        listReviewed: () => Effect.succeed([]),
      } as unknown as MemoryReviewStore["Service"]),
    ),
    Effect.provideService(
      RepositoryStore,
      RepositoryStore.of({
        getSnapshot: Effect.succeed({
          repositories: [{ repositoryId, path: cwd }],
          projectRepositories: [],
        }),
      } as unknown as RepositoryStore["Service"]),
    ),
  );
  const snapshot = Effect.fn(function* (turn: number, previous: string | null = null) {
    yield* run(["add", "-A"]);
    const tree = yield* run(["write-tree"]);
    const head = yield* run(["rev-parse", "HEAD"]);
    const ref = checkpointRefForThreadTurn(threadId, turn);
    const oid = yield* run([
      "commit-tree",
      tree,
      ...(previous ? ["-p", previous] : []),
      "-p",
      head,
      "-m",
      turn === 0 ? "t3 checkpoint baseline" : `t3 snapshot kind=settled ref=${ref}`,
    ]);
    yield* run(["update-ref", ref, oid]);
    if (turn > 0) {
      yield* run(["update-ref", lineSnapshotRef(rootId), oid]);
      checkpoints.push({
        turnId: TurnId.make(`turn-${turn}`),
        checkpointTurnCount: turn,
        checkpointRef: ref,
        status: "ready",
        files: [],
        assistantMessageId: MessageId.make(turn === 1 ? "after-one" : `after-${turn}`),
        completedAt: "2026-09-01T00:00:00Z",
      });
    }
    return oid;
  });
  const read = () =>
    dashboard.readDashboard({ projectId, line: { threadId }, position: { kind: "latest" } });
  return {
    fs,
    cwd,
    run,
    commands,
    context,
    checkpoints,
    positions,
    dashboard,
    snapshot,
    threadId,
    projectId,
    rootId,
    read,
    base,
  };
});
layer("immutable memory reads", (it) => {
  it.effect(
    "reads before/after and unchanged planning ancestry without later or main leakage",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const baseline = yield* f.snapshot(0);
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "one\n");
        const one = yield* f.snapshot(1, baseline);
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "two\n");
        yield* f.snapshot(2, one);
        const historical = yield* f.positions.read(f.context, {
          kind: "checkpoint",
          commitId: MercurianCommitId.make("no-memory-change"),
        });
        assert(!("kind" in historical));
        assert.equal(historical.snapshotOid, one);
        assert.equal(yield* f.run(["show", `${historical.treeOid}:A.md`]), "one");
        const start = yield* f.positions.read(f.context, {
          kind: "turn",
          threadId: f.threadId,
          turnCount: 0,
        });
        assert(!("kind" in start));
        assert.equal(yield* f.run(["show", `${start.treeOid}:A.md`]), "base");
        const before = yield* f.read();
        assert(before.kind === "available");
        yield* f.run(["update-ref", "refs/heads/main", one]);
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "borrowed slot content\n");
        const after = yield* f.read();
        assert(after.kind === "available");
        assert.deepEqual(after.position, before.position);
        yield* f.run(["update-ref", "-d", checkpointRefForThreadTurn(f.threadId, 1)]);
        assert.deepEqual(
          yield* f.positions.read(f.context, { kind: "turn", threadId: f.threadId, turnCount: 1 }),
          { kind: "unavailable", reason: "object-missing" },
        );
      }).pipe(Effect.scoped),
  );

  it.effect(
    "omits inherited unmarked work and preserves recorded-head deltas after later amendments",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.fs.writeFileString(`${f.cwd}/Inherited.md`, "inherited\n");
        const baseline = yield* f.snapshot(0);
        const one = yield* f.snapshot(1, baseline);
        const empty = yield* f.read();
        assert(empty.kind === "available");
        assert.deepEqual(empty.documents, []);
        assert.deepEqual(empty.amendments, []);
        yield* f.fs.writeFileString(`${f.cwd}/Loose.md`, "unmarked\n");
        const two = yield* f.snapshot(2, one);
        // Keep Loose uncommitted, then land a separate amendment after capture.
        yield* f.run(["reset", "HEAD"]);
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "amended after capture\n");
        yield* f.run(["add", "A.md"]);
        yield* f.run(["commit", "-m", "Later\n\nAstrolabe-Amendment: turn-later"]);
        const dashboard = yield* f.read();
        assert(dashboard.kind === "available");
        assert.equal(dashboard.position.recordedHeadOid, f.base);
        assert.equal(dashboard.position.snapshotOid, two);
        assert.notEqual(dashboard.position.headOid, f.base);
        assert.equal(
          yield* f.run(["show", `${dashboard.position.treeOid}:A.md`]),
          "amended after capture",
        );
        assert.equal(yield* f.run(["show", `${dashboard.position.treeOid}:Loose.md`]), "unmarked");
        assert.deepEqual(
          dashboard.documents.map((d) => d.path),
          ["A.md", "Loose.md"],
        );
        assert.equal(dashboard.amendments.filter((a) => a.kind === "unmarked").length, 1);
      }).pipe(Effect.scoped),
  );

  it.effect("unions restored, renamed and transient captured notes without eager patches", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const baseline = yield* f.snapshot(0);
      yield* f.fs.writeFileString(`${f.cwd}/A.md`, "changed\n");
      yield* f.fs.writeFileString(`${f.cwd}/Transient.md`, "temporary\n");
      yield* f.fs.writeFileString(`${f.cwd}/Rename.md`, "rename me\n");
      const one = yield* f.snapshot(1, baseline);
      yield* f.fs.writeFileString(`${f.cwd}/A.md`, "base\n");
      yield* f.fs.remove(`${f.cwd}/Transient.md`);
      yield* f.fs.rename(`${f.cwd}/Rename.md`, `${f.cwd}/Renamed.md`);
      yield* f.snapshot(2, one);
      f.commands.length = 0;
      const dashboard = yield* f.read();
      assert(dashboard.kind === "available");
      assert.equal(dashboard.documents.find((d) => d.path === "A.md")?.status, "restored");
      assert.equal(dashboard.documents.find((d) => d.path === "Transient.md")?.status, "deleted");
      assert.deepEqual(dashboard.documents.find((d) => d.path === "Renamed.md")?.previousPaths, [
        "Rename.md",
      ]);
      assert.equal(dashboard.graph.nodes.length, 3);
      assert(
        !f.commands.some(
          (args) =>
            args.includes("--patch") || (args.includes("diff") && !args.includes("--name-status")),
        ),
      );
      const deleted = dashboard.documents.find((d) => d.path === "Transient.md")!.document!;
      const detail = yield* f.dashboard.readDocument({ target: deleted });
      assert(detail.kind === "available");
      assert.equal(detail.markdown, "temporary\n");
      assert(detail.target.deleted);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps malformed map-only changes reviewable with immutable raw detail", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const baseline = yield* f.snapshot(0);
      yield* f.fs.writeFileString(`${f.cwd}/Broken.skillmap.md`, "---\ninvalid: [\n---\nbody\n");
      yield* f.snapshot(1, baseline);
      f.commands.length = 0;
      const dashboard = yield* f.read();
      assert(dashboard.kind === "available");
      assert(!f.commands.some((args) => args.includes("cat-file")));
      assert.deepEqual(dashboard.graph.nodes, []);
      assert.equal(dashboard.documents.length, 1);
      const doc = dashboard.documents[0]!;
      const detail = yield* f.dashboard.readDocument({ target: doc.document! });
      assert(detail.kind === "available");
      assert(detail.map !== null && "refusal" in detail.map);
      const diff = yield* f.dashboard.readComparison({ target: doc.comparison });
      assert(diff.kind === "available");
      assert(diff.patch.includes("+body"));
      assert(diff.maps[0]!.structureChanged);
      assert(diff.maps[0]!.bodyChanged);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "binds identical paths to repository and immutable version, including same-position links",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture("first");
        const g = yield* fixture("second");
        const baseline = yield* f.snapshot(0);
        const otherBaseline = yield* g.snapshot(0);
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "[[B]]\n");
        yield* f.fs.writeFileString(`${f.cwd}/B.md`, "linked\n");
        const one = yield* f.snapshot(1, baseline);
        yield* g.fs.writeFileString(`${g.cwd}/A.md`, "other repository\n");
        yield* g.snapshot(1, otherBaseline);
        const dashboard = yield* f.read();
        assert(dashboard.kind === "available");
        const t = dashboard.documents.find((d) => d.path === "A.md")!.document!;
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "future\n");
        yield* f.snapshot(2, one);
        const detail = yield* f.dashboard.readDocument({ target: t });
        assert(detail.kind === "available");
        assert.equal(detail.markdown, "[[B]]\n");
        assert.equal(detail.links[0]!.target!.position.treeOid, t.position.treeOid);
        assert.deepEqual(yield* g.dashboard.readDocument({ target: t }), {
          kind: "unavailable",
          reason: "not-designated",
        });
        assert.deepEqual(
          yield* g.dashboard.readDocument({
            target: { ...t, position: { ...t.position, projectId: g.projectId } },
          }),
          { kind: "unavailable", reason: "object-missing" },
        );
        assert.deepEqual(
          yield* f.dashboard.readDocument({ target: { ...t, blobOid: "0".repeat(40) } }),
          { kind: "unavailable", reason: "object-missing" },
        );
      }).pipe(Effect.scoped),
  );
  it.effect(
    "uses capture metadata to inherit an unchanged repository, but never hides a lost capture",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const baseline = yield* f.snapshot(0);
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "captured memory\n");
        const one = yield* f.snapshot(1, baseline);
        yield* f.snapshot(2, one);
        yield* f.run(["update-ref", "-d", checkpointRefForThreadTurn(f.threadId, 2)]);
        f.checkpoints[1] = {
          ...f.checkpoints[1]!,
          repositories: [
            {
              repositoryId: MercurianRepositoryId.make("other"),
              repositoryName: "Code",
              files: [],
            },
          ],
        };
        const inherited = yield* f.positions.read(f.context, {
          kind: "turn",
          threadId: f.threadId,
          turnCount: 2,
        });
        assert(!("kind" in inherited));
        assert.equal(inherited.snapshotOid, one);
        f.checkpoints[1] = {
          ...f.checkpoints[1]!,
          repositories: [
            { repositoryId: f.context.source.repositoryId, repositoryName: "Memory", files: [] },
          ],
        };
        assert.deepEqual(
          yield* f.positions.read(f.context, { kind: "turn", threadId: f.threadId, turnCount: 2 }),
          { kind: "unavailable", reason: "object-missing" },
        );
        yield* f.run(["update-ref", "-d", lineSnapshotRef(f.rootId)]);
        assert.deepEqual(yield* f.read(), { kind: "unavailable", reason: "object-missing" });
      }).pipe(Effect.scoped),
  );

  it.effect("retains the inherited fork tree when the parent's snapshot ref and main advance", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.fs.writeFileString(`${f.cwd}/Inherited.md`, "fork contents\n");
      const inherited = yield* f.snapshot(0);
      yield* f.run(["update-ref", lineSnapshotRef(f.rootId), inherited]);
      const before = yield* f.read();
      assert(before.kind === "available");
      assert.equal(before.documents.length, 0);
      yield* f.fs.writeFileString(`${f.cwd}/Inherited.md`, "parent later\n");
      // A fresh parent capture replaces its own reference, not the fork's recorded object.
      const moved = yield* f.snapshot(0);
      yield* f.run(["update-ref", "refs/heads/main", moved]);
      const after = yield* f.read();
      assert(after.kind === "available");
      assert.equal(after.position.baselineSnapshotOid, inherited);
      assert.deepEqual(after.position, before.position);
      assert.equal(
        yield* f.run(["show", `${after.position.treeOid}:Inherited.md`]),
        "fork contents",
      );
    }).pipe(Effect.scoped),
  );

  it.effect(
    "resolves legacy amendment attribution by commit identity without timestamp matching",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "legacy amendment\n");
        yield* f.run(["add", "A.md"]);
        yield* f.run(["commit", "-m", "Amended\n\nAstrolabe-Amendment: legacy-turn"]);
        const oid = yield* f.run(["rev-parse", "HEAD"]);
        const context = {
          ...f.context,
          detail: {
            ...f.context.detail,
            timeline: f.context.detail.timeline.map((item) =>
              String(item.commitId) === "after-one"
                ? {
                    ...item,
                    _tag: "message" as const,
                    text: "",
                    memoryAmendment: {
                      title: "Amended",
                      memoryCommitSha: oid,
                      branch: "line",
                      notes: ["A"],
                    },
                  }
                : item,
            ),
          },
        };
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "future amendment\n");
        yield* f.run(["add", "A.md"]);
        yield* f.run(["commit", "-m", "Later"]);
        const position = yield* f.positions.read(context, {
          kind: "checkpoint",
          commitId: MercurianCommitId.make("no-memory-change"),
        });
        assert(!("kind" in position));
        assert.equal(position.headOid, oid);
        assert.equal(yield* f.run(["show", `${position.treeOid}:A.md`]), "legacy amendment");
      }).pipe(Effect.scoped),
  );

  it.effect(
    "reports overlapping effective-tree conflicts rather than showing a stale capture",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const baseline = yield* f.snapshot(0);
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "captured edit\n");
        yield* f.snapshot(1, baseline);
        yield* f.fs.writeFileString(`${f.cwd}/A.md`, "different amendment\n");
        yield* f.run(["add", "A.md"]);
        yield* f.run(["commit", "-m", "amendment"]);
        assert.deepEqual(yield* f.read(), {
          kind: "unavailable",
          reason: "effective-tree-conflict",
        });
      }).pipe(Effect.scoped),
  );

  it.effect("keeps an unmarked restoration of a committed amendment to the baseline", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const baseline = yield* f.snapshot(0);
      yield* f.fs.writeFileString(`${f.cwd}/A.md`, "amended\n");
      yield* f.run(["add", "A.md"]);
      yield* f.run(["commit", "-m", "Amended\n\nAstrolabe-Amendment: first"]);
      const one = yield* f.snapshot(1, baseline);
      yield* f.fs.writeFileString(`${f.cwd}/A.md`, "base\n");
      yield* f.snapshot(2, one);
      const dashboard = yield* f.read();
      assert(dashboard.kind === "available");
      assert.equal(dashboard.documents[0]!.status, "restored");
      assert.equal(dashboard.amendments.filter((a) => a.kind === "unmarked").length, 1);
      assert.equal(dashboard.documents[0]!.amendmentIds.length, 2);
    }).pipe(Effect.scoped),
  );
  it.effect("composes a subpath's recorded delta without importing conflicting captured code", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.fs.makeDirectory(`${f.cwd}/memory`);
      yield* f.fs.writeFileString(`${f.cwd}/memory/Note.md`, "baseline memory\n");
      const baseline = yield* f.snapshot(0);
      yield* f.fs.writeFileString(`${f.cwd}/memory/Loose.md`, "captured memory\n");
      yield* f.fs.writeFileString(`${f.cwd}/A.md`, "captured code\n");
      yield* f.snapshot(1, baseline);
      yield* f.run(["reset", "HEAD"]);
      yield* f.fs.writeFileString(`${f.cwd}/A.md`, "later code\n");
      yield* f.run(["add", "A.md"]);
      yield* f.run(["commit", "-m", "later code"]);
      const context = {
        ...f.context,
        source: { ...f.context.source, subpath: "memory", rootPath: `${f.cwd}/memory` },
      };
      f.commands.length = 0;
      const position = yield* f.positions.read(context, { kind: "latest" });
      assert(!("kind" in position));
      assert(!f.commands.some((args) => args.includes("--patch") || args.includes("diff")));
      assert.equal(
        yield* f.run(["show", `${position.treeOid}:memory/Loose.md`]),
        "captured memory",
      );
      assert.equal(yield* f.run(["show", `${position.treeOid}:A.md`]), "later code");
    }).pipe(Effect.scoped),
  );
  it.effect("keeps an inherited note out of new changes when committed unchanged", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.fs.writeFileString(`${f.cwd}/Inherited.md`, "inherited content\n");
      const baseline = yield* f.snapshot(0);
      yield* f.run(["update-ref", lineSnapshotRef(f.rootId), baseline]);
      yield* f.run(["commit", "-m", "Record inherited memory\n\nAstrolabe-Amendment: inherited"]);
      const overview = yield* f.read();
      assert(overview.kind === "available");
      assert.deepEqual(overview.documents, []);
      assert.deepEqual(overview.graph.nodes, []);
      assert.deepEqual(overview.amendments, []);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "keeps a large unchanged vault out of the overview and reads Browse metadata lazily",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        for (let i = 0; i < 1000; i++)
          yield* f.fs.writeFileString(`${f.cwd}/Note-${i}.md`, "unchanged body ".repeat(100));
        yield* f.fs.writeFileString(`${f.cwd}/Map.skillmap.md`, "malformed map");
        const baseline = yield* f.snapshot(0);
        yield* f.snapshot(1, baseline);
        f.commands.length = 0;
        const overview = yield* f.read();
        assert(overview.kind === "available");
        assert(!("catalog" in overview));
        assert(encodeDashboard(overview).length < 4096);
        assert(!f.commands.some((args) => args.includes("cat-file")));
        const catalog = yield* f.dashboard.readCatalog({ position: overview.position });
        assert(catalog.kind === "available");
        assert.equal(catalog.entries.length, 1002);
        assert(!("position" in catalog.entries[0]!));
        assert(!f.commands.some((args) => args.includes("cat-file")));
        yield* f.fs.writeFileString(
          "/private/tmp/memory-correction1-payload.json",
          encodeMeasurement({
            files: catalog.entries.length,
            overviewBytes: new TextEncoder().encode(encodeDashboard(overview)).length,
            catalogBytes: new TextEncoder().encode(encodeCatalog(catalog)).length,
          }),
        );
      }).pipe(Effect.scoped),
  );
});
