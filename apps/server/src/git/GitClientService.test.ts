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
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RunStatus,
  type VcsStatusResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as GitClientService from "./GitClientService.ts";
import * as GitManager from "./GitManager.ts";
import * as GitWorkflow from "./GitWorkflowService.ts";

const layerVcsProcess = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const layerServices = Layer.mergeAll(
  GitVcsDriver.layer,
  CheckpointStore.layer.pipe(
    Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(layerVcsProcess))),
  ),
  ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-client-" })),
  Layer.provideMerge(layerVcsProcess),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

/** The service, with the paths the commit message generator was asked to describe. */
const service = Effect.gen(function* () {
  const described: Array<ReadonlyArray<string> | undefined> = [];
  const client = yield* GitClientService.GitClientService.pipe(
    Effect.provide(
      GitClientService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(KnownWorkspaces.KnownWorkspaces, {
              contains: () => Effect.succeed(true),
              assertContains: () => Effect.void,
            }),
            Layer.mock(GitManager.GitManager)({
              suggestCommitMessage: (input) =>
                Effect.sync(() => {
                  described.push(input.filePaths);
                  return { subject: "Generated subject", body: "" };
                }),
            }),
            Layer.mock(GitWorkflow.GitWorkflowService)({}),
            Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
              refreshStatus: () => Effect.succeed({} as VcsStatusResult),
            }),
          ),
        ),
      ),
    ),
  );
  return { client, described };
});

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 30, 0, minute));

/** A thread whose root checkpoint scope is in `cwd`. */
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
        projectId: ProjectId.make("project:git-client"),
        title: `Thread ${name}`,
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

/** Turn `ordinal` of thread `name`, in `status`. */
const turn = (
  name: string,
  ordinal: number,
  status: OrchestrationV2RunStatus,
): OrchestrationV2DomainEvent => {
  const threadId = ThreadId.make(`thread:${name}`);
  const runId = RunId.make(`run:${name}:${ordinal}`);
  return {
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
      rootNodeId: null,
      activeAttemptId: null,
      status,
      requestedAt: at(ordinal),
      startedAt: at(ordinal),
      completedAt: status === "completed" ? at(ordinal + 1) : null,
      checkpointId: null,
      contextHandoffId: null,
    },
  };
};

/** The checkpoint ending turn `ordinal` of thread `name`, captured at `minute`, listing `files`. */
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

const applyTurns = (...events: ReadonlyArray<OrchestrationV2DomainEvent>) =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* Effect.forEach(events, projections.apply, { discard: true });
  });

const repository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-git-client-" });
  const git = (...args: string[]) =>
    driver
      .execute({ operation: "GitClientService.test", cwd, args, allowNonZeroExit: true })
      .pipe(Effect.map((result) => result.stdout));
  const write = (relative: string, contents: string | Uint8Array) =>
    Effect.gen(function* () {
      const absolute = path.join(cwd, relative);
      yield* fileSystem.makeDirectory(path.dirname(absolute), { recursive: true });
      yield* typeof contents === "string"
        ? fileSystem.writeFileString(absolute, contents)
        : fileSystem.writeFile(absolute, contents);
    });
  const read = (relative: string) => fileSystem.readFile(path.join(cwd, relative));
  const exists = (relative: string) => fileSystem.exists(path.join(cwd, relative));
  const commit = (message: string, files: Record<string, string>) =>
    Effect.gen(function* () {
      for (const [file, contents] of Object.entries(files)) yield* write(file, contents);
      yield* git("add", "-A");
      yield* git("commit", "-m", message);
    });
  yield* git("init", "--initial-branch=main");
  yield* git("config", "user.email", "test@test.com");
  yield* git("config", "user.name", "Test");
  yield* git("config", "commit.gpgsign", "false");
  return { cwd, git, write, read, exists, commit };
});

