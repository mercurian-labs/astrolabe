import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { CheckpointScopeId } from "@t3tools/contracts";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { checkpointRefForScopeOrdinal } from "../orchestration-v2/CheckpointService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as IntentBlame from "./IntentBlame.ts";
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
    /** A thread's later turn: it starts from the previous turn's end, asked for now. */
    const nextTurn = (key: number, previous: BlameTurn, contents: string) =>
      Effect.gen(function* () {
        const requestedAt = clock;
        yield* write(contents);
        const endRef = yield* snapshot(`refs/test/${key}/end`);
        return { key, startRef: previous.endRef, endRef, requestedAt } satisfies BlameTurn;
      });
    return { cwd, git, write, read, commit, turn, turnDoing, nextTurn };
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

  it.effect("does not credit a thread's next turn with a pull made between the two turns", () =>
    Effect.gen(function* () {
      const { main } = yield* repository;
      yield* main.commit("a\n", "start");
      yield* main.git("branch", "upstream");
      const first = yield* main.turnDoing(0, main.commit("turn 0\na\n", "agent"));
      // Made after the first turn's checkpoint, pulled in before the next turn is asked for.
      yield* main.git("checkout", "upstream");
      yield* main.commit("a\nupstream\n", "upstream");
      yield* main.git("checkout", "main");
      yield* main.git("merge", "--no-edit", "upstream");
      const second = yield* main.nextTurn(1, first, "turn 0\na\nupstream\nturn 1\n");

      assert.deepStrictEqual(yield* attribute(main, [own(first, second)]), [
        "turn 0: turn 0",
        "a: before",
        "upstream: outside",
        "turn 1: turn 1",
      ]);
    }),
  );

  it.effect("cleans line endings as Git does, for the file and the editor's text", () =>
    Effect.gen(function* () {
      const { main, path } = yield* repository;
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.writeFileString(path.join(main.cwd, ".gitattributes"), "* text=auto\n");
      yield* main.git("add", ".gitattributes");
      yield* main.commit("a\r\nb\r\n", "start");
      const first = yield* main.turn(0, "a\r\nturn 0\r\nb\r\n");

      assert.deepStrictEqual(yield* attribute(main, [own(first)]), [
        "a\r: before",
        "turn 0\r: turn 0",
        "b: before",
      ]);
      // The editor joins lines with LF.
      assert.deepStrictEqual(yield* attribute(main, [own(first)], "a\nturn 0\nb\nnew\n"), [
        "a: before",
        "turn 0: turn 0",
        "b: before",
        "new: unsaved",
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

const serviceLayer = IntentBlame.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.mock(KnownWorkspaces.KnownWorkspaces)({ assertContains: () => Effect.void }),
      WorkspacePaths.layer,
      SqlitePersistence.layerMemory,
    ),
  ),
  Layer.provideMerge(layer),
);

const at = (seconds: number) => DateTime.formatIso(DateTime.makeUnsafe(seconds * 1000));

it.layer(serviceLayer)("IntentBlame.blame", (it) => {
  it.effect(
    "answers for a workspace inside a repository, skips deleted threads, and reuses no stale answer",
    () =>
      Effect.gen(function* () {
        const { main, path } = yield* repository;
        const fileSystem = yield* FileSystem.FileSystem;
        const sql = yield* SqlClient.SqlClient;
        const blame = (yield* IntentBlame.IntentBlame).blame;
        const workspace = path.join(main.cwd, "pkg");
        const file = path.join(workspace, "f.ts");
        yield* fileSystem.makeDirectory(workspace);
        const write = (text: string) => fileSystem.writeFileString(file, text);
        /** A recorded turn of `thread` that leaves the file as `contents`. */
        const recordTurn = (thread: string, contents: string, deleted = false) =>
          Effect.gen(function* () {
            const scopeId = `scope:${thread}`;
            const ref = (ordinal: number) =>
              checkpointRefForScopeOrdinal({
                scopeId: CheckpointScopeId.make(scopeId),
                ordinalWithinScope: ordinal,
              });
            const snapshot = (name: string) =>
              Effect.gen(function* () {
                yield* main.git("add", "-A");
                const tree = yield* main.git("write-tree");
                yield* main.git(
                  "update-ref",
                  name,
                  yield* main.git("commit-tree", tree, "-p", "HEAD", "-m", name),
                );
                yield* main.git("reset", "--quiet");
              });
            yield* snapshot(yield* ref(0));
            const asked = clock;
            yield* write(contents);
            const endRef = yield* ref(1);
            yield* snapshot(endRef);
            const run = `run:${thread}`;
            yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, deleted_at, payload_json) VALUES (${thread}, 'project', ${`Thread ${thread}`}, 'codex', 'full-access', 'default', ${at(asked)}, ${at(asked)}, ${deleted ? at(asked) : null}, '{}')`;
            yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, payload_json) VALUES (${run}, ${thread}, 1, 'codex', 'completed', ${at(asked)}, ${`{"userMessageId":"${thread}:ask"}`})`;
            yield* sql`INSERT INTO orchestration_v2_projection_checkpoint_scopes (scope_id, thread_id, node_id, kind, ordinal_within_parent, advances_app_run_count, created_at, payload_json) VALUES (${scopeId}, ${thread}, ${`node:${scopeId}`}, 'root_run', 0, 1, ${at(asked)}, ${`{"cwd":"${main.cwd}"}`})`;
            yield* sql`INSERT INTO orchestration_v2_projection_checkpoints (checkpoint_id, thread_id, scope_id, run_id, node_id, ordinal_within_scope, status, captured_at, payload_json) VALUES (${`checkpoint:${thread}`}, ${thread}, ${scopeId}, ${run}, ${`node:${thread}`}, 1, 'ready', ${at(clock)}, ${`{"ref":"${endRef}","files":[{"path":"pkg/f.ts"}]}`})`;
            const message = (id: string, role: string, seconds: number, text: string) =>
              sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json) VALUES (${id}, ${thread}, ${run}, ${role}, 0, ${at(seconds)}, ${at(seconds)}, ${`{"text":"${text}"}`})`;
            yield* message(`${thread}:ask`, "user", asked, "Add a line");
            yield* message(`${thread}:plan`, "assistant", asked + 1, "Adding the line now.");
            yield* sql`INSERT INTO orchestration_v2_projection_turn_items (turn_item_id, thread_id, run_id, ordinal, type, status, updated_at, payload_json) VALUES (${`item:${thread}`}, ${thread}, ${run}, 1, 'file_change', 'completed', ${at(asked + 2)}, ${`{"startedAt":"${at(asked + 2)}","fileName":"${file}"}`})`;
            yield* message(`${thread}:done`, "assistant", asked + 3, "Done.");
          });

        yield* write("a\n");
        yield* main.git("add", "-A");
        yield* main.git("commit", "-m", "start");
        yield* recordTurn("kept", "a\nkept\n");
        yield* recordTurn("gone", "a\nkept\ngone\n", true);

        const answer = yield* blame({ cwd: workspace, path: "f.ts" });
        assert.deepStrictEqual(
          answer.spans.map((span) => [span.startLine, span.endLine, span.origin, span.turn]),
          [
            [1, 1, "before", undefined],
            [2, 2, "turn", 0],
            [3, 3, "outside", undefined],
          ],
        );
        assert.strictEqual(answer.changedBy, 1);
        assert.deepStrictEqual(
          answer.turns.map((turn) => [
            turn.threadTitle,
            turn.request,
            turn.beforeChange,
            turn.beforeChangeMessageId,
            turn.closing,
            turn.closingMessageId,
          ]),
          [
            [
              "Thread kept",
              "Add a line",
              "Adding the line now.",
              "kept:plan",
              "Done.",
              "kept:done",
            ],
          ],
        );

        // Asked while unsaved, then saved: the saved answer is not the unsaved one.
        const unsaved = yield* blame({
          cwd: workspace,
          path: "f.ts",
          contents: "a\nkept\ngone\nnew\n",
        });
        assert.strictEqual(unsaved.spans.at(-1)?.origin, "unsaved");
        yield* write("a\nkept\ngone\nnew\n");
        assert.deepStrictEqual((yield* blame({ cwd: workspace, path: "f.ts" })).spans.at(-1), {
          startLine: 3,
          endLine: 4,
          origin: "outside",
        });

        const outside = yield* blame({ cwd: workspace, path: "../.git/config" }).pipe(Effect.flip);
        assert.strictEqual(outside.detail, "The path is outside the workspace.");
      }),
  );
});
