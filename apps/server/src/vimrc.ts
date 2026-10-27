/**
 * The vimrc beside keybindings.json, applied by every Vim editor of this server's clients. Plain
 * text so users can hand-edit it (the watcher streams saves); Settings edits it a line at a time,
 * keeping comments and every unchanged line, including unappliable ones reported as issues.
 *
 * @module Vimrc
 */
import {
  MAX_VIMRC_LENGTH,
  type ServerRemoveVimMappingInput,
  type ServerSetVimOptionInput,
  type ServerUpsertVimMappingInput,
  type ServerVimrc,
  VimrcConfigError,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import {
  checkVimrc,
  removeVimrcMapping,
  setVimrcOption,
  upsertVimrcMapping,
} from "@t3tools/shared/vimrc";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";

/** What a new vimrc file says, for a user who opens it from Settings. */
const NEW_VIMRC = `" Vim in Astrolabe's editors: map, noremap, and unmap with their mode prefixes, set, and comments.
`;

/** The served vimrc for a file's text: the text, and the lines it cannot apply. */
function vimrcState(text: string): ServerVimrc {
  if (text.length > MAX_VIMRC_LENGTH) {
    return {
      text: "",
      issues: [
        {
          kind: "vimrc.malformed-config",
          message: `The vimrc is longer than ${MAX_VIMRC_LENGTH} characters, so none of it applies.`,
        },
      ],
    };
  }
  return {
    text,
    issues: checkVimrc(text).map((error) => ({
      kind: "vimrc.invalid-line",
      line: error.line,
      message: error.message,
    })),
  };
}

export class Vimrc extends Context.Service<
  Vimrc,
  {
    /** The vimrc as the file has it now. An unreadable file serves as empty, with an issue. */
    readonly getSnapshot: Effect.Effect<ServerVimrc>;
    /** Each change to the vimrc, from a write here or a hand edit to the file. */
    readonly streamChanges: Stream.Stream<ServerVimrc>;
    readonly upsertMapping: (
      input: ServerUpsertVimMappingInput,
    ) => Effect.Effect<ServerVimrc, VimrcConfigError>;
    readonly removeMapping: (
      input: ServerRemoveVimMappingInput,
    ) => Effect.Effect<ServerVimrc, VimrcConfigError>;
    readonly setOption: (
      input: ServerSetVimOptionInput,
    ) => Effect.Effect<ServerVimrc, VimrcConfigError>;
  }
>()("t3/vimrc") {}

const make = Effect.gen(function* () {
  const { vimrcConfigPath } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const writeLock = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<ServerVimrc>();
  // The text last published, so a watch event for a write made here is not sent twice.
  const published = yield* Ref.make<string | null>(null);
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const readText = fs.exists(vimrcConfigPath).pipe(
    Effect.flatMap((exists) => (exists ? fs.readFileString(vimrcConfigPath) : Effect.succeed(""))),
    Effect.mapError(
      (cause) => new VimrcConfigError({ configPath: vimrcConfigPath, operation: "read", cause }),
    ),
  );

  const writeText = (contents: string) =>
    writeFileStringAtomically({ filePath: vimrcConfigPath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) => new VimrcConfigError({ configPath: vimrcConfigPath, operation: "write", cause }),
      ),
    );

  const getSnapshot = readText.pipe(
    Effect.map(vimrcState),
    Effect.catchTags({
      VimrcConfigError: (error) =>
        Effect.logWarning("failed to read the vimrc", {
          path: vimrcConfigPath,
          cause: error.cause,
        }).pipe(
          Effect.as<ServerVimrc>({
            text: "",
            issues: [{ kind: "vimrc.malformed-config", message: error.message }],
          }),
        ),
    }),
  );

  const publish = Effect.fn("Vimrc.publish")(function* (state: ServerVimrc) {
    const previous = yield* Ref.getAndSet(published, state.text);
    if (previous !== state.text) yield* PubSub.publish(changes, state);
  });

  /** Rewrites the file with `edit` applied to its text, keeping every line `edit` leaves. */
  const edit = (change: (text: string) => string) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const text = change(yield* readText);
        yield* writeText(text);
        const state = vimrcState(text);
        yield* publish(state);
        return state;
      }),
    );

  const startWatcher = Effect.gen(function* () {
    const directory = path.dirname(vimrcConfigPath);
    const file = path.basename(vimrcConfigPath);
    const resolved = path.resolve(vimrcConfigPath);
    // Running the stream is what attaches the watcher, so wait for it: a save made right after
    // the server starts is otherwise missed. A watch that fails to start lets go of the wait too.
    const ready = yield* Deferred.make<void>();
    // Debounced: editors emit several events per save, and `fs.watch` can fire before the
    // content is flushed.
    const events = fs
      .watch(directory, { onReady: () => Deferred.doneUnsafe(ready, Effect.void) })
      .pipe(
        Stream.filter(
          (event) =>
            event.path === file ||
            event.path === vimrcConfigPath ||
            path.resolve(directory, event.path) === resolved,
        ),
        Stream.debounce(Duration.millis(100)),
      );
    yield* Stream.runForEach(events, () =>
      writeLock.withPermits(1)(Effect.flatMap(getSnapshot, publish)),
    ).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.ensuring(Deferred.done(ready, Exit.void)),
      Effect.forkIn(watcherScope),
    );
    yield* Deferred.await(ready);
  });

  // A missing file is created, so Settings can open it; the vimrc is cosmetic to the server, so
  // a failure here leaves it unwatched rather than failing the server.
  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(path.dirname(vimrcConfigPath), { recursive: true });
    if (!(yield* fs.exists(vimrcConfigPath))) yield* writeText(NEW_VIMRC);
    yield* Ref.set(published, (yield* getSnapshot).text);
    yield* startWatcher;
  }).pipe(Effect.ignoreCause({ log: true }));

  return {
    getSnapshot,
    get streamChanges() {
      return Stream.fromPubSub(changes);
    },
    upsertMapping: ({ replace, ...mapping }) =>
      edit((text) => upsertVimrcMapping(text, mapping, replace)),
    removeMapping: (target) => edit((text) => removeVimrcMapping(text, target)),
    setOption: (input) => edit((text) => setVimrcOption(text, input)),
  } satisfies Vimrc["Service"];
});

export const layer = Layer.effect(Vimrc, make);