it.effect("reads a rename, an untracked file and a conflict from one status", () =>
  Effect.gen(function* () {
    const repo = yield* repository;
    const { client } = yield* service;
    yield* repo.commit("start", { "a.txt": "a\n", "c.txt": "base\n" });
    yield* repo.git("switch", "-c", "other");
    yield* repo.commit("theirs", { "c.txt": "theirs\n" });
    yield* repo.git("switch", "main");
    yield* repo.commit("ours", { "c.txt": "ours\n" });
    yield* repo.git("merge", "other");
    yield* repo.git("mv", "a.txt", "renamed.txt");
    yield* repo.write("new file.txt", "one\ntwo\n");

    const status = yield* client.status({ cwd: repo.cwd });
    assert.strictEqual(status.branch, "main");
    assert.strictEqual(status.operation, "merge");
    const byPath = new Map(status.files.map((file) => [file.path, file]));
    assert.deepInclude(byPath.get("renamed.txt"), {
      originalPath: "a.txt",
      index: "renamed",
      workingTree: null,
      untracked: false,
    });
    assert.deepInclude(byPath.get("new file.txt"), {
      untracked: true,
      additions: 2,
      deletions: 0,
      turnRunId: null,
    });
    assert.deepInclude(byPath.get("c.txt"), { conflicted: true });
    assert.strictEqual(status.files.length, 3);
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect(
  "gives a file to the latest turn with uncommitted work in it and leaves the person's own alone",
  () =>
    Effect.gen(function* () {
      const repo = yield* repository;
      const { client } = yield* service;
      yield* repo.commit("start", { "x.ts": "x\n", "y.ts": "y\n", "z.ts": "z\n", "w.ts": "w\n" });
      // A turn's work on w.ts was committed: its checkpoint holds the file as HEAD does.
      yield* repo.commit("the turn's w", { "w.ts": "w by the turn\n" });
      yield* repo.git("update-ref", "refs/t3/test/gamma/1", "HEAD");
      yield* repo.write("w.ts", "w edited by hand since\n");
      // A later turn left v.ts uncommitted, and its checkpoint can be read.
      yield* repo.write("v.ts", "v by the turn\n");
      yield* repo.git("add", "-N", "v.ts");
      yield* repo.git(
        "update-ref",
        "refs/t3/test/gamma/2",
        (yield* repo.git("stash", "create")).trim(),
      );
      yield* repo.write("x.ts", "x edited\n");
      yield* repo.write("y.ts", "y edited\n");
      yield* repo.write("z.ts", "z edited by hand\n");
      yield* applyTurns(
        ...threadIn("alpha", repo.cwd),
        turn("alpha", 1, "completed"),
        checkpoint("alpha", 1, 2, ["x.ts"]),
        turn("alpha", 2, "completed"),
        checkpoint("alpha", 2, 4, ["x.ts", "y.ts"]),
        // A later turn in another thread in the same checkout took y.ts last.
        ...threadIn("beta", repo.cwd),
        turn("beta", 1, "completed"),
        checkpoint("beta", 1, 6, ["y.ts"]),
        // A turn elsewhere names the same path; it is not this checkout's.
        ...threadIn("elsewhere", `${repo.cwd}-elsewhere`),
        turn("elsewhere", 1, "completed"),
        checkpoint("elsewhere", 1, 9, ["z.ts"]),
        ...threadIn("gamma", repo.cwd),
        turn("gamma", 1, "completed"),
        checkpoint("gamma", 1, 10, ["w.ts"]),
        turn("gamma", 2, "completed"),
        checkpoint("gamma", 2, 12, ["v.ts"]),
      );

      const status = yield* client.status({ cwd: repo.cwd });
      const byPath = new Map(status.files.map((file) => [file.path, file]));
      assert.deepInclude(byPath.get("x.ts"), {
        turnRunId: RunId.make("run:alpha:2"),
        earlierTurns: 1,
      });
      assert.deepInclude(byPath.get("y.ts"), {
        turnRunId: RunId.make("run:beta:1"),
        earlierTurns: 1,
      });
      assert.deepInclude(byPath.get("z.ts"), { turnRunId: null, earlierTurns: 0 });
      assert.deepInclude(byPath.get("w.ts"), { turnRunId: null, earlierTurns: 0 });
      assert.deepInclude(byPath.get("v.ts"), {
        turnRunId: RunId.make("run:gamma:2"),
        earlierTurns: 0,
      });
      assert.deepStrictEqual(
        status.turns.map((described) => [described.threadTitle, described.turnNumber]),
        [
          ["Thread gamma", 2],
          ["Thread beta", 1],
          ["Thread alpha", 2],
        ],
      );
      assert.strictEqual(status.running, null);
    }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect("discards tracked and untracked files, and undo puts back every byte", () =>
  Effect.gen(function* () {
    const repo = yield* repository;
    const { client } = yield* service;
    yield* repo.commit("start", { "tracked.txt": "committed\n" });
    yield* repo.write("tracked.txt", "staged\n");
    yield* repo.git("add", "tracked.txt");
    yield* repo.write("tracked.txt", "staged\nthen edited\n");
    const untracked = new Uint8Array([0, 1, 2, 254, 255, 10]);
    yield* repo.write("dir/new.bin", untracked);
    const statusBefore = yield* repo.git("status", "--porcelain=v2", "-z", "--untracked-files=all");

    yield* client.discard({ cwd: repo.cwd, paths: ["tracked.txt", "dir/new.bin"] });
    assert.strictEqual(new TextDecoder().decode(yield* repo.read("tracked.txt")), "committed\n");
    assert.isFalse(yield* repo.exists("dir/new.bin"));
    assert.strictEqual((yield* client.status({ cwd: repo.cwd })).undo, "discarding 2 files");

    yield* client.undo({ cwd: repo.cwd });
    assert.strictEqual(
      new TextDecoder().decode(yield* repo.read("tracked.txt")),
      "staged\nthen edited\n",
    );
    assert.deepStrictEqual(yield* repo.read("dir/new.bin"), untracked);
    assert.strictEqual(yield* repo.git("show", ":tracked.txt"), "staged\n");
    assert.strictEqual(
      yield* repo.git("status", "--porcelain=v2", "-z", "--untracked-files=all"),
      statusBefore,
    );
    assert.strictEqual(
      (yield* repo.git("for-each-ref", GitClientService.UNDO_REF_PREFIX)).trim(),
      "",
    );
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect("commits only what is staged, describing just those files", () =>
  Effect.gen(function* () {
    const repo = yield* repository;
    const { client, described } = yield* service;
    yield* repo.commit("start", { "a.txt": "a\n", "b.txt": "b\n" });
    yield* repo.write("a.txt", "a edited\n");
    yield* repo.write("b.txt", "b edited\n");
    yield* client.stage({ cwd: repo.cwd, paths: ["a.txt"] });

    const committed = yield* client.commit({ cwd: repo.cwd });
    assert.strictEqual(committed.subject, "Generated subject");
    assert.deepStrictEqual(described, [["a.txt"]]);
    assert.strictEqual(
      (yield* repo.git("show", "--name-only", "--format=%s", "HEAD")).trim(),
      "Generated subject\n\na.txt",
    );
    const left = (yield* client.status({ cwd: repo.cwd })).files;
    assert.deepStrictEqual(
      left.map((file) => [file.path, file.index, file.workingTree]),
      [["b.txt", null, "modified"]],
    );
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect("undoes a commit while HEAD is still it, and refuses once HEAD has moved", () =>
  Effect.gen(function* () {
    const repo = yield* repository;
    const { client } = yield* service;
    yield* repo.commit("start", { "a.txt": "a\n" });
    const start = (yield* repo.git("rev-parse", "HEAD")).trim();
    yield* repo.write("a.txt", "a edited\n");

    yield* client.commit({ cwd: repo.cwd, message: "Edit a" });
    yield* client.undo({ cwd: repo.cwd });
    assert.strictEqual((yield* repo.git("rev-parse", "HEAD")).trim(), start);
    // Committed with nothing staged, so undo leaves it unstaged as it was.
    const after = (yield* client.status({ cwd: repo.cwd })).files;
    assert.deepStrictEqual(
      after.map((file) => [file.path, file.index, file.workingTree]),
      [["a.txt", null, "modified"]],
    );

    yield* client.commit({ cwd: repo.cwd, message: "Edit a again" });
    yield* repo.git("commit", "--allow-empty", "-m", "made in a terminal");
    const refused = yield* Effect.exit(client.undo({ cwd: repo.cwd }));
    assert.isTrue(Exit.isFailure(refused));
    assert.include(String(Exit.isFailure(refused) && refused.cause), "moved on");
    assert.strictEqual((yield* repo.git("log", "-1", "--format=%s")).trim(), "made in a terminal");
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);

it.effect("refuses to change the checkout while a turn is working in it", () =>
  Effect.gen(function* () {
    const repo = yield* repository;
    const { client } = yield* service;
    yield* repo.commit("start", { "a.txt": "a\n" });
    yield* repo.write("a.txt", "a edited\n");
    yield* applyTurns(...threadIn("live", repo.cwd), turn("live", 1, "running"));

    const status = yield* client.status({ cwd: repo.cwd });
    assert.strictEqual(status.running?.threadId, "thread:live");
    const refused = yield* client.stage({ cwd: repo.cwd, paths: ["a.txt"] }).pipe(Effect.flip);
    assert.strictEqual(refused.runningThreadId, ThreadId.make("thread:live"));
    assert.include(refused.message, "Thread live");
    assert.strictEqual((yield* repo.git("diff", "--cached", "--name-only")).trim(), "");
  }).pipe(Effect.scoped, Effect.provide(layerServices)),
);
