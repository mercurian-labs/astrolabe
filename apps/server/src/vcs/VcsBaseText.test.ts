import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointScopeId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RunStatus,
  type VcsStatusLocalResult,
  type VcsStatusStreamEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { checkpointRefForScopeOrdinal } from "../orchestration-v2/CheckpointService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsBaseText from "./VcsBaseText.ts";
import * as VcsProcess from "./VcsProcess.ts";
import * as VcsStatusBroadcaster from "./VcsStatusBroadcaster.ts";

const layerGit = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-vcs-base-text-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const local: VcsStatusLocalResult = {
  isRepo: true,
  hasPrimaryRemote: false,
  isDefaultRef: true,
  refName: "main",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

/** The checkout's status as a queue the test fills, standing in for the broadcaster's. */
const statusEvents = Effect.gen(function* () {
  const events = yield* Queue.unbounded<VcsStatusStreamEvent>();
  const notUsed = () => Effect.die("not used");
  const layer = Layer.succeed(VcsStatusBroadcaster.VcsStatusBroadcaster, {
    getStatus: notUsed,
    refreshLocalStatus: notUsed,
    refreshStatus: notUsed,
    refreshPullRequestStatus: notUsed,
    streamStatus: () => Stream.fromQueue(events),
  });
  return { events, layer };
});

const layerKnownWorkspaces = Layer.succeed(KnownWorkspaces.KnownWorkspaces, {
  contains: () => Effect.succeed(true),
  assertContains: () => Effect.void,
});

/** The orchestration's events as a queue the test fills, applied to the projection as they go. */
const domainEvents = Effect.gen(function* () {
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const layer = Layer.mock(ThreadManagement.ThreadManagementService)({
    streamDomainEvents: Stream.fromQueue(events),
  });
  const apply = (...applied: ReadonlyArray<OrchestrationV2DomainEvent>) =>
    Effect.forEach(applied, projections.apply, { discard: true });
  const publish = (...published: ReadonlyArray<OrchestrationV2DomainEvent>) =>
    apply(...published).pipe(Effect.andThen(Queue.offerAll(events, published)));
  return { layer, apply, publish };
});

const layerServices = Layer.mergeAll(
  layerGit,
  layerKnownWorkspaces,
  NodeCrypto.layer,
  ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
);

const serviceWith = (
  statusLayer: Layer.Layer<VcsStatusBroadcaster.VcsStatusBroadcaster>,
  turnsLayer: Layer.Layer<ThreadManagement.ThreadManagementService>,
) =>
  VcsBaseText.VcsBaseText.pipe(
    Effect.provide(VcsBaseText.layer.pipe(Layer.provide(Layer.merge(statusLayer, turnsLayer)))),
  );

const noTurns = Layer.mock(ThreadManagement.ThreadManagementService)({
  streamDomainEvents: Stream.empty,
});

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 30, 0, minute));

