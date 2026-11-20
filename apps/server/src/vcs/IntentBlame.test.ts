import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import { attributeLines, type BlameChain, type BlameTurn } from "./IntentBlame.ts";
import * as VcsProcess from "./VcsProcess.ts";

const layer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-intent-blame-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

// Strictly increasing commit dates keep "made before the turn began" exact. Git reads only
// plausible timestamps as dates.
let clock = 1_700_000_000;

const checkout = (cwd: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const git = (...args: string[]) =>
      Effect.suspend(() => {
        clock += 10;
        const date = `@${clock} +0000`;
        return driver.execute({
          operation: "IntentBlame.test",
          cwd,
          args,
          timeoutMs: 10_000,
          env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
        });
      }).pipe(Effect.map((result) => result.stdout.trim()));
    const write = (contents: string) =>
      fileSystem.writeFileString(path.join(cwd, "f.ts"), contents);
    const read = fileSystem.readFileString(path.join(cwd, "f.ts"));
    const commit = (contents: string, message: string) =>
      write(contents).pipe(
        Effect.andThen(git("add", "f.ts")),
        Effect.andThen(git("commit", "-m", message)),
      );
    /** Points `ref` at the checkout's files as they are, on top of HEAD, as a checkpoint does. */
    const snapshot = (ref: string) =>
      Effect.gen(function* () {
        yield* git("add", "-A");
        const tree = yield* git("write-tree");
        yield* git("update-ref", ref, yield* git("commit-tree", tree, "-p", "HEAD", "-m", ref));
        yield* git("reset", "--quiet");
        return ref;
      });
    /** A turn whose work is `work`, which leaves the file as it finds it on disk. */
    const turnDoing = <E>(key: number, work: Effect.Effect<unknown, E>) =>
      Effect.gen(function* () {
        const startRef = yield* snapshot(`refs/test/${key}/start`);
        yield* work;
        const endRef = yield* snapshot(`refs/test/${key}/end`);
        return { key, startRef, endRef } satisfies BlameTurn;
      });
    /** A turn that leaves the file as `contents`. */
    const turn = (key: number, contents: string) => turnDoing(key, write(contents));
    return { cwd, git, write, read, commit, turn, turnDoing };
  });

const repository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-intent-blame-" }),
  );
  const main = yield* checkout(path.join(root, "main"));
  yield* fileSystem.makeDirectory(main.cwd);
  yield* main.git("init", "--initial-branch=main");
  yield* main.git("config", "user.email", "test@test.com");
  yield* main.git("config", "user.name", "Test");
  return { root, main, path };
});

/** Each line of the text the editor shows, with where it came from. */
const attribute = (
  main: { readonly cwd: string; readonly read: Effect.Effect<string, PlatformError.PlatformError> },
  chains: ReadonlyArray<BlameChain>,
  unsaved?: string,
) =>
  Effect.gen(function* () {
    const saved = yield* main.read;
    const contents = unsaved ?? saved;
    const sources = yield* attributeLines({
      repo: main.cwd,
      path: "f.ts",
      saved,
      contents,
      chains,
    });
    return contents
      .trimEnd()
      .split("\n")
      .map((line, index) => {
        const source = sources[index]!;
        return `${line}: ${source.origin === "turn" ? `turn ${source.turn}` : source.origin}`;
      });
  });

const own = (...turns: BlameTurn[]): BlameChain => ({ own: true, turns });
const elsewhere = (...turns: BlameTurn[]): BlameChain => ({ own: false, turns });

