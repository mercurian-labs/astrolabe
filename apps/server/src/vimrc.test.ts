import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { MAX_VIMRC_LENGTH } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import * as Vimrc from "./vimrc.ts";

/** Runs `body` against a Vimrc service whose file holds `seed` (none when null) as it starts. */
const withVimrc = <A, E>(
  seed: string | null,
  body: Effect.Effect<
    A,
    E,
    Vimrc.Vimrc | ServerConfig.ServerConfig | FileSystem.FileSystem | Path.Path | Scope.Scope
  >,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-vimrc-test-" });
    if (seed !== null) {
      yield* fs.makeDirectory(path.join(baseDir, "userdata"), { recursive: true });
      yield* fs.writeFileString(path.join(baseDir, "userdata", "vimrc"), seed);
    }
    return yield* body.pipe(
      Effect.provide(
        Vimrc.layer.pipe(Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir))),
      ),
    );
  }).pipe(Effect.scoped);

const readFile = Effect.gen(function* () {
  const { vimrcConfigPath } = yield* ServerConfig.ServerConfig;
  return yield* (yield* FileSystem.FileSystem).readFileString(vimrcConfigPath);
});

const HAND_WRITTEN = [
  '" my vimrc',
  "set nopcre",
  "let mapleader = ','",
  "inoremap jk <Esc>",
  "nnoremap H ^",
  "",
].join("\n");

it.layer(NodeServices.layer)("vimrc", (it) => {
  it.effect("creates the file beside keybindings.json when it is missing", () =>
    withVimrc(
      null,
      Effect.gen(function* () {
        const { vimrcConfigPath, keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
        const path = yield* Path.Path;
        assert.equal(path.dirname(vimrcConfigPath), path.dirname(keybindingsConfigPath));
        const text = yield* readFile;
        assert.match(text, /^" /);
        assert.deepEqual(yield* (yield* Vimrc.Vimrc).getSnapshot, { text, issues: [] });
      }),
    ),
  );

  it.effect("serves the file and reports each line it cannot apply", () =>
    withVimrc(
      HAND_WRITTEN,
      Effect.gen(function* () {
        assert.deepEqual(yield* (yield* Vimrc.Vimrc).getSnapshot, {
          text: HAND_WRITTEN,
          issues: [{ kind: "vimrc.invalid-line", line: 3, message: "Not supported here: let" }],
        });
      }),
    ),
  );

  it.effect("applies none of a file past the length limit, and says so", () =>
    withVimrc(
      `" ${"x".repeat(MAX_VIMRC_LENGTH)}\n`,
      Effect.gen(function* () {
        const state = yield* (yield* Vimrc.Vimrc).getSnapshot;
        assert.equal(state.text, "");
        assert.equal(state.issues[0]?.kind, "vimrc.malformed-config");
      }),
    ),
  );

  it.effect("writes mappings and options line by line, keeping every line it does not change", () =>
    withVimrc(
      HAND_WRITTEN,
      Effect.gen(function* () {
        const vimrc = yield* Vimrc.Vimrc;
        yield* vimrc.upsertMapping({
          mode: "normal",
          keys: "<C-d>",
          does: "<C-d>zz",
          recursive: false,
        });
        yield* vimrc.upsertMapping({
          mode: "normal",
          keys: "L",
          does: "$",
          recursive: true,
          replace: { mode: "normal", keys: "H" },
        });
        yield* vimrc.removeMapping({ mode: "insert", keys: "jk" });
        const state = yield* vimrc.setOption({ name: "insertModeEscKeysTimeout", value: 500 });
        const expected = [
          '" my vimrc',
          "set nopcre",
          "let mapleader = ','",
          "nmap L $",
          "nnoremap <C-d> <C-d>zz",
          "set insertModeEscKeysTimeout=500",
          "",
        ].join("\n");
        assert.equal(yield* readFile, expected);
        assert.deepEqual(state, {
          text: expected,
          issues: [{ kind: "vimrc.invalid-line", line: 3, message: "Not supported here: let" }],
        });
        assert.equal(
          (yield* vimrc.setOption({ name: "pcre", value: null })).text.includes("pcre"),
          false,
        );
      }),
    ),
  );

  it.effect("serializes concurrent writes so none is lost", () =>
    withVimrc(
      "",
      Effect.gen(function* () {
        const vimrc = yield* Vimrc.Vimrc;
        yield* Effect.all(
          ["a", "b", "c", "d"].map((keys) =>
            vimrc.upsertMapping({ mode: "normal", keys, does: "x", recursive: false }),
          ),
          { concurrency: "unbounded" },
        );
        const lines = (yield* readFile).trim().split("\n");
        assert.deepEqual(lines.toSorted(), [
          "nnoremap a x",
          "nnoremap b x",
          "nnoremap c x",
          "nnoremap d x",
        ]);
      }),
    ),
  );
});

// A hand edit to the file reaches clients without a restart. Live clock and a real filesystem
// event, so this proves the watcher rather than a direct read.
describe("vimrc watching", () => {
  it.live("streams each hand edit, and a write made here once", () =>
    withVimrc(
      HAND_WRITTEN,
      Effect.gen(function* () {
        const vimrc = yield* Vimrc.Vimrc;
        const fs = yield* FileSystem.FileSystem;
        const { vimrcConfigPath } = yield* ServerConfig.ServerConfig;
        const seen = yield* Queue.unbounded<string>();
        yield* Effect.forkScoped(
          Stream.runForEach(vimrc.streamChanges, (state) => Queue.offer(seen, state.text)),
          { startImmediately: true },
        );

        yield* fs.writeFileString(vimrcConfigPath, "set pcre!\n");
        assert.equal(yield* Queue.take(seen), "set pcre!\n");

        const written = yield* vimrc.upsertMapping({
          mode: "insert",
          keys: "jk",
          does: "<Esc>",
          recursive: false,
        });
        assert.equal(yield* Queue.take(seen), written.text);

        // The write's own watch event repeats what was already sent, so the next one is the
        // next hand edit.
        yield* fs.writeFileString(vimrcConfigPath, "nnoremap Q gq\n");
        assert.equal(yield* Queue.take(seen), "nnoremap Q gq\n");
      }).pipe(Effect.timeout("30 seconds")),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