/** A thread with its root checkpoint scope in `cwd`, as the projection holds them. */
const threadIn = (name: string, cwd: string): ReadonlyArray<OrchestrationV2DomainEvent> => {
  const threadId = ThreadId.make(`thread:${name}`);
  return [
    {
      id: EventId.make(`created:${name}`),
      type: "thread.created",
      threadId,
      occurredAt: at(0),
      payload: {
        createdBy: "user",
        creationSource: "web",
        id: threadId,
        projectId: ProjectId.make("project:base-text"),
        title: name,
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: at(0),
        updatedAt: at(0),
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
    },
    {
      id: EventId.make(`scope:${name}`),
      type: "checkpoint-scope.created",
      threadId,
      occurredAt: at(0),
      payload: {
        id: CheckpointScopeId.make(`scope:${name}`),
        threadId,
        runId: null,
        nodeId: NodeId.make(`node:${name}:1`),
        parentScopeId: null,
        providerThreadId: null,
        kind: "root_run",
        ordinalWithinParent: 0,
        advancesAppRunCount: true,
        cwd,
        createdAt: at(0),
      },
    },
  ];
};

/** Turn `ordinal` of thread `name`: its run and root node, in `status`. */
const turn = (
  name: string,
  ordinal: number,
  status: OrchestrationV2RunStatus,
): ReadonlyArray<OrchestrationV2DomainEvent> => {
  const threadId = ThreadId.make(`thread:${name}`);
  const runId = RunId.make(`run:${name}:${ordinal}`);
  const nodeId = NodeId.make(`node:${name}:${ordinal}`);
  return [
    {
      id: EventId.make(`node:${name}:${ordinal}`),
      type: "node.updated",
      threadId,
      runId,
      occurredAt: at(ordinal),
      payload: {
        id: nodeId,
        threadId,
        runId,
        parentNodeId: null,
        rootNodeId: nodeId,
        kind: "root_turn",
        status: "running",
        countsForRun: true,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId: CheckpointScopeId.make(`scope:${name}`),
        startedAt: at(ordinal),
        completedAt: null,
      },
    },
    {
      id: EventId.make(`run:${name}:${ordinal}:${status}`),
      type: "run.updated",
      threadId,
      runId,
      occurredAt: at(ordinal),
      payload: {
        id: runId,
        threadId,
        ordinal,
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
        providerThreadId: null,
        userMessageId: MessageId.make(`message:${name}:${ordinal}`),
        rootNodeId: nodeId,
        activeAttemptId: null,
        status,
        requestedAt: at(ordinal),
        startedAt: at(ordinal),
        completedAt: status === "completed" ? at(ordinal) : null,
        checkpointId: null,
        contextHandoffId: null,
      },
    },
  ];
};

/** The checkpoint that ends turn `ordinal` of thread `name`, listing `files`. */
const checkpoint = (
  name: string,
  ordinal: number,
  minute: number,
  files: ReadonlyArray<string>,
): OrchestrationV2DomainEvent => {
  const threadId = ThreadId.make(`thread:${name}`);
  const runId = RunId.make(`run:${name}:${ordinal}`);
  return {
    id: EventId.make(`checkpoint:${name}:${ordinal}`),
    type: "checkpoint.captured",
    threadId,
    runId,
    occurredAt: at(minute),
    payload: {
      id: CheckpointId.make(`checkpoint:${name}:${ordinal}`),
      threadId,
      scopeId: CheckpointScopeId.make(`scope:${name}`),
      runId,
      nodeId: NodeId.make(`node:${name}:${ordinal}`),
      parentCheckpointId: null,
      ordinalWithinScope: ordinal,
      appRunOrdinal: ordinal,
      ref: `refs/t3/test/${name}/${ordinal}` as never,
      status: "ready",
      files: files.map((path) => ({ path, kind: "modified", additions: 1, deletions: 1 })),
      capturedAt: at(minute),
    },
  };
};

/** A tool call of thread `name`'s turn `ordinal` finishing. */
const toolDone = (
  name: string,
  ordinal: number,
  key: string,
  type: "file_change" | "command_execution",
): OrchestrationV2DomainEvent => {
  const threadId = ThreadId.make(`thread:${name}`);
  const runId = RunId.make(`run:${name}:${ordinal}`);
  const base = {
    id: TurnItemId.make(`item:${name}:${key}`),
    threadId,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed" as const,
    title: null,
    startedAt: at(ordinal),
    completedAt: at(ordinal),
    updatedAt: at(ordinal),
  };
  return {
    id: EventId.make(`item:${name}:${key}`),
    type: "turn-item.updated",
    threadId,
    runId,
    occurredAt: at(ordinal),
    payload:
      type === "file_change"
        ? { ...base, type, fileName: "a.ts" }
        : { ...base, type, input: "sed -i s/three/four/ a.ts" },
  };
};

const repository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-vcs-base-text-" });
  const git = (...args: string[]) =>
    driver.execute({ operation: "VcsBaseText.test", cwd, args, timeoutMs: 10_000 });
  const write = (relative: string, contents: string) =>
    Effect.gen(function* () {
      const absolute = path.join(cwd, relative);
      yield* fileSystem.makeDirectory(path.dirname(absolute), { recursive: true });
      yield* fileSystem.writeFileString(absolute, contents);
    });
  const commit = (relative: string, contents: string) =>
    Effect.gen(function* () {
      yield* write(relative, contents);
      yield* git("add", relative);
      yield* git("commit", "-m", `write ${relative}`);
    });
  /** Points the checkpoint ref of thread `name`'s scope at `ordinal` to the files as they are. */
  const snapshot = (name: string, ordinal: number) =>
    Effect.gen(function* () {
      yield* git("add", "-A");
      yield* git("commit", "--allow-empty", "-m", `snapshot ${name} ${ordinal}`);
      const ref = yield* checkpointRefForScopeOrdinal({
        scopeId: CheckpointScopeId.make(`scope:${name}`),
        ordinalWithinScope: ordinal,
      });
      yield* git("update-ref", ref, "HEAD");
    });
  const blobOf = (relative: string) =>
    git("hash-object", "--", relative).pipe(Effect.map((result) => result.stdout.trim()));
  yield* git("init", "--initial-branch=main");
  yield* git("config", "user.email", "test@test.com");
  yield* git("config", "user.name", "Test");
  return { cwd, path, write, commit, snapshot, blobOf };
});

