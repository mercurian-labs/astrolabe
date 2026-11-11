/**
 * A thread's checkouts of its project's linked wikis, reached as extra folders; each turn's edits
 * land as one amendment on its change request. A child working in one (`delegate_task` `wiki`)
 * saves onto that thread's change request and gets no checkouts of its own.
 * @module ThreadWikiCheckouts
 */
import { BASE_SYNTAX_REMINDER, documentBaseCheck, isBaseFile } from "@mercurian/wiki";
import {
  type ProjectId,
  ThreadId,
  type WikiAmendResult,
  WikiError,
  WikiId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as WikiService from "./WikiService.ts";
import { THREAD_CHECKOUTS_FOLDER } from "./wikiStorage.ts";

/** The thread and wiki whose checkout `folder` is, by where it sits under the state dir. */
export const checkoutOwner = (
  path: Path.Path,
  stateDir: string,
  folder: string | null,
): { readonly threadId: ThreadId; readonly wikiId: WikiId } | undefined => {
  if (folder === null) return undefined;
  const relative = path.relative(path.join(stateDir, THREAD_CHECKOUTS_FOLDER), folder);
  const [threadId, wikiId, ...rest] = relative.split(path.sep);
  if (!threadId || !wikiId || threadId === ".." || path.isAbsolute(relative) || rest.length > 0)
    return undefined;
  return { threadId: ThreadId.make(threadId), wikiId: WikiId.make(wikiId) };
};

/** A base a turn saved that doesn't work as written. */
export interface BrokenBase {
  readonly wiki: string;
  /** Its path in the wiki. */
  readonly file: string;
  /** Where it sits in the checkout. */
  readonly path: string;
  readonly problems: ReadonlyArray<string>;
}

/** What the app tells the agent whose turn left bases broken. */
export function brokenBasesMessage(bases: ReadonlyArray<BrokenBase>): string {
  const one = bases.length === 1;
  return [
    `Astrolabe checked the bases your last turn changed, and ${one ? "one doesn't" : `${bases.length} don't`} work as written.`,
    ...bases.map(({ wiki, file, path, problems }) =>
      [`${file} in the ${wiki} wiki (${path}):`, ...problems.map((problem) => `- ${problem}`)].join(
        "\n",
      ),
    ),
    `How a base is written:\n${BASE_SYNTAX_REMINDER}`,
    `Fix ${one ? "it" : "them"}, then run ${one ? "it" : "each"} with astrolabe_wiki_query to check what it lists.`,
  ].join("\n\n");
}

export class ThreadWikiCheckouts extends Context.Service<
  ThreadWikiCheckouts,
  {
    /**
     * The thread's checkout of each linked wiki, made where missing; for a thread working in
     * a checkout, none, and the wiki it works in.
     */
    readonly ensure: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
    }) => Effect.Effect<{
      readonly checkouts: ReadonlyArray<WikiService.WikiCheckout>;
      readonly workingIn: WikiId | undefined;
    }>;
    /**
     * The folder holding the thread's checkout of the linked wiki `wiki` names, made where
     * missing, for a child thread to work in. A thread working in a checkout of it passes on
     * that one.
     */
    readonly checkoutFor: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
      readonly wiki: string;
    }) => Effect.Effect<string, WikiError>;
    /**
     * Saves each checkout's edits as one amendment by `author`, then drops checkouts of wikis
     * no longer linked; a thread working in a checkout saves that one onto its owner's change
     * request. Returns the bases saved that don't work as written. Failures are logged, never
     * raised.
     */
    readonly saveTurn: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
      readonly title: string;
      readonly author: WikiService.WikiAuthor;
    }) => Effect.Effect<ReadonlyArray<BrokenBase>>;
    /** Removes every checkout the thread has. */
    readonly removeThread: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/wiki/ThreadWikiCheckouts") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const wikis = yield* WikiService.WikiService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = path.join(config.stateDir, THREAD_CHECKOUTS_FOLDER);
  const threadFolder = (threadId: ThreadId) => path.join(base, threadId);

  /** The wikis the thread has a checkout folder of. */
  const checkedOut = (threadId: ThreadId) =>
    fileSystem.readDirectory(threadFolder(threadId)).pipe(
      Effect.map((names) =>
        names.filter((name) => !name.startsWith(".")).map((name) => WikiId.make(name)),
      ),
      Effect.orElseSucceed((): ReadonlyArray<WikiId> => []),
    );

  /** The thread whose checkout of a wiki another thread works in. */
  const workingIn = (threadId: ThreadId, worktreePath: string | null) => {
    const owner = checkoutOwner(path, config.stateDir, worktreePath);
    return owner?.threadId === threadId ? undefined : owner;
  };

  const ensure: ThreadWikiCheckouts["Service"]["ensure"] = Effect.fn("ThreadWikiCheckouts.ensure")(
    function* (input) {
      const owner = workingIn(input.threadId, input.worktreePath);
      if (owner !== undefined) return { checkouts: [], workingIn: owner.wikiId };
      const linked = yield* wikis.linkedTo(input.projectId).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not read the wikis linked to a thread's project.", {
            cause,
          }).pipe(Effect.as<ReadonlyArray<WikiId>>([])),
        ),
      );
      const checkouts = yield* Effect.forEach(linked, (wikiId) =>
        wikis
          .checkoutForThread({
            wikiId,
            threadId: input.threadId,
            folder: path.join(threadFolder(input.threadId), wikiId),
          })
          .pipe(
            Effect.map((folder) => [{ wikiId, folder }]),
            Effect.catch((cause) =>
              Effect.logWarning("Could not check a wiki out for a thread.", {
                wikiId,
                threadId: input.threadId,
                cause,
              }).pipe(Effect.as([])),
            ),
          ),
      );
      return { checkouts: checkouts.flat(), workingIn: undefined };
    },
  );

  const checkoutFor: ThreadWikiCheckouts["Service"]["checkoutFor"] = Effect.fn(
    "ThreadWikiCheckouts.checkoutFor",
  )(function* (input) {
    const wikiId = yield* wikis.linkedWiki(input.projectId, input.wiki);
    const owner = workingIn(input.threadId, input.worktreePath);
    const threadId = owner?.wikiId === wikiId ? owner.threadId : input.threadId;
    const folder = path.join(threadFolder(threadId), wikiId);
    const held = yield* wikis.checkoutForThread({ wikiId, threadId, folder });
    if (held !== folder) {
      return yield* new WikiError({
        reason: "invalid",
        wikiId,
        message: `Your changes to this wiki are checked out at ${held}, so a child cannot share your checkout of it.`,
      });
    }
    return folder;
  });

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

  /** The bases an amendment changed that don't work as written, read from the saved checkout. */
  const brokenBases = Effect.fn("ThreadWikiCheckouts.brokenBases")(function* (
    wikiId: WikiId,
    folder: string,
    saved: WikiAmendResult | null,
  ) {
    const files = (
      saved?.changeRequest.amendments.find(({ amendment }) => amendment === saved.amendment)
        ?.files ?? []
    ).filter((file) => isBaseFile(file) || file.endsWith(".md"));
    const broken = yield* Effect.forEach(files, (file) => {
      const at = path.join(folder, file);
      return fileSystem.readFileString(at).pipe(
        Effect.map((source) => {
          const { errors, warnings } = documentBaseCheck(file, source);
          const problems = [...errors, ...warnings];
          return problems.length ? [{ file, path: at, problems }] : [];
        }),
        // A file the turn deleted holds no base.
        Effect.orElseSucceed(() => []),
      );
    });
    if (broken.flat().length === 0) return [];
    const wiki = yield* wikis.get(wikiId).pipe(
      Effect.map(({ name }) => name),
      Effect.orElseSucceed(() => wikiId),
    );
    return broken.flat().map((base): BrokenBase => ({ wiki, ...base }));
  });

  const saveTurn: ThreadWikiCheckouts["Service"]["saveTurn"] = Effect.fn(
    "ThreadWikiCheckouts.saveTurn",
  )(function* (input) {
    const owner = workingIn(input.threadId, input.worktreePath);
    if (owner !== undefined) {
      const folder = path.join(threadFolder(owner.threadId), owner.wikiId);
      const saved = yield* wikis
        .saveThreadCheckout(
          {
            wikiId: owner.wikiId,
            threadId: owner.threadId,
            folder,
            title: input.title,
            message: input.title,
          },
          { ...input.author, threadId: owner.threadId },
        )
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not save a child's wiki edits.", {
              ...owner,
              childThreadId: input.threadId,
              cause,
            }).pipe(Effect.as(null)),
          ),
        );
      return yield* brokenBases(owner.wikiId, folder, saved);
    }
    const folders = yield* checkedOut(input.threadId);
    if (folders.length === 0) return [];
    const linked = yield* wikis.linkedTo(input.projectId).pipe(Effect.option);
    const broken: BrokenBase[] = [];
    for (const wikiId of folders) {
      const folder = path.join(threadFolder(input.threadId), wikiId);
      const saved = yield* wikis
        .saveThreadCheckout(
          {
            wikiId,
            threadId: input.threadId,
            folder,
            title: input.title,
            message: input.title,
          },
          input.author,
        )
        .pipe(
          Effect.map((result) => ({ result })),
          Effect.catch((cause) =>
            Effect.logWarning("Could not save a turn's wiki edits.", {
              wikiId,
              threadId: input.threadId,
              cause,
            }).pipe(Effect.as(undefined)),
          ),
        );
      if (saved === undefined) continue;
      broken.push(...(yield* brokenBases(wikiId, folder, saved.result)));
      if (linked._tag === "Some" && !linked.value.includes(wikiId)) {
        yield* remove(input.threadId, wikiId);
      }
    }
    return broken;
  });

  const removeThread: ThreadWikiCheckouts["Service"]["removeThread"] = Effect.fn(
    "ThreadWikiCheckouts.removeThread",
  )(function* (threadId) {
    for (const wikiId of yield* checkedOut(threadId)) yield* remove(threadId, wikiId);
    yield* fileSystem
      .remove(threadFolder(threadId), { recursive: true, force: true })
      .pipe(Effect.ignore);
  });

  return ThreadWikiCheckouts.of({ ensure, checkoutFor, saveTurn, removeThread });
});

export const layer = Layer.effect(ThreadWikiCheckouts, make);
