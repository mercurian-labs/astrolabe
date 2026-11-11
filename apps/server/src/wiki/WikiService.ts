/**
 * Wikis: git repositories of linked markdown notes whose folder is main's hand-editable checkout.
 * Changes reach main via change requests; merges use git's two-tree checkout, which refuses to
 * overwrite local edits. One writer per wiki here; `WikiHostService` owns the git host's side.
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
  planCanvasEdits,
  planTransform,
  WikiFormatError,
  type AmendmentStamp,
  type PlannedAmendment,
  type PlannedMove,
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
  type WikiLinkFiles,
} from "@mercurian/wiki";
import {
  type ProjectId,
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
  type WikiChangeRequestOpenInput,
  type WikiChangeRequestTarget,
  type WikiCheckoutTransformResult,
  type WikiCodeStatus,
  type WikiCodeStatusInput,
  type WikiCodeStatusResult,
  type WikiCreateInput,
  type WikiDraftMoveInput,
  type WikiMoveInput,
  type WikiDraftPromoteInput,
  WikiError,
  type WikiEvent,
  type WikiHostRelation,
  type WikiHostStatus,
  WikiId,
  type WikiIndexResult,
  type WikiListFilesInput,
  type WikiListFilesResult,
  type WikiListResult,
  type WikiMergePreview,
  type WikiMergeResult,
  type WikiNoteResult,
  type WikiPullRequestLink,
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
  type WikiTransform,
  type WikiTransformInput,
  linkedWikiAgentNote,
  type SourceControlProviderKind,
  type WikiCheckoutReach,
  wikiCheckoutAgentNote,
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
  parseChangeList,
  parseTreeListing,
  EDIT_TIMES_DEPTH,
  EDIT_TIMES_FORMAT,
  parseFileListing,
  parseFileTimes,
  withRecordedMoves,
  type WikiFileTimes,
  parseMergeTree,
  type PendingCheckoutAmendment,
  PendingCheckoutAmendmentJson,
  THREAD_CHECKOUTS_FOLDER,
  type WikiRecord,
  type WikiRegistry,
  WikiRegistryJson,
  wikiTerms,
} from "./wikiStorage.ts";
import {
  indexResult,
  linksResult,
  locateBase,
  noteResult,
  orientResult,
  searchFiles,
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

/** A thread's checkout of one wiki. */
export interface WikiCheckout {
  readonly wikiId: WikiId;
  readonly folder: string;
}

/** The person at the keyboard, for changes made from the app. */
export const person: WikiAuthor = { actor: "You", threadId: null };

/**
 * Where a read comes from: a named change request's head, else the thread's own open change
 * request on that wiki, else the main line. `wikiId` may also be the wiki's name, for agents.
 */
export interface WikiReadTarget {
  readonly wikiId: WikiId;
  readonly changeRequestId?: WikiChangeRequestId | undefined;
  readonly threadId?: ThreadId | undefined;
  /**
   * With `threadId` and no `changeRequestId`, read the thread's checkout of the wiki as its files
   * stand, unsaved edits and all, when it has one. A change request's detail lists them apart.
   */
  readonly checkout?: boolean | undefined;
}

/** The thread whose checkout of a wiki the fallback file tools work in. */
export interface WikiCheckoutTarget {
  readonly wikiId: WikiId;
  readonly threadId?: ThreadId | undefined;
}

export interface WikiCheckoutReadResult {
  /** Path from the checkout's root. */
  readonly path: string;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
}

export interface WikiCheckoutWriteInput {
  readonly wikiId: WikiId;
  readonly path: string;
  readonly content?: string | undefined;
  readonly oldText?: string | undefined;
  readonly newText?: string | undefined;
  readonly delete?: boolean | undefined;
}

