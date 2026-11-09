import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CheckpointScopeId,
  EventId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
  type VcsStatusStreamEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as LanguageServers from "./LanguageServers.ts";
import * as WorkspaceChangeSignals from "./WorkspaceChangeSignals.ts";

const layerServices = Layer.mergeAll(
  GitVcsDriver.layer.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-change-signals-" })),
    Layer.provideMerge(VcsProcess.layer),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  ),
  ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
);

const at = DateTime.makeUnsafe(Date.UTC(2026, 9, 30));
const providerInstanceId = ProviderInstanceId.make("codex");

/** A thread whose root checkpoint scope is in `cwd`, as the projection holds it. */
const threadIn = (name: string, cwd: string): ReadonlyArray<OrchestrationV2DomainEvent> => {
  const threadId = ThreadId.make(`thread:${name}`);
  return [
    {
      id: EventId.make(`created:${name}`),
      type: "thread.created",
      threadId,
      occurredAt: at,
      payload: {
        createdBy: "user",
        creationSource: "web",
        id: threadId,
        projectId: ProjectId.make("project:signals"),
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
        createdAt: at,
        updatedAt: at,
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
      occurredAt: at,
      payload: {
        id: CheckpointScopeId.make(`scope:${name}`),
        threadId,
        runId: null,
        nodeId: NodeId.make(`node:${name}`),
        parentScopeId: null,
        providerThreadId: null,
        kind: "root_run",
        ordinalWithinParent: 0,
        advancesAppRunCount: true,
        cwd,
        createdAt: at,
      },
    },
  ];
};

/** An agent's file edit in thread `name` finishing. */
const fileEditDone = (name: string): OrchestrationV2DomainEvent => {
  const threadId = ThreadId.make(`thread:${name}`);
  const runId = RunId.make(`run:${name}`);
  return {
    id: EventId.make(`item:${name}`),
    type: "turn-item.updated",
    threadId,
    runId,
    occurredAt: at,
    payload: {
      id: TurnItemId.make(`item:${name}`),
      threadId,
      runId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
      type: "file_change",
      fileName: "vectors.ts",
    },
  };
};

const local = {
  isRepo: true,
  hasPrimaryRemote: false,
  isDefaultRef: true,
  refName: "main",
  hasWorkingTreeChanges: true,
  workingTree: { files: [], insertions: 0, deletions: 0 },
} as const;

/** A git checkout, the signals the test sends, and what the servers are told. */
const setup = Effect.fn("setup")(function* (threads: ReadonlyArray<string> = []) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-change-signals-" });
  const git = (...args: string[]) =>
    driver.execute({ operation: "WorkspaceChangeSignals.test", cwd, args, timeoutMs: 10_000 });
  yield* git("init", "--initial-branch=main");
  yield* git("config", "user.email", "test@test.com");
  yield* git("config", "user.name", "Test");
  const write = (relative: string, contents: string) =>
    fileSystem.writeFileString(path.join(cwd, relative), contents);
  const remove = (relative: string) => fileSystem.remove(path.join(cwd, relative));
  for (const event of threads.flatMap((name) => threadIn(name, cwd))) {
    yield* projections.apply(event);
  }

  const status = yield* Queue.unbounded<VcsStatusStreamEvent>();
  const turns = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const told = yield* Queue.unbounded<LanguageServers.FilesChangedInput>();
  const following = yield* Deferred.make<void>();
  const notUsed = () => Effect.die("not used");
  const layer = WorkspaceChangeSignals.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(LanguageServers.LanguageServers)({
          subscribe: Stream.concat(
            Stream.make([
              {
                cwd,
                server: "typescript" as const,
                name: "TypeScript",
                state: "ready" as const,
                source: null,
                restricted: false,
                message: null,
                memoryBytes: null,
              },
            ]),
            Stream.never,
          ),
          filesChanged: (input) => Queue.offer(told, input).pipe(Effect.asVoid),
        }),
        Layer.succeed(VcsStatusBroadcaster.VcsStatusBroadcaster, {
          getStatus: notUsed,
          refreshLocalStatus: notUsed,
          refreshStatus: notUsed,
          refreshPullRequestStatus: notUsed,
          // Asked for once the checkout's first read is in.
          streamStatus: () => {
            Deferred.doneUnsafe(following, Effect.void);
            return Stream.fromQueue(status);
          },
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          streamDomainEvents: Stream.fromQueue(turns),
        }),
      ),
    ),
  );
  return {
    cwd,
    git,
    write,
    remove,
    /** Starts following the checkout as it is now. */
    start: Layer.build(layer).pipe(Effect.andThen(Deferred.await(following))),
    statusChanged: Queue.offer(status, { _tag: "localUpdated", local }),
    /** A full refresh, as when a window comes back. */
    statusRefreshed: Queue.offer(status, { _tag: "snapshot", local, remote: null }),
    turns,
    /** The next changes the servers are told, by path. */
    told: Queue.take(told).pipe(
      Effect.map((input) =>
        input.changes.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath)),
      ),
    ),
  };
});

