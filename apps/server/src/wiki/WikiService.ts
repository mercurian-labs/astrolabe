/**
 * A project root's documents: read from a commit or on disk, and drafts and change requests kept
 * as refs in its repository. Nothing here moves the folder's own branches; change requests land
 * on the host. One writer per repository; `WikiHostService` owns the host's side.
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
  folderOf,
  freePath,
  MOVES_LOG_FORMAT,
  parseMoves,
  planAmendment,
  planMove,
  planProjectFolderRename,
  planProjectRename,
  planCanvasEdits,
  planTransform,
  WikiFormatError,
  type AmendmentStamp,
  type PlannedAmendment,
  type PlannedMove,
  type ProjectIndex,
  type WikiAttachment,
  type WikiChanges,
  type WikiBlob,
  type WikiFiles,
  type WikiIndex,
  type WikiMove,
  canvasMerge,
  canvasMergeMessages,
  mergeMarkdown,
  parseBase,
  queryBase,
  baseCorpus,
  checkBase,
  documentBaseCheck,
  applyBaseEdits,
  applyChanges,
  corpusWithChanges,
  isCanvasFile,
  isHidden,
  isWikiPath,
  linkFiles,
  resolveLink,
  type BaseCorpus,
  type CodeFile,
  type WikiLinkFiles,
} from "@mercurian/wiki";
import {
  type CodeIndexError,
  type IsoDateTime,
  parseProjectRootId,
  type ProjectId,
  type ProjectRoot,
  projectRootId,
  type ThreadId,
  type WikiAmendInput,
  type WikiAmendResult,
  type WikiAutosaveInput,
  type WikiAutosaveResult,
  type WikiCanvasMergeNotes,
  type WikiChangeRequest,
  type WikiChangeRequestDetail,
  WikiChangeRequestId,
  type WikiChangeRequestListInput,
  type WikiChangeRequestListResult,
  type WikiChangeRequestTarget,
  type WikiCheckoutTransformResult,
  type WikiCodeStatus,
  type WikiCodeStatusInput,
  type WikiCodeStatusResult,
  type WikiDraftMoveInput,
  type WikiMoveInput,
  type WikiDraftPromoteInput,
  WikiError,
  type WikiEvent,
  ProjectRootId,
  type WikiMapBackground,
  type WikiIndexResult,
  type WikiListFilesInput,
  type WikiListFilesResult,
  type WikiListResult,
  type WikiMergePreview,
  type WikiNoteResult,
  type WikiPullRequestLink,
  type WikiQueryInput,
  type WikiQueryResult,
  type WikiReadFilesInput,
  type WikiReadFilesResult,
  type WikiRevertInput,
  type WikiSetChangeRequestStatusInput,
  type WikiSummary,
  type WikiTransform,
  type WikiTransformInput,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { hostPreviewMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hash from "effect/Hash";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { isWithinRoot } from "../workspace/KnownWorkspaces.ts";
import * as ProjectRoots from "../workspace/ProjectRoots.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { parseWorktreeList } from "../worktrees/worktreeList.ts";
import { type PlainScan, plainScanFresh, scanPlainFolder } from "./plainFolder.ts";
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
  parseChangeList,
  parseTreeListing,
  EDIT_TIMES_DEPTH,
  EDIT_TIMES_FORMAT,
  advanceFileTimes,
  parseFileListing,
  parseFileTimes,
  parseTreeChanges,
  withRecordedMoves,
  type WikiFileTimes,
  parseMergeTree,
  type PendingCheckoutAmendment,
  PendingCheckoutAmendmentJson,
  type WikiMigration,
  WikiMigrationJson,
  WIKI_MIGRATION_FILE,
  type WikiRecord,
  wikiTerms,
} from "./wikiStorage.ts";
import {
  docPaths as docPathsOf,
  indexResult,
  linksResult,
  locateBase,
  noteResult,
  orientResult,
  type WikiLinksResult,
  type WikiOrientResult,
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

/**
 * Where a read comes from: a named change request's head, else `checkout` on disk, else the
 * thread's own open change request on that root, else the main line. A folder without Git is
 * read on disk.
 */
export interface WikiReadTarget {
  readonly wikiId: ProjectRootId;
  readonly changeRequestId?: WikiChangeRequestId | undefined;
  readonly threadId?: ThreadId | undefined;
  /** The root's own folder or one of its worktrees, read as its files stand. */
  readonly checkout?: string | undefined;
}

/** One root of a project as a call across its roots reads it: in `checkout`, as its files stand. */
export interface ProjectRootRead {
  /** What its addresses and links name it by. */
  readonly key: string;
  readonly wikiId: ProjectRootId;
  /** The root's own folder or one of its worktrees. */
  readonly checkout: string;
  readonly writable: boolean;
}

/** A rename across a project's roots: each root it wrote, the moving one first, and each it may not. */
export interface ProjectRenameResult {
  readonly changed: ReadonlyArray<WikiCheckoutTransformResult & { readonly root: string }>;
  /** Roots whose links led to what moved, with the files that keep them. */
  readonly unchanged: ReadonlyArray<{
    readonly root: string;
    readonly files: ReadonlyArray<string>;
  }>;
}

/** What the code index knows of a wiki's code files at one commit. */
export type CodeFacts =
  | { readonly state: "off" }
  | { readonly state: "building" }
  | { readonly state: "ready"; readonly files: ReadonlyMap<string, CodeFile> };

export type CodeFactsSource = (input: {
  readonly root: string;
  readonly commit: string;
}) => Effect.Effect<CodeFacts, CodeIndexError>;

const CODE_BUILDING =
  "The code index is still reading this repository, so its code files show only their file fields.";