export interface WikiCheckoutWriteResult {
  readonly path: string;
  readonly change: "created" | "updated" | "deleted";
  /** The errors and warnings of the bases the file now holds. Absent when none. */
  readonly warnings?: ReadonlyArray<string>;
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
     * linked wiki it has a checkout of, or with `linkedSince` only those linked after it. A
     * thread working in a checkout hears, on its first message, only which wiki it is in.
     */
    readonly agentNote: (input: {
      readonly projectId: ProjectId;
      readonly linkedSince?: DateTime.Utc | undefined;
      readonly checkouts: ReadonlyArray<WikiCheckout>;
      readonly reach: WikiCheckoutReach;
      readonly workingIn?: WikiId | undefined;
    }) => Effect.Effect<string | null, WikiError>;
    /** The folder holding a wiki's main line, the repository its worktrees belong to. */
    readonly root: (wikiId: WikiId) => Effect.Effect<string, WikiError>;
    /** Pushes main to the mirror now; a failed push is recorded on the summary, not raised. */
    readonly pushMirror: (input: WikiTarget) => Effect.Effect<WikiSummary, WikiError>;
    readonly index: (input: WikiReadTarget) => Effect.Effect<WikiIndexResult, WikiError>;
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
    /**
     * An agent's transform: written uncommitted into its thread's checkout of the wiki, for the
     * turn's save to land, when it has one and names no change request; else as `transform`.
     */
    readonly transformCheckout: (
      input: WikiTransformInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult | WikiCheckoutTransformResult, WikiError>;
    /**
     * A document in the thread's checkout of the wiki as it stands on disk, whole or lines
     * `startLine` to `endLine`: for a session whose own file tools can't reach the checkout.
     */
    readonly checkoutRead: (
      input: WikiCheckoutTarget & {
        readonly path: string;
        readonly startLine?: number | undefined;
        readonly endLine?: number | undefined;
      },
    ) => Effect.Effect<WikiCheckoutReadResult, WikiError>;
    /** Searches the paths and lines of the documents in the thread's checkout, unsaved edits included. */
    readonly checkoutSearch: (
      input: WikiCheckoutTarget & { readonly query: string },
    ) => Effect.Effect<WikiSearchResult, WikiError>;
    /**
     * Writes a note or a base in the author's thread's checkout, uncommitted, for the turn's save
     * to land: whole `content`, one exact `oldText` replaced by `newText`, or `delete`.
     */
    readonly checkoutWrite: (
      input: WikiCheckoutWriteInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiCheckoutWriteResult, WikiError>;
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
    /**
     * Lands the uncommitted document edits in the worktree that has a change request checked out
     * as one amendment on it, leaving that worktree clean.
     */
    readonly saveWorktree: (
      input: WikiSaveWorktreeInput,
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult, WikiError>;
    /** The wikis linked to a project. */
    readonly linkedTo: (projectId: ProjectId) => Effect.Effect<ReadonlyArray<WikiId>, WikiError>;
    /** The wiki linked to a project that `reference` names by id or name. */
    readonly linkedWiki: (
      projectId: ProjectId,
      reference: string,
    ) => Effect.Effect<WikiId, WikiError>;
    /**
     * Makes `folder` a worktree of the wiki on the thread's open change request, or detached at
     * main's tip while it has none; one with unsaved edits stays as it is. Returns the folder
     * holding the checkout, another one when the change request is checked out elsewhere.
     */
    readonly checkoutForThread: (input: {
      readonly wikiId: WikiId;
      readonly threadId: ThreadId;
      readonly folder: string;
    }) => Effect.Effect<string, WikiError>;
    /**
     * Lands a thread's checkout's unsaved document edits as one amendment on its open change
     * request, opening one titled `title` when it has none. Null when nothing changed.
     */
    readonly saveThreadCheckout: (
      input: {
        readonly wikiId: WikiId;
        readonly threadId: ThreadId;
        readonly folder: string;
        readonly title: string;
        readonly message: string;
      },
      author: WikiAuthor,
    ) => Effect.Effect<WikiAmendResult | null, WikiError>;
    /** Removes a worktree of the wiki, unsaved edits and all. */
    readonly removeCheckout: (input: {
      readonly wikiId: WikiId;
      readonly folder: string;
    }) => Effect.Effect<void, WikiError>;
    /** A person's act: lands an open change request on main and moves the checkout with it. */
    readonly merge: (input: WikiChangeRequestTarget) => Effect.Effect<WikiMergeResult, WikiError>;
    readonly setChangeRequestStatus: (
      input: WikiSetChangeRequestStatusInput,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    readonly get: (wikiId: WikiId) => Effect.Effect<WikiSummary, WikiError>;
    /** The wikis on a host, read from the registry alone. */
    readonly hosted: Effect.Effect<ReadonlyArray<WikiId>, WikiError>;
    /** Makes `remote` the wiki's main line, or with null makes it local again; drops a mirror. */
    readonly setHost: (
      wikiId: WikiId,
      host: {
        readonly projectId: ProjectId;
        readonly remote: string;
        readonly kind: SourceControlProviderKind;
        readonly createdProject: boolean;
      } | null,
    ) => Effect.Effect<WikiSummary, WikiError>;
    /** Fetches the host, fast-forwards main and the open change requests, and records how it went. */
    readonly syncFromHost: (wikiId: WikiId) => Effect.Effect<WikiHostRelation, WikiError>;
    /** Records what stopped a change request following the host, or clears it with null. */
    readonly recordChangeRequestIssue: (
      wikiId: WikiId,
      message: string | null,
    ) => Effect.Effect<void, WikiError>;
    /** Records a sync or publish that failed, or clears one with null. */
    readonly recordHostError: (
      wikiId: WikiId,
      message: string | null,
    ) => Effect.Effect<void, WikiError>;
    /** Pushes main without force, for a wiki moving onto a host. */
    readonly pushMainToHost: (wikiId: WikiId) => Effect.Effect<void, WikiError>;
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
    /** Records that the host merged a change request; main has already been synced. */
    readonly recordHostMerge: (
      input: WikiChangeRequestTarget,
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

const decodeRegistry = Schema.decodeEffect(WikiRegistryJson);
const encodeRegistry = Schema.encodeEffect(WikiRegistryJson);
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
  const fetchLocks = new Map<string, Semaphore.Semaphore>();
  const snapshots = lru<Snapshot>(24);
  const amendmentLogs = lru<WikiChangeRequest["amendments"]>(128);
  const changedFiles = lru<ChangedFiles>(128);
  const metadataRecords = lru<ChangeRequestRecord>(512);
  const editTimes = lru<WikiFileTimes>(24);
  const corpora = lru<BaseCorpus>(8);
  const fileListings = lru<FileListing>(8);
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
    const index = yield* Effect.try({ try: () => indexFiles(files), catch: planningError });
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
    withWiki(
      target.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const checkout = yield* threadCheckout(wiki, target);
          if (checkout !== null) {
            const { head, snapshot } = yield* checkoutSnapshot(wiki, checkout);
            return read(wiki, head, snapshot);
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

  const autosave: WikiService["Service"]["autosave"] = (input, author) =>
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

  /** Moves main from `from` to `to`, and the folder that has main checked out with it. */
  const moveMain = (wiki: WikiRecord, from: string, to: string, what: "merge" | "sync" = "merge") =>
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
        busy: (paths) => {
          const where = paths.length ? `: ${paths.join(", ")}` : "";
          return what === "merge"
            ? `Local edits in the wiki folder overlap this merge${where}. Commit or set them aside, then merge again.`
            : `Local edits in the wiki folder overlap what's new on the host${where}. Commit or set them aside, and the wiki catches up.`;
        },
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
                message: `This ${wikiTerms(wiki).singular} is not checked out in a worktree.`,
              });
            }
            return yield* withWorkspaceLease(
              at,
              Effect.gen(function* () {
                if ((yield* gitOut("worktreeHead", at, ["rev-parse", "HEAD"])) !== stored.head) {
                  return yield* new WikiError({
                    reason: "stale",
                    message: `The ${wikiTerms(wiki).singular} moved while this ran. Read it again and retry.`,
                  });
                }
                const result = yield* landCheckoutEdits(
                  wiki,
                  at,
                  stored.head,
                  { kind: "existing", stored },
                  author,
                  input.message,
                  false,
                );
                if (result === null) {
                  return yield* new WikiError({
                    reason: "invalid",
                    message: "No document in this worktree has unsaved changes.",
                  });
                }
                return result;
              }),
            );
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

  const clearPending = (at: string) =>
    pendingFile(at).pipe(
      Effect.flatMap((file) => fileSystem.remove(file, { force: true })),
      Effect.ignore,
    );

  /**
   * Lands the unsaved edits in `at`, whose HEAD is `from`, as one amendment on `target`, then
   * leaves the folder clean on the target's branch; null when there were none. Callers hold the
   * wiki's lock and the folder's lease.
   */
  const landCheckoutEdits = Effect.fn("WikiService.landCheckoutEdits")(function* (
    wiki: WikiRecord,
    at: string,
    from: string,
    target: Target,
    author: WikiAuthor,
    message: string,
    /** A thread's checkout saves every visible file; a person's worktree only its documents. */
    attachments: boolean,
    /** Where the folder's own commits began, when they are to land as edits too. */
    since?: string,
  ) {
    const edits = yield* checkoutEdits(at, attachments, since);
    if (carriedNames(edits).length === 0) {
      yield* clearPending(at);
      return null;
    }
    const pending = Option.getOrUndefined(yield* readPending(at));
    const gone = (file: string) =>
      edits.changes[file] === null || (file in edits.blobs && edits.blobs[file] === null);
    const present = (file: string) =>
      typeof edits.changes[file] === "string" || typeof edits.blobs[file] === "string";
    // Only the moves a transform made that still stand: a later edit may have undone one.
    const moved = (pending?.moved ?? []).filter(({ from, to }) => gone(from) && present(to));
    const result = yield* land(
      wiki,
      target,
      author,
      message,
      (files, stamp) => ({
        ...(Object.keys(edits.changes).length === 0
          ? { changes: {}, errors: indexFiles(files).errors }
          : // A move adds no edge, so an edge that stood unsupported only comes along.
            planAmendment(files, edits.changes, stamp, { allowUnstamped: moved.length > 0 })),
        blobs: edits.blobs,
        ...(moved.length === 0 ? {} : { moved }),
      }),
      { follow: false, ...(pending === undefined ? {} : { pending }) },
    );
    yield* clearPending(at);
    const branch = changeRequestBranch(result.changeRequest.changeRequestId);
    const onBranch = yield* runGit("checkoutBranch", at, ["symbolic-ref", "-q", "HEAD"], {
      allowExitCodes: [1],
    });
    // Moves HEAD alone: the folder already holds the edits the new branch's head has.
    if (onBranch.stdout.trim() !== branch) {
      yield* runGit("adoptBranch", at, ["symbolic-ref", "HEAD", branch]);
    }
    // The folder already holds the edits: line its index up with the new head, then write what
    // the amendment changed besides them (stamps, map warnings, a head that moved meanwhile).
    const touched = (yield* runGit("amendedFiles", at, [
      "diff",
      "--name-status",
      "--no-renames",
      "-z",
      from,
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
      yield* fileSystem.remove(path.join(at, file), { force: true }).pipe(Effect.ignore);
    }
    return result;
  });

  /** Where a checkout's own commits began: the last commit `head` shares with main. */
  const checkoutBase = (wiki: WikiRecord, head: string) =>
    runGit("checkoutBase", wiki.root, ["merge-base", head, mainRef(wiki)], {
      allowExitCodes: [1],
    }).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : head)));

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

  /** The thread's checkout of the wiki a read or an agent's transform works in, if it has one. */
  const threadCheckout = Effect.fn("WikiService.threadCheckout")(function* (
    wiki: WikiRecord,
    target: WikiReadTarget,
  ) {
    if (!target.checkout || target.threadId === undefined) return null;
    if (target.changeRequestId !== undefined) return null;
    const folder = path.join(
      config.stateDir,
      THREAD_CHECKOUTS_FOLDER,
      target.threadId,
      wiki.wikiId,
    );
    if (!(yield* fileSystem.exists(folder).pipe(Effect.orElseSucceed(() => false)))) return null;
    return (yield* listedCheckout(wiki, folder)) === undefined ? null : folder;
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
    const snapshot: Snapshot = {
      files,
      index: yield* Effect.try({ try: () => indexFiles(files), catch: planningError }),
      others: [
        ...committed.others.filter(({ file }) => !(file in edits.blobs)),
        ...Object.entries(edits.blobs).flatMap(([file, oid]) =>
          oid === null ? [] : [{ file, oid }],
        ),
      ],
    };
    return { head, edits, snapshot };
  });

  const ioError = (message: string) => (cause: unknown) =>
    new WikiError({ reason: "git-failed", message, cause });

  /**
   * Plans a transform on a checkout's files and writes the result there, uncommitted. Its stamps
   * carry the amendment id the turn's save will land under. Callers hold the lock and the lease.
   */
  const transformInCheckout = Effect.fn("WikiService.transformInCheckout")(function* (
    wiki: WikiRecord,
    folder: string,
    change: WikiTransform,
  ): Effect.fn.Return<WikiCheckoutTransformResult, WikiError> {
    const { snapshot } = yield* checkoutSnapshot(wiki, folder);
    const stored = yield* readPending(folder);
    const pending = Option.isSome(stored)
      ? stored.value
      : { amendment: yield* newId, minted: 0, moved: [] };
    let minted = pending.minted;
    const stamp: AmendmentStamp = {
      amendment: pending.amendment,
      at: yield* nowIso,
      newId: () => `${pending.amendment}-${++minted}`,
    };
    const planned = yield* Effect.try({
      try: () => planWikiTransform(change)(snapshot.files, stamp, snapshot.others),
      catch: planningError,
    });
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
      yield* fileSystem.writeFileString(
        yield* pendingFile(folder),
        yield* encodePending({
          amendment: pending.amendment,
          minted,
          moved: chainMoves(pending.moved, planned.moved ?? []),
        }),
      );
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

  const transformCheckout: WikiService["Service"]["transformCheckout"] = (input, author) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const folder =
            author.threadId === null
              ? null
              : yield* threadCheckout(wiki, {
                  wikiId: wiki.wikiId,
                  threadId: author.threadId,
                  changeRequestId: input.changeRequestId,
                  checkout: true,
                });
          if (folder === null) return yield* transform(input, author);
          return yield* locked(
            wiki,
            withWorkspaceLease(folder, transformInCheckout(wiki, folder, input.transform)),
          );
        }),
      input.changeRequestId,
    );

  /** The thread's checkout of the wiki, which the fallback file tools work in alone. */
  const requireCheckout = Effect.fn("WikiService.requireCheckout")(function* (
    wiki: WikiRecord,
    threadId: ThreadId | null | undefined,
  ) {
    const folder =
      threadId == null
        ? null
        : yield* threadCheckout(wiki, { wikiId: wiki.wikiId, threadId, checkout: true });
    if (folder === null) {
      return yield* new WikiError({
        reason: "not-found",
        message: `Your thread has no checkout of this ${wikiTerms(wiki).singular}.`,
      });
    }
    return folder;
  });

  const outsideCheckout = (file: string) =>
    new WikiError({
      reason: "invalid",
      message: `${file} is not a path inside the wiki: give one from its root, as in area/Name.md.`,
    });

  /** Where `file`, a wiki path, sits in a checkout. A link on disk leading out of it is refused. */
  const checkoutFile = Effect.fn("WikiService.checkoutFile")(function* (
    folder: string,
    file: string,
  ) {
    const at = path.join(folder, file);
    const root = yield* fileSystem
      .realPath(folder)
      .pipe(Effect.mapError(ioError("Could not read the checkout.")));
    let probe = at;
    while (
      probe !== folder &&
      !(yield* fileSystem.exists(probe).pipe(Effect.orElseSucceed(() => false)))
    ) {
      probe = path.dirname(probe);
    }
    const real = yield* fileSystem.realPath(probe).pipe(Effect.orElseSucceed(() => probe));
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
      return yield* outsideCheckout(file);
    }
    return at;
  });

  const checkoutRead: WikiService["Service"]["checkoutRead"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      Effect.gen(function* () {
        if (!isWikiPath(input.path)) return yield* outsideCheckout(input.path);
        if (!isWikiDocument(input.path)) {
          return yield* new WikiError({
            reason: "invalid",
            message: `${input.path} is not a note, base or canvas.`,
          });
        }
        const folder = yield* requireCheckout(wiki, input.threadId);
        const text = yield* fileSystem.readFileString(yield* checkoutFile(folder, input.path)).pipe(
          Effect.mapError(
            (cause) =>
              new WikiError({
                reason: "not-found",
                message: `${input.path} is not in the wiki.`,
                cause,
              }),
          ),
        );
        const lines = text.split("\n");
        if (lines.at(-1) === "") lines.pop();
        const startLine = Math.max(1, input.startLine ?? 1);
        const endLine = Math.min(lines.length, input.endLine ?? lines.length);
        return {
          path: input.path,
          text:
            startLine === 1 && endLine === lines.length
              ? text
              : lines.slice(startLine - 1, endLine).join("\n"),
          startLine,
          endLine,
          totalLines: lines.length,
        };
      }),
    );

  const checkoutSearch: WikiService["Service"]["checkoutSearch"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      Effect.gen(function* () {
        const folder = yield* requireCheckout(wiki, input.threadId);
        const { snapshot } = yield* checkoutSnapshot(wiki, folder);
        return searchFiles(snapshot.files, input.query);
      }),
    );

  const checkoutWrite: WikiService["Service"]["checkoutWrite"] = (input, author) =>
    withWiki(input.wikiId, (wiki) =>
      Effect.gen(function* () {
        const file = input.path;
        const refuse = (message: string) => new WikiError({ reason: "invalid", message });
        if (!isWikiPath(file)) return yield* outsideCheckout(file);
        if (isCanvasFile(file)) {
          return yield* refuse("A canvas changes through a canvas transform, never its JSON.");
        }
        if (!isWikiDocument(file)) return yield* refuse(`${file} is not a note (.md) or a base.`);
        const replacing = input.oldText !== undefined || input.newText !== undefined;
        const modes = [input.content !== undefined, replacing, input.delete === true];
        if (modes.filter(Boolean).length !== 1) {
          return yield* refuse("Give one of content, oldText with newText, or delete.");
        }
        if (replacing && (input.oldText === undefined || input.newText === undefined)) {
          return yield* refuse("oldText and newText go together.");
        }
        if (input.oldText === "") return yield* refuse("oldText cannot be empty.");
        const folder = yield* requireCheckout(wiki, author.threadId);
        return yield* locked(
          wiki,
          withWorkspaceLease(
            folder,
            Effect.gen(function* () {
              const at = yield* checkoutFile(folder, file);
              const existing = Option.getOrUndefined(
                yield* fileSystem.readFileString(at).pipe(Effect.option),
              );
              const missing = new WikiError({
                reason: "not-found",
                message: `${file} is not in the wiki.`,
              });
              if (input.delete === true) {
                if (existing === undefined) return yield* missing;
                yield* fileSystem.remove(at);
                return { path: file, change: "deleted" as const };
              }
              let next = input.content;
              if (next === undefined) {
                const oldText = input.oldText ?? "";
                if (existing === undefined) return yield* missing;
                const first = existing.indexOf(oldText);
                if (first === -1) return yield* refuse(`oldText is not in ${file}.`);
                if (existing.indexOf(oldText, first + 1) !== -1) {
                  return yield* refuse(
                    `oldText is in ${file} more than once: include more of the text around it.`,
                  );
                }
                next = `${existing.slice(0, first)}${input.newText ?? ""}${existing.slice(first + oldText.length)}`;
              }
              yield* fileSystem.makeDirectory(path.dirname(at), { recursive: true });
              yield* fileSystem.writeFileString(at, next);
              const check = documentBaseCheck(file, next);
              const warnings = [...check.errors, ...check.warnings];
              return {
                path: file,
                change: existing === undefined ? "created" : "updated",
                ...(warnings.length ? { warnings } : {}),
              } as const;
            }).pipe(
              Effect.mapError((cause) =>
                isWikiError(cause)
                  ? cause
                  : ioError("Could not write the note into the checkout.")(cause),
              ),
            ),
          ),
        );
      }),
    );

  const checkoutForThread: WikiService["Service"]["checkoutForThread"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      locked(
        wiki,
        Effect.gen(function* () {
          const own = yield* threadChangeRequest(wiki, input.threadId);
          const branch = own === undefined ? null : changeRequestBranch(own.record.changeRequestId);
          const listed = yield* listedCheckout(wiki, input.folder);
          const elsewhere = branch === null ? null : yield* checkoutHolding(wiki, branch);
          if (elsewhere !== null && elsewhere !== listed?.path) return elsewhere;
          const main = yield* mainTip(wiki);
          if (listed === undefined) {
            yield* runGit("pruneWorktrees", wiki.root, ["worktree", "prune"]);
            yield* fileSystem
              .makeDirectory(path.dirname(input.folder), { recursive: true })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new WikiError({ reason: "invalid", message: "No folder for it.", cause }),
                ),
              );
            yield* runGit(
              "addThreadCheckout",
              wiki.root,
              branch === null
                ? ["worktree", "add", "--quiet", "--detach", input.folder, main]
                : ["worktree", "add", "--quiet", input.folder, branch.slice("refs/heads/".length)],
            );
            return input.folder;
          }
          const current = listed.branch === null ? null : `refs/heads/${listed.branch}`;
          if (current === branch && (branch !== null || listed.head === main)) return input.folder;
          // Unsaved edits and commits stay where they are; the turn-end save lands them.
          const since =
            listed.branch === null && listed.head !== null
              ? yield* checkoutBase(wiki, listed.head)
              : undefined;
          if (carriedNames(yield* checkoutEdits(input.folder, true, since)).length > 0)
            return input.folder;
          yield* withWorkspaceLease(
            input.folder,
            runGit(
              "switchThreadCheckout",
              input.folder,
              branch === null
                ? ["checkout", "--quiet", "--detach", main]
                : ["checkout", "--quiet", branch.slice("refs/heads/".length)],
            ),
          );
          return input.folder;
        }),
      ),
    );

  const saveThreadCheckout: WikiService["Service"]["saveThreadCheckout"] = (input, author) =>
    withWiki(input.wikiId, (wiki) =>
      locked(
        wiki,
        withWorkspaceLease(
          input.folder,
          Effect.gen(function* () {
            const listed = yield* listedCheckout(wiki, input.folder);
            if (listed === undefined) return null;
            const from = yield* gitOut("worktreeHead", input.folder, ["rev-parse", "HEAD"]);
            const own = yield* threadChangeRequest(wiki, input.threadId);
            // Commits made on a detached checkout belong to no branch: they land in this amendment.
            const since = listed.branch === null ? yield* checkoutBase(wiki, from) : from;
            const target: Target =
              own !== undefined
                ? { kind: "existing", stored: own }
                : {
                    kind: "new",
                    changeRequestId: WikiChangeRequestId.make(yield* newId),
                    base: since,
                    title: oneLine(input.title) || subjectOf(input.message) || "Wiki change",
                    draft: false,
                  };
            return yield* landCheckoutEdits(
              wiki,
              input.folder,
              from,
              target,
              author,
              input.message,
              true,
              since === from ? undefined : since,
            );
          }),
        ),
      ),
    );

  const removeCheckout: WikiService["Service"]["removeCheckout"] = (input) =>
    withWiki(input.wikiId, (wiki) =>
      locked(
        wiki,
        runGit("removeThreadCheckout", wiki.root, [
          "worktree",
          "remove",
          "--force",
          input.folder,
        ]).pipe(
          Effect.catchIf(
            (error) => error.reason === "git-failed",
            () => runGit("pruneWorktrees", wiki.root, ["worktree", "prune"]),
          ),
          Effect.asVoid,
        ),
      ),
    );

  const merge: WikiService["Service"]["merge"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            if (wiki.host !== null) {
              return yield* new WikiError({
                reason: "invalid",
                message: `This merges on the host, through its ${wikiTerms(wiki).singular}.`,
              });
            }
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            yield* requireOpen(stored);
            if (stored.record.draft) {
              return yield* new WikiError({
                reason: "invalid",
                message: `A draft doesn't merge. Make it a ${wikiTerms(wiki).singular} first.`,
              });
            }
            const main = yield* mainTip(wiki);
            if (yield* isAncestor(wiki.root, stored.head, main)) {
              return yield* new WikiError({
                reason: "invalid",
                message: `Nothing to merge: main already has every amendment in this ${wikiTerms(wiki).singular}.`,
              });
            }
            const { tree, conflicts } = yield* mergeIntoMain(wiki, main, stored.head);
            if (tree === null) {
              return yield* new WikiError({
                reason: "conflict",
                message: `Merging conflicts with main in ${conflicts.join(", ") || "some files"}. ${
                  conflicts.some(isCanvasFile)
                    ? settleInWorktree(wikiTerms(wiki).singular)
                    : `Amend the ${wikiTerms(wiki).singular} to reconcile, then merge again.`
                }`,
              });
            }
            const now = yield* DateTime.now;
            const env = identity(person.actor, now);
            const commit = yield* commitTree(
              wiki.root,
              tree,
              [main, stored.head],
              `Merge ${wikiTerms(wiki).singular}: ${oneLine(stored.record.title)}\n\nWiki-Change-Request: ${stored.record.changeRequestId}\n`,
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
      Effect.map(
        (all) => all.filter(({ record }) => record.status === "open" && !record.draft).length,
      ),
      // A wiki whose folder went away still lists, so it can be removed.
      Effect.orElseSucceed(() => 0),
      Effect.map((openChangeRequests): WikiSummary => ({
        wikiId: wiki.wikiId,
        name: wiki.name,
        root: wiki.root,
        mainBranch: wiki.mainBranch,
        projectIds: wiki.projectIds,
        mirror: wiki.mirror,
        host: wiki.host,
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

  /** Every file at `commit`, at any depth. */
  const fileListingAt = Effect.fn("WikiService.fileListingAt")(function* (
    wiki: WikiRecord,
    commit: string,
  ) {
    const cached = fileListings.get(commit);
    if (cached !== undefined) return cached;
    const entries = parseFileListing(
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

  /** Every file at `commit` as a base lists them; only notes and canvases are read. */
  const corpusAt = Effect.fn("WikiService.corpusAt")(function* (wiki: WikiRecord, commit: string) {
    const cached = corpora.get(commit);
    if (cached !== undefined) return cached;
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
          const checkout = yield* threadCheckout(wiki, input);
          const inCheckout = checkout === null ? null : yield* checkoutSnapshot(wiki, checkout);
          const commit = inCheckout?.head ?? (yield* readCommit(wiki, input));
          const snapshot = inCheckout?.snapshot ?? (yield* snapshotAt(wiki, commit));
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
          const index = edited ? indexFiles(applyChanges(snapshot.files, viewed)) : snapshot.index;
          const changes = { ...inCheckout?.edits.changes, ...viewed };
          const located = locateBase(index, input);
          if ("problem" in located) {
            return yield* new WikiError({ reason: located.problem, message: located.message });
          }
          const committed = yield* corpusAt(wiki, commit);
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
          const problems = [...errors, ...warnings];
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

  const readFiles: WikiService["Service"]["readFiles"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const commit = yield* fileCommit(wiki, input);
          const listing = yield* fileListingAt(wiki, commit);
          const found = input.paths.map((path) => listedFile(listing, path, input.from ?? null));
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
    withWiki(
      input.wikiId,
      (wiki) =>
        Effect.gen(function* () {
          const commit = yield* fileCommit(wiki, input);
          const listing = yield* fileListingAt(wiki, commit);
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
          const checkout = yield* threadCheckout(wiki, input);
          const unsaved =
            checkout === null
              ? undefined
              : carriedNames(yield* checkoutEdits(checkout, true)).toSorted();
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
              message: unsaved?.length
                ? `This thread has no open ${singular} on this wiki yet. The turn's end opens one with its unsaved files: ${unsaved.join(", ")}.`
                : `This thread has no open ${singular} on this wiki.`,
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
            ...(unsaved === undefined ? {} : { unsaved }),
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
              draft: false,
              branch: changeRequestBranch(changeRequestId),
              base,
              threadId: author.threadId,
              createdBy: actorName(author),
              createdAt: at,
              updatedAt: at,
              mergedCommit: null,
              pullRequest: null,
              pushedHead: null,
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
      host: null,
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
        if (wiki.host !== null && input.url !== null) {
          return yield* new WikiError({
            reason: "invalid",
            message: "A host wiki has no mirror: the host already holds its main line.",
          });
        }
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

  const linkedTo: WikiService["Service"]["linkedTo"] = (projectId) =>
    Effect.map(loadRegistry, (registry) =>
      registry.wikis
        .filter((wiki) => wiki.projectIds.includes(projectId))
        .map((wiki) => wiki.wikiId),
    );

  const linkedWiki: WikiService["Service"]["linkedWiki"] = Effect.fn("WikiService.linkedWiki")(
    function* (projectId, reference) {
      const { wikis } = yield* loadRegistry;
      const names = (wiki: WikiRecord) =>
        wiki.wikiId === reference || wiki.name.toLowerCase() === reference.toLowerCase();
      const linked = wikis.filter((wiki) => wiki.projectIds.includes(projectId));
      const byId = linked.find((wiki) => wiki.wikiId === reference);
      if (byId !== undefined) return byId.wikiId;
      const found = linked.filter(names);
      if (found.length === 1) return found[0]!.wikiId;
      const listed = linked.map((wiki) => `"${wiki.name}"`).join(", ");
      return yield* new WikiError({
        reason: found.length > 1 ? "invalid" : "not-found",
        message: `${
          found.length > 1
            ? "Several wikis linked to this project have this name; use the wiki's id."
            : wikis.some(names)
              ? "That wiki is not linked to this project."
              : "No wiki has this id or name."
        } ${linked.length === 0 ? "This project has no linked wikis." : `Its linked wikis: ${listed}.`}`,
      });
    },
  );

  const agentNote: WikiService["Service"]["agentNote"] = (input) =>
    loadRegistry.pipe(
      Effect.map((registry) => {
        if (input.workingIn !== undefined) {
          const wiki = registry.wikis.find((candidate) => candidate.wikiId === input.workingIn);
          return wiki === undefined || input.linkedSince !== undefined
            ? null
            : wikiCheckoutAgentNote(wiki.name);
        }
        const linkedSince = input.linkedSince;
        return linkedWikiAgentNote(
          registry.wikis.flatMap((wiki) => {
            if (!wiki.projectIds.includes(input.projectId)) return [];
            const linkedAt = wiki.projectLinkedAt[input.projectId];
            if (
              linkedSince !== undefined &&
              (linkedAt === undefined ||
                Date.parse(linkedAt) <= DateTime.toEpochMillis(linkedSince))
            )
              return [];
            const checkout = input.checkouts.find((candidate) => candidate.wikiId === wiki.wikiId);
            return checkout === undefined
              ? []
              : [{ name: wiki.name, folder: checkout.folder, reach: input.reach }];
          }),
        );
      }),
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

  const get: WikiService["Service"]["get"] = (wikiId) => withWiki(wikiId, summary);

  const hosted: WikiService["Service"]["hosted"] = Effect.map(loadRegistry, (registry) =>
    registry.wikis.filter((wiki) => wiki.host !== null).map((wiki) => wiki.wikiId),
  );

  const requireHost = (wiki: WikiRecord) =>
    wiki.host === null
      ? Effect.fail(
          new WikiError({ reason: "invalid", message: "This wiki is not connected to a host." }),
        )
      : Effect.succeed(wiki.host);

  /** Re-reads the wiki inside its lock, since a sync may have waited behind a disconnect. */
  const replaceHost = (wiki: WikiRecord, update: (host: WikiHostStatus) => WikiHostStatus) =>
    updateRegistry((registry) => {
      const current = registry.wikis.find((entry) => entry.wikiId === wiki.wikiId);
      if (current === undefined || current.host === null) {
        return Effect.succeed([registry, undefined] as const);
      }
      const next = { ...current, host: update(current.host) };
      return Effect.succeed([
        {
          ...registry,
          wikis: registry.wikis.map((entry) => (entry.wikiId === next.wikiId ? next : entry)),
        },
        undefined,
      ] as const);
    }).pipe(Effect.andThen(publish("mirror", wiki.wikiId, null)));

  const setHost: WikiService["Service"]["setHost"] = (wikiId, host) =>
    withWiki(wikiId, (wiki) =>
      Effect.gen(function* () {
        if (host !== null) {
          // A name that reads as an option would reach git as one.
          const known =
            !host.remote.startsWith("-") &&
            (yield* runGit("remoteUrl", wiki.root, ["remote", "get-url", host.remote], {
              allowExitCodes: [2, 128],
            })).exitCode === 0;
          if (!known) {
            return yield* new WikiError({
              reason: "invalid",
              message: `The wiki's folder has no git remote named ${host.remote}.`,
            });
          }
        }
        const next = yield* locked(
          wiki,
          Effect.gen(function* () {
            // Links name pull requests on this host; a later host would read them as its own.
            if (host === null) {
              const now = yield* DateTime.now;
              for (const stored of yield* readChangeRequests(wiki)) {
                if (stored.record.pullRequest === null || stored.record.status === "merged") {
                  continue;
                }
                yield* recordChangeRequest(
                  wiki,
                  stored,
                  { ...stored.record, pullRequest: null, pushedHead: null },
                  "Disconnect from the host",
                  identity(person.actor, now),
                );
              }
            }
            return yield* replaceWiki({
              ...wiki,
              mirror: host === null ? wiki.mirror : null,
              host:
                host === null
                  ? null
                  : {
                      ...host,
                      lastSyncedAt: null,
                      lastSyncedCommit: null,
                      relation: null,
                      lastError: null,
                    },
            });
          }),
        );
        yield* publish("mirror", wiki.wikiId, null);
        return yield* summary(next);
      }),
    );

  const recordHostError: WikiService["Service"]["recordHostError"] = (wikiId, message) =>
    withWiki(wikiId, (wiki) =>
      wiki.host === null || wiki.host.lastError === message
        ? Effect.void
        : replaceHost(wiki, (host) => ({ ...host, lastError: message })),
    );

  const recordChangeRequestIssue: WikiService["Service"]["recordChangeRequestIssue"] = (
    wikiId,
    message,
  ) =>
    withWiki(wikiId, (wiki) =>
      wiki.host === null || (wiki.host.changeRequestIssue ?? null) === message
        ? Effect.void
        : replaceHost(wiki, (host) => ({ ...host, changeRequestIssue: message })),
    );

  const trackedHostRoot = (remote: string) => `refs/wiki/host/${remote}/`;

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
    let lock = fetchLocks.get(wiki.wikiId);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      fetchLocks.set(wiki.wikiId, lock);
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
        return yield* locked(
          wiki,
          Effect.gen(function* () {
            const local = yield* mainTip(wiki);
            const remoteMain = remote.get(mainRef(wiki));
            let main = local;
            let relation: WikiHostRelation = "ahead";
            let busy: string | null = null;
            if (remoteMain === local) {
              relation = "up-to-date";
            } else if (remoteMain !== undefined) {
              if (yield* isAncestor(wiki.root, local, remoteMain)) {
                // The folder's unsaved edits hold main back until they are dealt with.
                busy = yield* moveMain(wiki, local, remoteMain, "sync").pipe(
                  Effect.as(null),
                  Effect.catchIf(
                    (error) => error.reason === "checkout-busy",
                    (error) => Effect.succeed(error.message),
                  ),
                );
                if (busy === null) {
                  main = remoteMain;
                  relation = "up-to-date";
                  yield* publish("main-moved", wiki.wikiId, null);
                } else {
                  relation = "behind";
                }
              } else if (!(yield* isAncestor(wiki.root, remoteMain, local))) {
                relation = "diverged";
              }
            }
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
            const at = yield* nowIso;
            yield* replaceHost(wiki, (current) => ({
              ...current,
              lastSyncedAt: at,
              lastSyncedCommit: remoteMain ?? null,
              relation,
              lastError: busy,
            }));
            return relation;
          }),
        );
      }),
    );

  const pushMainToHost: WikiService["Service"]["pushMainToHost"] = (wikiId) =>
    withWiki(wikiId, (wiki) =>
      Effect.gen(function* () {
        const host = yield* requireHost(wiki);
        yield* runGit(
          "pushMainToHost",
          wiki.root,
          ["push", "--no-verify", host.remote, `${mainRef(wiki)}:${mainRef(wiki)}`],
          { timeoutMs: REMOTE_TIMEOUT_MS },
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

  const recordHostMerge: WikiService["Service"]["recordHostMerge"] = (input) =>
    withWiki(
      input.wikiId,
      (wiki) =>
        locked(
          wiki,
          Effect.gen(function* () {
            const stored = yield* loadChangeRequest(wiki, input.changeRequestId);
            if (stored.record.status === "merged") return yield* view(wiki, stored);
            const now = yield* DateTime.now;
            const next = yield* recordChangeRequest(
              wiki,
              stored,
              {
                ...stored.record,
                status: "merged",
                // The host's main: unsaved edits here can hold this folder's back.
                mergedCommit: wiki.host?.lastSyncedCommit ?? (yield* mainTip(wiki)),
                updatedAt: DateTime.formatIso(now),
              },
              "Merge change request",
              identity(person.actor, now),
            );
            yield* publish("merged", wiki.wikiId, stored.record.changeRequestId);
            return yield* view(wiki, next);
          }),
        ),
      input.changeRequestId,
    );

  return WikiService.of({
    list,
    root,
    get,
    hosted,
    setHost,
    syncFromHost,
    recordHostError,
    recordChangeRequestIssue,
    pushMainToHost,
    pushChangeRequest,
    adoptHostBranch,
    changeRequest,
    reconcileChangeRequest,
    recordPullRequest,
    recordHostMerge,
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
    transformCheckout,
    checkoutRead,
    checkoutSearch,
    checkoutWrite,
    autosave,
    listFiles,
    draftPromote,
    draftMove,
    move,
    revertAmendment,
    saveWorktree,
    linkedTo,
    linkedWiki,
    checkoutForThread,
    saveThreadCheckout,
    removeCheckout,
    merge,
    setChangeRequestStatus,
  });
});

export const layer = Layer.effect(WikiService, make);