it.effect("tells the servers what each status change created, changed and deleted", () =>
  Effect.gen(function* () {
    const checkout = yield* setup();
    yield* checkout.write("a.ts", "a\n");
    yield* checkout.write("b.ts", "b\n");
    yield* checkout.git("add", "-A");
    yield* checkout.git("commit", "-m", "a and b");
    yield* checkout.write("untracked.ts", "u\n");
    yield* checkout.start;

    yield* checkout.write("new.ts", "new\n");
    yield* checkout.write("a.ts", "a, edited\n");
    yield* checkout.remove("b.ts");
    yield* checkout.remove("untracked.ts");
    yield* checkout.statusChanged;
    assert.deepStrictEqual(yield* checkout.told, [
      { relativePath: "a.ts", type: "changed" },
      { relativePath: "b.ts", type: "deleted" },
      { relativePath: "new.ts", type: "created" },
      { relativePath: "untracked.ts", type: "deleted" },
    ]);

    // Edited again while it stays changed, restored, and committed (which changes nothing).
    yield* checkout.write("a.ts", "a, edited twice\n");
    yield* checkout.git("checkout", "--", "b.ts");
    yield* checkout.git("add", "new.ts");
    yield* checkout.git("commit", "-m", "new");
    yield* checkout.statusChanged;
    assert.deepStrictEqual(yield* checkout.told, [
      { relativePath: "a.ts", type: "changed" },
      { relativePath: "b.ts", type: "created" },
    ]);
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect("reads the checkout again when one of its agents finishes editing a file", () =>
  Effect.gen(function* () {
    const checkout = yield* setup(["here"]);
    yield* checkout.write("a.ts", "a\n");
    yield* checkout.git("add", "-A");
    yield* checkout.git("commit", "-m", "a");
    yield* checkout.start;

    yield* checkout.write("vectors.ts", "export const scaleVector = 1;\n");
    yield* Queue.offer(checkout.turns, fileEditDone("here"));
    assert.deepStrictEqual(yield* checkout.told, [{ relativePath: "vectors.ts", type: "created" }]);
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect("reads the checkout again on a full status refresh, as when a window comes back", () =>
  Effect.gen(function* () {
    const checkout = yield* setup();
    yield* checkout.write("a.ts", "a\n");
    yield* checkout.git("add", "-A");
    yield* checkout.git("commit", "-m", "a");
    yield* checkout.start;

    // Made in a shell: nothing but the window's return signals it.
    yield* checkout.write("somethingNew.ts", "export const somethingNew = 1;\n");
    yield* checkout.statusRefreshed;
    assert.deepStrictEqual(yield* checkout.told, [
      { relativePath: "somethingNew.ts", type: "created" },
    ]);
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);
