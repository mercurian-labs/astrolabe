/**
 * Local wikis: git repositories of linked markdown notes whose registered folder is main's
 * hand-editable checkout. Changes reach main only via change requests built on a private index;
 * merges use git's two-tree checkout, which refuses to overwrite local edits. One writer per wiki.
 *
 * @module WikiService
 */
import {
  AmendmentError,
  amendmentMessage,
  BaseError,
  indexFiles,
  isWikiDocument,
  keepWarningHistory,
  planAmendment,
  planCanvasEdits,
  planTransform,
  WikiCollisionError,
  WikiFormatError,
  type AmendmentStamp,
  type PlannedAmendment,
  type WikiChanges,
  type WikiFiles,
  type WikiIndex,
  canvasMerge,
  canvasMergeMessages,
  mergeMarkdown,
  parseBase,
  queryBase,
  baseCorpus,
  applyBaseEdits,
  applyChanges,
  corpusWithChanges,
  isCanvasFile,
  isHidden,
  key,
  type BaseCorpus,
} from "@mercurian/wiki";
import {
  type ProjectId,
  type ThreadId,
  type WikiAmendInput,
  type WikiAmendResult,
  type WikiCanvasMergeNotes,
  type WikiChangeRequest,
  type WikiChangeRequestDetail,
  WikiChangeRequestId,
  type WikiChangeRequestListInput,
  type WikiChangeRequestListResult,
  type WikiChangeRequestOpenInput,
  type WikiChangeRequestTarget,
  type WikiCodeStatus,
  type WikiCodeStatusInput,
  type WikiCodeStatusResult,
  type WikiCreateInput,
  WikiError,
  type WikiEvent,
  WikiId,
  type WikiIndexResult,
  type WikiListResult,
  type WikiMergePreview,
  type WikiMergeResult,
  type WikiNoteResult,
  type WikiQueryInput,
  type WikiQueryResult,
  type WikiReadFilesInput,
  type WikiReadFilesResult,
  type WikiRegisterInput,
  type WikiRevertInput,
  type WikiSaveWorktreeInput,
  type WikiSetChangeRequestStatusInput,
  type WikiSetMapBackgroundsInput,
  type WikiSetMirrorInput,
  type WikiSetProjectLinkInput,
  type WikiSummary,
  type WikiTarget,
  type WikiTransformInput,
  wikiAgentGuidance,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { hostPreviewMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import { newProjectFolderName } from "@t3tools/shared/path";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { parseWorktreeList } from "../worktrees/worktreeList.ts";
import {
  AMENDMENT_LOG_FORMAT,
  CHANGE_REQUEST_BRANCH_PREFIX,
  CHANGE_REQUEST_FILE,
  CHANGE_REQUEST_METADATA_PREFIX,
  type ChangeRequestRecord,
  ChangeRequestRecordJson,
  changeRequestBranch,
  changeRequestMetadataRef,
  gitSupportsWikis,
  parseAmendmentLog,
  parseBatchOutput,
  parseBusyPaths,
  parseDocumentListing,
  EDIT_TIMES_DEPTH,
  EDIT_TIMES_FORMAT,
  parseFileListing,
  parseFileTimes,
  type WikiFileTimes,
  parseMergeTree,
  type WikiRecord,
  type WikiRegistry,
  WikiRegistryJson,
} from "./wikiStorage.ts";
import {
  indexResult,
  linksResult,
  locateBase,
  noteResult,
  orientResult,
  searchNotes,
  type WikiLinksResult,
  type WikiOrientResult,
  type WikiSearchResult,
} from "./wikiViews.ts";

/** A git command that exited non-zero; only ever the `cause` of a `WikiError`. */
class WikiGitExitError extends Schema.TaggedError<WikiGitExitError>()("WikiGitExitError", {
  operation: Schema.String,
  exitCode: Schema.Number,
  stderr: Schema.String,
}) {
  override get message(): string {
    return `git exited with ${this.exitCode} in ${this.operation}.`;
  }
}

/** Who makes a change: the person ("You") or an agent, with the thread it runs in. */
export interface WikiAuthor {
  readonly actor: string;
  readonly threadId: ThreadId | null;
}

/** The person at the keyboard, for changes made from the app. */
export const person: WikiAuthor = { actor: "You", threadId: null };

/** What a thread's agent is told about the wikis its repository is linked to. */
const linkedWikiNote = (names: ReadonlyArray<string>): string | null =>
  names.length === 0
    ? null
    : `<astrolabe_wikis>
${wikiAgentGuidance(names)}
</astrolabe_wikis>`;

/**
 * Where a read comes from: a named change request's head, else the thread's own open change
 * request on that wiki, else the main line. `wikiId` may also be the wiki's name, for agents.
 */
export interface WikiReadTarget {
  readonly wikiId: WikiId;
  readonly changeRequestId?: WikiChangeRequestId | undefined;
  readonly threadId?: ThreadId | undefined;
}

export class WikiService extends Context.Service<
  WikiService,
  {
    readonly list: Effect.Effect<WikiListResult, WikiError>;
    /** Every change to any wiki, so open views know to read again. */
    readonly subscribe: Stream.Stream<WikiEvent>;
    readonly register: (input: WikiRegisterInput) => Effect.Effect<WikiSummary, WikiError>;
    readonly create: (input: WikiCreateInput) => Effect.Effect<WikiSummary, WikiError>;
    /** Forgets the wiki; its folder and history stay as they are. */
    readonly remove: (input: WikiTarget) => Effect.Effect<void, WikiError>;
    readonly setMirror: (input: WikiSetMirrorInput) => Effect.Effect<WikiSummary, WikiError>;
    readonly setMapBackgrounds: (
      input: WikiSetMapBackgroundsInput,
    ) => Effect.Effect<WikiSummary, WikiError>;
    readonly setProjectLink: (
      input: WikiSetProjectLinkInput,
    ) => Effect.Effect<WikiSummary, WikiError>;
    /**
     * The note for a thread in this repository, or null when there is nothing to tell: every
     * linked wiki, or with `linkedSince` only those linked after it.
     */
    readonly agentNote: (
      projectId: ProjectId,
      linkedSince?: DateTime.Utc,
    ) => Effect.Effect<string | null, WikiError>;
    /** The folder holding a wiki's main line, the repository its worktrees belong to. */
    readonly root: (wikiId: WikiId) => Effect.Effect<string, WikiError>;
    /** Pushes main to the mirror now; a failed push is recorded on the summary, not raised. */
    readonly pushMirror: (input: WikiTarget) => Effect.Effect<WikiSummary, WikiError>;
    readonly index: (input: WikiReadTarget) => Effect.Effect<WikiIndexResult, WikiError>;
    readonly readNote: (
      input: WikiReadTarget & { readonly name: string },
    ) => Effect.Effect<WikiNoteResult, WikiError>;
    readonly search: (
      input: WikiReadTarget & { readonly query: string },
    ) => Effect.Effect<WikiSearchResult & { readonly commit: string }, WikiError>;
    readonly orient: (
      input: WikiReadTarget & { readonly map: string },
    ) => Effect.Effect<WikiOrientResult & { readonly commit: string }, WikiError>;
    readonly links: (
      input: WikiReadTarget & { readonly name: string },
    ) => Effect.Effect<WikiLinksResult & { readonly commit: string }, WikiError>;
    /** Runs one view of a base over the notes read, with at most `QUERY_ROWS` rows. */
    readonly query: (
      input: WikiReadTarget & Omit<WikiQueryInput, "wikiId" | "changeRequestId">,
    ) => Effect.Effect<WikiQueryResult, WikiError>;
    /** Files by path, any depth, read at a commit. Too many at once is a caller's mistake. */
    readonly readFiles: (
      input: WikiReadTarget & Omit<WikiReadFilesInput, "wikiId" | "changeRequestId">,
    ) => Effect.Effect<WikiReadFilesResult, WikiError>;
    /** Where to read a file's bytes, once it is known to exist at that commit. */
    readonly locateFile: (input: {
      readonly wikiId: string;
      readonly changeRequestId?: string;
      readonly commit?: string;
      readonly path: string;
    }) => Effect.Effect<
      { readonly root: string; readonly commit: string; readonly path: string },
      WikiError
    >;
    /** How code cards' pinned files compare with their project's head. */
    readonly codeStatus: (
      input: WikiCodeStatusInput,
    ) => Effect.Effect<WikiCodeStatusResult, WikiError>;
    readonly changeRequestsList: (
      input: WikiChangeRequestListInput,
    ) => Effect.Effect<WikiChangeRequestListResult, WikiError>;
    /** A change request in review form: what it changes, whether it merges, what it breaks. */
    readonly changeRequestsGet: (
      input: WikiReadTarget,
    ) => Effect.Effect<WikiChangeRequestDetail, WikiError>;
    readonly changeRequestsOpen: (
      input: WikiChangeRequestOpenInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /**
     * Lands one amendment on a change request: the named one, else the author's thread's open one,
     * else a new one titled `title` or the message's first line.
     */
    readonly amend: (
      input: WikiAmendInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult, WikiError>;
    readonly transform: (
      input: WikiTransformInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult, WikiError>;
    /** Undoes one amendment with a new one, keeping later independent work. */
    readonly revertAmendment: (
      input: WikiRevertInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult, WikiError>;
    /**
     * Lands the uncommitted document edits in the worktree that has a change request checked out
     * as one amendment on it, leaving that worktree clean.
     */
    readonly saveWorktree: (
      input: WikiSaveWorktreeInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult, WikiError>;
    /** A person's act: lands an open change request on main and moves the checkout with it. */
    readonly merge: (input: WikiChangeRequestTarget) => Effect.Effect<WikiMergeResult, WikiError>;
    readonly setChangeRequestStatus: (
      input: WikiSetChangeRequestStatusInput,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
  }
>()("t3/wiki/WikiService") {}

/** The most rows a base query returns, for a view and for an agent's context alike. */
const QUERY_ROWS = 200;

/** The largest file `readFiles` returns text for. */
const READ_TEXT_BYTES = 16 * 1024 * 1024;
const PROJECT_PAGE = 200;

// Product commits never run the user's hooks or ask to sign; git never prompts.
const PRODUCT_GIT_CONFIG = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.quotePath=false",
] as const;
const NON_INTERACTIVE_ENV = {
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  GIT_TERMINAL_PROMPT: "0",
  SSH_ASKPASS: "",
  SSH_ASKPASS_REQUIRE: "never",
} as const;
const WIKI_EMAIL = "wiki@astrolabe.local";
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 120_000;

interface GitRunOptions {
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly allowExitCodes?: ReadonlyArray<number>;
  readonly timeoutMs?: number;
}

interface Snapshot {
  readonly files: WikiFiles;
  readonly index: WikiIndex;
}

interface StoredChangeRequest {
  readonly record: ChangeRequestRecord;
  readonly metadataCommit: string;
  readonly head: string;
}

/** A person's way out of a canvas conflict. An agent changes the clashing cards with a transform. */
const SETTLE_IN_WORKTREE =
  "A canvas is settled in the change request's worktree: edit it there so the clashing cards agree with main, save the edits to the change request, then merge again.";

/** Two commits merged as a tree, or what stopped them, with what a canvas's merge had to say. */
type WikiTreeMerge =
  | {
      readonly tree: string;
      readonly conflicts: readonly [];
      readonly canvases: ReadonlyArray<WikiCanvasMergeNotes>;
    }
  | {
      readonly tree: null;
      readonly conflicts: ReadonlyArray<string>;
      readonly canvases: ReadonlyArray<WikiCanvasMergeNotes>;
    };

/** Derived data keyed by immutable object ids, so an entry is never stale, only evicted. */
const lru = <A>(capacity: number) => {
  const entries = new Map<string, A>();
  return {
    get: (key: string): A | undefined => {
      const value = entries.get(key);
      if (value !== undefined) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set: (key: string, value: A) => {
      entries.delete(key);
      entries.set(key, value);
      const oldest = entries.keys().next();
      if (entries.size > capacity && !oldest.done) entries.delete(oldest.value);
    },
  };
};

/** A path as a wiki's links mean it: exact, else ignoring case, else a bare name in any folder. */
const listedFile = <A extends { readonly file: string }>(
  listing: ReadonlyArray<A>,
  path: string,
): A | undefined => {
  const wanted = key(path);
  const exact = listing.find(({ file }) => file === path || key(file) === wanted);
  if (exact !== undefined || path.includes("/")) return exact;
  const suffix = `/${wanted}`;
  return listing
    .filter(({ file }) => key(file).endsWith(suffix))
    .toSorted((a, b) => a.file.split("/").length - b.file.split("/").length)
    .at(0);
};

const isMediaFile = (file: string) => {
  const mime = hostPreviewMimeTypeFromExtension(/\.[^./]+$/.exec(file)?.[0] ?? "");
  return mime !== null && /^(image|audio|video|font)\/|\/pdf$/.test(mime) && !mime.includes("svg");
};

const decodeRegistry = Schema.decodeEffect(WikiRegistryJson);
const encodeRegistry = Schema.encodeEffect(WikiRegistryJson);
const decodeChangeRequest = Schema.decodeEffect(ChangeRequestRecordJson);
const encodeChangeRequest = Schema.encodeEffect(ChangeRequestRecordJson);

const isWikiError = Schema.is(WikiError);

const oneLine = (text: string) => text.replace(/[\r\n<>]+/g, " ").trim();

const subjectOf = (message: string) => {
  const subject = message.trim().split("\n")[0]?.trim() ?? "";
  return subject.length > 120 ? `${subject.slice(0, 117)}...` : subject;
};

/** The core's own validation messages are what an author needs to fix the amendment. */
const planningError = (cause: unknown) =>
  new WikiError({
    reason: "invalid",
    message:
      cause instanceof AmendmentError ||
      cause instanceof WikiFormatError ||
      cause instanceof WikiCollisionError
        ? cause.message
        : "The amendment could not be planned.",
    cause,
  });

/** Adds the wiki (and change request) a failure happened in, keeping everything else. */
const inWiki =
  (wikiId: WikiId, changeRequestId?: WikiChangeRequestId) =>
  (error: WikiError): WikiError => {
    if (error.wikiId !== undefined) return error;
    const changeRequest = error.changeRequestId ?? changeRequestId;
    return new WikiError({
      message: error.message,
      reason: error.reason,
      wikiId,
      ...(changeRequest === undefined ? {} : { changeRequestId: changeRequest }),
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    });
  };

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const crypto = yield* Crypto.Crypto;
  const projects = yield* ProjectService.ProjectService;

  const events = yield* PubSub.sliding<WikiEvent>(256);
  const registryPath = path.join(config.stateDir, "wikis.json");
  const registryLock = yield* Semaphore.make(1);
  const registryCache = yield* Ref.make<WikiRegistry | undefined>(undefined);
  const wikiLocks = new Map<string, Semaphore.Semaphore>();
  const snapshots = lru<Snapshot>(24);
  const amendmentLogs = lru<WikiChangeRequest["amendments"]>(128);
  const metadataRecords = lru<ChangeRequestRecord>(512);
  const editTimes = lru<WikiFileTimes>(24);
  const corpora = lru<BaseCorpus>(8);
  const fileListings = lru<ReturnType<typeof parseFileListing>>(8);
  // A change request's every read asks for its preview, and a canvas's merge reads three blobs.
  const mergePreviews = lru<WikiTreeMerge>(64);

  const newId = crypto.randomUUIDv4().pipe(
    Effect.orDie,
    Effect.map((uuid) => uuid.replaceAll("-", "").slice(0, 12)),
  );
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const publish = (kind: WikiEvent["kind"], wikiId: WikiId, changeRequestId: string | null) =>
    nowIso.pipe(
      Effect.flatMap((at) =>
        PubSub.publish(events, {
          wikiId,
          changeRequestId:
            changeRequestId === null ? null : WikiChangeRequestId.make(changeRequestId),
          kind,
          at,
        }),
      ),
      Effect.asVoid,
    );

  const runGit = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: GitRunOptions = {},
  ) =>
    git
      .execute({
        operation: `WikiService.${operation}`,
        cwd,
        args: [...PRODUCT_GIT_CONFIG, ...args],
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        env: { ...NON_INTERACTIVE_ENV, ...options.env },
        allowNonZeroExit: true,
        maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      })
      .pipe(
        Effect.mapError(
          (cause) => new WikiError({ reason: "git-failed", message: "Git could not run.", cause }),
        ),
        Effect.flatMap((result) => {
          const exitCode = Number(result.exitCode);
          return exitCode === 0 || options.allowExitCodes?.includes(exitCode)
            ? Effect.succeed({ ...result, exitCode })
            : Effect.fail(
                new WikiError({
                  reason: "git-failed",
                  message: "A git command failed for this wiki.",
                  cause: new WikiGitExitError({ operation, exitCode, stderr: result.stderr }),
                }),
              );
        }),
      );

  const gitOut = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: GitRunOptions,
  ) => runGit(operation, cwd, args, options).pipe(Effect.map((result) => result.stdout.trim()));

  const requireGit = yield* Effect.cached(
    git
      .execute({
        operation: "WikiService.version",
        cwd: config.cwd,
        args: ["--version"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new WikiError({
              reason: "git-unavailable",
              message: "Git could not start. Wikis need Git 2.38 or newer installed.",
              cause,
            }),
        ),
        Effect.flatMap((result) =>
          gitSupportsWikis(result.stdout)
            ? Effect.void
            : Effect.fail(
                new WikiError({
                  reason: "git-unavailable",
                  message: "Wikis need Git 2.38 or newer. Update Git, then try again.",
                }),
              ),
        ),
      ),
  );

  const identity = (actor: string, at: DateTime.Utc) => {
    const name = oneLine(actor) || "Agent";
    const date = `@${Math.floor(DateTime.toEpochMillis(at) / 1000)} +0000`;
    return {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: WIKI_EMAIL,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: WIKI_EMAIL,
      GIT_COMMITTER_DATE: date,
    };
  };

  const commitTree = (
    cwd: string,
    tree: string,
    parents: ReadonlyArray<string>,
    message: string,
    env: Readonly<Record<string, string>>,
  ) =>
    gitOut(
      "commitTree",
      cwd,
      ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])],
      {
        stdin: message.endsWith("\n") ? message : `${message}\n`,
        env,
      },
    );

  const revParse = (cwd: string, rev: string) =>
    runGit("revParse", cwd, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], {
      allowExitCodes: [1, 128],
    }).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : undefined)));

  const isAncestor = (cwd: string, ancestor: string, descendant: string) =>
    runGit("isAncestor", cwd, ["merge-base", "--is-ancestor", ancestor, descendant], {
      allowExitCodes: [1],
    }).pipe(Effect.map((result) => result.exitCode === 0));

  /** Object contents for `<oid>` or `<rev>:<path>` specs; `null` for a missing one. */
  const readObjects = Effect.fn("WikiService.readObjects")(function* (
    cwd: string,
    specs: ReadonlyArray<string>,
  ) {
    if (!specs.length) return [] as ReadonlyArray<string | null>;
    const batch = yield* runGit("catFileBatch", cwd, ["cat-file", "--batch"], {
      stdin: `${specs.join("\n")}\n`,
    });
    const parsed = parseBatchOutput(batch.stdout, specs.length);
    if (parsed !== undefined) return parsed;
    return yield* Effect.forEach(specs, (spec) =>
      runGit("catFile", cwd, ["cat-file", "blob", spec], { allowExitCodes: [128] }).pipe(
        Effect.map((result) => (result.exitCode === 0 ? result.stdout : null)),
      ),
    );
  });

  /** The wiki's documents at a commit or tree, and their index. */
  const snapshotAt = Effect.fn("WikiService.snapshotAt")(function* (
    wiki: WikiRecord,
    treeish: string,
  ) {
    const cached = snapshots.get(treeish);
    if (cached !== undefined) return cached;
    const listing = parseDocumentListing(
      (yield* runGit("lsTree", wiki.root, ["ls-tree", "-z", treeish])).stdout,
    );
    const contents = yield* readObjects(
      wiki.root,
      listing.map((entry) => entry.oid),
    );
    const files: Record<string, string> = {};
    listing.forEach((entry, position) => {
      files[entry.file] = contents[position] ?? "";
    });
    const index = yield* Effect.try({ try: () => indexFiles(files), catch: planningError });
    const snapshot: Snapshot = { files, index };
    snapshots.set(treeish, snapshot);
    return snapshot;
  });

  /** A tree of `base` with `changes` applied, built on a private index. */
  const buildTree = (cwd: string, base: string, changes: WikiChanges) =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* fileSystem
          .makeTempDirectoryScoped({ prefix: "t3-wiki-index-" })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WikiError({
                  reason: "git-failed",
                  message: "Could not prepare the amendment.",
                  cause,
                }),
            ),
          );
        const env = { GIT_INDEX_FILE: path.join(directory, "index") };
        yield* runGit("readTree", cwd, ["read-tree", base], { env });
        const entries = Object.entries(changes);
        const written = entries.filter((entry): entry is [string, string] => entry[1] !== null);
        const blobPaths = written.map((_, position) => path.join(directory, `blob-${position}`));
        yield* Effect.forEach(written, ([, content], position) =>
          fileSystem.writeFileString(blobPaths[position] ?? "", content),
        ).pipe(
          Effect.mapError(
            (cause) =>
              new WikiError({
                reason: "git-failed",
                message: "Could not prepare the amendment.",
                cause,
              }),
          ),
        );
        const oids = written.length
          ? (yield* gitOut(
              "hashObjects",
              cwd,
              ["hash-object", "-w", "--no-filters", "--stdin-paths"],
              {
                stdin: `${blobPaths.join("\n")}\n`,
              },
            )).split("\n")
          : [];
        const blobs = new Map(written.map(([file], position) => [file, oids[position] ?? ""]));
        const zero = "0".repeat(base.length);
        const info = entries
          .map(([file, content]) =>
            content === null ? `0 ${zero}\t${file}` : `100644 ${blobs.get(file)}\t${file}`,
          )
          .join("\n");
        yield* runGit("updateIndex", cwd, ["update-index", "--index-info"], {
          stdin: `${info}\n`,
          env,
        });
        return yield* gitOut("writeTree", cwd, ["write-tree"], { env });
      }),
    );

  /**
   * Merges `theirs` into `ours` as a tree. Git's line merge goes first. Every canvas changed on
   * both sides is then merged by card, whatever git made of it: git can merge an arrow onto a
   * deleted card without a conflict. With `notes`, a note git conflicted on is merged again by
   * paragraph and sentence, so edits to different sentences of one paragraph still merge.
   */
  const mergeTrees = Effect.fn("WikiService.mergeTrees")(function* (
    wiki: WikiRecord,
    ours: string,
    theirs: string,
    options: { readonly notes: boolean },
  ): Effect.fn.Return<WikiTreeMerge, WikiError> {
    const merged = yield* runGit(
      "mergeTree",
      wiki.root,
      ["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", ours, theirs],
      { allowExitCodes: [1] },
    );
    const { tree, conflicts } = parseMergeTree(merged.stdout);
    const clean = merged.exitCode === 0;
    const asGitLeftIt: WikiTreeMerge = clean
      ? { tree, conflicts: [], canvases: [] }
      : { tree: null, conflicts, canvases: [] };
    if (!clean && conflicts.length === 0) return asGitLeftIt;
    const base = yield* runGit("mergeBase", wiki.root, ["merge-base", ours, theirs], {
      allowExitCodes: [1],
    });
    if (base.exitCode !== 0) return asGitLeftIt;
    const baseCommit = base.stdout.trim();
    const changedTo = (tip: string) =>
      runGit("diffNames", wiki.root, [
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        baseCommit,
        tip,
      ]).pipe(Effect.map((diff) => diff.stdout.split("\0").filter(isCanvasFile)));
    const onOurs = new Set(yield* changedTo(ours));
    const onBoth = (yield* changedTo(theirs)).filter((file) => onOurs.has(file));
    const retried = conflicts.filter(
      (file) => isCanvasFile(file) || (options.notes && isWikiDocument(file)),
    );
    const files = [...new Set([...onBoth, ...retried])];
    if (files.length === 0) return asGitLeftIt;
    const sides = yield* readObjects(
      wiki.root,
      files.flatMap((file) => [`${baseCommit}:${file}`, `${ours}:${file}`, `${theirs}:${file}`]),
    );
    const resolved: Record<string, string> = {};
    const stuck = conflicts.filter((file) => !files.includes(file));
    const canvases: WikiCanvasMergeNotes[] = [];
    files.forEach((file, position) => {
      const [ancestor, mine, other] = sides.slice(position * 3, position * 3 + 3);
      const conflicted = conflicts.includes(file);
      if (ancestor == null || mine == null || other == null) {
        // Added on both sides, or deleted on one: nothing to merge by card, so git's answer stands.
        if (conflicted) stuck.push(file);
        return;
      }
      if (mine === other && !conflicted) return;
      if (!isCanvasFile(file)) {
        const outcome = mergeMarkdown(ancestor, mine, other);
        if (outcome.status === "merged") resolved[file] = outcome.text;
        else stuck.push(file);
        return;
      }
      const outcome = canvasMerge(ancestor, mine, other);
      const notes = outcome.status === "merged" ? outcome.resolved : outcome.conflicts;
      if (notes.length > 0) canvases.push({ file, notes: canvasMergeMessages(notes) });
      if (outcome.status === "merged") resolved[file] = outcome.text;
      else stuck.push(file);
    });
    if (stuck.length > 0) return { tree: null, conflicts: stuck, canvases };
    if (Object.keys(resolved).length === 0) return { tree, conflicts: [], canvases };
    return { tree: yield* buildTree(wiki.root, tree, resolved), conflicts: [], canvases };
  });

  /** Merges a change request's head into main as a tree. */
  const mergeIntoMain = (wiki: WikiRecord, main: string, head: string) =>
    mergeTrees(wiki, main, head, { notes: true });

  /** The folder that has `ref` checked out: the wiki's own, one of its worktrees, or none. */
  const checkoutHolding = Effect.fn("WikiService.checkoutHolding")(function* (
    wiki: WikiRecord,
    ref: string,
  ) {
    const listed = yield* runGit("worktreeList", wiki.root, [
      "worktree",
      "list",
      "--porcelain",
      "-z",
    ]);
    const branch = ref.slice("refs/heads/".length);
    return parseWorktreeList(listed.stdout).find((entry) => entry.branch === branch)?.path ?? null;
  });

  /**
   * Moves a branch with `move`, and the folder that has it checked out along with it by git's
   * two-tree checkout, which refuses to overwrite local edits there. When `move` finds the ref
   * already moved, the folder goes back to `from`.
   */
  const moveWithCheckout = Effect.fn("WikiService.moveWithCheckout")(function* (
    wiki: WikiRecord,
    ref: string,
    from: string,
    to: string,
    move: Effect.Effect<
      { readonly moved: true } | { readonly moved: false; readonly cause: unknown },
      WikiError
    >,
    errors: {
      readonly busy: (paths: ReadonlyArray<string>) => string;
      readonly stale: (rolledBack: boolean, cause: unknown) => WikiError;
    },
  ) {
    const at = yield* checkoutHolding(wiki, ref);
    if (at === null) {
      const result = yield* move;
      if (!result.moved) return yield* errors.stale(true, result.cause);
      return;
    }
    yield* withWorkspaceLease(
      at,
      Effect.gen(function* () {
        // Stat-only differences would otherwise read as local edits.
        yield* runGit("refreshIndex", at, ["update-index", "-q", "--refresh"], {
          allowExitCodes: [1],
        });
        const checkout = yield* runGit("checkout", at, ["read-tree", "-u", "-m", from, to], {
          allowExitCodes: [1, 128],
        });
        if (checkout.exitCode !== 0) {
          return yield* new WikiError({
            reason: "checkout-busy",
            message: errors.busy(parseBusyPaths(checkout.stderr)),
            cause: new WikiGitExitError({
              operation: "checkout",
              exitCode: checkout.exitCode,
              stderr: checkout.stderr,
            }),
          });
        }
        // Only our own checkout is reversed; git refuses if an editor changed those files since.
        const rollback = runGit("rollback", at, ["read-tree", "-u", "-m", to, from], {
          allowExitCodes: [1, 128],
        });
        const result = yield* move.pipe(Effect.tapError(() => Effect.ignore(rollback)));
        if (result.moved) return;
        const rolledBack = yield* rollback;
        return yield* errors.stale(rolledBack.exitCode === 0, result.cause);
      }),
    );
  });

  /** Applies several ref moves at once; each checks its old value, so a racing writer fails. */
  const updateRefs = (
    cwd: string,
    updates: ReadonlyArray<{
      readonly ref: string;
      readonly next: string;
      readonly previous: string | null;
    }>,
  ) =>
    runGit("updateRefs", cwd, ["update-ref", "--stdin"], {
      stdin: [
        "start",
        ...updates.map((update) =>
          update.previous === null
            ? `create ${update.ref} ${update.next}`
            : `update ${update.ref} ${update.next} ${update.previous}`,
        ),
        "prepare",
        "commit",
        "",
      ].join("\n"),
      allowExitCodes: [1, 128],
    }).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.void
          : Effect.fail(
              new WikiError({
                reason: "stale",
                message: "The change request moved while this ran. Read it again and retry.",
                cause: new WikiGitExitError({
                  operation: "updateRefs",
                  exitCode: result.exitCode,
                  stderr: result.stderr,
                }),
              }),
            ),
      ),
    );

  const registryError = (cause: unknown) =>
    new WikiError({
      reason: "invalid",
      message: "The wiki registry could not be read or written.",
      cause,
    });

  const loadRegistry = Effect.gen(function* () {
    const cached = yield* Ref.get(registryCache);
    if (cached !== undefined) return cached;
    const exists = yield* fileSystem.exists(registryPath).pipe(Effect.mapError(registryError));
    const registry: WikiRegistry = exists
      ? yield* fileSystem
          .readFileString(registryPath)
          .pipe(Effect.flatMap(decodeRegistry), Effect.mapError(registryError))
      : { version: 1, wikis: [] };
    yield* Ref.set(registryCache, registry);
    return registry;
  });

  const updateRegistry = <A>(
    update: (registry: WikiRegistry) => Effect.Effect<readonly [WikiRegistry, A], WikiError>,
  ) =>
    registryLock.withPermits(1)(
      Effect.gen(function* () {
        const [next, result] = yield* update(yield* loadRegistry);
        const contents = yield* encodeRegistry(next).pipe(Effect.mapError(registryError));
        yield* writeFileStringAtomically({
          filePath: registryPath,
          contents: `${contents}\n`,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.mapError(registryError),
        );
        yield* Ref.set(registryCache, next);
        return result;
      }),
    );

  const replaceWiki = (next: WikiRecord) =>
    updateRegistry((registry) =>
      Effect.succeed([
        {
          ...registry,
          wikis: registry.wikis.map((wiki) => (wiki.wikiId === next.wikiId ? next : wiki)),
        },
        next,
      ] as const),
    );

  /** A wiki by id, or by name for agents that know it by name. */
  const lookup = Effect.fn("WikiService.lookup")(function* (reference: string) {
    const { wikis } = yield* loadRegistry;
    const byId = wikis.find((wiki) => wiki.wikiId === reference);
    if (byId !== undefined) return byId;
    const byName = wikis.filter((wiki) => wiki.name.toLowerCase() === reference.toLowerCase());
    if (byName.length === 1 && byName[0] !== undefined) return byName[0];
    return yield* new WikiError({
      reason: "not-found",
      message:
        byName.length > 1
          ? "Several wikis have this name; use the wiki's id."
          : "No wiki has this id or name.",
    });
  });

  /** Runs `body` against a known wiki, with git checked and failures naming the wiki. */
  const withWiki = <A>(
    reference: string,
    body: (wiki: WikiRecord) => Effect.Effect<A, WikiError>,
    changeRequestId?: WikiChangeRequestId,
  ) =>
    requireGit.pipe(
      Effect.andThen(lookup(reference)),
      Effect.flatMap((wiki) =>
        body(wiki).pipe(Effect.mapError(inWiki(wiki.wikiId, changeRequestId))),
      ),
    );

  /** Serializes every write to one wiki. */
  const locked = <A, E, R>(wiki: WikiRecord, body: Effect.Effect<A, E, R>) => {
    let lock = wikiLocks.get(wiki.wikiId);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      wikiLocks.set(wiki.wikiId, lock);
    }
    return lock.withPermits(1)(body);
  };

  const mainRef = (wiki: WikiRecord) => `refs/heads/${wiki.mainBranch}`;

  const mainTip = (wiki: WikiRecord) =>
    revParse(wiki.root, mainRef(wiki)).pipe(
      Effect.filterOrFail(
        (tip): tip is string => tip !== undefined,
        () =>
          new WikiError({
            reason: "invalid",
            message: `The wiki's main branch ${wiki.mainBranch} has no commits.`,
          }),
      ),
    );

  const readChangeRequests = Effect.fn("WikiService.readChangeRequests")(function* (
    wiki: WikiRecord,
    only?: string,
  ) {
    const patterns =
      only === undefined
        ? [CHANGE_REQUEST_METADATA_PREFIX, CHANGE_REQUEST_BRANCH_PREFIX]
        : [changeRequestMetadataRef(only), changeRequestBranch(only)];
    const refs = yield* gitOut("forEachRef", wiki.root, [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
      ...patterns,
    ]);
    const metadata = new Map<string, string>();
    const heads = new Map<string, string>();
    for (const line of refs.split("\n")) {
      const [ref, oid] = line.split("\0");
      if (!ref || !oid) continue;
      if (ref.startsWith(CHANGE_REQUEST_METADATA_PREFIX)) {
        metadata.set(ref.slice(CHANGE_REQUEST_METADATA_PREFIX.length), oid);
      } else if (ref.startsWith(CHANGE_REQUEST_BRANCH_PREFIX)) {
        heads.set(ref.slice(CHANGE_REQUEST_BRANCH_PREFIX.length), oid);
      }
    }
    const unread = [...metadata.values()].filter((oid) => metadataRecords.get(oid) === undefined);
    const contents = yield* readObjects(
      wiki.root,
      unread.map((oid) => `${oid}:${CHANGE_REQUEST_FILE}`),
    );
    yield* Effect.forEach(unread, (oid, position) =>
      decodeChangeRequest(contents[position] ?? "").pipe(
        Effect.tap((record) => Effect.sync(() => metadataRecords.set(oid, record))),
        // A record this version cannot read is left alone, not dropped from the repository.
        Effect.catch((cause) =>
          Effect.logWarning("Skipping an unreadable wiki change request").pipe(
            Effect.annotateLogs({ wikiId: wiki.wikiId, cause }),
          ),
        ),
      ),
    );
    return [...metadata].flatMap(([id, metadataCommit]): ReadonlyArray<StoredChangeRequest> => {
      const record = metadataRecords.get(metadataCommit);
      const head = heads.get(id);
      return record === undefined || head === undefined || record.changeRequestId !== id
        ? []
        : [{ record, metadataCommit, head }];
    });
  });

  const loadChangeRequest = (wiki: WikiRecord, changeRequestId: WikiChangeRequestId) =>
    readChangeRequests(wiki, changeRequestId).pipe(
      Effect.flatMap((found) =>
        found[0] === undefined
          ? Effect.fail(
              new WikiError({
                reason: "not-found",
                message: "No change request has this id in this wiki.",
                changeRequestId,
              }),
            )
          : Effect.succeed(found[0]),
      ),
    );

  /** The thread's most recently updated open change request on this wiki. */
  const threadChangeRequest = (wiki: WikiRecord, threadId: ThreadId) =>
    readChangeRequests(wiki).pipe(
      Effect.map((all) =>
        all
          .filter((cr) => cr.record.status === "open" && cr.record.threadId === threadId)
          .toSorted((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt))
          .at(0),
      ),
    );

  const amendmentsOf = Effect.fn("WikiService.amendmentsOf")(function* (
    wiki: WikiRecord,
    stored: StoredChangeRequest,
  ) {
    const range = `${stored.record.base}..${stored.head}`;
    const cached = amendmentLogs.get(range);
    if (cached !== undefined) return cached;
    const log = yield* runGit("log", wiki.root, [
      "log",
      "--reverse",
      "--no-renames",
      `--format=${AMENDMENT_LOG_FORMAT}`,
      "--name-only",
      "-z",
      range,
    ]);
    const amendments = parseAmendmentLog(log.stdout);
    amendmentLogs.set(range, amendments);
    return amendments;
  });

  const view = (wiki: WikiRecord, stored: StoredChangeRequest) =>
    amendmentsOf(wiki, stored).pipe(
      Effect.map((amendments): WikiChangeRequest => ({
        changeRequestId: stored.record.changeRequestId,
        wikiId: wiki.wikiId,
        title: stored.record.title,
        status: stored.record.status,
        branch: stored.record.branch,
        base: stored.record.base,
        head: stored.head,
        threadId: stored.record.threadId,
        createdBy: stored.record.createdBy,
        createdAt: stored.record.createdAt,
        updatedAt: stored.record.updatedAt,
        mergedCommit: stored.record.mergedCommit,
        amendments,
      })),
    );

  const metadataCommit = Effect.fn("WikiService.metadataCommit")(function* (
    wiki: WikiRecord,
    record: ChangeRequestRecord,
    parent: string | null,
    message: string,
    env: Readonly<Record<string, string>>,
  ) {
    const json = yield* encodeChangeRequest(record).pipe(
      Effect.mapError(
        (cause) =>
          new WikiError({
            reason: "invalid",
            message: "The change request could not be recorded.",
            cause,
          }),
      ),
    );
    const blob = yield* gitOut("hashMetadata", wiki.root, ["hash-object", "-w", "--stdin"], {
      stdin: `${json}\n`,
    });
    const tree = yield* gitOut("mkTree", wiki.root, ["mktree"], {
      stdin: `100644 blob ${blob}\t${CHANGE_REQUEST_FILE}\n`,
    });
    return yield* commitTree(wiki.root, tree, parent === null ? [] : [parent], message, env);
  });

  /** Records new metadata for a stored change request, optionally moving its branch too. */
  const recordChangeRequest = Effect.fn("WikiService.recordChangeRequest")(function* (
    wiki: WikiRecord,
    stored: StoredChangeRequest,
    record: ChangeRequestRecord,
    message: string,
    env: Readonly<Record<string, string>>,
    head: string = stored.head,
    // False when the folder holding the branch already has the new head's edits.
    follow = true,
  ) {
    const next = yield* metadataCommit(wiki, record, stored.metadataCommit, message, env);
    const branch = changeRequestBranch(record.changeRequestId);
    const refs = updateRefs(wiki.root, [
      ...(head === stored.head ? [] : [{ ref: branch, next: head, previous: stored.head }]),
      {
        ref: changeRequestMetadataRef(record.changeRequestId),
        next,
        previous: stored.metadataCommit,
      },
    ]);
    if (head === stored.head || !follow) {
      yield* refs;
    } else {
      yield* moveWithCheckout(
        wiki,
        branch,
        stored.head,
        head,
        refs.pipe(
          Effect.as({ moved: true } as const),
          Effect.catchIf(
            (error) => error.reason === "stale",
            (error) => Effect.succeed({ moved: false, cause: error } as const),
          ),
        ),
        {
          busy: (paths) =>
            `Unsaved edits in this change request's worktree overlap the amendment${
              paths.length ? `: ${paths.join(", ")}` : ""
            }. Save them to the change request or set them aside, then try again.`,
          stale: (rolledBack, cause) =>
            rolledBack && isWikiError(cause)
              ? cause
              : new WikiError({
                  reason: "stale",
                  message:
                    "The change request moved while this ran and its worktree could not be put back; check its files.",
                  cause,
                }),
        },
      );
    }
    metadataRecords.set(next, record);
    return { record, metadataCommit: next, head } satisfies StoredChangeRequest;
  });

  /** Creates a change request's branch at `head` and its first metadata record together. */
  const createChangeRequest = Effect.fn("WikiService.createChangeRequest")(function* (
    wiki: WikiRecord,
    record: ChangeRequestRecord,
    head: string,
    env: Readonly<Record<string, string>>,
  ) {
    const meta = yield* metadataCommit(wiki, record, null, "Open change request", env);
    yield* updateRefs(wiki.root, [
      { ref: changeRequestBranch(record.changeRequestId), next: head, previous: null },
      { ref: changeRequestMetadataRef(record.changeRequestId), next: meta, previous: null },
    ]);
    metadataRecords.set(meta, record);
    return { record, metadataCommit: meta, head } satisfies StoredChangeRequest;
  });

  const requireOpen = (stored: StoredChangeRequest) =>
    stored.record.status === "open"
      ? Effect.void
      : Effect.fail(
          new WikiError({
            reason: "invalid",
            message: `This change request is ${stored.record.status}; reopen it or open a new one.`,
            changeRequestId: stored.record.changeRequestId,
          }),
        );

  /** The commit a read sees: a named change request's head, the thread's, else main. */
  const readCommit = Effect.fn("WikiService.readCommit")(function* (
    wiki: WikiRecord,
    target: WikiReadTarget,
  ) {
    if (target.changeRequestId !== undefined) {
      return (yield* loadChangeRequest(wiki, target.changeRequestId)).head;
    }
    if (target.threadId !== undefined) {
      const own = yield* threadChangeRequest(wiki, target.threadId);
      if (own !== undefined) return own.head;
    }
    return yield* mainTip(wiki);
  });

  const readAt = <A>(
    target: WikiReadTarget,
    read: (wiki: WikiRecord, commit: string, snapshot: Snapshot) => A,
  ) =>
    withWiki(
      target.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const commit = yield* readCommit(wiki, target);
          return read(wiki, commit, yield* snapshotAt(wiki, commit));
        }),
      target.changeRequestId,
    );

  type Target =
    | { readonly kind: "existing"; readonly stored: StoredChangeRequest }
    | {
        readonly kind: "new";
        readonly changeRequestId: WikiChangeRequestId;
        readonly base: string;
        readonly title: string;
      };

  const resolveTarget = Effect.fn("WikiService.resolveTarget")(function* (
    wiki: WikiRecord,
    input: {
      readonly changeRequestId?: WikiChangeRequestId | undefined;
      readonly title?: string | undefined;
      readonly message: string;
    },
    author: WikiAuthor,
  ): Effect.fn.Return<Target, WikiError> {
    if (input.changeRequestId !== undefined) {
      const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
      yield* requireOpen(stored);
      return { kind: "existing", stored };
    }
    if (author.threadId !== null) {
      const own = yield* threadChangeRequest(wiki, author.threadId);
      if (own !== undefined) return { kind: "existing", stored: own };
    }
    return {
      kind: "new",
      changeRequestId: WikiChangeRequestId.make(yield* newId),
      base: yield* mainTip(wiki),
      title: input.title ?? (subjectOf(input.message) || "Wiki change"),
    };
  });

  /**
   * Plans an amendment on the target's head and lands it as one commit, moving the branch and
   * the metadata together. Callers hold the wiki's lock.
   */
  const land = Effect.fn("WikiService.land")(function* (
    wiki: WikiRecord,
    target: Target,
    author: WikiAuthor,
    message: string,
    plan: (files: WikiFiles, stamp: AmendmentStamp) => PlannedAmendment,
    options: { readonly reverts?: string; readonly follow?: boolean } = {},
  ) {
    const { reverts, follow = true } = options;
    const now = yield* DateTime.now;
    const at = DateTime.formatIso(now);
    const amendment = yield* newId;
    const env = identity(author.actor, now);
    const changeRequestId =
      target.kind === "existing" ? target.stored.record.changeRequestId : target.changeRequestId;
    const parent = target.kind === "existing" ? target.stored.head : target.base;
    const snapshot = yield* snapshotAt(wiki, parent);
    let warnings = 0;
    const stamp: AmendmentStamp = {
      amendment,
      at,
      newId: () => `${amendment}-${++warnings}`,
    };
    const planned = yield* Effect.try({
      try: () => plan(snapshot.files, stamp),
      catch: planningError,
    });
    const tree = yield* buildTree(wiki.root, parent, planned.changes);
    if (tree === (yield* gitOut("parentTree", wiki.root, ["rev-parse", `${parent}^{tree}`]))) {
      return yield* new WikiError({
        reason: "invalid",
        message: "This amendment changes nothing.",
      });
    }
    const commit = yield* commitTree(
      wiki.root,
      tree,
      [parent],
      amendmentMessage(message, {
        amendment,
        actor: oneLine(author.actor) || "Agent",
        changeRequest: changeRequestId,
        ...(author.threadId === null ? {} : { thread: author.threadId }),
        ...(reverts === undefined ? {} : { reverts }),
      }),
      env,
    );
    const stored =
      target.kind === "existing"
        ? yield* recordChangeRequest(
            wiki,
            target.stored,
            { ...target.stored.record, updatedAt: at },
            "Amend change request",
            env,
            commit,
            follow,
          )
        : yield* createChangeRequest(
            wiki,
            {
              version: 1,
              changeRequestId,
              title: target.title,
              status: "open",
              branch: changeRequestBranch(changeRequestId),
              base: target.base,
              threadId: author.threadId,
              createdBy: oneLine(author.actor) || "Agent",
              createdAt: at,
              updatedAt: at,
              mergedCommit: null,
            },
            commit,
            env,
          );
    yield* publish("amended", wiki.wikiId, changeRequestId);
    return {
      changeRequest: yield* view(wiki, stored),
      commit,
      amendment,
      errors: planned.errors,
      ...(planned.canvas === undefined ? {} : { canvas: planned.canvas }),
    } satisfies WikiAmendResult;
  });

  const amendWith = (
    input: WikiAmendInput | WikiTransformInput,
    author: WikiAuthor,
    plan: (files: WikiFiles, stamp: AmendmentStamp) => PlannedAmendment,
  ) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          resolveTarget(wiki, input, author).pipe(
            Effect.flatMap((target) => land(wiki, target, author, input.message, plan)),
          ),
        ),
      input.changeRequestId,
    );

  // Here, not in `planAmendment`: a revert and a saved worktree still pass through that.
  const amend: WikiService["Service"]["amend"] = (input, author) => {
    const canvas = Object.keys(input.changes).find(isCanvasFile);
    if (canvas !== undefined) {
      return Effect.fail(
        new WikiError({
          reason: "invalid",
          message: `${canvas} is a canvas, which astrolabe_wiki_amend can't write. Change it with astrolabe_wiki_transform, kind "canvas": say what is on it, and it is placed for you.`,
          wikiId: input.wikiId,
        }),
      );
    }
    return amendWith(input, author, (files, stamp) => planAmendment(files, input.changes, stamp));
  };

  const transform: WikiService["Service"]["transform"] = (input, author) =>
    amendWith(input, author, (files, stamp) => {
      const change = input.transform;
      if (change.kind !== "canvas") {
        return planAmendment(files, planTransform(files, change, stamp), stamp);
      }
      const { file, changes, cards, notes } = planCanvasEdits(files, change, stamp);
      const canvas = { file, cards, ...(notes.length > 0 ? { notes } : {}) };
      return { ...planAmendment(files, changes, stamp), canvas };
    });

  const revertAmendment: WikiService["Service"]["revertAmendment"] = (input, author) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            yield* requireOpen(stored);
            const notAmendment = new WikiError({
              reason: "invalid",
              message: "That commit is not an amendment on this change request.",
            });
            if (!/^[0-9a-f]{4,64}$/i.test(input.commit)) return yield* notAmendment;
            const commit = yield* revParse(wiki.root, input.commit);
            const own = (yield* gitOut("revList", wiki.root, [
              "rev-list",
              `${stored.record.base}..${stored.head}`,
            ])).split("\n");
            if (commit === undefined || !own.includes(commit)) return yield* notAmendment;
            const parents = (yield* gitOut("parents", wiki.root, [
              "rev-list",
              "--parents",
              "-n",
              "1",
              commit,
            ])).split(" ");
            if (parents.length !== 2 || parents[1] === undefined) {
              return yield* new WikiError({
                reason: "invalid",
                message: "Only an ordinary one-parent amendment can be reverted.",
              });
            }
            const now = yield* DateTime.now;
            const env = identity(author.actor, now);
            // The inverse is a sibling built on the amendment, so a three-way merge keeps later
            // independent work and refuses only what overlaps it.
            const inverse = yield* commitTree(
              wiki.root,
              yield* gitOut("parentTree", wiki.root, ["rev-parse", `${parents[1]}^{tree}`]),
              [commit],
              "Temporary inverse base",
              env,
            );
            const merged = yield* mergeTrees(wiki, stored.head, inverse, { notes: false });
            if (merged.tree === null) {
              return yield* new WikiError({
                reason: "conflict",
                message: merged.conflicts.some(isCanvasFile)
                  ? `This amendment overlaps later work in the change request, in ${merged.conflicts.join(", ")}. ${SETTLE_IN_WORKTREE}`
                  : "This amendment overlaps later work in the change request; reconcile it with a new amendment instead.",
              });
            }
            const { tree, canvases } = merged;
            const names = (yield* runGit("revertDiff", wiki.root, [
              "diff",
              "--no-renames",
              "--name-only",
              "-z",
              stored.head,
              tree,
            ])).stdout
              .split("\0")
              .filter(Boolean);
            const contents = yield* readObjects(
              wiki.root,
              names.map((name) => `${tree}:${name}`),
            );
            const inverseChanges: Record<string, string | null> = {};
            names.forEach((name, position) => {
              inverseChanges[name] = contents[position] ?? null;
            });
            const subject = (yield* amendmentsOf(wiki, stored)).find(
              (amendment) => amendment.commit === commit,
            )?.subject;
            const landed = yield* land(
              wiki,
              { kind: "existing", stored },
              author,
              `Revert "${subject ?? commit.slice(0, 12)}"`,
              // Warning history survives the inverse; resolving a warning is its own amendment.
              (files, stamp) =>
                planAmendment(files, keepWarningHistory(files, inverseChanges), stamp, {
                  allowUnstamped: true,
                }),
              { reverts: commit },
            );
            return canvases.length > 0 ? { ...landed, canvases } : landed;
          }),
        ),
      input.changeRequestId,
    );

  /** Moves main from `from` to `to`, and the folder that has main checked out with it. */
  const moveMain = (wiki: WikiRecord, from: string, to: string) =>
    moveWithCheckout(
      wiki,
      mainRef(wiki),
      from,
      to,
      runGit(
        "updateMain",
        wiki.root,
        ["update-ref", "-m", "wiki: merge change request", mainRef(wiki), to, from],
        { allowExitCodes: [1, 128] },
      ).pipe(
        Effect.map((moved) =>
          moved.exitCode === 0
            ? ({ moved: true } as const)
            : ({ moved: false, cause: moved.stderr } as const),
        ),
      ),
      {
        busy: (paths) =>
          paths.length
            ? `Local edits in the wiki folder overlap this merge: ${paths.join(", ")}. Commit or set them aside, then merge again.`
            : "Local edits in the wiki folder overlap this merge. Commit or set them aside, then merge again.",
        stale: (rolledBack, cause) =>
          new WikiError({
            reason: "stale",
            message: rolledBack
              ? "Main moved while merging, so nothing was merged. Merge again."
              : "Main moved while merging and the wiki folder could not be put back; check its files before merging again.",
            cause,
          }),
      },
    );

  /** Pushes main to the mirror and records how it went; never fails for the push itself. */
  const pushToMirror = Effect.fn("WikiService.pushToMirror")(function* (wiki: WikiRecord) {
    const mirror = wiki.mirror;
    if (mirror === null) return wiki;
    const at = yield* nowIso;
    const attempt = Effect.gen(function* () {
      const local = yield* mainTip(wiki);
      const remote = yield* gitOut(
        "lsRemote",
        wiki.root,
        ["ls-remote", mirror.url, mainRef(wiki)],
        { timeoutMs: REMOTE_TIMEOUT_MS },
      );
      const remoteTip = remote.split("\t")[0]?.trim() || undefined;
      // A remote commit this repository lacks, or one main does not contain, is work made on
      // the mirror directly that this push replaces.
      const overwrote =
        remoteTip !== undefined &&
        remoteTip !== local &&
        !(
          (yield* revParse(wiki.root, remoteTip)) !== undefined &&
          (yield* isAncestor(wiki.root, remoteTip, local))
        );
      yield* runGit(
        "push",
        wiki.root,
        ["push", "--force", "--no-verify", mirror.url, `${mainRef(wiki)}:${mainRef(wiki)}`],
        { timeoutMs: REMOTE_TIMEOUT_MS },
      );
      return {
        ...mirror,
        lastPushedAt: at,
        lastPushedCommit: local,
        lastError: null,
        overwroteRemoteAt: overwrote ? at : mirror.overwroteRemoteAt,
      };
    });
    const status = yield* attempt.pipe(
      Effect.catchTags({
        WikiError: (error) =>
          Effect.logWarning("Wiki mirror push failed").pipe(
            Effect.annotateLogs({ wikiId: wiki.wikiId, cause: error }),
            Effect.as({ ...mirror, lastError: "The push to the mirror failed." }),
          ),
      }),
    );
    const next = yield* updateRegistry((registry) => {
      const current = registry.wikis.find((entry) => entry.wikiId === wiki.wikiId);
      // The mirror was changed or removed meanwhile; this push's status no longer applies.
      const updated =
        current === undefined || current.mirror?.url !== mirror.url
          ? current
          : { ...current, mirror: status };
      return Effect.succeed([
        {
          ...registry,
          wikis: registry.wikis.map((entry) =>
            entry.wikiId === wiki.wikiId && updated !== undefined ? updated : entry,
          ),
        },
        updated ?? wiki,
      ] as const);
    });
    yield* publish("mirror", wiki.wikiId, null);
    return next;
  });

  const saveWorktree: WikiService["Service"]["saveWorktree"] = (input, author) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            yield* requireOpen(stored);
            const at = yield* checkoutHolding(wiki, changeRequestBranch(input.changeRequestId));
            if (at === null) {
              return yield* new WikiError({
                reason: "invalid",
                message: "This change request is not checked out in a worktree.",
              });
            }
            return yield* withWorkspaceLease(
              at,
              Effect.gen(function* () {
                if ((yield* gitOut("worktreeHead", at, ["rev-parse", "HEAD"])) !== stored.head) {
                  return yield* new WikiError({
                    reason: "stale",
                    message: "The change request moved while this ran. Read it again and retry.",
                  });
                }
                const status = yield* runGit("worktreeStatus", at, [
                  "status",
                  "--porcelain=v1",
                  "-z",
                  "--no-renames",
                  "--untracked-files=all",
                ]);
                const changes: Record<string, string | null> = {};
                for (const record of status.stdout.split("\0")) {
                  const file = record.slice(3);
                  if (record.length < 4 || !isWikiDocument(file)) continue;
                  changes[file] = record.slice(0, 2).includes("D")
                    ? null
                    : yield* fileSystem.readFileString(path.join(at, file)).pipe(
                        Effect.mapError(
                          (cause) =>
                            new WikiError({
                              reason: "invalid",
                              message: `${file} could not be read from the worktree.`,
                              cause,
                            }),
                        ),
                      );
                }
                if (Object.keys(changes).length === 0) {
                  return yield* new WikiError({
                    reason: "invalid",
                    message: "No document in this worktree has unsaved changes.",
                  });
                }
                const result = yield* land(
                  wiki,
                  { kind: "existing", stored },
                  author,
                  input.message,
                  (files, stamp) => planAmendment(files, changes, stamp),
                  { follow: false },
                );
                // The folder already holds the edits: line its index up with the new head, then
                // write what the amendment changed besides them (stamps, map warnings).
                const touched = (yield* runGit("amendedFiles", at, [
                  "diff",
                  "--name-status",
                  "--no-renames",
                  "-z",
                  stored.head,
                  result.commit,
                ])).stdout
                  .split("\0")
                  .filter(Boolean);
                const written: string[] = [];
                const removed: string[] = [];
                for (let position = 0; position + 1 < touched.length; position += 2) {
                  const file = touched[position + 1]!;
                  if (touched[position] === "D") removed.push(file);
                  else written.push(file);
                }
                yield* runGit("adoptHead", at, ["read-tree", result.commit]);
                if (written.length) {
                  yield* runGit("writeAmended", at, ["checkout-index", "-f", "--", ...written]);
                }
                for (const file of removed) {
                  yield* fileSystem
                    .remove(path.join(at, file), { force: true })
                    .pipe(Effect.ignore);
                }
                return result;
              }),
            );
          }),
        ),
      input.changeRequestId,
    );

  const merge: WikiService["Service"]["merge"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            yield* requireOpen(stored);
            const main = yield* mainTip(wiki);
            if (yield* isAncestor(wiki.root, stored.head, main)) {
              return yield* new WikiError({
                reason: "invalid",
                message:
                  "Nothing to merge: main already has every amendment in this change request.",
              });
            }
            const { tree, conflicts } = yield* mergeIntoMain(wiki, main, stored.head);
            if (tree === null) {
              return yield* new WikiError({
                reason: "conflict",
                message: `Merging conflicts with main in ${conflicts.join(", ") || "some files"}. ${
                  conflicts.some(isCanvasFile)
                    ? SETTLE_IN_WORKTREE
                    : "Amend the change request to reconcile, then merge again."
                }`,
              });
            }
            const now = yield* DateTime.now;
            const env = identity(person.actor, now);
            const commit = yield* commitTree(
              wiki.root,
              tree,
              [main, stored.head],
              `Merge change request: ${oneLine(stored.record.title)}\n\nWiki-Change-Request: ${stored.record.changeRequestId}\n`,
              env,
            );
            yield* moveMain(wiki, main, commit);
            const done = yield* recordChangeRequest(
              wiki,
              stored,
              {
                ...stored.record,
                status: "merged",
                mergedCommit: commit,
                updatedAt: DateTime.formatIso(now),
              },
              "Merge change request",
              env,
            );
            yield* publish("merged", wiki.wikiId, stored.record.changeRequestId);
            yield* pushToMirror(wiki);
            return { changeRequest: yield* view(wiki, done), commit } satisfies WikiMergeResult;
          }),
        ),
      input.changeRequestId,
    );

  const summary = (wiki: WikiRecord) =>
    readChangeRequests(wiki).pipe(
      Effect.map((all) => all.filter((cr) => cr.record.status === "open").length),
      // A wiki whose folder went away still lists, so it can be removed.
      Effect.orElseSucceed(() => 0),
      Effect.map((openChangeRequests): WikiSummary => ({
        wikiId: wiki.wikiId,
        name: wiki.name,
        root: wiki.root,
        mainBranch: wiki.mainBranch,
        projectIds: wiki.projectIds,
        mirror: wiki.mirror,
        mapBackgrounds: wiki.mapBackgrounds,
        openChangeRequests,
        createdAt: wiki.createdAt,
      })),
    );

  const list: WikiService["Service"]["list"] = loadRegistry.pipe(
    Effect.flatMap((registry) => Effect.forEach(registry.wikis, summary, { concurrency: 4 })),
    Effect.map((wikis) => ({ wikis })),
  );

  /** When each file was last changed on the line ending at `commit`. */
  const editTimesAt = Effect.fn("WikiService.editTimesAt")(function* (
    wiki: WikiRecord,
    commit: string,
  ) {
    const cached = editTimes.get(commit);
    if (cached !== undefined) return cached;
    const log = yield* runGit("editTimes", wiki.root, [
      "log",
      "--no-renames",
      `--max-count=${EDIT_TIMES_DEPTH}`,
      `--format=${EDIT_TIMES_FORMAT}`,
      "--name-only",
      "-z",
      commit,
      "--",
    ]);
    const times = parseFileTimes(log.stdout);
    editTimes.set(commit, times);
    return times;
  });

  /** Every file at `commit`, at any depth. */
  const fileListingAt = Effect.fn("WikiService.fileListingAt")(function* (
    wiki: WikiRecord,
    commit: string,
  ) {
    const cached = fileListings.get(commit);
    if (cached !== undefined) return cached;
    const listing = parseFileListing(
      (yield* runGit("lsTreeAll", wiki.root, ["ls-tree", "-r", "-l", "-z", commit])).stdout,
    );
    fileListings.set(commit, listing);
    return listing;
  });

  /** Every file at `commit` as a base lists them; only notes and canvases are read. */
  const corpusAt = Effect.fn("WikiService.corpusAt")(function* (wiki: WikiRecord, commit: string) {
    const cached = corpora.get(commit);
    if (cached !== undefined) return cached;
    const listing = (yield* fileListingAt(wiki, commit)).filter((entry) => !isHidden(entry.file));
    const readable = listing.filter((entry) => /\.(md|canvas)$/i.test(entry.file));
    const contents = yield* readObjects(
      wiki.root,
      readable.map((entry) => entry.oid),
    );
    const sources = new Map(readable.map((entry, position) => [entry.file, contents[position]]));
    const times = yield* editTimesAt(wiki, commit);
    const corpus = baseCorpus(
      listing.map((entry) => ({
        file: entry.file,
        size: entry.size,
        ...(sources.has(entry.file) ? { source: sources.get(entry.file) ?? "" } : {}),
      })),
      times,
    );
    corpora.set(commit, corpus);
    return corpus;
  });

  const index: WikiService["Service"]["index"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const commit = yield* readCommit(wiki, input);
          const snapshot = yield* snapshotAt(wiki, commit);
          const times = yield* editTimesAt(wiki, commit);
          return indexResult(wiki.wikiId, commit, snapshot.index, times.modified);
        }),
      input.changeRequestId,
    );

  const readNote: WikiService["Service"]["readNote"] = (input) =>
    readAt(input, (wiki, commit, snapshot) =>
      noteResult(wiki.wikiId, commit, snapshot.index, snapshot.files, input.name),
    );

  const search: WikiService["Service"]["search"] = (input) =>
    readAt(input, (_wiki, commit, snapshot) => ({
      commit,
      ...searchNotes(snapshot.index, input.query),
    }));

  const links: WikiService["Service"]["links"] = (input) =>
    readAt(input, (_wiki, commit, snapshot) => ({
      commit,
      ...linksResult(snapshot.index, input.name),
    }));

  const query: WikiService["Service"]["query"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const commit = yield* readCommit(wiki, input);
          const snapshot = yield* snapshotAt(wiki, commit);
          // Unsaved edits from the view are read as if they had landed.
          const changes = yield* Effect.try({
            try: () => (input.edits?.length ? applyBaseEdits(snapshot.files, input.edits) : {}),
            catch: (cause) =>
              new WikiError({
                reason: "invalid",
                message: cause instanceof BaseError ? cause.message : "The edits could not apply.",
                cause,
              }),
          });
          const edited = Object.keys(changes).length > 0;
          const index = edited ? indexFiles(applyChanges(snapshot.files, changes)) : snapshot.index;
          const located = locateBase(index, input);
          if ("problem" in located) {
            return yield* new WikiError({ reason: located.problem, message: located.message });
          }
          const committed = yield* corpusAt(wiki, commit);
          const corpus = edited ? corpusWithChanges(committed, changes) : committed;
          const now = yield* Clock.currentTimeMillis;
          const result = yield* Effect.try({
            try: () =>
              queryBase(corpus, parseBase(located.source), {
                view: input.view,
                self: located.self,
                now,
                cap: QUERY_ROWS,
              }),
            // A base's own errors name what to fix; anything else is ours.
            catch: (cause) =>
              new WikiError({
                reason: "invalid",
                message: cause instanceof BaseError ? cause.message : "The base could not run.",
                cause,
              }),
          });
          return { commit, ...result };
        }),
      input.changeRequestId,
    );

  /** The commit a file read sees: the one named, once it's known to be a commit here. */
  const fileCommit = Effect.fn("WikiService.fileCommit")(function* (
    wiki: WikiRecord,
    target: WikiReadTarget & { readonly commit?: string | undefined },
  ) {
    if (target.commit === undefined) return yield* readCommit(wiki, target);
    const commit = /^[0-9a-f]{4,64}$/i.test(target.commit)
      ? yield* revParse(wiki.root, target.commit)
      : undefined;
    if (commit !== undefined) return commit;
    return yield* new WikiError({ reason: "not-found", message: "No commit has this id here." });
  });

  const readFiles: WikiService["Service"]["readFiles"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const commit = yield* fileCommit(wiki, input);
          const listing = yield* fileListingAt(wiki, commit);
          const found = input.paths.map((path) => listedFile(listing, path));
          // A media file's existence is all a card needs here: its bytes come as an asset.
          const readable = found.flatMap((entry) =>
            entry !== undefined && entry.size <= READ_TEXT_BYTES && !isMediaFile(entry.file)
              ? [entry]
              : [],
          );
          const contents = yield* readObjects(
            wiki.root,
            readable.map((entry) => entry.oid),
          );
          const texts = new Map(readable.map((entry, position) => [entry.oid, contents[position]]));
          return {
            commit,
            files: input.paths.map((path, position) => {
              const entry = found[position];
              const text = entry === undefined ? undefined : texts.get(entry.oid);
              return {
                path,
                exists: entry !== undefined,
                file: entry?.file ?? path,
                size: entry?.size ?? 0,
                // Bytes that aren't text decode to something, but never without a NUL or a U+FFFD.
                text: text == null || /[\0\uFFFD]/.test(text) ? null : text,
              };
            }),
          };
        }),
      input.changeRequestId,
    );

  const locateFile: WikiService["Service"]["locateFile"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      Effect.gen(function* () {
        const commit = yield* fileCommit(wiki, {
          wikiId: wiki.wikiId,
          commit: input.commit,
          ...(input.changeRequestId === undefined
            ? {}
            : { changeRequestId: WikiChangeRequestId.make(input.changeRequestId) }),
        });
        const entry = listedFile(yield* fileListingAt(wiki, commit), input.path);
        if (entry === undefined) {
          return yield* new WikiError({
            reason: "not-found",
            message: `${input.path} isn't in this wiki at that commit.`,
          });
        }
        return { root: wiki.root, commit, path: entry.file };
      }),
    );

  /** Each active project, by the repository it checks out. */
  const projectRoots = Effect.gen(function* () {
    const roots = new Map<string, string>();
    const readFrom = (cursor: number): Effect.Effect<void, ProjectService.ProjectOperationError> =>
      projects.listPage({ cursor, limit: PROJECT_PAGE }).pipe(
        Effect.flatMap(({ projects: page, nextCursor }) => {
          for (const project of page) {
            const repository = project.repositoryIdentity?.canonicalKey;
            if (repository && !roots.has(repository)) roots.set(repository, project.workspaceRoot);
          }
          return nextCursor === null ? Effect.void : readFrom(nextCursor);
        }),
      );
    yield* readFrom(0);
    return roots;
  });

  /** Blob ids for `<rev>:<path>` specs, null for what isn't there; a bad rev only reads as that. */
  const blobIds = (cwd: string, specs: ReadonlyArray<string>) =>
    runGit("catFileCheck", cwd, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
      stdin: `${specs.join("\n")}\n`,
    }).pipe(
      Effect.map((result) =>
        result.stdout
          .split("\n")
          .slice(0, specs.length)
          .map((line) => {
            const [oid, type] = line.split(" ");
            return type === "blob" && oid !== undefined ? oid : null;
          }),
      ),
    );

  const codeStatus: WikiService["Service"]["codeStatus"] = Effect.fn("WikiService.codeStatus")(
    function* (input) {
      const roots = yield* projectRoots.pipe(
        Effect.mapError(
          (cause) =>
            new WikiError({ reason: "invalid", message: "Projects couldn't be read.", cause }),
        ),
      );
      const statuses: WikiCodeStatus[] = input.references.map(() => "unknown");
      const byRoot = new Map<string, number[]>();
      input.references.forEach((reference, position) => {
        const root = roots.get(reference.repository);
        if (root !== undefined) byRoot.set(root, [...(byRoot.get(root) ?? []), position]);
      });
      for (const [root, positions] of byRoot) {
        const references = positions.flatMap((position) => input.references[position] ?? []);
        const blobs = yield* blobIds(root, [
          ...references.map(({ commit, path }) => `${commit}:${path}`),
          ...references.map(({ path }) => `HEAD:${path}`),
        ]).pipe(Effect.orElseSucceed((): ReadonlyArray<string | null> => []));
        positions.forEach((position, index) => {
          const pinned = blobs[index];
          const head = blobs[references.length + index];
          if (pinned == null) return;
          statuses[position] = head == null ? "gone" : head === pinned ? "current" : "changed";
        });
      }
      return { statuses };
    },
  );

  const orient: WikiService["Service"]["orient"] = (input) =>
    readAt(input, (_wiki, commit, snapshot) => {
      const oriented = orientResult(snapshot.index, input.map);
      return oriented === undefined ? undefined : { commit, ...oriented };
    }).pipe(
      Effect.filterOrFail(
        (oriented) => oriented !== undefined,
        () =>
          new WikiError({
            reason: "not-found",
            message: "No valid skill map has this name.",
            wikiId: input.wikiId,
          }),
      ),
    );

  const changeRequestsList: WikiService["Service"]["changeRequestsList"] = (input) =>
    requireGit.pipe(
      Effect.andThen(
        input.wikiId === undefined
          ? Effect.map(loadRegistry, (registry) => registry.wikis)
          : Effect.map(lookup(input.wikiId), (wiki) => [wiki]),
      ),
      Effect.flatMap((wikis) =>
        Effect.forEach(
          wikis,
          (wiki) =>
            readChangeRequests(wiki).pipe(
              Effect.map((all) =>
                all.filter(
                  ({ record }) =>
                    (input.status === undefined || record.status === input.status) &&
                    (input.threadId === undefined || record.threadId === input.threadId),
                ),
              ),
              Effect.flatMap((matching) => Effect.forEach(matching, (cr) => view(wiki, cr))),
              Effect.mapError(inWiki(wiki.wikiId)),
            ),
          { concurrency: 4 },
        ),
      ),
      Effect.map((perWiki) => ({
        changeRequests: perWiki.flat().toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      })),
    );

  const mergePreview = Effect.fn("WikiService.mergePreview")(function* (
    wiki: WikiRecord,
    stored: StoredChangeRequest,
    main: string,
  ): Effect.fn.Return<WikiMergePreview, WikiError> {
    if (yield* isAncestor(wiki.root, stored.head, main)) {
      return { status: "up-to-date", conflicts: [], errors: [], canvases: [] };
    }
    const key = `${main}:${stored.head}`;
    const merge = mergePreviews.get(key) ?? (yield* mergeIntoMain(wiki, main, stored.head));
    mergePreviews.set(key, merge);
    const { tree, conflicts, canvases } = merge;
    if (tree === null) return { status: "conflict", conflicts, errors: [], canvases };
    return {
      status: "clean",
      conflicts: [],
      errors: (yield* snapshotAt(wiki, tree)).index.errors,
      canvases,
    };
  });

  const changeRequestsGet: WikiService["Service"]["changeRequestsGet"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const stored =
            input.changeRequestId !== undefined
              ? yield* loadChangeRequest(wiki, input.changeRequestId)
              : input.threadId !== undefined
                ? yield* threadChangeRequest(wiki, input.threadId)
                : undefined;
          if (stored === undefined) {
            return yield* new WikiError({
              reason: "not-found",
              message: "This thread has no open change request on this wiki.",
            });
          }
          const main = yield* mainTip(wiki);
          // An open change request shows what merging would add; a finished one, what it changed.
          const from =
            stored.record.status === "open"
              ? (yield* runGit("mergeBase", wiki.root, ["merge-base", main, stored.head], {
                  allowExitCodes: [1],
                })).stdout.trim() || stored.record.base
              : stored.record.base;
          const names = (yield* runGit("diffNames", wiki.root, [
            "diff",
            "--no-renames",
            "--name-only",
            "-z",
            from,
            stored.head,
          ])).stdout
            .split("\0")
            .filter((file) => file.length > 0 && isWikiDocument(file));
          const contents = yield* readObjects(wiki.root, [
            ...names.map((file) => `${from}:${file}`),
            ...names.map((file) => `${stored.head}:${file}`),
          ]);
          return {
            changeRequest: yield* view(wiki, stored),
            files: names.map((file, position) => ({
              file,
              before: contents[position] ?? null,
              after: contents[names.length + position] ?? null,
            })),
            mergePreview:
              stored.record.status === "merged"
                ? { status: "up-to-date" as const, conflicts: [], errors: [], canvases: [] }
                : yield* mergePreview(wiki, stored, main),
            errors: (yield* snapshotAt(wiki, stored.head)).index.errors,
          } satisfies WikiChangeRequestDetail;
        }),
      input.changeRequestId,
    );

  const changeRequestsOpen: WikiService["Service"]["changeRequestsOpen"] = (input, author) =>
    withWiki(input.wikiId, (wiki) =>
      locked(
        wiki,
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const at = DateTime.formatIso(now);
          const changeRequestId = WikiChangeRequestId.make(yield* newId);
          const base = yield* mainTip(wiki);
          const stored = yield* createChangeRequest(
            wiki,
            {
              version: 1,
              changeRequestId,
              title: input.title,
              status: "open",
              branch: changeRequestBranch(changeRequestId),
              base,
              threadId: author.threadId,
              createdBy: oneLine(author.actor) || "Agent",
              createdAt: at,
              updatedAt: at,
              mergedCommit: null,
            },
            base,
            identity(author.actor, now),
          );
          yield* publish("status", wiki.wikiId, changeRequestId);
          return yield* view(wiki, stored);
        }),
      ),
    );

  const setChangeRequestStatus: WikiService["Service"]["setChangeRequestStatus"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            if (stored.record.status === "merged") {
              return yield* new WikiError({
                reason: "invalid",
                message: "A merged change request stays merged.",
              });
            }
            if (stored.record.status === input.status) return yield* view(wiki, stored);
            const now = yield* DateTime.now;
            const next = yield* recordChangeRequest(
              wiki,
              stored,
              { ...stored.record, status: input.status, updatedAt: DateTime.formatIso(now) },
              input.status === "open" ? "Reopen change request" : "Close change request",
              identity(person.actor, now),
            );
            yield* publish("status", wiki.wikiId, input.changeRequestId);
            return yield* view(wiki, next);
          }),
        ),
      input.changeRequestId,
    );

  const addRecord = Effect.fn("WikiService.addRecord")(function* (
    root: string,
    name: string,
    mainBranch: string,
  ) {
    const wikiId = WikiId.make(yield* newId);
    const createdAt = yield* nowIso;
    const record: WikiRecord = {
      wikiId,
      name,
      root,
      mainBranch,
      projectIds: [],
      projectLinkedAt: {},
      mirror: null,
      mapBackgrounds: [],
      createdAt,
    };
    yield* updateRegistry((registry) =>
      registry.wikis.some((wiki) => wiki.root === root)
        ? Effect.fail(
            new WikiError({ reason: "invalid", message: "This folder is already a wiki." }),
          )
        : Effect.succeed([{ ...registry, wikis: [...registry.wikis, record] }, record] as const),
    );
    yield* publish("registered", wikiId, null);
    return yield* summary(record);
  });

  const register: WikiService["Service"]["register"] = (input) =>
    requireGit.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const root = yield* fileSystem.realPath(input.root).pipe(
            Effect.mapError(
              (cause) =>
                new WikiError({
                  reason: "not-found",
                  message: "This folder does not exist.",
                  cause,
                }),
            ),
          );
          const notRepository = new WikiError({
            reason: "invalid",
            message: "Choose the top-level folder of a git repository.",
          });
          const topLevel = yield* runGit("topLevel", root, ["rev-parse", "--show-toplevel"], {
            allowExitCodes: [128],
          });
          if (topLevel.exitCode !== 0) return yield* notRepository;
          const top = yield* fileSystem
            .realPath(topLevel.stdout.trim())
            .pipe(Effect.orElseSucceed(() => ""));
          if (top !== root) return yield* notRepository;
          const head = yield* runGit("headBranch", root, ["symbolic-ref", "-q", "HEAD"], {
            allowExitCodes: [1],
          });
          const ref = head.stdout.trim();
          if (head.exitCode !== 0 || !ref.startsWith("refs/heads/")) {
            return yield* new WikiError({
              reason: "invalid",
              message: "Check out the wiki's main branch in this folder, then add it.",
            });
          }
          const mainBranch = ref.slice("refs/heads/".length);
          if ((yield* revParse(root, ref)) === undefined) {
            return yield* new WikiError({
              reason: "invalid",
              message: "The repository needs at least one commit to become a wiki.",
            });
          }
          if ((yield* loadRegistry).wikis.some((wiki) => wiki.root === root)) {
            return yield* new WikiError({
              reason: "invalid",
              message: "This folder is already a wiki.",
            });
          }
          return yield* addRecord(root, input.name ?? path.basename(root), mainBranch);
        }),
      ),
    );

  const create: WikiService["Service"]["create"] = (input) =>
    requireGit.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const parent = path.join(config.baseDir, "wikis");
          const folderError = (cause: unknown) =>
            new WikiError({
              reason: "invalid",
              message: "Could not create the wiki's folder.",
              cause,
            });
          yield* fileSystem
            .makeDirectory(parent, { recursive: true })
            .pipe(Effect.mapError(folderError));
          const slug = newProjectFolderName(input.name);
          let folder: string | undefined;
          // Creating the folder without `recursive` is the claim, so two creates never share one.
          for (let attempt = 1; attempt <= 100 && folder === undefined; attempt++) {
            const candidate = path.join(parent, attempt === 1 ? slug : `${slug}-${attempt}`);
            const claimed = yield* fileSystem.makeDirectory(candidate).pipe(
              Effect.as(true),
              Effect.catchIf(
                (error) => error.reason._tag === "AlreadyExists",
                () => Effect.succeed(false),
              ),
              Effect.mapError(folderError),
            );
            if (claimed) folder = candidate;
          }
          if (folder === undefined) return yield* folderError("Every folder name is taken.");
          const root = folder;
          const scaffold = Effect.gen(function* () {
            const configured = yield* runGit(
              "defaultBranch",
              root,
              ["config", "--get", "init.defaultBranch"],
              {
                allowExitCodes: [1],
              },
            );
            const branch = configured.stdout.trim() || "main";
            yield* runGit("init", root, ["init", "--quiet", `--initial-branch=${branch}`]);
            yield* fileSystem
              .writeFileString(path.join(root, "README.md"), `# ${input.name}\n`)
              .pipe(Effect.mapError(folderError));
            yield* runGit("add", root, ["add", "--force", "--", "README.md"]);
            const tree = yield* gitOut("writeTree", root, ["write-tree"]);
            const commit = yield* commitTree(
              root,
              tree,
              [],
              "Create wiki",
              identity("Astrolabe", yield* DateTime.now),
            );
            yield* runGit("createMain", root, ["update-ref", `refs/heads/${branch}`, commit, ""]);
            return {
              root: yield* fileSystem.realPath(root).pipe(Effect.mapError(folderError)),
              branch,
            };
          });
          const made = yield* scaffold.pipe(
            Effect.tapError(() => fileSystem.remove(root, { recursive: true }).pipe(Effect.ignore)),
          );
          return yield* addRecord(made.root, input.name, made.branch);
        }),
      ),
    );

  const remove: WikiService["Service"]["remove"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      updateRegistry((registry) =>
        Effect.succeed([
          { ...registry, wikis: registry.wikis.filter((entry) => entry.wikiId !== wiki.wikiId) },
          undefined,
        ] as const),
      ).pipe(Effect.andThen(publish("removed", wiki.wikiId, null))),
    );

  const setMirror: WikiService["Service"]["setMirror"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      Effect.gen(function* () {
        // A URL that reads as an option would reach git as one.
        if (input.url !== null && input.url.startsWith("-")) {
          return yield* new WikiError({
            reason: "invalid",
            message: "This is not a git remote URL.",
          });
        }
        const mirror =
          input.url === null
            ? null
            : wiki.mirror?.url === input.url
              ? wiki.mirror
              : {
                  url: input.url,
                  lastPushedAt: null,
                  lastPushedCommit: null,
                  lastError: null,
                  overwroteRemoteAt: null,
                };
        const next = yield* locked(wiki, replaceWiki({ ...wiki, mirror }));
        yield* publish("mirror", wiki.wikiId, null);
        return yield* summary(next);
      }),
    );

  const setMapBackgrounds: WikiService["Service"]["setMapBackgrounds"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      Effect.gen(function* () {
        const names = new Set(input.backgrounds.map(({ name }) => name.toLowerCase()));
        if (names.size !== input.backgrounds.length) {
          return yield* new WikiError({
            reason: "invalid",
            message: "Two map backgrounds can't share a name.",
          });
        }
        const addresses = input.backgrounds.flatMap(({ lightTiles, darkTiles }) =>
          darkTiles === null ? [lightTiles] : [lightTiles, darkTiles],
        );
        if (addresses.some((address) => !/^https?:\/\//i.test(address))) {
          return yield* new WikiError({
            reason: "invalid",
            message: "A map background's address starts with http:// or https://.",
          });
        }
        const next = yield* locked(
          wiki,
          replaceWiki({ ...wiki, mapBackgrounds: input.backgrounds }),
        );
        // A kind older clients decode; every kind only tells them to read again.
        yield* publish("mirror", wiki.wikiId, null);
        return yield* summary(next);
      }),
    );

  const setProjectLink: WikiService["Service"]["setProjectLink"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      locked(
        wiki,
        updateRegistry((registry) =>
          Effect.map(nowIso, (at) => {
            const current = registry.wikis.find((entry) => entry.wikiId === wiki.wikiId) ?? wiki;
            const others = current.projectIds.filter((id) => id !== input.projectId);
            const otherLinkTimes = Record.remove(current.projectLinkedAt, input.projectId);
            const next = {
              ...current,
              projectIds: input.linked ? [...others, input.projectId] : others,
              projectLinkedAt: !input.linked
                ? otherLinkTimes
                : current.projectIds.includes(input.projectId)
                  ? current.projectLinkedAt
                  : { ...otherLinkTimes, [input.projectId]: at },
            };
            return [
              {
                ...registry,
                wikis: registry.wikis.map((entry) => (entry.wikiId === next.wikiId ? next : entry)),
              },
              next,
            ] as const;
          }),
        ),
      ).pipe(
        Effect.tap(() => publish("linked", wiki.wikiId, null)),
        Effect.flatMap(summary),
      ),
    );

  const agentNote: WikiService["Service"]["agentNote"] = (projectId, linkedSince) =>
    loadRegistry.pipe(
      Effect.map((registry) =>
        linkedWikiNote(
          registry.wikis
            .filter((wiki) => {
              if (!wiki.projectIds.includes(projectId)) return false;
              if (linkedSince === undefined) return true;
              const linkedAt = wiki.projectLinkedAt[projectId];
              return (
                linkedAt !== undefined && Date.parse(linkedAt) > DateTime.toEpochMillis(linkedSince)
              );
            })
            .map((wiki) => wiki.name),
        ),
      ),
    );

  const pushMirror: WikiService["Service"]["pushMirror"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      wiki.mirror === null
        ? Effect.fail(new WikiError({ reason: "invalid", message: "This wiki has no mirror." }))
        : locked(wiki, pushToMirror(wiki)).pipe(Effect.flatMap(summary)),
    );

  const root: WikiService["Service"]["root"] = Effect.fn("WikiService.root")(function* (wikiId) {
    return (yield* lookup(wikiId)).root;
  });

  return WikiService.of({
    list,
    root,
    subscribe: Stream.fromPubSub(events),
    register,
    create,
    remove,
    setMirror,
    setMapBackgrounds,
    setProjectLink,
    agentNote,
    pushMirror,
    index,
    readNote,
    search,
    query,
    readFiles,
    locateFile,
    codeStatus,
    orient,
    links,
    changeRequestsList,
    changeRequestsGet,
    changeRequestsOpen,
    amend,
    transform,
    revertAmendment,
    saveWorktree,
    merge,
    setChangeRequestStatus,
  });
});

export const layer = Layer.effect(WikiService, make);
