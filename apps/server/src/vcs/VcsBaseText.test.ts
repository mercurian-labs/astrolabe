import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { VcsStatusLocalResult, VcsStatusStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsBaseText from "./VcsBaseText.ts";
import * as VcsProcess from "./VcsProcess.ts";
import * as VcsStatusBroadcaster from "./VcsStatusBroadcaster.ts";

const layerGit = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-vcs-base-text-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
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
  yield* git("init", "--initial-branch=main");
  yield* git("config", "user.email", "test@test.com");
  yield* git("config", "user.name", "Test");
  return { cwd, path, write, commit };
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
      const service = yield* VcsBaseText.VcsBaseText.pipe(
        Effect.provide(VcsBaseText.layer.pipe(Layer.provide(layer))),
      );

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
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(layerGit, layerKnownWorkspaces))),
);

it.effect("sends the base text again when a status change brings a new commit of the file", () =>
  Effect.gen(function* () {
    const repo = yield* repository;
    yield* repo.commit("a.ts", "one\n");
    const { events, layer } = yield* statusEvents;
    const service = yield* VcsBaseText.VcsBaseText.pipe(
      Effect.provide(VcsBaseText.layer.pipe(Layer.provide(layer))),
    );
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
  }).pipe(Effect.scoped, Effect.provide(Layer.merge(layerGit, layerKnownWorkspaces))),
);
