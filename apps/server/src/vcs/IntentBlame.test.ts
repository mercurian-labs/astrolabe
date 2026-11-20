import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import { attributeLines, type BlameTurn, type LineSource } from "./IntentBlame.ts";
import * as VcsProcess from "./VcsProcess.ts";

const layer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-intent-blame-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const checkout = (cwd: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const git = (...args: string[]) =>
      driver
        .execute({ operation: "IntentBlame.test", cwd, args, timeoutMs: 10_000 })
        .pipe(Effect.map((result) => result.stdout.trim()));
    const write = (contents: string) =>
      fileSystem.writeFileString(path.join(cwd, "f.ts"), contents);
    const commit = (contents: string, message: string) =>
      write(contents).pipe(
        Effect.andThen(git("add", "f.ts")),
        Effect.andThen(git("commit", "-m", message)),
      );
    /** Points `ref` at the checkout's files as they are, as a checkpoint does. */
    const snapshot = (ref: string) =>
      Effect.gen(function* () {
        yield* git("add", "-A");
        const tree = yield* git("write-tree");
        yield* git("update-ref", ref, yield* git("commit-tree", tree, "-m", ref));
        return ref;
      });
    /** A turn that leaves the file as `contents`. */
    const turn = (key: number, contents: string) =>
      Effect.gen(function* () {
        const startRef = yield* snapshot(`refs/test/${key}/start`);
        yield* write(contents);
        const endRef = yield* snapshot(`refs/test/${key}/end`);
        return { key, startRef, endRef } satisfies BlameTurn;
      });
    return { cwd, git, write, commit, turn };
  });

const repository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-intent-blame-" });
  const main = yield* checkout(path.join(root, "main"));
  yield* fileSystem.makeDirectory(main.cwd);
  yield* main.git("init", "--initial-branch=main");
  yield* main.git("config", "user.email", "test@test.com");
  yield* main.git("config", "user.name", "Test");
  return { root, main, path };
});

const describe = (contents: string, sources: ReadonlyArray<LineSource>) =>
  contents
    .trimEnd()
    .split("\n")
    .map((line, index) => {
      const source = sources[index]!;
      return `${line}: ${source.origin === "turn" ? `turn ${source.turn}` : source.origin}`;
    });

it.layer(layer)("IntentBlame.attributeLines", (it) => {
  it.effect("gives each line to the turn that last wrote it, and says when none did", () =>
    Effect.gen(function* () {
      const { main } = yield* repository;
      yield* main.commit("a\nb\nc\n", "start");
      const first = yield* main.turn(0, "a\nb\nturn 0\nc\n");
      yield* main.write("a\nperson\nb\nturn 0\nc\n");
      const second = yield* main.turn(1, "a\nperson\nb\nturn 0 edited by turn 1\nc\nturn 1\n");
      const contents = "a\nperson\nb\nturn 0 edited by turn 1\nc\nturn 1\nnot saved by a turn\n";

      const sources = yield* attributeLines({
        cwd: main.cwd,
        path: "f.ts",
        contents,
        chains: [[first, second]],
        rank: (key) => key,
      });

      assert.deepStrictEqual(describe(contents, sources), [
        "a: before",
        "person: outside",
        "b: before",
        "turn 0 edited by turn 1: turn 1",
        "c: before",
        "turn 1: turn 1",
        "not saved by a turn: outside",
      ]);
    }),
  );

  it.effect(
    "follows a turn's lines from a removed worktree through a rebase and a squash merge",
    () =>
      Effect.gen(function* () {
        const { root, main, path } = yield* repository;
        yield* main.commit("a\nb\n", "start");
        yield* main.git("worktree", "add", path.join(root, "feature"), "-b", "feature");
        const feature = yield* checkout(path.join(root, "feature"));
        const featureTurn = yield* feature.turn(0, "a\nb\nfeature\n");
        yield* feature.commit("a\nb\nfeature\n", "feature");
        // A person changes main meanwhile; the feature is rebased onto it, then squashed in.
        yield* main.commit("top\na\nb\n", "person");
        yield* feature.git("rebase", "main");
        yield* main.git("merge", "--squash", "feature");
        yield* main.git("commit", "-m", "squash feature");
        yield* main.git("worktree", "remove", "--force", feature.cwd);
        yield* main.git("branch", "-D", "feature");
        const mainTurn = yield* main.turn(1, "top\na\nb\nfeature\nmain turn\n");

        const contents = "top\na\nb\nfeature\nmain turn\n";
        const sources = yield* attributeLines({
          cwd: main.cwd,
          path: "f.ts",
          contents,
          chains: [[featureTurn], [mainTurn]],
          rank: (key) => key,
        });

        assert.deepStrictEqual(describe(contents, sources), [
          "top: outside",
          "a: before",
          "b: before",
          "feature: turn 0",
          "main turn: turn 1",
        ]);
      }),
  );
});