export class WikiService extends Context.Service<
  WikiService,
  {
    readonly list: Effect.Effect<WikiListResult, WikiError>;
    /**
     * Astrolabe: where bases read code files' facts. The code index hands itself over as it
     * starts; without one, as in most tests, code files keep their file fields only.
     */
    readonly useCodeFacts: (source: CodeFactsSource) => Effect.Effect<void>;
    /** Every change to any wiki, so open views know to read again. */
    readonly subscribe: Stream.Stream<WikiEvent>;
    /** The folder holding a wiki's main line, the repository its worktrees belong to. */
    readonly root: (wikiId: ProjectRootId) => Effect.Effect<string, WikiError>;
    readonly index: (input: WikiReadTarget) => Effect.Effect<WikiIndexResult, WikiError>;
    /**
     * Astrolabe: what the Projects tree's Docs filter keeps of `checkout` (the root's own folder
     * when absent), read on disk: `docPaths` of the root and of the project's roots inside it.
     */
    readonly docPaths: (input: {
      readonly wikiId: ProjectRootId;
      readonly checkout?: string;
    }) => Effect.Effect<ReadonlyArray<string>, WikiError>;
    readonly readNote: (
      input: WikiReadTarget & { readonly name: string },
    ) => Effect.Effect<WikiNoteResult, WikiError>;
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
    readonly listFiles: (
      input: WikiListFilesInput,
    ) => Effect.Effect<WikiListFilesResult, WikiError>;
    /** Where to read a file's bytes, once it is known to exist at that commit. */
    readonly locateFile: (input: {
      readonly wikiId: string;
      readonly changeRequestId?: string;
      readonly commit?: string;
      readonly path: string;
      readonly from?: string | undefined;
    }) => Effect.Effect<
      { readonly root: string; readonly commit: string; readonly path: string },
      WikiError
    >;
    /** How code cards' pinned files compare with their project's head. */
    readonly codeStatus: (
      input: WikiCodeStatusInput,
    ) => Effect.Effect<WikiCodeStatusResult, WikiError>;
    /** A draft lists only for the `viewer` who wrote it; with no viewer, none do. */
    readonly changeRequestsList: (
      input: WikiChangeRequestListInput,
      viewer?: WikiAuthor,
    ) => Effect.Effect<WikiChangeRequestListResult, WikiError>;
    /** A change request in review form: what it changes, whether it merges, what it breaks. */
    readonly changeRequestsGet: (
      input: WikiReadTarget,
    ) => Effect.Effect<WikiChangeRequestDetail, WikiError>;
    /**
     * Lands one amendment on a change request: the named one, else the author's thread's open one,
     * else a new one titled `title` or the message's first line.
     */
    readonly amend: (
      input: WikiAmendInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult, WikiError>;
    /** Lands as an amendment; never on disk, whatever `checkout` says. */
    readonly transform: (
      input: WikiTransformInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult, WikiError>;
    /**
     * A transform written uncommitted on disk: in `checkout`, in a folder without Git, or in the
     * agent's thread's checkout of the wiki (for the turn's save to land) when it has one and
     * names no change request. Otherwise as `transform`.
     */
    readonly transformCheckout: (
      input: WikiTransformInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult | WikiCheckoutTransformResult, WikiError>;
    /** Every root's index as its checkout stands, by key: what links across the roots resolve over. */
    readonly projectIndex: (
      roots: ReadonlyArray<ProjectRootRead>,
    ) => Effect.Effect<ProjectIndex, WikiError>;
    /**
     * A rename in `root`'s checkout, uncommitted, with the links to what moved rewritten in every
     * other root's; a root that isn't writable keeps its links and is reported.
     */
    readonly projectRename: (input: {
      readonly roots: ReadonlyArray<ProjectRootRead>;
      readonly root: string;
      readonly transform: Extract<WikiTransform, { readonly kind: "rename" }>;
    }) => Effect.Effect<ProjectRenameResult, WikiError>;
    /**
     * A person's edit landing by itself: in the change request named, else the author's draft,
     * starting one on the first edit. Saves of one document in a run replace each other.
     */
    readonly autosave: (
      input: WikiAutosaveInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAutosaveResult, WikiError>;
    /** Makes a draft an ordinary change request, under a title of the person's. */
    readonly draftPromote: (
      input: WikiDraftPromoteInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /**
     * Merges some or all of a draft into an open change request as one amendment, which is
     * returned. Moving everything closes the draft; otherwise those files go back to its base.
     */
    readonly draftMove: (
      input: WikiDraftMoveInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /**
     * Moves a document or a folder as one amendment, in the person's draft or the change request
     * named, with every link that led to what moved following it.
     */
    readonly move: (
      input: WikiMoveInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAutosaveResult, WikiError>;
    /** Undoes one amendment with a new one, keeping later independent work. */
    readonly revertAmendment: (
      input: WikiRevertInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult, WikiError>;
    readonly setChangeRequestStatus: (
      input: WikiSetChangeRequestStatusInput,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    readonly get: (wikiId: ProjectRootId) => Effect.Effect<WikiSummary, WikiError>;
    /** Records where each registered wiki went: old ids resolve to those project roots from then on. */
    readonly recordMigration: (migration: WikiMigration) => Effect.Effect<void, WikiError>;
    /**
     * Fetches the host into its tracking refs and moves each open change request onto what the
     * host holds when that only adds to it. The folder's own branches, main among them, stay put.
     */
    readonly syncFromHost: (wikiId: ProjectRootId) => Effect.Effect<void, WikiError>;
    /** Pushes a change request's branch without force; a host that moved refuses it. */
    readonly pushChangeRequest: (
      input: WikiChangeRequestTarget,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /** Merges the host's copy of a change request into this one, when both have moved. */
    readonly adoptHostBranch: (
      input: WikiChangeRequestTarget,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /** Merges main into a change request with the markdown merge, so the host merges it cleanly. */
    readonly reconcileChangeRequest: (
      input: WikiChangeRequestTarget,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /** One change request, without reading the rest of the wiki's. */
    readonly changeRequest: (
      input: WikiChangeRequestTarget,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    readonly recordPullRequest: (
      input: WikiChangeRequestTarget & { readonly pullRequest: WikiPullRequestLink },
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
  }
>()("t3/wiki/WikiService") {}

/** The most rows a base query returns, for a view and for an agent's context alike. */
const QUERY_ROWS = 200;

/** How long after a person's last save of a document the next one still replaces it. */
const AUTOSAVE_RUN_MS = 10 * 60 * 1000;

const NOTHING_CHANGED = "This amendment changes nothing.";

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
  /** Every file that isn't a document. */
  readonly others: ReadonlyArray<WikiBlob>;
}

/** Documents read from a folder on disk as its files stand. */
interface DiskRead {
  /** The checkout's HEAD; for a folder without Git, a digest of what was read. */
  readonly commit: string;
  readonly snapshot: Snapshot;
  /** Documents on disk that differ from `commit`; none for a folder without Git. */
  readonly changes: WikiChanges;
  /** A folder without Git: its files and their times on disk. */
  readonly plain: {
    readonly scan: PlainScan;
    readonly listing: FileListing;
    readonly times: WikiFileTimes;
  } | null;
}

/** What git's pathspecs match of a document, at any depth. */
const DOCUMENT_PATHSPECS = ["*.md", "*.base", "*.canvas"] as const;

interface ChangedFiles {
  readonly files: ReadonlyArray<string>;
  readonly moves: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

/** A blob to write at each path, or null to delete it: a file no text could carry. */
type BlobChanges = Readonly<Record<string, string | null>>;

interface CarriedBlobs {
  readonly blobs?: BlobChanges;
}

/** Files on their way between commits. Bytes that aren't a document only travel as blobs. */
interface CarriedFiles {
  readonly changes: WikiChanges;
  readonly blobs: BlobChanges;
}

const carriedNames = ({ changes, blobs }: CarriedFiles) => [
  ...Object.keys(changes),
  ...Object.keys(blobs),
];

interface FileListing {
  readonly entries: ReturnType<typeof parseFileListing>;
  readonly byFile: ReadonlyMap<string, ReturnType<typeof parseFileListing>[number]>;
  readonly links: WikiLinkFiles;
}

/** The file a path means in a wiki, as a link written in `from` would mean it. */
const listedFile = (listing: FileListing, path: string, from: string | null = null) => {
  const { file } = resolveLink(path, from, listing.links);
  return file === null ? undefined : listing.byFile.get(file);
};

interface StoredChangeRequest {
  readonly record: ChangeRequestRecord;
  readonly metadataCommit: string;
  readonly head: string;
}

/** A person's way out of a canvas conflict. An agent changes the clashing cards with a transform. */
const settleInWorktree = (noun: string) =>
  `A canvas is settled in the ${noun}'s worktree: edit it there so the clashing cards agree with main, save the edits to the ${noun}, then merge again.`;

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

const isMediaFile = (file: string) => {
  const mime = hostPreviewMimeTypeFromExtension(/\.[^./]+$/.exec(file)?.[0] ?? "");
  return mime !== null && /^(image|audio|video|font)\/|\/pdf$/.test(mime) && !mime.includes("svg");
};

const decodeMigration = Schema.decodeEffect(WikiMigrationJson);
const encodeMigration = Schema.encodeEffect(WikiMigrationJson);
const decodeChangeRequest = Schema.decodeEffect(ChangeRequestRecordJson);
const encodeChangeRequest = Schema.encodeEffect(ChangeRequestRecordJson);

const isWikiError = Schema.is(WikiError);
const decodePending = Schema.decodeEffect(PendingCheckoutAmendmentJson);
const encodePending = Schema.encodeEffect(PendingCheckoutAmendmentJson);

/** Moves after `earlier` ones: a file moved twice moved once, from where it was to where it is. */
const chainMoves = (earlier: ReadonlyArray<WikiMove>, later: ReadonlyArray<WikiMove>) => {
  const moves = [...earlier];
  for (const { from, to } of later) {
    const position = moves.findIndex((move) => move.to === from);
    if (position === -1) moves.push({ from, to });
    else moves[position] = { from: moves[position]!.from, to };
  }
  return moves;
};

const oneLine = (text: string) => text.replace(/[\r\n<>]+/g, " ").trim();

const actorName = (author: WikiAuthor) => oneLine(author.actor) || "Agent";

/** A visible path, and never a document: those go through a skill map's checks. */
const isAttachmentName = (file: string) =>
  isWikiPath(file) && !isHidden(file) && !isWikiDocument(file);

/** A document as an amendment names it: its name, without the extension a person never reads. */
const documentSubject = (document: string) =>
  document.slice(document.lastIndexOf("/") + 1).replace(/\.(md|base|canvas)$/i, "");

const moveSubject = (from: string, to: string) => {
  if (folderOf(from) === folderOf(to)) {
    return `Rename ${documentSubject(from)} to ${documentSubject(to)}`;
  }
  return `Move ${documentSubject(from)} to ${folderOf(to) || "the root"}`;
};

const isCommitId = (value: string) => /^[0-9a-f]{4,64}$/i.test(value);

const subjectOf = (message: string) => {
  const subject = message.trim().split("\n")[0]?.trim() ?? "";
  return subject.length > 120 ? `${subject.slice(0, 117)}...` : subject;
};

/** The core's own validation messages are what an author needs to fix the amendment. */
const planningError = (cause: unknown) =>
  new WikiError({
    reason: "invalid",
    message:
      cause instanceof AmendmentError || cause instanceof WikiFormatError
        ? cause.message
        : "The amendment could not be planned.",
    cause,
  });

/** Adds the wiki (and change request) a failure happened in, keeping everything else. */
const inWiki =
  (wikiId: ProjectRootId, changeRequestId?: WikiChangeRequestId) =>
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
  const random = yield* SecureRandom.SecureRandom;
  const projects = yield* ProjectService.ProjectService;
  const projectRootFolders = yield* ProjectRoots.ProjectRoots;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const events = yield* PubSub.sliding<WikiEvent>(256);
  const migrationPath = path.join(config.stateDir, WIKI_MIGRATION_FILE);
  const migrationLock = yield* Semaphore.make(1);
  const migrationCache = yield* Ref.make<WikiMigration | undefined>(undefined);
  const wikiLocks = new Map<string, Semaphore.Semaphore>();
  const fetchLocks = new Map<string, Semaphore.Semaphore>();
  const snapshots = lru<Snapshot>(24);
  const amendmentLogs = lru<WikiChangeRequest["amendments"]>(128);
  const changedFiles = lru<ChangedFiles>(128);
  const metadataRecords = lru<ChangeRequestRecord>(512);
  const editTimes = lru<WikiFileTimes>(24);
  const corpora = lru<{
    readonly corpus: BaseCorpus;
    readonly code: ReadonlyMap<string, CodeFile> | undefined;
  }>(8);
  const codeFacts = yield* Ref.make<CodeFactsSource | null>(null);
  const corpusLocks = new Map<string, Semaphore.Semaphore>();
  const fileListings = lru<FileListing>(8);
  // By folder: a disk read is reused while what decides it (git's status, the files' times) holds.
  const checkoutReads = lru<{ readonly key: string; readonly read: DiskRead }>(8);
  const plainReads = lru<DiskRead>(8);
  // A change request's every read asks for its preview, and a canvas's merge reads three blobs.
  const mergePreviews = lru<WikiTreeMerge>(64);

  const newId = random.uuidV4().pipe(Effect.map((uuid) => uuid.replaceAll("-", "").slice(0, 12)));
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const publish = (
    kind: WikiEvent["kind"],
    wikiId: ProjectRootId,
    changeRequestId: string | null,
  ) =>
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
    const tree = parseTreeListing(
      (yield* runGit("lsTree", wiki.root, ["ls-tree", "-r", "-z", treeish])).stdout,
    );
    const listing = tree.filter((entry) => isWikiDocument(entry.file));
    const others = tree.filter((entry) => !isWikiDocument(entry.file));
    const contents = yield* readObjects(
      wiki.root,
      listing.map((entry) => entry.oid),
    );
    const files: Record<string, string> = {};
    listing.forEach((entry, position) => {
      files[entry.file] = contents[position] ?? "";
    });
    const index = yield* Effect.try({
      try: () =>
        indexFiles(
          files,
          others.map((entry) => entry.file),
        ),
      catch: planningError,
    });
    const snapshot: Snapshot = { files, index, others };
    snapshots.set(treeish, snapshot);
    return snapshot;
  });

  /** A tree of `base` with `changes` applied, built on a private index. */
  const buildTree = (
    cwd: string,
    base: string,
    changes: WikiChanges,
    attachment?: WikiAttachment,
    blobs: BlobChanges = {},
  ) =>
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
        const entries: ReadonlyArray<readonly [string, string | Uint8Array | null]> = [
          ...Object.entries(changes),
          ...(attachment === undefined ? [] : [[attachment.file, attachment.bytes] as const]),
        ];
        const written = entries.filter(
          (entry): entry is readonly [string, string | Uint8Array] => entry[1] !== null,
        );
        const blobPaths = written.map((_, position) => path.join(directory, `blob-${position}`));
        yield* Effect.forEach(written, ([, content], position) =>
          typeof content === "string"
            ? fileSystem.writeFileString(blobPaths[position] ?? "", content)
            : fileSystem.writeFile(blobPaths[position] ?? "", content),
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
        const hashed = new Map(written.map(([file], position) => [file, oids[position] ?? ""]));
        const zero = "0".repeat(base.length);
        const info = [
          ...entries.map(([file, content]): readonly [string, string | null | undefined] => [
            file,
            content === null ? null : hashed.get(file),
          ]),
          ...Object.entries(blobs),
        ]
          .map(([file, oid]) => (oid === null ? `0 ${zero}\t${file}` : `100644 ${oid}\t${file}`))
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
                message: "The wiki moved while this ran. Read it again and retry.",
                cause: new WikiGitExitError({
                  operation: "updateRefs",
                  exitCode: result.exitCode,
                  stderr: result.stderr,
                }),
              }),
            ),
      ),
    );

  const migrationError = (cause: unknown) =>
    new WikiError({
      reason: "invalid",
      message: "The record of where registered wikis went could not be read or written.",
      cause,
    });

  const loadMigration = Effect.gen(function* () {
    const cached = yield* Ref.get(migrationCache);
    if (cached !== undefined) return cached;
    const exists = yield* fileSystem.exists(migrationPath).pipe(Effect.mapError(migrationError));
    const migration: WikiMigration = exists
      ? yield* fileSystem
          .readFileString(migrationPath)
          .pipe(Effect.flatMap(decodeMigration), Effect.mapError(migrationError))
      : { version: 1, wikis: {}, droppedMirrors: [] };
    yield* Ref.set(migrationCache, migration);
    return migration;
  });

  const recordMigration: WikiService["Service"]["recordMigration"] = (migration) =>
    migrationLock.withPermits(1)(
      Effect.gen(function* () {
        const contents = yield* encodeMigration(migration).pipe(Effect.mapError(migrationError));
        yield* writeFileStringAtomically({
          filePath: migrationPath,
          contents: `${contents}\n`,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.mapError(migrationError),
        );
        yield* Ref.set(migrationCache, migration);
      }),
    );

  const trackedHostRoot = (remote: string) => `refs/wiki/host/${remote}/`;

  /** A repository's main line: its host's default branch, else the branch its folder has out. */
  const defaultBranch = Effect.fn("WikiService.defaultBranch")(function* (
    root: string,
    remote: string,
  ) {
    const named = yield* git
      .resolveDefaultBranchName(root, remote)
      .pipe(Effect.orElseSucceed(() => null));
    if (named !== null) return named;
    const head = yield* gitOut("headBranch", root, ["symbolic-ref", "-q", "--short", "HEAD"], {
      allowExitCodes: [1, 128],
    }).pipe(Effect.orElseSucceed(() => ""));
    return head || "main";
  });

  /**
   * A folder of a project, as a wiki whose host is the folder's remote. A folder without Git has
   * no host or main line, and is read on disk.
   */
  const rootRecord = Effect.fn("WikiService.rootRecord")(function* (
    project: { readonly id: ProjectId; readonly title: string; readonly createdAt: IsoDateTime },
    root: ProjectRoot,
  ) {
    const folder = yield* fileSystem
      .realPath(root.path)
      .pipe(Effect.orElseSucceed(() => root.path));
    const named = {
      wikiId: projectRootId(project.id, root.key),
      projectId: project.id,
      rootKey: root.key,
      name: root.kind === "workspace" ? project.title : root.name,
      root: folder,
      createdAt: project.createdAt,
      mapBackgrounds: yield* serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.wikiMapBackgrounds),
        Effect.orElseSucceed((): ReadonlyArray<WikiMapBackground> => []),
      ),
    };
    if (root.state === "plain") {
      const plain: WikiRecord = {
        ...named,
        mainBranch: "main",
        host: null,
        plain: true,
      };
      return plain;
    }
    const host = root.hostBacked ? yield* projectRootFolders.host(root.path) : null;
    const mainBranch = yield* defaultBranch(folder, host?.remote ?? "origin");
    const record: WikiRecord = {
      ...named,
      mainBranch,
      host:
        host === null
          ? null
          : {
              projectId: project.id,
              remote: host.remote,
              kind: host.kind,
              lastSyncedAt: null,
              // What the last fetch saw: a folder keeps no sync state of its own.
              lastSyncedCommit:
                (yield* revParse(folder, `${trackedHostRoot(host.remote)}${mainBranch}`)) ?? null,
              relation: null,
              lastError: null,
            },
    };
    return record;
  });

  const projectRootRecord = Effect.fn("WikiService.projectRootRecord")(function* (
    reference: string,
  ) {
    const parsed = parseProjectRootId(reference);
    if (parsed === null) return undefined;
    const project = yield* projects
      .getById(parsed.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project)) return undefined;
    const roots = yield* projectRootFolders
      .list(parsed.projectId)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<ProjectRoot> => []));
    const root = roots.find((candidate) => candidate.key === parsed.rootKey);
    if (root === undefined) return undefined;
    if (root.state === "missing") {
      return yield* new WikiError({
        reason: "not-found",
        message: `The folder ${root.path} is gone.`,
      });
    }
    return yield* rootRecord(project.value, root);
  });

  /** Every folder of every project that isn't archived, as wikis. */
  const projectRootRecords = Effect.gen(function* () {
    const shells = yield* projects
      .listShells()
      .pipe(
        Effect.mapError(
          (cause) =>
            new WikiError({ reason: "invalid", message: "Projects couldn't be read.", cause }),
        ),
      );
    const perProject = yield* Effect.forEach(
      shells.filter((shell) => shell.archivedAt == null),
      (shell) =>
        projectRootFolders.list(shell.id).pipe(
          Effect.flatMap((roots) =>
            Effect.forEach(
              roots.filter((root) => root.state !== "missing"),
              (root) => rootRecord(shell, root),
            ),
          ),
          // A project whose folders can't be read lists none, rather than hiding every other.
          Effect.orElseSucceed((): ReadonlyArray<WikiRecord> => []),
        ),
      { concurrency: 4 },
    );
    return perProject.flat();
  });

  /** A project's folder by its root id, or by the id it had as a registered wiki. */
  const lookup = Effect.fn("WikiService.lookup")(function* (reference: string) {
    const byRoot = yield* projectRootRecord(reference);
    if (byRoot !== undefined) return byRoot;
    const migrated = (yield* loadMigration).wikis[reference];
    if (migrated !== undefined) {
      const moved = yield* projectRootRecord(projectRootId(migrated.projectId, migrated.rootKey));
      if (moved !== undefined) return moved;
    }
    return yield* new WikiError({
      reason: "not-found",
      message: "No project has a folder with this id.",
    });
  });

  const withoutGit = (wiki: WikiRecord) =>
    new WikiError({
      reason: "invalid",
      message: `${wiki.root} is not a Git repository, so it has no change requests, drafts or history: its files are edited on disk.`,
    });

  /** Runs `body` against a known wiki, a folder without Git too, with failures naming it. */
  const withAnyWiki = <A>(
    reference: string,
    body: (wiki: WikiRecord) => Effect.Effect<A, WikiError>,
    changeRequestId?: WikiChangeRequestId,
  ) =>
    lookup(reference).pipe(
      Effect.flatMap((wiki) =>
        (wiki.plain ? Effect.void : requireGit).pipe(
          Effect.andThen(body(wiki)),
          Effect.mapError(inWiki(wiki.wikiId, changeRequestId)),
        ),
      ),
    );

  /** Runs `body` against a known wiki in Git, with git checked and failures naming the wiki. */
  const withWiki = <A>(
    reference: string,
    body: (wiki: WikiRecord) => Effect.Effect<A, WikiError>,
    changeRequestId?: WikiChangeRequestId,
  ) =>
    withAnyWiki(
      reference,
      (wiki) => (wiki.plain ? Effect.fail(withoutGit(wiki)) : body(wiki)),
      changeRequestId,
    );

  /** Serializes every write to one repository, whichever id named it. */
  const locked = <A, E, R>(wiki: WikiRecord, body: Effect.Effect<A, E, R>) => {
    let lock = wikiLocks.get(wiki.root);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      wikiLocks.set(wiki.root, lock);
    }
    return lock.withPermits(1)(body);
  };

  const mainRef = (wiki: WikiRecord) => `refs/heads/${wiki.mainBranch}`;

  /**
   * The main line change requests start from and merge into. A host-backed root's is the host's,
   * as the last fetch saw it: the folder's own main is the person's, and is never moved here.
   */
  const mainTip = (wiki: WikiRecord) =>
    (wiki.host?.lastSyncedCommit != null
      ? Effect.succeed<string | undefined>(wiki.host.lastSyncedCommit)
      : revParse(wiki.root, mainRef(wiki))
    ).pipe(
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
                message: `No ${wikiTerms(wiki).singular} has this id in this wiki.`,
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
      // Merging main in, here or on the host, is no amendment.
      "--no-merges",
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

  /** What changed from `from` to the head: what git sees, and the moves it can't. */
  const changeList = Effect.fn("WikiService.changeList")(function* (
    wiki: WikiRecord,
    stored: StoredChangeRequest,
    from: string,
  ) {
    const [diff, log] = yield* Effect.all(
      [
        runGit("changeList", wiki.root, [
          "diff",
          "--find-renames",
          "--name-status",
          "-z",
          from,
          stored.head,
        ]),
        runGit("recordedMoves", wiki.root, [
          "log",
          "--reverse",
          "--no-merges",
          `--format=${MOVES_LOG_FORMAT}`,
          `${stored.record.base}..${stored.head}`,
        ]),
      ],
      { concurrency: "unbounded" },
    );
    return withRecordedMoves(parseChangeList(diff.stdout), parseMoves(log.stdout));
  });

  const filesOf = Effect.fn("WikiService.filesOf")(function* (
    wiki: WikiRecord,
    stored: StoredChangeRequest,
  ) {
    const range = `${stored.record.base}..${stored.head}`;
    const cached = changedFiles.get(range);
    if (cached !== undefined) return cached;
    const listed = yield* changeList(wiki, stored, stored.record.base);
    // Both paths stay in `files`: whatever travels with a change request needs each.
    const changed: ChangedFiles = {
      files: [
        ...new Set(
          listed.flatMap(({ file, movedFrom }) =>
            movedFrom === undefined ? [file] : [movedFrom, file],
          ),
        ),
      ].toSorted(),
      moves: listed.flatMap(({ file, movedFrom }) =>
        movedFrom === undefined ? [] : [{ from: movedFrom, to: file }],
      ),
    };
    changedFiles.set(range, changed);
    return changed;
  });

  const view = (wiki: WikiRecord, stored: StoredChangeRequest) =>
    Effect.all([amendmentsOf(wiki, stored), filesOf(wiki, stored)]).pipe(
      Effect.map(([amendments, { files, moves }]): WikiChangeRequest => ({
        changeRequestId: stored.record.changeRequestId,
        wikiId: wiki.wikiId,
        title: stored.record.title,
        status: stored.record.status,
        draft: stored.record.draft,
        branch: stored.record.branch,
        base: stored.record.base,
        head: stored.head,
        threadId: stored.record.threadId,
        createdBy: stored.record.createdBy,
        createdAt: stored.record.createdAt,
        updatedAt: stored.record.updatedAt,
        mergedCommit: stored.record.mergedCommit,
        amendments,
        pullRequest: stored.record.pullRequest,
        pushedHead: stored.record.pushedHead,
        files,
        ...(moves.length === 0 ? {} : { moves }),
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
            message: `The ${wikiTerms(wiki).singular} could not be recorded.`,
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
            `Unsaved edits in this ${wikiTerms(wiki).singular}'s worktree overlap the amendment${
              paths.length ? `: ${paths.join(", ")}` : ""
            }. Save them to the ${wikiTerms(wiki).singular} or set them aside, then try again.`,
          stale: (rolledBack, cause) =>
            rolledBack && isWikiError(cause)
              ? cause
              : new WikiError({
                  reason: "stale",
                  message: `The ${wikiTerms(wiki).singular} moved while this ran and its worktree could not be put back; check its files.`,
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

  /** The draft `actor` has open on this wiki; there is at most one. */
  const openDraftOf = (wiki: WikiRecord, actor: string) =>
    readChangeRequests(wiki).pipe(
      Effect.map((all) =>
        all.find(
          ({ record }) => record.draft && record.status === "open" && record.createdBy === actor,
        ),
      ),
    );

  const refuseOthersDraft = (stored: StoredChangeRequest, author: WikiAuthor) =>
    stored.record.draft && stored.record.createdBy !== actorName(author)
      ? Effect.fail(
          new WikiError({
            reason: "invalid",
            message: "This is someone's draft, which only they can change.",
            changeRequestId: stored.record.changeRequestId,
          }),
        )
      : Effect.void;

  const requireOpen = (stored: StoredChangeRequest) =>
    stored.record.status === "open"
      ? Effect.void
      : Effect.fail(
          new WikiError({
            reason: "invalid",
            message: `This is ${stored.record.status}; reopen it or open a new one.`,
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
    withAnyWiki(
      target.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const folder = yield* diskFolder(wiki, target);
          if (folder !== null) {
            const { commit, snapshot } = yield* diskRead(wiki, folder);
            return read(wiki, commit, snapshot);
          }
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
        readonly draft: boolean;
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
      yield* refuseOthersDraft(stored, author);
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
      draft: false,
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
    plan: (
      files: WikiFiles,
      stamp: AmendmentStamp,
      others: ReadonlyArray<WikiBlob>,
    ) => PlannedAmendment & CarriedBlobs,
    options: {
      readonly reverts?: string;
      readonly follow?: boolean;
      /** The document, when this is a person's autosave. */
      readonly autosave?: string;
      /** Lands on this commit in place of the head, whose amendment this one replaces. */
      readonly onto?: string;
      /** Plans on `onto` too: a whole text replaces what the head's amendment did. */
      readonly planOnto?: boolean;
      /** The amendment id stamps already written in a checkout carry, and the ids they took. */
      readonly pending?: Pick<PendingCheckoutAmendment, "amendment" | "minted">;
    } = {},
  ) {
    const { reverts, follow = true, autosave, onto, planOnto = false, pending } = options;
    const now = yield* DateTime.now;
    const at = DateTime.formatIso(now);
    const amendment = pending?.amendment ?? (yield* newId);
    const env = identity(author.actor, now);
    const changeRequestId =
      target.kind === "existing" ? target.stored.record.changeRequestId : target.changeRequestId;
    const parent = target.kind === "existing" ? target.stored.head : target.base;
    const from = planOnto ? (onto ?? parent) : parent;
    const snapshot = yield* snapshotAt(wiki, from);
    let warnings = pending?.minted ?? 0;
    const stamp: AmendmentStamp = {
      amendment,
      at,
      newId: () => `${amendment}-${++warnings}`,
    };
    const planned = yield* Effect.try({
      try: () => plan(snapshot.files, stamp, snapshot.others),
      catch: planningError,
    });
    const tree = yield* buildTree(
      wiki.root,
      from,
      planned.changes,
      planned.attachment,
      planned.blobs,
    );
    const treeOf = (commit: string) =>
      gitOut("parentTree", wiki.root, ["rev-parse", `${commit}^{tree}`]);
    if (tree === (yield* treeOf(parent))) {
      return yield* new WikiError({ reason: "invalid", message: NOTHING_CHANGED });
    }
    // A run edited back to where it began leaves nothing to record.
    const commit =
      onto !== undefined && tree === (yield* treeOf(onto))
        ? onto
        : yield* commitTree(
            wiki.root,
            tree,
            [onto ?? parent],
            amendmentMessage(message, {
              amendment,
              actor: actorName(author),
              changeRequest: changeRequestId,
              ...(author.threadId === null ? {} : { thread: author.threadId }),
              ...(reverts === undefined ? {} : { reverts }),
              ...(autosave === undefined ? {} : { autosave }),
              ...(planned.moved === undefined ? {} : { moved: planned.moved }),
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
              draft: target.draft,
              branch: changeRequestBranch(changeRequestId),
              base: target.base,
              threadId: author.threadId,
              createdBy: actorName(author),
              createdAt: at,
              updatedAt: at,
              mergedCommit: null,
              pullRequest: null,
              pushedHead: null,
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
      ...(planned.attachment === undefined ? {} : { attachment: planned.attachment.file }),
    } satisfies WikiAmendResult;
  });

  const amendWith = (
    input: WikiAmendInput | WikiTransformInput,
    author: WikiAuthor,
    plan: (
      files: WikiFiles,
      stamp: AmendmentStamp,
      others: ReadonlyArray<WikiBlob>,
    ) => PlannedAmendment & CarriedBlobs,
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
          message: `${canvas} is a canvas, which is never written whole. Change it with a "canvas" transform: say what is on it, and it is placed for you.`,
          wikiId: input.wikiId,
        }),
      );
    }
    return amendWith(input, author, (files, stamp) => planAmendment(files, input.changes, stamp));
  };

  /** A move adds no edge, so an edge that stood unsupported before only comes along. */
  const planMoved = (
    files: WikiFiles,
    stamp: AmendmentStamp,
    { changes, blobs, moved }: PlannedMove,
  ) => ({
    ...(Object.keys(changes).length === 0
      ? { changes, errors: [] }
      : planAmendment(files, changes, stamp, { allowUnstamped: true })),
    blobs,
    moved,
  });

  const planWikiTransform =
    (change: WikiTransform) =>
    (
      files: WikiFiles,
      stamp: AmendmentStamp,
      others: ReadonlyArray<WikiBlob>,
    ): PlannedAmendment & CarriedBlobs => {
      if (change.kind === "rename") {
        return planMoved(files, stamp, planMove(files, others, change));
      }
      if (change.kind !== "canvas") {
        return planAmendment(files, planTransform(files, change, stamp), stamp);
      }
      const { file, changes, cards, notes } = planCanvasEdits(files, change, stamp);
      const canvas = { file, cards, ...(notes.length > 0 ? { notes } : {}) };
      return { ...planAmendment(files, changes, stamp), canvas };
    };

  const transform: WikiService["Service"]["transform"] = (input, author) =>
    amendWith(input, author, planWikiTransform(input.transform));

  /** Where an autosave lands: the change request named, else the author's draft, else a new one. */
  const autosaveTarget = Effect.fn("WikiService.autosaveTarget")(function* (
    wiki: WikiRecord,
    input: WikiAutosaveInput,
    author: WikiAuthor,
  ): Effect.fn.Return<Target, WikiError> {
    if (input.changeRequestId !== undefined) {
      const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
      yield* requireOpen(stored);
      yield* refuseOthersDraft(stored, author);
      return { kind: "existing", stored };
    }
    const own = yield* openDraftOf(wiki, actorName(author));
    if (own !== undefined) return { kind: "existing", stored: own };
    const main = yield* mainTip(wiki);
    const read = input.write.kind === "text" ? input.write.readAt : undefined;
    // Started from what the person read, so a merge keeps whatever main gained since.
    const base =
      read !== undefined &&
      isCommitId(read) &&
      (yield* revParse(wiki.root, read)) !== undefined &&
      (yield* isAncestor(wiki.root, read, main))
        ? read
        : main;
    return {
      kind: "new",
      changeRequestId: WikiChangeRequestId.make(yield* newId),
      base,
      title: `Edit ${documentSubject(input.document)}`,
      draft: true,
    };
  });

  /**
   * A draft takes in what reached main at each save, so it can hold any document its person opens,
   * including one newer than the draft. A clash stays where it is, to settle before merging.
   */
  const followMain = Effect.fn("WikiService.followMain")(function* (
    wiki: WikiRecord,
    stored: StoredChangeRequest,
    document: string,
    author: WikiAuthor,
  ) {
    const main = yield* mainTip(wiki);
    if (yield* isAncestor(wiki.root, main, stored.head)) return stored;
    const { tree, conflicts } = yield* mergeIntoMain(wiki, main, stored.head);
    if (tree === null) {
      const [held, onMain] = yield* readObjects(wiki.root, [
        `${stored.head}:${document}`,
        `${main}:${document}`,
      ]);
      if (typeof held === "string" || typeof onMain !== "string") return stored;
      return yield* new WikiError({
        reason: "conflict",
        message: `Your draft clashes with main in ${conflicts.join(", ")}, so ${documentSubject(document)} can't join it yet. Make the draft a ${wikiTerms(wiki).singular} and settle that first.`,
      });
    }
    const now = yield* DateTime.now;
    const env = identity(author.actor, now);
    const message = "Follow main";
    const commit = yield* commitTree(wiki.root, tree, [stored.head, main], message, env);
    return yield* recordChangeRequest(
      wiki,
      stored,
      { ...stored.record, base: main, updatedAt: DateTime.formatIso(now) },
      message,
      env,
      commit,
    ).pipe(
      // A view reading main hears it moved, which an outside commit doesn't tell it.
      Effect.tap(() => publish("main-moved", wiki.wikiId, null)),
      // A worktree with unsaved edits holds the branch, which can move once they're in.
      Effect.catchIf(
        (error) => error.reason === "checkout-busy",
        () => Effect.succeed(stored),
      ),
    );
  });

  /**
   * Refuses whole text from a client that hasn't seen what another device saved of this document,
   * which would overwrite it. The client's read brings that work into its buffer, and it retries.
   * A document this change request hasn't touched has nothing to overwrite, unless it's a draft
   * that has taken in a newer copy from main.
   */
  const requireInStep = Effect.fn("WikiService.requireInStep")(function* (
    wiki: WikiRecord,
    stored: StoredChangeRequest,
    file: string,
    readAt: string,
  ) {
    if (readAt === stored.head) return;
    const [atHead, atRead, atBase] = yield* readObjects(wiki.root, [
      `${stored.head}:${file}`,
      ...(isCommitId(readAt) ? [`${readAt}:${file}`] : ["0000:missing"]),
      `${stored.record.base}:${file}`,
    ]);
    if (atHead === atRead) return;
    const followed =
      stored.record.draft &&
      isCommitId(readAt) &&
      (yield* isAncestor(wiki.root, yield* mainTip(wiki), stored.head));
    if (atHead === atBase && !followed) return;
    return yield* new WikiError({
      reason: "stale",
      message: `${documentSubject(file)} changed on another device. It saves again once that arrives.`,
    });
  });

  /** The commit this save lands on, when it continues the run the head's amendment belongs to. */
  const autosaveRunParent = Effect.fn("WikiService.autosaveRunParent")(function* (
    wiki: WikiRecord,
    stored: StoredChangeRequest,
    document: string,
    author: WikiAuthor,
  ) {
    const head = (yield* amendmentsOf(wiki, stored)).at(-1);
    if (head?.autosave !== document || head.actor !== actorName(author)) return undefined;
    if (head.commit !== stored.head) return undefined;
    // Rewriting a commit the host has would fork the branch from its copy there.
    if (stored.record.pushedHead === head.commit) return undefined;
    const now = yield* Clock.currentTimeMillis;
    if (now - Date.parse(head.at) >= AUTOSAVE_RUN_MS) return undefined;
    return yield* revParse(wiki.root, `${stored.head}^`);
  });

  /** The change request a person's edit lands on: their draft, caught up with main. */
  const draftTarget = Effect.fn("WikiService.draftTarget")(function* (
    wiki: WikiRecord,
    input: WikiAutosaveInput,
    author: WikiAuthor,
  ) {
    const found = yield* autosaveTarget(wiki, input, author);
    return found.kind === "existing" && found.stored.record.draft
      ? { ...found, stored: yield* followMain(wiki, found.stored, input.document, author) }
      : found;
  });

  /** A pasted file written into a checkout as it stands, uncommitted, under a free name. */
  const attachOnDisk = (input: WikiAutosaveInput, checkout: string) =>
    withAnyWiki(input.wikiId, (wiki) =>
      Effect.gen(function* () {
        const { write } = input;
        if (write.kind !== "attachment" || !isAttachmentName(write.file)) {
          return yield* new WikiError({
            reason: "invalid",
            message: "Only an attachment is written on disk this way.",
          });
        }
        const folder = yield* checkoutFolder(wiki, checkout);
        const directory = folderOf(write.file, "/");
        // Under the lease: two pastes in one second ask for one name.
        const file = yield* withWorkspaceLease(
          folder,
          Effect.gen(function* () {
            const beside = yield* fileSystem
              .readDirectory(path.join(folder, directory))
              .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
            const free = freePath(
              write.file,
              beside.map((name) => `${directory}${name}`),
            );
            const target = path.join(folder, free);
            yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
            yield* fileSystem.writeFile(
              target,
              new Uint8Array(Buffer.from(write.base64, "base64")),
            );
            return free;
          }),
        ).pipe(Effect.mapError(ioError(`Could not write ${write.file} into the checkout.`)));
        return { changeRequest: null, commit: null, attachment: file } satisfies WikiAutosaveResult;
      }),
    );

  const autosaveDraft: WikiService["Service"]["autosave"] = (input, author) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const target = yield* draftTarget(wiki, input, author);
            const { write } = input;
            const nothing =
              target.kind === "new"
                ? Effect.succeed<WikiAutosaveResult>({ changeRequest: null, commit: null })
                : Effect.map(view(wiki, target.stored), (changeRequest): WikiAutosaveResult => ({
                    changeRequest,
                    commit: target.stored.head,
                  }));
            if (write.kind === "text") {
              const head = target.kind === "new" ? target.base : target.stored.head;
              if ((yield* snapshotAt(wiki, head)).files[write.file] === write.text)
                return yield* nothing;
              if (write.readAt !== undefined && target.kind === "existing") {
                yield* requireInStep(wiki, target.stored, write.file, write.readAt);
              }
            }
            if (write.kind === "attachment" && !isAttachmentName(write.file)) {
              return yield* new WikiError({
                reason: "invalid",
                message: `${write.file} can't be attached to a wiki.`,
              });
            }
            const onto =
              target.kind === "existing"
                ? yield* autosaveRunParent(wiki, target.stored, input.document, author)
                : undefined;
            return yield* land(
              wiki,
              target,
              author,
              `Edit ${documentSubject(input.document)}`,
              write.kind === "text"
                ? (files, stamp) => planAmendment(files, { [write.file]: write.text }, stamp)
                : write.kind === "transform"
                  ? planWikiTransform(write.transform)
                  : (files, _stamp, others) => ({
                      changes: {},
                      errors: [],
                      attachment: {
                        // Here, under the lock: two pastes in one second ask for one name.
                        file: freePath(write.file, [
                          ...Object.keys(files),
                          ...others.map(({ file }) => file),
                        ]),
                        bytes: Buffer.from(write.base64, "base64"),
                      },
                    }),
              // A link broken for a moment while typing stamps no lasting warning on a map.
              {
                autosave: input.document,
                planOnto: write.kind === "text",
                ...(onto === undefined ? {} : { onto }),
              },
            ).pipe(
              Effect.map(({ changeRequest, commit, attachment }): WikiAutosaveResult => ({
                changeRequest,
                commit,
                ...(attachment === undefined ? {} : { attachment }),
              })),
              Effect.catchIf(
                (error) => error.message === NOTHING_CHANGED,
                () => nothing,
              ),
            );
          }),
        ),
      input.changeRequestId,
    );

  const autosave: WikiService["Service"]["autosave"] = (input, author) =>
    input.checkout !== undefined
      ? attachOnDisk(input, input.checkout)
      : autosaveDraft(input, author);

  const move: WikiService["Service"]["move"] = ({ folder, from, to, ...input }, author) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const target = yield* draftTarget(
              wiki,
              {
                ...input,
                document: from,
                write: { kind: "transform", transform: { kind: "rename", from, to } },
              },
              author,
            );
            const { changeRequest, commit } = yield* land(
              wiki,
              target,
              author,
              moveSubject(from, to),
              planWikiTransform({ kind: "rename", from: `/${from}`, to: `/${to}`, folder }),
            );
            return { changeRequest, commit } satisfies WikiAutosaveResult;
          }),
        ),
      input.changeRequestId,
    );

  /** The open draft `changeRequestId` names, which must be the author's. */
  const loadOwnDraft = Effect.fn("WikiService.loadOwnDraft")(function* (
    wiki: WikiRecord,
    changeRequestId: WikiChangeRequestId,
    author: WikiAuthor,
  ) {
    const stored = yield* loadChangeRequest(wiki, changeRequestId);
    yield* requireOpen(stored);
    yield* refuseOthersDraft(stored, author);
    if (stored.record.draft) return stored;
    return yield* new WikiError({
      reason: "invalid",
      message: `This ${wikiTerms(wiki).singular} isn't a draft.`,
      changeRequestId,
    });
  });

  const draftPromote: WikiService["Service"]["draftPromote"] = (input, author) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const stored = yield* loadOwnDraft(wiki, input.changeRequestId, author);
            const now = yield* DateTime.now;
            const next = yield* recordChangeRequest(
              wiki,
              stored,
              {
                ...stored.record,
                draft: false,
                title: input.title,
                updatedAt: DateTime.formatIso(now),
              },
              "Make draft a change request",
              identity(author.actor, now),
            );
            yield* publish("status", wiki.wikiId, input.changeRequestId);
            return yield* view(wiki, next);
          }),
        ),
      input.changeRequestId,
    );

  /** `names` as they stand at `commit`: documents by their text, the rest by their blobs. */
  const filesAt = Effect.fn("WikiService.filesAt")(function* (
    wiki: WikiRecord,
    commit: string,
    names: ReadonlyArray<string>,
  ) {
    const documents = names.filter(isWikiDocument);
    const others = names.filter((name) => !isWikiDocument(name));
    const contents = yield* readObjects(
      wiki.root,
      documents.map((name) => `${commit}:${name}`),
    );
    const oids =
      others.length === 0
        ? []
        : yield* blobIds(
            wiki.root,
            others.map((name) => `${commit}:${name}`),
          );
    const carried: CarriedFiles = {
      changes: Object.fromEntries(
        documents.map((name, position) => [name, contents[position] ?? null]),
      ),
      blobs: Object.fromEntries(others.map((name, position) => [name, oids[position] ?? null])),
    };
    return carried;
  });

  /** What `to` changes from `from`, by file. */
  const changesBetween = Effect.fn("WikiService.changesBetween")(function* (
    wiki: WikiRecord,
    from: string,
    to: string,
  ) {
    const names = (yield* runGit("diffNames", wiki.root, [
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      from,
      to,
    ])).stdout
      .split("\0")
      .filter(Boolean);
    return yield* filesAt(wiki, to, names);
  });

  /** Lands files already carried from elsewhere; a warning they drop from a map stays on it. */
  const planCarried =
    ({ changes, blobs }: CarriedFiles, moved: ReadonlyArray<WikiMove> = []) =>
    (files: WikiFiles, stamp: AmendmentStamp) => {
      const planned =
        Object.keys(changes).length === 0
          ? { changes, errors: [] }
          : planAmendment(files, keepWarningHistory(files, changes), stamp, {
              allowUnstamped: true,
            });
      return { ...planned, blobs, moved };
    };

  const draftMove: WikiService["Service"]["draftMove"] = (input, author) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const draft = yield* loadOwnDraft(wiki, input.changeRequestId, author);
            const target = yield* loadChangeRequest(wiki, input.to);
            yield* requireOpen(target);
            if (target.record.draft) {
              return yield* new WikiError({
                reason: "invalid",
                message: `A draft moves into a ${wikiTerms(wiki).singular}, not another draft.`,
              });
            }
            const { base } = draft.record;
            const held = yield* changesBetween(wiki, base, draft.head);
            const inDraft = carriedNames(held);
            const files = inDraft.filter(
              (file) => input.files === undefined || input.files.includes(file),
            );
            if (files.length === 0) {
              return yield* new WikiError({
                reason: "invalid",
                message: "None of those documents are in this draft.",
              });
            }
            const now = yield* DateTime.now;
            const env = identity(author.actor, now);
            // Only what moves, on what the two share: a draft that followed main is ahead of the
            // target, and its base would bring all of that along.
            const shared =
              (yield* runGit("mergeBase", wiki.root, ["merge-base", base, target.head], {
                allowExitCodes: [1],
              })).stdout.trim() || base;
            const moving = yield* filesAt(wiki, draft.head, files);
            const carrier = yield* commitTree(
              wiki.root,
              yield* buildTree(wiki.root, shared, moving.changes, undefined, moving.blobs),
              [shared],
              "Temporary draft carrier",
              env,
            );
            const { tree, conflicts } = yield* mergeTrees(wiki, target.head, carrier, {
              notes: true,
            });
            if (tree === null) {
              return yield* new WikiError({
                reason: "conflict",
                message: `This draft conflicts with that ${wikiTerms(wiki).singular} in ${conflicts.join(", ") || "some files"}. Nothing was moved.`,
              });
            }
            const merged = yield* changesBetween(wiki, target.head, tree);
            const first = documentSubject(files[0] ?? "");
            const moves = (yield* filesOf(wiki, draft)).moves.filter(
              ({ from, to }) => files.includes(from) && files.includes(to),
            );
            const moved =
              carriedNames(merged).length === 0
                ? yield* view(wiki, target)
                : (yield* land(
                    wiki,
                    { kind: "existing", stored: target },
                    author,
                    files.length === 1
                      ? `Move ${first} from a draft`
                      : `Move ${files.length} documents from a draft`,
                    planCarried(merged, moves),
                  )).changeRequest;
            if (files.length === inDraft.length) {
              yield* recordChangeRequest(
                wiki,
                draft,
                { ...draft.record, status: "closed", updatedAt: DateTime.formatIso(now) },
                "Close draft",
                env,
              );
              yield* publish("status", wiki.wikiId, input.changeRequestId);
              return moved;
            }
            yield* land(
              wiki,
              { kind: "existing", stored: draft },
              author,
              `Move ${files.length === 1 ? first : `${files.length} documents`} to ${target.record.title}`,
              planCarried(yield* filesAt(wiki, base, files)),
            );
            return moved;
          }),
        ),
      input.changeRequestId,
    );

  const revertAmendment: WikiService["Service"]["revertAmendment"] = (input, author) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            yield* requireOpen(stored);
            yield* refuseOthersDraft(stored, author);
            const notAmendment = new WikiError({
              reason: "invalid",
              message: `That commit is not an amendment on this ${wikiTerms(wiki).singular}.`,
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
                  ? `This amendment overlaps later work in the ${wikiTerms(wiki).singular}, in ${merged.conflicts.join(", ")}. ${settleInWorktree(wikiTerms(wiki).singular)}`
                  : `This amendment overlaps later work in the ${wikiTerms(wiki).singular}; reconcile it with a new amendment instead.`,
              });
            }
            const { tree, canvases } = merged;
            const inverseChanges = yield* changesBetween(wiki, stored.head, tree);
            const undone = parseMoves(
              yield* gitOut("revertedMoves", wiki.root, [
                "log",
                "-1",
                `--format=${MOVES_LOG_FORMAT}`,
                commit,
              ]),
            );
            const subject = (yield* amendmentsOf(wiki, stored)).find(
              (amendment) => amendment.commit === commit,
            )?.subject;
            const landed = yield* land(
              wiki,
              { kind: "existing", stored },
              author,
              `Revert "${subject ?? commit.slice(0, 12)}"`,
              // Warning history survives the inverse; resolving a warning is its own amendment.
              planCarried(
                inverseChanges,
                undone.toReversed().map(({ from, to }) => ({ from: to, to: from })),
              ),
              { reverts: commit },
            );
            return canvases.length > 0 ? { ...landed, canvases } : landed;
          }),
        ),
      input.changeRequestId,
    );

  /**
   * A checkout's unsaved edits: documents by text and, with `attachments`, other visible files as
   * blobs written to the object store; null for a deleted one. With `since`, what commits made
   * in the folder after it changed counts too.
   */
  const checkoutEdits = Effect.fn("WikiService.checkoutEdits")(function* (
    at: string,
    attachments: boolean,
    since?: string,
  ) {
    const status = yield* runGit("worktreeStatus", at, [
      "status",
      "--porcelain=v1",
      "-z",
      "--no-renames",
      "--untracked-files=all",
    ]);
    const entries = new Map<string, boolean>();
    for (const record of status.stdout.split("\0")) {
      if (record.length >= 4) entries.set(record.slice(3), record.slice(0, 2).includes("D"));
    }
    if (since !== undefined) {
      const committed = yield* gitOut("committedEdits", at, [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        since,
        "HEAD",
      ]);
      for (const file of committed.split("\0").filter(Boolean)) {
        if (entries.has(file)) continue;
        const exists = yield* fileSystem
          .exists(path.join(at, file))
          .pipe(Effect.orElseSucceed(() => false));
        entries.set(file, !exists);
      }
    }
    const changes: Record<string, string | null> = {};
    const blobs: Record<string, string | null> = {};
    const hashed: string[] = [];
    for (const [file, deleted] of entries) {
      if (attachments && isAttachmentName(file)) {
        if (deleted) blobs[file] = null;
        else hashed.push(file);
        continue;
      }
      if (!isWikiDocument(file)) continue;
      changes[file] = deleted
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
    if (hashed.length > 0) {
      const oids = (yield* gitOut(
        "hashAttachments",
        at,
        ["hash-object", "-w", "--no-filters", "--stdin-paths"],
        { stdin: `${hashed.join("\n")}\n` },
      )).split("\n");
      hashed.forEach((file, position) => {
        blobs[file] = oids[position] ?? null;
      });
    }
    return { changes, blobs } satisfies CarriedFiles;
  });

  const pendingFile = (at: string) =>
    gitOut("checkoutGitDir", at, ["rev-parse", "--absolute-git-dir"]).pipe(
      Effect.map((gitDir) => path.join(gitDir, "astrolabe-pending-amendment.json")),
    );

  const readPending = Effect.fn("WikiService.readPending")(function* (at: string) {
    const file = yield* pendingFile(at);
    return yield* fileSystem
      .readFileString(file)
      .pipe(Effect.flatMap(decodePending), Effect.option);
  });

  /** Whether `folder` is one of the wiki's worktrees, with the branch it has checked out. */
  const listedCheckout = Effect.fn("WikiService.listedCheckout")(function* (
    wiki: WikiRecord,
    folder: string,
  ) {
    const listed = yield* runGit("worktreeList", wiki.root, [
      "worktree",
      "list",
      "--porcelain",
      "-z",
    ]);
    // git lists real paths, which a symlinked temp folder (macOS /var) is not.
    const real = yield* fileSystem
      .realPath(folder)
      .pipe(Effect.orElseSucceed(() => path.resolve(folder)));
    return parseWorktreeList(listed.stdout).find((entry) => path.resolve(entry.path) === real);
  });

  /** A checkout's files as they stand: its HEAD's snapshot with the unsaved edits over it. */
  const checkoutSnapshot = Effect.fn("WikiService.checkoutSnapshot")(function* (
    wiki: WikiRecord,
    folder: string,
  ) {
    const head = yield* gitOut("worktreeHead", folder, ["rev-parse", "HEAD"]);
    const committed = yield* snapshotAt(wiki, head);
    const edits = yield* checkoutEdits(folder, true);
    if (carriedNames(edits).length === 0) return { head, edits, snapshot: committed };
    const files = applyChanges(committed.files, edits.changes);
    const others = [
      ...committed.others.filter(({ file }) => !(file in edits.blobs)),
      ...Object.entries(edits.blobs).flatMap(([file, oid]) =>
        oid === null ? [] : [{ file, oid }],
      ),
    ];
    const snapshot: Snapshot = {
      files,
      index: yield* Effect.try({
        try: () =>
          indexFiles(
            files,
            others.map((entry) => entry.file),
          ),
        catch: planningError,
      }),
      others,
    };
    return { head, edits, snapshot };
  });

  /**
   * The folder `checkout` names, once it is the root's own folder or, for Git, one of the worktrees
   * git lists for it. Any other path is refused.
   */
  const checkoutFolder = Effect.fn("WikiService.checkoutFolder")(function* (
    wiki: WikiRecord,
    checkout: string,
  ) {
    const refused = new WikiError({
      reason: "invalid",
      message: `${checkout} is not a checkout of ${wiki.name}: give its folder or one of its worktrees.`,
    });
    if (!path.isAbsolute(checkout)) return yield* refused;
    const real = yield* fileSystem.realPath(checkout).pipe(Effect.mapError(() => refused));
    const root = yield* fileSystem.realPath(wiki.root).pipe(Effect.orElseSucceed(() => wiki.root));
    if (real === root) return real;
    if (wiki.plain || (yield* listedCheckout(wiki, real)) === undefined) return yield* refused;
    return real;
  });

  /** The folder a read works in on disk, or null to read a commit. */
  const diskFolder = Effect.fn("WikiService.diskFolder")(function* (
    wiki: WikiRecord,
    target: Pick<WikiReadTarget, "changeRequestId" | "checkout">,
  ) {
    if (wiki.plain && target.changeRequestId !== undefined) return yield* withoutGit(wiki);
    if (target.checkout !== undefined) {
      if (target.changeRequestId !== undefined) {
        return yield* new WikiError({
          reason: "invalid",
          message: "Name a change request or a checkout to read, not both.",
        });
      }
      return yield* checkoutFolder(wiki, target.checkout);
    }
    return wiki.plain ? wiki.root : null;
  });

  /** Other roots of the wiki's project inside `folder`: their files are theirs. */
  const nestedRoots = Effect.fn("WikiService.nestedRoots")(function* (
    wiki: WikiRecord,
    folder: string,
  ) {
    const parsed = parseProjectRootId(wiki.wikiId);
    if (parsed === null) return new Set<string>();
    const roots = yield* projectRootFolders
      .list(parsed.projectId)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<ProjectRoot> => []));
    const inside = yield* Effect.forEach(
      roots.filter((root) => root.key !== parsed.rootKey),
      (root) => fileSystem.realPath(root.path).pipe(Effect.orElseSucceed(() => root.path)),
    );
    return new Set(inside.filter((at) => at !== folder && isWithinRoot(path, at, folder)));
  });

  /** A folder without Git as it stands, walked again only once a file or folder it read moved. */
  const plainRead = Effect.fn("WikiService.plainRead")(function* (
    wiki: WikiRecord,
    folder: string,
  ) {
    const cached = plainReads.get(folder);
    if (
      cached?.plain != null &&
      (yield* plainScanFresh(cached.plain.scan).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
      ))
    ) {
      return cached;
    }
    const scan = yield* scanPlainFolder(folder, yield* nestedRoots(wiki, folder)).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    const others = scan.files.flatMap(({ file }) =>
      isWikiDocument(file) ? [] : [{ file, oid: "" }],
    );
    const entries = scan.files.map(({ file, size }) => ({ file, oid: "", size }));
    const isoTimes = (time: "modified" | "created") =>
      new Map(
        scan.files.flatMap((entry) => {
          const at = entry[time];
          return at === undefined ? [] : [[entry.file, at.toISOString()] as const];
        }),
      );
    const read: DiskRead = {
      commit: `disk-${(Hash.string(scan.stamps.join("\n")) >>> 0).toString(16)}`,
      snapshot: {
        files: scan.documents,
        index: yield* Effect.try({
          try: () =>
            indexFiles(
              scan.documents,
              others.map((entry) => entry.file),
            ),
          catch: planningError,
        }),
        others,
      },
      changes: {},
      plain: {
        scan,
        listing: {
          entries,
          byFile: new Map(entries.map((entry) => [entry.file, entry])),
          links: linkFiles(entries.map((entry) => entry.file)),
        },
        times: { modified: isoTimes("modified"), created: isoTimes("created") },
      },
    };
    plainReads.set(folder, read);
    return read;
  });

  /**
   * A Git checkout's documents as they stand: its HEAD's with the edits git's status names over
   * them. Status asks after documents alone, so git compares only those with its index; the read
   * is reused while HEAD, that status and the edited documents' times hold.
   */
  const gitDiskRead = Effect.fn("WikiService.gitDiskRead")(function* (
    wiki: WikiRecord,
    folder: string,
  ) {
    const head = yield* gitOut("worktreeHead", folder, ["rev-parse", "HEAD"]);
    const status = (yield* runGit("documentStatus", folder, [
      "status",
      "--porcelain=v1",
      "-z",
      "--no-renames",
      "--untracked-files=all",
      "--",
      ...DOCUMENT_PATHSPECS,
    ])).stdout;
    const edited = new Map<string, boolean>();
    for (const record of status.split("\0")) {
      const file = record.slice(3);
      if (record.length >= 4 && isWikiDocument(file)) {
        edited.set(file, record.slice(0, 2).includes("D"));
      }
    }
    const times = yield* Effect.forEach(
      [...edited].filter(([, deleted]) => !deleted),
      ([file]) =>
        fileSystem.stat(path.join(folder, file)).pipe(
          Effect.map(
            (info) => `${file}:${Option.getOrUndefined(info.mtime)?.getTime()}:${info.size}`,
          ),
          Effect.orElseSucceed(() => `${file}:gone`),
        ),
      { concurrency: 16 },
    );
    const key = [head, status, ...times].join("\0");
    const cached = checkoutReads.get(folder);
    if (cached?.key === key) return cached.read;
    const committed = yield* snapshotAt(wiki, head);
    const changes: Record<string, string | null> = {};
    for (const [file, deleted] of edited) {
      changes[file] = deleted
        ? null
        : yield* fileSystem.readFileString(path.join(folder, file)).pipe(
            Effect.mapError(
              (cause) =>
                new WikiError({
                  reason: "invalid",
                  message: `${file} could not be read from ${folder}.`,
                  cause,
                }),
            ),
          );
    }
    const files = edited.size === 0 ? committed.files : applyChanges(committed.files, changes);
    const read: DiskRead = {
      commit: head,
      snapshot:
        edited.size === 0
          ? committed
          : {
              files,
              index: yield* Effect.try({
                try: () =>
                  indexFiles(
                    files,
                    committed.others.map((entry) => entry.file),
                  ),
                catch: planningError,
              }),
              others: committed.others,
            },
      changes,
      plain: null,
    };
    checkoutReads.set(folder, { key, read });
    return read;
  });

  const diskRead = (wiki: WikiRecord, folder: string) =>
    wiki.plain ? plainRead(wiki, folder) : gitDiskRead(wiki, folder);

  const ioError = (message: string) => (cause: unknown) =>
    new WikiError({ reason: "git-failed", message, cause });

  /** A checkout's files as a change plans on them: in Git, its HEAD with every unsaved edit over it. */
  const checkoutFiles = (
    wiki: WikiRecord,
    folder: string,
  ): Effect.Effect<{ readonly snapshot: Snapshot }, WikiError> =>
    wiki.plain ? plainRead(wiki, folder) : checkoutSnapshot(wiki, folder);

  /**
   * Plans a change on a checkout's files and writes the result there, uncommitted. In Git its
   * stamps carry the amendment id a turn's save would land under. Callers hold the lock and the
   * lease.
   */
  const inCheckout = Effect.fn("WikiService.inCheckout")(function* (
    wiki: WikiRecord,
    folder: string,
    plan: (snapshot: Snapshot, stamp: AmendmentStamp) => PlannedAmendment & CarriedBlobs,
  ): Effect.fn.Return<WikiCheckoutTransformResult, WikiError> {
    const { snapshot } = yield* checkoutFiles(wiki, folder);
    const stored = wiki.plain ? Option.none() : yield* readPending(folder);
    const pending = Option.isSome(stored)
      ? stored.value
      : { amendment: yield* newId, minted: 0, moved: [] };
    let minted = pending.minted;
    const stamp: AmendmentStamp = {
      amendment: pending.amendment,
      at: yield* nowIso,
      newId: () => `${pending.amendment}-${++minted}`,
    };
    const planned = yield* Effect.try({ try: () => plan(snapshot, stamp), catch: planningError });
    const blobs = planned.blobs ?? {};
    if (carriedNames({ changes: planned.changes, blobs }).length === 0) {
      return yield* new WikiError({ reason: "invalid", message: NOTHING_CHANGED });
    }
    const on = (file: string) => path.join(folder, file);
    const place = (file: string) =>
      fileSystem.makeDirectory(path.dirname(on(file)), { recursive: true });
    const movedFrom = new Map((planned.moved ?? []).map(({ from, to }) => [to, from]));
    const removed: string[] = [];
    const written: string[] = [];
    yield* Effect.gen(function* () {
      // Bytes that aren't a document only ever move; removals go before writes, so a rename
      // that changes only case survives a case-blind disk.
      for (const [file, oid] of Object.entries(blobs)) {
        const from = movedFrom.get(file);
        if (oid === null || from === undefined) continue;
        yield* place(file);
        yield* fileSystem.rename(on(from), on(file));
      }
      const renamed = new Set(movedFrom.values());
      for (const [file, content] of [
        ...Object.entries(planned.changes),
        ...Object.entries(blobs),
      ]) {
        if (content !== null) continue;
        removed.push(file);
        if (!(file in blobs && renamed.has(file)))
          yield* fileSystem.remove(on(file), { force: true });
      }
      for (const [file, content] of Object.entries(planned.changes)) {
        if (content === null) continue;
        yield* place(file);
        yield* fileSystem.writeFileString(on(file), content);
        written.push(file);
      }
      written.push(...Object.keys(blobs).filter((file) => blobs[file] !== null));
      // A folder a move emptied goes too; one still holding anything refuses.
      for (const file of removed) {
        for (let dir = path.dirname(file); dir !== "."; dir = path.dirname(dir)) {
          const left = yield* fileSystem
            .readDirectory(on(dir))
            .pipe(Effect.orElseSucceed(() => [""]));
          if (left.length > 0) break;
          yield* fileSystem.remove(on(dir), { recursive: true });
        }
      }
      if (!wiki.plain) {
        yield* fileSystem.writeFileString(
          yield* pendingFile(folder),
          yield* encodePending({
            amendment: pending.amendment,
            minted,
            moved: chainMoves(pending.moved, planned.moved ?? []),
          }),
        );
      }
    }).pipe(
      Effect.mapError((cause) =>
        isWikiError(cause)
          ? cause
          : ioError("Could not write the change into the checkout.")(cause),
      ),
    );
    return {
      written: written.toSorted(),
      removed: removed.toSorted(),
      errors: planned.errors,
      ...(planned.canvas === undefined ? {} : { canvas: planned.canvas }),
    };
  });

  const transformInCheckout = (wiki: WikiRecord, folder: string, change: WikiTransform) =>
    inCheckout(wiki, folder, (snapshot, stamp) =>
      planWikiTransform(change)(snapshot.files, stamp, snapshot.others),
    );

  const transformCheckout: WikiService["Service"]["transformCheckout"] = (input, author) =>
    withAnyWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const folder = yield* diskFolder(wiki, input);
          if (folder === null) return yield* transform(input, author);
          return yield* locked(
            wiki,
            withWorkspaceLease(folder, transformInCheckout(wiki, folder, input.transform)),
          );
        }),
      input.changeRequestId,
    );

  /** A project root and the folder its read names, once that folder is known to be its checkout. */
  const openRoot = (root: ProjectRootRead) =>
    withAnyWiki(root.wikiId, (wiki) =>
      checkoutFolder(wiki, root.checkout).pipe(Effect.map((folder) => ({ root, wiki, folder }))),
    );

  const projectIndex: WikiService["Service"]["projectIndex"] = (roots) =>
    Effect.forEach(
      roots,
      (root) =>
        openRoot(root).pipe(
          Effect.flatMap(({ wiki, folder }) => diskRead(wiki, folder)),
          Effect.map(({ snapshot }) => [root.key, snapshot.index] as const),
        ),
      { concurrency: 4 },
    ).pipe(
      Effect.map((entries) => {
        const indexes = new Map(entries);
        return {
          roots: indexes,
          documents: new Map([...indexes].map(([key, each]) => [key, each.documents] as const)),
        };
      }),
    );

  /** Holds each repository's lock in one order, so two calls over the same roots never deadlock. */
  const lockedAll = <A, E, R>(wikis: ReadonlyArray<WikiRecord>, body: Effect.Effect<A, E, R>) =>
    [...new Map(wikis.map((wiki) => [wiki.root, wiki])).values()]
      .toSorted((a, b) => a.root.localeCompare(b.root))
      .reduceRight((inner, wiki) => locked(wiki, inner), body);

  const projectRename: WikiService["Service"]["projectRename"] = Effect.fn(
    "WikiService.projectRename",
  )(function* (input) {
    const opened = yield* Effect.forEach(input.roots, openRoot, { concurrency: 4 });
    const moving = opened.find(({ root }) => root.key === input.root);
    if (moving === undefined) {
      return yield* new WikiError({
        reason: "not-found",
        message: `The project has no folder ${input.root}.`,
      });
    }
    if (!moving.root.writable) {
      return yield* new WikiError({
        reason: "invalid",
        message: `This thread cannot write ${input.root}.`,
      });
    }
    const ordered = [moving, ...opened.filter((each) => each !== moving)];
    const writers = ordered.filter(({ root }) => root.writable);
    return yield* lockedAll(
      writers.map(({ wiki }) => wiki),
      Effect.gen(function* () {
        const snapshots = yield* Effect.forEach(
          ordered,
          ({ wiki, folder }) => checkoutFiles(wiki, folder),
          { concurrency: 4 },
        );
        const roots = new Map(
          ordered.map(({ root }, position) => {
            const { files, others } = snapshots[position]!.snapshot;
            return [root.key, { files, others }] as const;
          }),
        );
        const { from, to, folder } = input.transform;
        const plans = yield* Effect.try({
          try: () =>
            (folder === true ? planProjectFolderRename : planProjectRename)(
              roots,
              input.root,
              from.trim(),
              to.trim(),
            ),
          catch: planningError,
        });
        const changed: Array<ProjectRenameResult["changed"][number]> = [];
        const unchanged: Array<ProjectRenameResult["unchanged"][number]> = [];
        for (const { root, wiki, folder: at } of ordered) {
          const plan = plans.get(root.key);
          if (plan === undefined) continue;
          if (!root.writable) {
            const files = [...Object.keys(plan.changes), ...Object.keys(plan.blobs)];
            unchanged.push({ root: root.key, files: files.toSorted() });
            continue;
          }
          const written = yield* withWorkspaceLease(
            at,
            inCheckout(wiki, at, (snapshot, stamp) => planMoved(snapshot.files, stamp, plan)),
          );
          changed.push({ ...written, root: root.key });
        }
        return { changed, unchanged };
      }),
    );
  });

  const summary = (wiki: WikiRecord) =>
    (wiki.plain ? Effect.succeed([]) : readChangeRequests(wiki)).pipe(
      Effect.map(
        (all) => all.filter(({ record }) => record.status === "open" && !record.draft).length,
      ),
      // A folder whose repository can't be read still lists.
      Effect.orElseSucceed(() => 0),
      Effect.map((openChangeRequests): WikiSummary => ({
        wikiId: wiki.wikiId,
        name: wiki.name,
        root: wiki.root,
        mainBranch: wiki.mainBranch,
        host: wiki.host,
        mapBackgrounds: wiki.mapBackgrounds,
        openChangeRequests,
        createdAt: wiki.createdAt,
        projectId: wiki.projectId,
        rootKey: wiki.rootKey,
      })),
    );

  /** Every folder of every project that isn't archived. */
  const list: WikiService["Service"]["list"] = Effect.gen(function* () {
    const folders = yield* projectRootRecords;
    return { wikis: yield* Effect.forEach(folders, summary, { concurrency: 4 }) };
  });

  /** When each file was last changed on the line ending at `commit`. */
  const editTimesAt = Effect.fn("WikiService.editTimesAt")(function* (
    wiki: WikiRecord,
    commit: string,
  ) {
    const cached = editTimes.get(commit);
    if (cached !== undefined) return cached;
    // A draft's every save is a commit: from its parent's times, it costs only what it changed.
    const parent = yield* onlyParent(wiki, commit);
    const before = parent === null ? undefined : editTimes.get(parent);
    if (before !== undefined) {
      const step = yield* runGit("editTimesStep", wiki.root, [
        "log",
        "-1",
        "--find-renames",
        `--format=${EDIT_TIMES_FORMAT}`,
        "--name-status",
        "-z",
        commit,
        "--",
      ]);
      const times = advanceFileTimes(before, step.stdout);
      editTimes.set(commit, times);
      return times;
    }
    const log = yield* runGit("editTimes", wiki.root, [
      "log",
      "--find-renames",
      `--max-count=${EDIT_TIMES_DEPTH}`,
      `--format=${EDIT_TIMES_FORMAT}`,
      "--name-status",
      "-z",
      commit,
      "--",
    ]);
    const times = parseFileTimes(log.stdout);
    editTimes.set(commit, times);
    return times;
  });

  /** A commit's one parent; null for a root or a merge. */
  const onlyParent = Effect.fn("WikiService.onlyParent")(function* (
    wiki: WikiRecord,
    commit: string,
  ) {
    const line = yield* gitOut("parents", wiki.root, ["rev-list", "--parents", "-n", "1", commit]);
    const parents = line.trim().split(" ");
    return parents.length === 2 ? (parents[1] ?? null) : null;
  });

  /** The files at `commit`, from its parent's listing and what the commit changed. */
  const listingFrom = Effect.fn("WikiService.listingFrom")(function* (
    wiki: WikiRecord,
    before: FileListing,
    parent: string,
    commit: string,
  ) {
    const changes = parseTreeChanges(
      yield* gitOut("diffTree", wiki.root, [
        "diff-tree",
        "-r",
        "-z",
        "--no-renames",
        "--no-commit-id",
        parent,
        commit,
      ]),
    );
    const added = changes.filter(
      (change) => change.oid !== null && (change.mode === "100644" || change.mode === "100755"),
    );
    const sizes =
      added.length === 0
        ? []
        : (yield* gitOut("catFileSizes", wiki.root, ["cat-file", "--batch-check=%(objectsize)"], {
            stdin: `${added.map((change) => change.oid).join("\n")}\n`,
          })).split("\n");
    const changed = new Set(changes.map((change) => change.file));
    const entries = before.entries.filter((entry) => !changed.has(entry.file));
    added.forEach((change, position) => {
      const size = Number(sizes[position]);
      if (change.oid !== null && Number.isFinite(size)) {
        entries.push({ file: change.file, oid: change.oid, size });
      }
    });
    // As `ls-tree -r` lists them.
    return entries.toSorted((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  });

  /** Every file at `commit`, at any depth. */
  const fileListingAt = Effect.fn("WikiService.fileListingAt")(function* (
    wiki: WikiRecord,
    commit: string,
  ) {
    const cached = fileListings.get(commit);
    if (cached !== undefined) return cached;
    const parent = yield* onlyParent(wiki, commit);
    const before = parent === null ? undefined : fileListings.get(parent);
    const entries =
      parent !== null && before !== undefined
        ? yield* listingFrom(wiki, before, parent, commit)
        : parseFileListing(
            (yield* runGit("lsTreeAll", wiki.root, ["ls-tree", "-r", "-l", "-z", commit])).stdout,
          );
    const listing: FileListing = {
      entries,
      byFile: new Map(entries.map((entry) => [entry.file, entry])),
      links: linkFiles(entries.map((entry) => entry.file)),
    };
    fileListings.set(commit, listing);
    return listing;
  });

  /** What the code index knows of the wiki's code at `commit`; nothing when it can't say. */
  const codeAt = Effect.fn("WikiService.codeAt")(function* (wiki: WikiRecord, commit: string) {
    const source = yield* Ref.get(codeFacts);
    if (source === null) return { state: "off" } satisfies CodeFacts;
    return yield* source({ root: wiki.root, commit }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("bases could not read the code index", { cause }).pipe(
          Effect.as({ state: "off" } satisfies CodeFacts),
        ),
      ),
    );
  });

  /**
   * Every file at `commit` as a base lists them; only notes and canvases are read, and code files
   * carry `code`'s facts.
   */
  const corpusAt = Effect.fn("WikiService.corpusAt")(function* (
    wiki: WikiRecord,
    commit: string,
    code: ReadonlyMap<string, CodeFile> | undefined,
  ) {
    const cached = corpora.get(commit);
    if (cached !== undefined && cached.code === code) return cached.corpus;
    let lock = corpusLocks.get(wiki.root);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      corpusLocks.set(wiki.root, lock);
    }
    return yield* lock.withPermits(1)(buildCorpus(wiki, commit, code));
  });

  // Readers asking at once wait for one build, then share it.
  const buildCorpus = Effect.fn("WikiService.buildCorpus")(function* (
    wiki: WikiRecord,
    commit: string,
    code: ReadonlyMap<string, CodeFile> | undefined,
  ) {
    const built = corpora.get(commit);
    if (built !== undefined && built.code === code) return built.corpus;
    const listing = (yield* fileListingAt(wiki, commit)).entries.filter(
      (entry) => !isHidden(entry.file),
    );
    const readable = listing.filter((entry) => /\.(md|canvas)$/i.test(entry.file));
    const contents = yield* readObjects(
      wiki.root,
      readable.map((entry) => entry.oid),
    );
    const sources = new Map(readable.map((entry, position) => [entry.file, contents[position]]));
    const times = yield* editTimesAt(wiki, commit);
    const corpus = baseCorpus(
      listing.map((entry) => {
        const facts = code?.get(entry.file);
        return {
          file: entry.file,
          size: entry.size,
          ...(sources.has(entry.file) ? { source: sources.get(entry.file) ?? "" } : {}),
          ...(facts === undefined ? {} : { code: facts }),
        };
      }),
      times,
    );
    corpora.set(commit, { corpus, code });
    return corpus;
  });

  /** A folder without Git as a base lists it: every file, with its times on disk. */
  const plainCorpus = (commit: string, plain: NonNullable<DiskRead["plain"]>) => {
    const cached = corpora.get(commit);
    if (cached !== undefined) return cached.corpus;
    const corpus = baseCorpus(
      plain.scan.files.map(({ file, size }) => ({
        file,
        size,
        ...(/\.(md|canvas)$/i.test(file) && file in plain.scan.documents
          ? { source: plain.scan.documents[file] }
          : {}),
      })),
      plain.times,
    );
    corpora.set(commit, { corpus, code: undefined });
    return corpus;
  };

  const index: WikiService["Service"]["index"] = (input) =>
    withAnyWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const folder = yield* diskFolder(wiki, input);
          if (folder !== null) {
            const disk = yield* diskRead(wiki, folder);
            const times = disk.plain?.times ?? (yield* editTimesAt(wiki, disk.commit));
            return indexResult(wiki.wikiId, disk.commit, disk.snapshot.index, times.modified);
          }
          const commit = yield* readCommit(wiki, input);
          const snapshot = yield* snapshotAt(wiki, commit);
          const times = yield* editTimesAt(wiki, commit);
          return indexResult(wiki.wikiId, commit, snapshot.index, times.modified);
        }),
      input.changeRequestId,
    );

  const docPaths: WikiService["Service"]["docPaths"] = (input) =>
    withAnyWiki(input.wikiId, (wiki) =>
      Effect.gen(function* () {
        const folder = yield* checkoutFolder(wiki, input.checkout ?? wiki.root);
        const read = (record: WikiRecord, at: string) =>
          diskRead(record, at).pipe(
            Effect.map(({ snapshot }) =>
              docPathsOf(
                snapshot.index,
                snapshot.others.map((entry) => entry.file),
              ),
            ),
          );
        const own = yield* read(wiki, folder);
        const parsed = parseProjectRootId(wiki.wikiId);
        if (parsed === null) return own;
        const project = yield* projects
          .getById(parsed.projectId)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        if (Option.isNone(project)) return own;
        const roots = yield* projectRootFolders
          .list(parsed.projectId)
          .pipe(Effect.orElseSucceed((): ReadonlyArray<ProjectRoot> => []));
        // A root inside this checkout shows in its tree, though its documents index on their own.
        const nested = yield* Effect.forEach(
          roots.filter((root) => root.key !== parsed.rootKey && root.state !== "missing"),
          (root) =>
            Effect.gen(function* () {
              const real = yield* fileSystem
                .realPath(root.path)
                .pipe(Effect.orElseSucceed(() => root.path));
              if (real === folder || !isWithinRoot(path, real, folder)) return [];
              const prefix = path.relative(folder, real).split(path.sep).join("/");
              const files = yield* read(yield* rootRecord(project.value, root), real);
              return files.map((file) => `${prefix}/${file}`);
            }).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => [])),
          { concurrency: 4 },
        );
        // A Git checkout's untracked files can hold a nested root's documents already.
        return [...new Set([...own, ...nested.flat()])].toSorted();
      }),
    );

  const readNote: WikiService["Service"]["readNote"] = (input) =>
    readAt(input, (wiki, commit, snapshot) =>
      noteResult(wiki.wikiId, commit, snapshot.index, snapshot.files, input.name),
    );

  const links: WikiService["Service"]["links"] = (input) =>
    readAt(input, (_wiki, commit, snapshot) => ({
      commit,
      ...linksResult(snapshot.index, input.name),
    }));

  const query: WikiService["Service"]["query"] = (input) =>
    withAnyWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const folder = yield* diskFolder(wiki, input);
          const disk = folder === null ? null : yield* diskRead(wiki, folder);
          const commit = disk?.commit ?? (yield* readCommit(wiki, input));
          const snapshot = disk?.snapshot ?? (yield* snapshotAt(wiki, commit));
          // Unsaved edits from the view are read as if they had landed.
          const viewed = yield* Effect.try({
            try: () => (input.edits?.length ? applyBaseEdits(snapshot.files, input.edits) : {}),
            catch: (cause) =>
              new WikiError({
                reason: "invalid",
                message: cause instanceof BaseError ? cause.message : "The edits could not apply.",
                cause,
              }),
          });
          const edited = Object.keys(viewed).length > 0;
          const index = edited
            ? indexFiles(
                applyChanges(snapshot.files, viewed),
                snapshot.others.map((entry) => entry.file),
              )
            : snapshot.index;
          const changes = { ...disk?.changes, ...viewed };
          const located = locateBase(index, input);
          if ("problem" in located) {
            return yield* new WikiError({ reason: located.problem, message: located.message });
          }
          const code: CodeFacts = wiki.plain ? { state: "off" } : yield* codeAt(wiki, commit);
          const committed =
            disk?.plain == null
              ? yield* corpusAt(wiki, commit, code.state === "ready" ? code.files : undefined)
              : plainCorpus(disk.commit, disk.plain);
          const corpus =
            Object.keys(changes).length > 0 ? corpusWithChanges(committed, changes) : committed;
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
          // The view ran, so any error is another view's.
          const { errors, warnings } = checkBase(located.source);
          const problems = [
            ...errors,
            ...warnings,
            ...(code.state === "building" ? [CODE_BUILDING] : []),
          ];
          return { commit, ...result, ...(problems.length ? { warnings: problems } : {}) };
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

  /** A folder without Git's file listing as it stands; its files are read on disk. */
  const plainListing = (wiki: WikiRecord) =>
    plainRead(wiki, wiki.root).pipe(
      Effect.map((disk) => ({ commit: disk.commit, plain: disk.plain! })),
    );

  /** `readFiles` in a Git checkout: its HEAD's files with the documents edited on disk over them. */
  const filesOnDisk = Effect.fn("WikiService.filesOnDisk")(function* (
    wiki: WikiRecord,
    folder: string,
    input: Pick<WikiReadFilesInput, "paths" | "from">,
  ) {
    const disk = yield* gitDiskRead(wiki, folder);
    const listing = yield* fileListingAt(wiki, disk.commit);
    const sizes = new Map(listing.entries.map((entry) => [entry.file, entry.size] as const));
    for (const [file, text] of Object.entries(disk.changes)) {
      if (text === null) sizes.delete(file);
      else sizes.set(file, Buffer.byteLength(text));
    }
    const links = linkFiles(sizes.keys());
    const files = yield* Effect.forEach(input.paths, (asked) =>
      Effect.gen(function* () {
        const { file } = resolveLink(asked, input.from ?? null, links);
        const size = file === null ? undefined : sizes.get(file);
        if (file === null || size === undefined) {
          const exact = asked.replace(/^\/+/, "");
          // A file added since HEAD, such as a pasted image, is found by its whole path alone.
          const added = isAttachmentName(exact)
            ? yield* fileSystem.stat(path.join(folder, exact)).pipe(
                Effect.map((info) => (info.type === "File" ? Number(info.size) : null)),
                Effect.orElseSucceed(() => null),
              )
            : null;
          return { path: asked, exists: added !== null, file: exact, size: added ?? 0, text: null };
        }
        const text =
          size > READ_TEXT_BYTES || isMediaFile(file)
            ? null
            : (disk.snapshot.files[file] ??
              (yield* fileSystem
                .readFileString(path.join(folder, file))
                .pipe(Effect.orElseSucceed(() => null))));
        return {
          path: asked,
          exists: true,
          file,
          size,
          text: text === null || /[\0\uFFFD]/.test(text) ? null : text,
        };
      }),
    );
    return { commit: disk.commit, files };
  });

  const readFiles: WikiService["Service"]["readFiles"] = (input) =>
    withAnyWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          if (input.checkout !== undefined && !wiki.plain) {
            const folder = yield* diskFolder(wiki, input);
            if (folder !== null) return yield* filesOnDisk(wiki, folder, input);
          }
          const plain = wiki.plain ? yield* plainListing(wiki) : null;
          const commit = plain?.commit ?? (yield* fileCommit(wiki, input));
          const listing = plain?.plain.listing ?? (yield* fileListingAt(wiki, commit));
          const found = input.paths.map((path) => listedFile(listing, path, input.from ?? null));
          // A media file's existence is all a card needs here: its bytes come as an asset.
          const readable = found.flatMap((entry) =>
            entry !== undefined && entry.size <= READ_TEXT_BYTES && !isMediaFile(entry.file)
              ? [entry]
              : [],
          );
          const contents =
            plain === null
              ? yield* readObjects(
                  wiki.root,
                  readable.map((entry) => entry.oid),
                )
              : yield* Effect.forEach(readable, ({ file }) =>
                  file in plain.plain.scan.documents
                    ? Effect.succeed(plain.plain.scan.documents[file] ?? null)
                    : fileSystem
                        .readFileString(path.join(wiki.root, file))
                        .pipe(Effect.orElseSucceed(() => null)),
                );
          const texts = new Map(
            readable.map((entry, position) => [entry.file, contents[position]]),
          );
          return {
            commit,
            files: input.paths.map((path, position) => {
              const entry = found[position];
              const text = entry === undefined ? undefined : texts.get(entry.file);
              return {
                path,
                exists: entry !== undefined,
                file: entry?.file ?? path.replace(/^\/+/, ""),
                size: entry?.size ?? 0,
                // Bytes that aren't text decode to something, but never without a NUL or a U+FFFD.
                text: text == null || /[\0\uFFFD]/.test(text) ? null : text,
              };
            }),
          };
        }),
      input.changeRequestId,
    );

  const listFiles: WikiService["Service"]["listFiles"] = (input) =>
    withAnyWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const plain = wiki.plain ? yield* plainListing(wiki) : null;
          const commit = plain?.commit ?? (yield* fileCommit(wiki, input));
          const listing = plain?.plain.listing ?? (yield* fileListingAt(wiki, commit));
          return {
            commit,
            files: listing.entries.flatMap(({ file, size }) =>
              isHidden(file) ? [] : [{ file, size }],
            ),
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
        const listing = yield* fileListingAt(wiki, commit);
        const entry = listedFile(listing, input.path, input.from ?? null);
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

  const changeRequestsList: WikiService["Service"]["changeRequestsList"] = (input, viewer) =>
    requireGit.pipe(
      // A folder without Git has no change requests to list.
      Effect.andThen(Effect.map(lookup(input.wikiId), (wiki) => (wiki.plain ? [] : [wiki]))),
      Effect.flatMap((wikis) =>
        Effect.forEach(
          wikis,
          (wiki) =>
            readChangeRequests(wiki).pipe(
              Effect.map((all) =>
                all.filter(
                  ({ record }) =>
                    (!record.draft ||
                      (viewer !== undefined && record.createdBy === actorName(viewer))) &&
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
            const { singular } = wikiTerms(wiki);
            return yield* new WikiError({
              reason: "not-found",
              message: `This thread has no open ${singular} on this wiki.`,
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
          const listed = (yield* changeList(wiki, stored, from)).filter(({ file }) =>
            isWikiDocument(file),
          );
          const contents = yield* readObjects(wiki.root, [
            ...listed.map(({ file, movedFrom }) => `${from}:${movedFrom ?? file}`),
            ...listed.map(({ file }) => `${stored.head}:${file}`),
          ]);
          const warnings = listed.flatMap(({ file }, position) => {
            const after = contents[listed.length + position];
            return after == null
              ? []
              : documentBaseCheck(file, after).warnings.map((warning) => ({ file, warning }));
          });
          return {
            changeRequest: yield* view(wiki, stored),
            files: listed.map(({ file, movedFrom }, position) => ({
              file,
              before: contents[position] ?? null,
              after: contents[listed.length + position] ?? null,
              ...(movedFrom === undefined ? {} : { movedFrom }),
            })),
            mergePreview:
              stored.record.status === "merged"
                ? { status: "up-to-date" as const, conflicts: [], errors: [], canvases: [] }
                : yield* mergePreview(wiki, stored, main),
            errors: (yield* snapshotAt(wiki, stored.head)).index.errors,
            ...(warnings.length ? { warnings } : {}),
          } satisfies WikiChangeRequestDetail;
        }),
      input.changeRequestId,
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
                message: `A merged ${wikiTerms(wiki).singular} stays merged.`,
              });
            }
            if (stored.record.status === input.status) return yield* view(wiki, stored);
            if (
              input.status === "open" &&
              stored.record.draft &&
              (yield* openDraftOf(wiki, stored.record.createdBy)) !== undefined
            ) {
              return yield* new WikiError({
                reason: "invalid",
                message: `You have another draft on this wiki. Make it a ${wikiTerms(wiki).singular} or discard it, then reopen this one.`,
              });
            }
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

  const root: WikiService["Service"]["root"] = Effect.fn("WikiService.root")(function* (wikiId) {
    return (yield* lookup(wikiId)).root;
  });

  const get: WikiService["Service"]["get"] = (wikiId) => withAnyWiki(wikiId, summary);

  const requireHost = (wiki: WikiRecord) =>
    wiki.host === null
      ? Effect.fail(
          new WikiError({ reason: "invalid", message: "This wiki is not connected to a host." }),
        )
      : Effect.succeed(wiki.host);

  /** What the host holds under main and `cr/`, read without fetching. */
  const hostRefs = Effect.fn("WikiService.hostRefs")(function* (wiki: WikiRecord, remote: string) {
    const listed = yield* gitOut(
      "lsRemoteHost",
      wiki.root,
      ["ls-remote", "--heads", remote, mainRef(wiki), `${CHANGE_REQUEST_BRANCH_PREFIX}*`],
      { timeoutMs: REMOTE_TIMEOUT_MS },
    );
    const refs = new Map<string, string>();
    for (const line of listed.split("\n")) {
      const [oid, ref] = line.split("\t");
      if (oid && ref) refs.set(ref.trim(), oid.trim());
    }
    return refs;
  });

  /** Moves an open change request onto what the host holds, if that only adds to it. */
  const followHostBranch = Effect.fn("WikiService.followHostBranch")(function* (
    wiki: WikiRecord,
    stored: StoredChangeRequest,
    remoteHead: string,
    main: string,
  ) {
    if (remoteHead === stored.head) return;
    if (!(yield* isAncestor(wiki.root, stored.head, remoteHead))) return;
    const now = yield* DateTime.now;
    // The host may have merged main in, which would otherwise read as this request's own work.
    const base = (yield* gitOut("followBase", wiki.root, ["merge-base", main, remoteHead])) || null;
    yield* recordChangeRequest(
      wiki,
      stored,
      {
        ...stored.record,
        base: base ?? stored.record.base,
        pushedHead: remoteHead,
        updatedAt: DateTime.formatIso(now),
      },
      "Follow the host",
      identity(person.actor, now),
      remoteHead,
    );
    yield* publish("amended", wiki.wikiId, stored.record.changeRequestId);
  });

  /** Holds no lock while it talks to the host, so a slow fetch never blocks an amendment. */
  const fetchHost = Effect.fn("WikiService.fetchHost")(function* (
    wiki: WikiRecord,
    remote: string,
  ) {
    const trackingRoot = trackedHostRoot(remote);
    const tracking = (ref: string) => `${trackingRoot}${ref.slice("refs/heads/".length)}`;
    let lock = fetchLocks.get(wiki.root);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      fetchLocks.set(wiki.root, lock);
    }
    // Two fetches into one tracking ref would fail each other on git's ref lock.
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const refs = yield* hostRefs(wiki, remote);
        const known = yield* gitOut("forEachTracked", wiki.root, [
          "for-each-ref",
          "--format=%(refname) %(objectname)",
          trackingRoot,
        ]);
        const tracked = new Map(
          known.split("\n").map((line) => line.split(" ") as [string, string]),
        );
        if ([...refs].some(([ref, oid]) => tracked.get(tracking(ref)) !== oid)) {
          yield* runGit(
            "fetchHost",
            wiki.root,
            [
              "fetch",
              "--no-tags",
              "--no-write-fetch-head",
              remote,
              ...[...refs.keys()].map((ref) => `+${ref}:${tracking(ref)}`),
            ],
            { timeoutMs: REMOTE_TIMEOUT_MS },
          );
        }
        return refs;
      }),
    );
  });

  const syncFromHost: WikiService["Service"]["syncFromHost"] = (wikiId) =>
    withWiki(wikiId, (wiki) =>
      Effect.gen(function* () {
        const host = yield* requireHost(wiki);
        const remote = yield* fetchHost(wiki, host.remote);
        yield* locked(
          wiki,
          Effect.gen(function* () {
            const main = yield* mainTip(wiki);
            for (const stored of yield* readChangeRequests(wiki)) {
              const remoteHead = remote.get(changeRequestBranch(stored.record.changeRequestId));
              if (stored.record.status === "open" && remoteHead !== undefined) {
                // One held-up change request is no reason to stop the others following.
                yield* followHostBranch(wiki, stored, remoteHead, main).pipe(
                  Effect.catch((error) =>
                    Effect.logInfo("A wiki change request could not follow the host").pipe(
                      Effect.annotateLogs({ wikiId: wiki.wikiId, cause: error.message }),
                    ),
                  ),
                );
              }
            }
          }),
        );
      }),
    );

  const pushChangeRequest: WikiService["Service"]["pushChangeRequest"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const host = yield* requireHost(wiki);
          const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
          yield* requireOpen(stored);
          if (stored.record.pushedHead === stored.head) return yield* view(wiki, stored);
          // Pushes the commit, not the ref: an amendment landing meanwhile stays unpublished.
          const pushed = yield* runGit(
            "pushChangeRequest",
            wiki.root,
            [
              "push",
              "--no-verify",
              host.remote,
              `${stored.head}:${changeRequestBranch(input.changeRequestId)}`,
            ],
            { timeoutMs: REMOTE_TIMEOUT_MS, allowExitCodes: [1], env: { LC_ALL: "C" } },
          );
          if (pushed.exitCode !== 0) {
            const cause = new WikiGitExitError({
              operation: "pushChangeRequest",
              exitCode: pushed.exitCode,
              stderr: pushed.stderr,
            });
            return yield* /non-fast-forward|fetch first/.test(pushed.stderr)
              ? new WikiError({
                  reason: "stale",
                  message: `The host's copy of this ${wikiTerms(wiki).singular} has work this one lacks. Sync the wiki and try again.`,
                  cause,
                })
              : new WikiError({
                  reason: "git-failed",
                  message:
                    "The host refused this push. A branch rule or hook on the repository may be blocking it.",
                  cause,
                });
          }
          return yield* locked(
            wiki,
            Effect.gen(function* () {
              const current = yield* loadChangeRequest(wiki, input.changeRequestId);
              const now = yield* DateTime.now;
              const next = yield* recordChangeRequest(
                wiki,
                current,
                { ...current.record, pushedHead: stored.head },
                "Publish change request",
                identity(person.actor, now),
              );
              yield* publish("status", wiki.wikiId, input.changeRequestId);
              return yield* view(wiki, next);
            }),
          );
        }),
      input.changeRequestId,
    );

  const adoptHostBranch: WikiService["Service"]["adoptHostBranch"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const host = yield* requireHost(wiki);
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            yield* requireOpen(stored);
            const hostHead = yield* revParse(
              wiki.root,
              `${trackedHostRoot(host.remote)}cr/${input.changeRequestId}`,
            );
            if (hostHead === undefined || (yield* isAncestor(wiki.root, hostHead, stored.head))) {
              return yield* view(wiki, stored);
            }
            const { tree, conflicts } = yield* mergeIntoMain(wiki, hostHead, stored.head);
            if (tree === null) {
              return yield* new WikiError({
                reason: "conflict",
                message: `This ${wikiTerms(wiki).singular} and its copy on the host conflict in ${conflicts.join(", ") || "some files"}. Amend it to reconcile, then publish again.`,
              });
            }
            const now = yield* DateTime.now;
            const env = identity(person.actor, now);
            const commit = yield* commitTree(
              wiki.root,
              tree,
              [stored.head, hostHead],
              `Reconcile with the host's copy\n\nWiki-Change-Request: ${stored.record.changeRequestId}\n`,
              env,
            );
            const main = yield* mainTip(wiki);
            const base = yield* gitOut("adoptBase", wiki.root, ["merge-base", main, commit]);
            const next = yield* recordChangeRequest(
              wiki,
              stored,
              { ...stored.record, base, updatedAt: DateTime.formatIso(now) },
              "Reconcile change request",
              env,
              commit,
            );
            yield* publish("amended", wiki.wikiId, stored.record.changeRequestId);
            return yield* view(wiki, next);
          }),
        ),
      input.changeRequestId,
    );

  const changeRequest: WikiService["Service"]["changeRequest"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        loadChangeRequest(wiki, input.changeRequestId).pipe(
          Effect.flatMap((stored) => view(wiki, stored)),
        ),
      input.changeRequestId,
    );

  const reconcileChangeRequest: WikiService["Service"]["reconcileChangeRequest"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            yield* requireOpen(stored);
            const main = yield* mainTip(wiki);
            if (yield* isAncestor(wiki.root, main, stored.head)) return yield* view(wiki, stored);
            const { tree, conflicts } = yield* mergeIntoMain(wiki, main, stored.head);
            if (tree === null) {
              return yield* new WikiError({
                reason: "conflict",
                message: `Main and this ${wikiTerms(wiki).singular} change the same sentences in ${conflicts.join(", ") || "some files"}.`,
              });
            }
            const now = yield* DateTime.now;
            const env = identity(person.actor, now);
            const commit = yield* commitTree(
              wiki.root,
              tree,
              [stored.head, main],
              `Reconcile with main\n\nWiki-Change-Request: ${stored.record.changeRequestId}\n`,
              env,
            );
            const next = yield* recordChangeRequest(
              wiki,
              stored,
              { ...stored.record, base: main, updatedAt: DateTime.formatIso(now) },
              "Reconcile change request",
              env,
              commit,
            );
            yield* publish("amended", wiki.wikiId, stored.record.changeRequestId);
            return yield* view(wiki, next);
          }),
        ),
      input.changeRequestId,
    );

  const recordPullRequest: WikiService["Service"]["recordPullRequest"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            const now = yield* DateTime.now;
            const next = yield* recordChangeRequest(
              wiki,
              stored,
              { ...stored.record, pullRequest: input.pullRequest },
              "Link pull request",
              identity(person.actor, now),
            );
            yield* publish("status", wiki.wikiId, input.changeRequestId);
            return yield* view(wiki, next);
          }),
        ),
      input.changeRequestId,
    );

  return WikiService.of({
    list,
    root,
    get,
    recordMigration,
    syncFromHost,
    pushChangeRequest,
    adoptHostBranch,
    changeRequest,
    reconcileChangeRequest,
    recordPullRequest,
    subscribe: Stream.fromPubSub(events),
    useCodeFacts: Effect.fn("WikiService.useCodeFacts")(function* (source) {
      yield* Ref.set(codeFacts, source);
    }),
    index,
    docPaths,
    readNote,
    query,
    readFiles,
    locateFile,
    codeStatus,
    orient,
    links,
    changeRequestsList,
    changeRequestsGet,
    amend,
    transform,
    transformCheckout,
    projectIndex,
    projectRename,
    autosave,
    listFiles,
    draftPromote,
    draftMove,
    move,
    revertAmendment,
    setChangeRequestStatus,
  });
});

export const layer = Layer.effect(WikiService, make);
