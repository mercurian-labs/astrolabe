import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CheckpointRef, type OrchestrationV2Checkpoint } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { fileRevertPreview } from "./EditedFileRevert.ts";

const layerGit = Layer.mergeAll(
  GitVcsDriver.layer,
  ProcessRunner.layer.pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
).pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-edited-file-revert-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const PATH = "src/a.ts";

/**
 * A repository whose `src/a.ts` was committed as "one\n", then changed by the agent to
 * "one\ntwo\n" without a commit and checkpointed, then edited by the user to "one\nTWO\n".
 */
const checkout = Effect.fn("checkout")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const driver = yield* GitVcsDriver.makeVcsDriverShape();
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-edited-file-revert-" });
  const run = (args: ReadonlyArray<string>) =>
    git.execute({ operation: "EditedFileRevert.test", cwd, args });
  const write = (text: string) => fileSystem.writeFileString(path.join(cwd, PATH), text);
  yield* run(["init"]);
  yield* run(["config", "user.name", "Test"]);
  yield* run(["config", "user.email", "test@test.com"]);
  yield* fileSystem.makeDirectory(path.join(cwd, "src"));
  yield* write("one\n");
  yield* run(["add", "."]);
  yield* run(["commit", "-m", "initial"]);
  yield* write("one\ntwo\n");
  const ref = CheckpointRef.make("refs/t3/checkpoints/revert-test");
  yield* driver.checkpoints.captureCheckpoint({ cwd, checkpointRef: ref });
  yield* write("one\nTWO\n");
  const commit = (text: string) =>
    Effect.gen(function* () {
      yield* write(text);
      yield* run(["add", PATH]);
      yield* run(["commit", "-m", "commit"]);
    });
  const checkpoint = { ref, status: "ready" } as OrchestrationV2Checkpoint;
  return { cwd, git, write, commit, checkpoint, remove: fileSystem.remove(path.join(cwd, PATH)) };
});

const documents = (options: { readonly onlyHere?: boolean; readonly live?: string } = {}) => ({
  unsavedTexts: () =>
    Effect.succeed(options.live === undefined ? [] : [{ relativePath: PATH, text: options.live }]),
  editedOnlyHere: () => Effect.succeed(options.onlyHere ?? true),
});

const preview = (
  fixture: Effect.Success<ReturnType<typeof checkout>>,
  options: {
    readonly running?: boolean;
    readonly checkpoint?: OrchestrationV2Checkpoint | undefined;
    readonly documents?: ReturnType<typeof documents>;
  } = {},
) =>
  fileRevertPreview(
    {
      cwd: fixture.cwd,
      path: PATH,
      checkpoint: "checkpoint" in options ? options.checkpoint : fixture.checkpoint,
      running: options.running ?? false,
    },
    fixture.git,
    options.documents ?? documents(),
  );

it.effect("shows the user's changes since the checkpoint, and blocks while a turn runs", () =>
  Effect.gen(function* () {
    const fixture = yield* checkout();
    const ready = yield* preview(fixture);
    assert.strictEqual(ready.blocked, null);
    assert.strictEqual(ready.checkpointText, "one\ntwo\n");
    assert.include(ready.diff ?? "", "--- a/src/a.ts\n+++ b/src/a.ts");
    assert.include(ready.diff ?? "", "-two\n+TWO");
    assert.isFalse(ready.missing);
    assert.isFalse(ready.outsideChanges);

    assert.strictEqual((yield* preview(fixture, { running: true })).blocked, "running");
    assert.isTrue(
      (yield* preview(fixture, { documents: documents({ onlyHere: false }) })).outsideChanges,
    );
    // An open document's text, not yet on disk, is what the revert throws away.
    const live = yield* preview(fixture, { documents: documents({ live: "one\nTWO!\n" }) });
    assert.include(live.diff ?? "", "+TWO!");
    assert.strictEqual(
      (yield* preview(fixture, { checkpoint: undefined })).blocked,
      "no-checkpoint",
    );
    yield* fixture.write("one\ntwo\n");
    assert.strictEqual((yield* preview(fixture)).blocked, "unchanged");
  }).pipe(Effect.scoped, Effect.provide(layerGit)),
);

it.effect("blocks once a commit since the checkpoint changed the file from it", () =>
  Effect.gen(function* () {
    const fixture = yield* checkout();
    // Committing the agent's version alone undoes no commit when reverted to it.
    yield* fixture.commit("one\ntwo\n");
    yield* fixture.write("one\nTWO\n");
    assert.strictEqual((yield* preview(fixture)).blocked, null);

    yield* fixture.commit("one\nTWO\n");
    const committed = yield* preview(fixture);
    assert.strictEqual(committed.blocked, "committed");
    assert.include(committed.diff ?? "", "-two\n+TWO");
  }).pipe(Effect.scoped, Effect.provide(layerGit)),
);

it.effect("recreates a file deleted since the checkpoint", () =>
  Effect.gen(function* () {
    const fixture = yield* checkout();
    yield* fixture.remove;
    const deleted = yield* preview(fixture);
    assert.strictEqual(deleted.blocked, null);
    assert.isTrue(deleted.missing);
    assert.strictEqual(deleted.checkpointText, "one\ntwo\n");
    assert.include(deleted.diff ?? "", "+++ /dev/null");
  }).pipe(Effect.scoped, Effect.provide(layerGit)),
);