it.effect(
  "reads a file's committed text, relative to the cwd, and nothing for an untracked one",
  () =>
    Effect.gen(function* () {
      const repo = yield* repository;
      yield* repo.commit("src/a.ts", "one\n");
      yield* repo.write("src/a.ts", "one, edited\n");
      yield* repo.write("src/new.ts", "new\n");
      const { layer } = yield* statusEvents;
      const service = yield* serviceWith(layer, noTurns);

      const base = yield* service.read({ cwd: repo.cwd, path: "src/a.ts", base: "head" });
      assert.strictEqual(base?.text, "one\n");
      assert.match(base?.hash ?? "", /^[0-9a-f]{40}$/);
      const inSubfolder = yield* service.read({
        cwd: repo.path.join(repo.cwd, "src"),
        path: "a.ts",
        base: "head",
      });
      assert.deepStrictEqual(inSubfolder, base);
      assert.strictEqual(
        yield* service.read({ cwd: repo.cwd, path: "src/new.ts", base: "head" }),
        null,
      );
    }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect("sends the base text again when a status change brings a new commit of the file", () =>
  Effect.gen(function* () {
    const repo = yield* repository;
    yield* repo.commit("a.ts", "one\n");
    const { events, layer } = yield* statusEvents;
    const service = yield* serviceWith(layer, noTurns);
    const texts = yield* Stream.toQueue(
      service.stream({ cwd: repo.cwd, path: "a.ts", base: "head" }),
      { capacity: "unbounded" },
    );

    yield* Queue.offer(events, { _tag: "snapshot", local, remote: null });
    assert.strictEqual((yield* Queue.take(texts))?.text, "one\n");

    // Status changes that leave the file's commit alone send nothing: "one" never comes again.
    yield* repo.commit("other.ts", "other\n");
    yield* Queue.offer(events, { _tag: "localUpdated", local });
    yield* Queue.offer(events, { _tag: "remoteUpdated", remote: null });
    yield* repo.commit("a.ts", "two\n");
    yield* Queue.offer(events, { _tag: "localUpdated", local });
    assert.strictEqual((yield* Queue.take(texts))?.text, "two\n");
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect(
  "compares against the start of the latest turn in the checkout that changed the file",
  () =>
    Effect.gen(function* () {
      const repo = yield* repository;
      const turns = yield* domainEvents;
      const { layer } = yield* statusEvents;
      const service = yield* serviceWith(layer, turns.layer);
      const turnBase = (path: string) => service.read({ cwd: repo.cwd, path, base: "turn" });

      yield* repo.commit("a.ts", "one\n");
      yield* repo.snapshot("first", 0);
      yield* repo.write("a.ts", "two\n");
      yield* repo.write("new.ts", "made by a turn\n");
      yield* repo.snapshot("first", 1);
      yield* turns.apply(
        ...threadIn("first", repo.cwd),
        ...turn("first", 1, "completed"),
        checkpoint("first", 1, 5, ["a.ts", "new.ts"]),
        // A later turn in another checkout changed a file of the same name.
        ...threadIn("elsewhere", repo.path.join(repo.cwd, "..", "elsewhere")),
        ...turn("elsewhere", 1, "completed"),
        checkpoint("elsewhere", 1, 9, ["a.ts"]),
      );

      const first = yield* turnBase("a.ts");
      assert.deepStrictEqual(
        { text: first?.text, turn: first?.turn },
        { text: "one\n", turn: { threadId: ThreadId.make("thread:first"), running: false } },
      );
      // A file the turn created starts empty; one no turn changed has no turn base.
      assert.strictEqual((yield* turnBase("new.ts"))?.text, "");
      yield* repo.commit("untouched.ts", "same\n");
      assert.strictEqual(yield* turnBase("untouched.ts"), null);

      // Another thread's later turn in this checkout takes over.
      yield* repo.snapshot("second", 0);
      yield* repo.write("a.ts", "three\n");
      yield* repo.snapshot("second", 1);
      yield* turns.apply(
        ...threadIn("second", repo.cwd),
        ...turn("second", 1, "completed"),
        checkpoint("second", 1, 7, ["a.ts"]),
      );
      const second = yield* turnBase("a.ts");
      assert.strictEqual(second?.text, "two\n");
      assert.strictEqual(second?.turn?.threadId, ThreadId.make("thread:second"));
    }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect("follows a running turn once it writes the file, and again as it ends", () =>
  Effect.gen(function* () {
    const repo = yield* repository;
    const turns = yield* domainEvents;
    const { layer } = yield* statusEvents;
    const service = yield* serviceWith(layer, turns.layer);

    yield* repo.commit("a.ts", "one\n");
    yield* repo.snapshot("done", 0);
    yield* repo.write("a.ts", "two\n");
    yield* repo.snapshot("done", 1);
    yield* turns.apply(
      ...threadIn("done", repo.cwd),
      ...turn("done", 1, "completed"),
      checkpoint("done", 1, 1, ["a.ts"]),
    );
    const texts = yield* Stream.toQueue(
      service.stream({ cwd: repo.cwd, path: "a.ts", base: "turn" }),
      { capacity: "unbounded" },
    );
    const done = yield* Queue.take(texts);
    assert.strictEqual(done?.text, "one\n");
    assert.strictEqual(done?.turn?.threadId, ThreadId.make("thread:done"));

    // A turn starts in a new thread here and has not written the file: nothing is sent.
    yield* repo.snapshot("live", 0);
    yield* turns.publish(...threadIn("live", repo.cwd), ...turn("live", 1, "running"));
    // It writes the file: its start is the base.
    yield* repo.write("a.ts", "three\n");
    yield* turns.publish(toolDone("live", 1, "edit", "file_change"));
    const writing = yield* Queue.take(texts);
    assert.deepStrictEqual(
      { text: writing?.text, turn: writing?.turn },
      { text: "two\n", turn: { threadId: ThreadId.make("thread:live"), running: true } },
    );
    // Writing it again leaves the base as it was: nothing is sent.
    yield* repo.write("a.ts", "four\n");
    yield* turns.publish(toolDone("live", 1, "sed", "command_execution"));

    // It ends: the same base, from its checkpoint now.
    yield* repo.snapshot("live", 1);
    yield* turns.publish(checkpoint("live", 1, 3, ["a.ts"]), ...turn("live", 1, "completed"));
    const ended = yield* Queue.take(texts);
    assert.deepStrictEqual(
      { text: ended?.text, turn: ended?.turn },
      { text: "two\n", turn: { threadId: ThreadId.make("thread:live"), running: false } },
    );
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);