it.layer(layer)("IntentBlame.attributeLines", (it) => {
  it.effect("gives each line to the turn that last changed it, and says when none did", () =>
    Effect.gen(function* () {
      const { main } = yield* repository;
      yield* main.commit("a\nb\nc\n", "start");
      const first = yield* main.turn(0, "a\nb\nturn 0\nc\n");
      yield* main.write("a\nperson\nb\nturn 0\nc\n");
      const second = yield* main.turn(1, "a\nperson\nb\nturn 0 edited by turn 1\nc\nturn 1\n");
      yield* main.write("a\nperson\nb\nturn 0 edited by turn 1\nc\nturn 1\nsaved by a person\n");
      // A turn whose start checkpoint is gone cannot say which lines it wrote.
      const startless = yield* main.turn(
        2,
        "a\nperson\nb\nturn 0 edited by turn 1\nc\nturn 1\nsaved by a person\nturn 2\n",
      );

      const lines = yield* attribute(
        main,
        [own(first, second, { ...startless, startRef: "refs/test/gone" })],
        "a\nperson\nb\nturn 0 edited by turn 1\nc\nturn 1\nsaved by a person\nturn 2\nnot saved\n",
      );

      assert.deepStrictEqual(lines, [
        "a: before",
        "person: outside",
        "b: before",
        "turn 0 edited by turn 1: turn 1",
        "c: before",
        "turn 1: turn 1",
        "saved by a person: outside",
        "turn 2: outside",
        "not saved: unsaved",
      ]);
    }),
  );

  it.effect("does not credit a turn with what a merge or a rebase brought in", () =>
    Effect.gen(function* () {
      const { main } = yield* repository;
      yield* main.commit("a\nb\n", "start");
      yield* main.git("checkout", "-b", "upstream");
      yield* main.commit("a\nb\nupstream\n", "upstream");
      yield* main.git("checkout", "main");
      // The agent commits its own edit, then merges upstream in.
      const merging = yield* main.turnDoing(
        0,
        main
          .commit("agent\na\nb\n", "agent")
          .pipe(Effect.andThen(main.git("merge", "--no-edit", "upstream"))),
      );
      // A person adds to upstream; the next turn rebases onto it and edits again.
      yield* main.git("checkout", "upstream");
      yield* main.commit("a\nb\nupstream\nperson upstream\n", "person");
      yield* main.git("checkout", "main");
      yield* main.git("reset", "--hard", "HEAD~1");
      yield* main.write("agent\na\nb\n");
      const rebasing = yield* main.turnDoing(
        1,
        main
          .git("rebase", "upstream")
          .pipe(
            Effect.andThen(main.write("agent\na\nb\nupstream\nperson upstream\nagent again\n")),
          ),
      );

      assert.deepStrictEqual(yield* attribute(main, [own(merging, rebasing)]), [
        "agent: turn 0",
        "a: before",
        "b: before",
        "upstream: outside",
        "person upstream: outside",
        "agent again: turn 1",
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

        assert.deepStrictEqual(yield* attribute(main, [elsewhere(featureTurn), own(mainTurn)]), [
          "top: outside",
          "a: before",
          "b: before",
          "feature: turn 0",
          "main turn: turn 1",
        ]);
      }),
  );

  it.effect("lets the file's own checkout decide before an older turn elsewhere", () =>
    Effect.gen(function* () {
      const { root, main, path } = yield* repository;
      yield* main.commit("a\n", "start");
      yield* main.git("worktree", "add", path.join(root, "other"), "-b", "other");
      const other = yield* checkout(path.join(root, "other"));
      const older = yield* other.turn(0, "a\nsame line\nonly there\n");
      const newer = yield* main.turn(1, "a\nsame line\n");
      yield* main.write("a\nsame line\nonly there\n");

      assert.deepStrictEqual(yield* attribute(main, [elsewhere(older), own(newer)]), [
        "a: before",
        "same line: turn 1",
        "only there: turn 0",
      ]);
    }),
  );

  it.effect(
    "keeps a turn's lines through a merge commit, a cherry-pick and a move, but not a reformat",
    () =>
      Effect.gen(function* () {
        const { root, main, path } = yield* repository;
        const base = "a\nb\nc\nd\n";
        yield* main.commit(base, "start");
        yield* main.git("worktree", "add", path.join(root, "feature"), "-b", "feature");
        const feature = yield* checkout(path.join(root, "feature"));
        const block = "function writtenByTheTurn() {\n  return 'a line long enough to move';\n}\n";
        const featureTurn = yield* feature.turn(0, `${base}${block}const reformatted = 1;\n`);
        yield* feature.commit(`${base}${block}const reformatted = 1;\n`, "feature");
        yield* main.git("merge", "--no-ff", "feature", "-m", "merge feature");
        yield* main.git("checkout", "-b", "release", "HEAD~1");
        yield* main.git("cherry-pick", "feature");
        // A person moves the turn's function to the top and reformats one of its lines.
        const contents = `${block}${base}const reformatted   =   1;\n`;
        yield* main.commit(contents, "person moves and reformats");

        assert.deepStrictEqual(yield* attribute(main, [elsewhere(featureTurn)]), [
          "function writtenByTheTurn() {: turn 0",
          "  return 'a line long enough to move';: turn 0",
          "}: turn 0",
          "a: before",
          "b: before",
          "c: before",
          "d: before",
          "const reformatted   =   1;: outside",
        ]);
      }),
  );
});
