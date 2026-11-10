/**
 * A thread's checkouts of the wikis linked to its project, which its provider session reaches as
 * extra folders. Each turn's edits there land as one amendment on the thread's change request.
 *
 * @module ThreadWikiCheckouts
 */
import { type ProjectId, type ThreadId, WikiId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as WikiService from "./WikiService.ts";

export class ThreadWikiCheckouts extends Context.Service<
  ThreadWikiCheckouts,
  {
    /** The folders holding the thread's checkout of each linked wiki, made where missing. */
    readonly ensure: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
    }) => Effect.Effect<ReadonlyArray<string>>;
    /**
     * Saves each checkout's edits as one amendment by `author`, then drops checkouts of wikis
     * no longer linked. Failures are logged, never raised.
     */
    readonly saveTurn: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly title: string;
      readonly author: WikiService.WikiAuthor;
    }) => Effect.Effect<void>;
    /** Removes every checkout the thread has. */
    readonly removeThread: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/wiki/ThreadWikiCheckouts") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const wikis = yield* WikiService.WikiService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = path.join(config.stateDir, "wiki-checkouts");
  const threadFolder = (threadId: ThreadId) => path.join(base, threadId);

  /** The wikis the thread has a checkout folder of. */
  const checkedOut = (threadId: ThreadId) =>
    fileSystem.readDirectory(threadFolder(threadId)).pipe(
      Effect.map((names) =>
        names.filter((name) => !name.startsWith(".")).map((name) => WikiId.make(name)),
      ),
      Effect.orElseSucceed((): ReadonlyArray<WikiId> => []),
    );

  const ensure: ThreadWikiCheckouts["Service"]["ensure"] = Effect.fn("ThreadWikiCheckouts.ensure")(
    function* (input) {
      const linked = yield* wikis.linkedTo(input.projectId).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not read the wikis linked to a thread's project.", {
            cause,
          }).pipe(Effect.as<ReadonlyArray<WikiId>>([])),
        ),
      );
      const folders = yield* Effect.forEach(linked, (wikiId) =>
        wikis
          .checkoutForThread({
            wikiId,
            threadId: input.threadId,
            folder: path.join(threadFolder(input.threadId), wikiId),
          })
          .pipe(
            Effect.map((folder) => [folder]),
            Effect.catch((cause) =>
              Effect.logWarning("Could not check a wiki out for a thread.", {
                wikiId,
                threadId: input.threadId,
                cause,
              }).pipe(Effect.as([])),
            ),
          ),
      );
      return folders.flat();
    },
  );

  const remove = (threadId: ThreadId, wikiId: WikiId) => {
    const folder = path.join(threadFolder(threadId), wikiId);
    return wikis.removeCheckout({ wikiId, folder }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not remove a thread's wiki checkout.", { wikiId, cause }),
      ),
      // A wiki forgotten meanwhile leaves only the folder; git prunes its record later.
      Effect.andThen(fileSystem.remove(folder, { recursive: true, force: true })),
      Effect.ignore,
    );
  };

  const saveTurn: ThreadWikiCheckouts["Service"]["saveTurn"] = Effect.fn(
    "ThreadWikiCheckouts.saveTurn",
  )(function* (input) {
    const folders = yield* checkedOut(input.threadId);
    if (folders.length === 0) return;
    const linked = yield* wikis.linkedTo(input.projectId).pipe(Effect.option);
    for (const wikiId of folders) {
      const saved = yield* wikis
        .saveThreadCheckout(
          {
            wikiId,
            threadId: input.threadId,
            folder: path.join(threadFolder(input.threadId), wikiId),
            title: input.title,
            message: input.title,
          },
          input.author,
        )
        .pipe(
          Effect.as(true),
          Effect.catch((cause) =>
            Effect.logWarning("Could not save a turn's wiki edits.", {
              wikiId,
              threadId: input.threadId,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );
      if (saved && linked._tag === "Some" && !linked.value.includes(wikiId)) {
        yield* remove(input.threadId, wikiId);
      }
    }
  });

  const removeThread: ThreadWikiCheckouts["Service"]["removeThread"] = Effect.fn(
    "ThreadWikiCheckouts.removeThread",
  )(function* (threadId) {
    for (const wikiId of yield* checkedOut(threadId)) yield* remove(threadId, wikiId);
    yield* fileSystem
      .remove(threadFolder(threadId), { recursive: true, force: true })
      .pipe(Effect.ignore);
  });

  return ThreadWikiCheckouts.of({ ensure, saveTurn, removeThread });
});

export const layer = Layer.effect(ThreadWikiCheckouts, make);
