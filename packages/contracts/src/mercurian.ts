/**
 * Mercurian's planning surface on the wire: projects, plans, and the artifact
 * and history of a planning space.
 *
 * A project contains plans; a plan is the unit of work and owns exactly one
 * planning space. A commit arrives already projected into what the surface
 * renders, never as an opaque payload. Three constant-size facts about the
 * commit itself ride along as deliberate exceptions, because the DAG explorer
 * renders the history's shape: `sequence`, the store's append order and a
 * subscription's resume cursor; `parents`, the edges the explorer draws; and
 * `published`, which tells shared work from private.
 *
 * A message's `attachments` are the fourth such exception, and the same shape
 * of one: metadata only — id, name, type, size — so a commit stays
 * constant-size on the wire. The bytes are fetched later through the assets
 * door, by id, and never ride a subscription.
 *
 * Names are `Mercurian`-prefixed wherever the fork already owns the word:
 * a t3code `Project` is an on-disk workspace root, a Mercurian project is a
 * container of plans, and the contracts barrel re-exports both.
 *
 * @module MercurianContracts
 */
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
// Import creates a plan, so it belongs to the planning surface — but the issue
// it creates one from is the tracker surface's own shape, passed back verbatim.
import { TrackerConnectionId, TrackerIssue } from "./mercurianTrackers.ts";
import { PlanningModelSelection } from "./mercurianWorkspace.ts";
import {
  BranchMovement,
  ChatAttachment,
  ModelSelection,
  SnapshotKind,
  UploadChatAttachment,
} from "./orchestration.ts";

export const MERCURIAN_WS_METHODS = {
  subscribeTree: "mercurian.subscribeTree",
  subscribePlan: "mercurian.subscribePlan",
  createProject: "mercurian.createProject",
  createPlan: "mercurian.createPlan",
  importPlan: "mercurian.importPlan",
  appendPlanMessage: "mercurian.appendPlanMessage",
  savePlanRevision: "mercurian.savePlanRevision",
  saveSpecRevision: "mercurian.saveSpecRevision",
  refreshSpec: "mercurian.refreshSpec",
  tryImplement: "mercurian.tryImplement",
  confirmSplits: "mercurian.confirmSplits",
  confirmMemoryAmendment: "mercurian.confirmMemoryAmendment",
  cancelMemoryAmendment: "mercurian.cancelMemoryAmendment",
  cancelImplementProposal: "mercurian.cancelImplementProposal",
  startCodingSession: "mercurian.startCodingSession",
  getPlanTextAt: "mercurian.getPlanTextAt",
  measurePlanReconstruction: "mercurian.measurePlanReconstruction",
  getSpecAt: "mercurian.getSpecAt",
  visitPlan: "mercurian.visitPlan",
  markPlanUnread: "mercurian.markPlanUnread",
  archivePlan: "mercurian.archivePlan",
  unarchivePlan: "mercurian.unarchivePlan",
  deletePlan: "mercurian.deletePlan",
  stopPlanningTurn: "mercurian.stopPlanningTurn",
  answerPlanningQuestion: "mercurian.answerPlanningQuestion",
  subscribeWorktreeSlots: "mercurian.subscribeWorktreeSlots",
  readLineUncommittedDiff: "mercurian.readLineUncommittedDiff",
} as const;

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const MercurianProjectId = makeEntityId("MercurianProjectId");
export type MercurianProjectId = typeof MercurianProjectId.Type;

export const PlanId = makeEntityId("PlanId");
export type PlanId = typeof PlanId.Type;

/** A commit id as the planning surface sees it — one message in the space. */
export const MercurianCommitId = makeEntityId("MercurianCommitId");
export type MercurianCommitId = typeof MercurianCommitId.Type;

// Repository contracts import this module for project identity, so repeat the
// same brand schema locally instead of introducing a runtime import cycle.
const MercurianRepositoryId = makeEntityId("MercurianRepositoryId");

export const WorktreeSlotView = Schema.Struct({
  slotId: TrimmedNonEmptyString,
  projectId: MercurianProjectId,
  path: TrimmedNonEmptyString,
  currentLineRootCommitId: Schema.NullOr(MercurianCommitId),
  members: Schema.Array(
    Schema.Struct({
      repositoryId: MercurianRepositoryId,
      relativePath: TrimmedNonEmptyString,
      currentBranch: Schema.NullOr(TrimmedNonEmptyString),
    }),
  ),
  leased: Schema.Boolean,
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime,
});
export type WorktreeSlotView = typeof WorktreeSlotView.Type;

export const WorktreeSlotSnapshot = Schema.Struct({ slots: Schema.Array(WorktreeSlotView) });
export type WorktreeSlotSnapshot = typeof WorktreeSlotSnapshot.Type;

export const WorktreeSlotStreamItem = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  snapshot: WorktreeSlotSnapshot,
});
export type WorktreeSlotStreamItem = typeof WorktreeSlotStreamItem.Type;

export const MercurianSubscribeWorktreeSlotsInput = Schema.Struct({});
export type MercurianSubscribeWorktreeSlotsInput = typeof MercurianSubscribeWorktreeSlotsInput.Type;

export const MercurianReadLineUncommittedDiffInput = Schema.Struct({
  threadId: ThreadId,
  ignoreWhitespace: Schema.optional(Schema.Boolean),
});
export type MercurianReadLineUncommittedDiffInput =
  typeof MercurianReadLineUncommittedDiffInput.Type;

export const MercurianReadLineUncommittedDiffResult = Schema.Struct({
  threadId: ThreadId,
  diff: Schema.String,
});
export type MercurianReadLineUncommittedDiffResult =
  typeof MercurianReadLineUncommittedDiffResult.Type;

/** Mutable facts keyed by the coding-session leaf commit. */
export const PlanCodingSessionRecord = Schema.Struct({
  commitId: MercurianCommitId,
  repositoryId: MercurianRepositoryId,
  threadId: ThreadId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  startedAt: IsoDateTime,
  endedAt: Schema.NullOr(IsoDateTime),
  outcome: Schema.NullOr(Schema.Literals(["completed", "stopped", "failed"])),
  prUrl: Schema.NullOr(Schema.String),
  settledCommitOid: Schema.NullOr(TrimmedNonEmptyString),
  partial: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  snapshotOid: Schema.NullOr(TrimmedNonEmptyString),
  snapshotKind: Schema.NullOr(SnapshotKind),
  departedRef: Schema.NullOr(Schema.String),
  branchMovement: Schema.NullOr(BranchMovement),
});
export type PlanCodingSessionRecord = typeof PlanCodingSessionRecord.Type;

/** Mirrors the commit store's author axis. */
export const PlanAuthorKind = Schema.Literals(["human", "assistant"]);
export type PlanAuthorKind = typeof PlanAuthorKind.Type;

/**
 * A planning turn's identity while it is running. Transient — a turn id never
 * lands in a commit; the settled message is the record and needs no handle.
 */
export const PlanTurnId = makeEntityId("PlanTurnId");
export type PlanTurnId = typeof PlanTurnId.Type;

/**
 * One thing the assistant consulted while grounding a reply: a file it read, a
 * search it ran, a directory it listed. Normalized at the server from each
 * provider's own tool vocabulary, so every client renders one shape.
 */
export const PlanGroundingItem = Schema.Struct({
  kind: Schema.Literals(["file-read", "search", "listing", "other"]),
  /** What a person would recognize it by — a path, a query, a tool name. */
  label: TrimmedNonEmptyString,
  detail: Schema.optional(Schema.String),
});
export type PlanGroundingItem = typeof PlanGroundingItem.Type;

/**
 * Grounding that could not reach everything: the repositories the provider's
 * session shape left out. Present only when narrowing actually happened —
 * "grounding is visible" includes what was out of reach.
 */
export const PlanGroundingScope = Schema.Struct({
  unreachableRepositories: Schema.Array(TrimmedNonEmptyString),
});
export type PlanGroundingScope = typeof PlanGroundingScope.Type;

const PlanQuestionOption = Schema.Struct({
  label: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
});
export type PlanQuestionOption = typeof PlanQuestionOption.Type;

/**
 * A structured question the assistant asked instead of guessing. Structurally
 * a copy of the provider runtime's `UserInputQuestion`, deliberately not an
 * import: the planning surface's contract must not couple to the provider
 * contract's evolution.
 */
export const PlanQuestion = Schema.Struct({
  id: TrimmedNonEmptyString,
  header: TrimmedNonEmptyString,
  question: TrimmedNonEmptyString,
  options: Schema.Array(PlanQuestionOption),
  multiSelect: Schema.optional(Schema.Boolean),
});
export type PlanQuestion = typeof PlanQuestion.Type;

/**
 * The question-and-answer exchange as the settled commit records it. `answers`
 * is absent when the turn ended — stopped, or failed — before anyone answered:
 * a question stopped past stays in the record, honestly unanswered.
 */
export const PlanQuestionRecord = Schema.Struct({
  questions: Schema.Array(PlanQuestion),
  answers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type PlanQuestionRecord = typeof PlanQuestionRecord.Type;

export const MercurianProject = Schema.Struct({
  projectId: MercurianProjectId,
  name: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MercurianProject = typeof MercurianProject.Type;

/** What a plan is, at the size a surface needs to name it. */
export const PlanShell = Schema.Struct({
  planId: PlanId,
  projectId: MercurianProjectId,
  title: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PlanShell = typeof PlanShell.Type;

/**
 * What a plan looks like as a tree row: the shell, plus the three facts a
 * status is ranked from and the two its lifecycle is decided by.
 *
 * The split from {@link PlanShell} is deliberate. Status is the tree's
 * business — the planning space renders none of it — so a `PlanDetail` never
 * carries visit state it has no use for. Lifecycle is here for the same
 * reason: the surfaces that offer archive and delete are the tree and the
 * Archived page, and both read this snapshot.
 *
 * Every input here is a server-side fact and the client only ranks them
 * (ADR 002 §4). "Unseen updates" is deliberately *not* a field: it is
 * `updatedAt` against `visitedAt`, which is ranking rather than originating,
 * and the palette needs both raw timestamps anyway for its own ordering.
 */
export const PlanTreeRow = Schema.Struct({
  ...PlanShell.fields,
  /**
   * Something in this plan is waiting on a person: a structured question, or a
   * coding session's approval request rolled up from below.
   */
  hasPendingInput: Schema.Boolean,
  /** A reply is streaming in this plan right now. */
  isWorking: Schema.Boolean,
  /** When you last opened it. Absent means never — which reads as unseen. */
  visitedAt: Schema.optional(IsoDateTime),
  /**
   * Null while the plan is in the tree, stamped once it has left it. Archived
   * plans ride this snapshot rather than a second read, so the Archived page in
   * Settings is live in every window with no refresh.
   */
  archivedAt: Schema.NullOr(IsoDateTime),
  /**
   * The lifecycle rule made renderable: delete exists only while a plan is
   * fully private, so a `true` here is what takes the verb off every surface.
   * Derived per read from the plan's commits, never stored.
   */
  hasPublishedCommits: Schema.Boolean,
  codingSessions: Schema.Array(PlanCodingSessionRecord),
});
export type PlanTreeRow = typeof PlanTreeRow.Type;

/**
 * The commit facts every timeline item carries, whatever kind it is: where it
 * sits in the append order, which commits it hangs from, and whether it has
 * crossed into shared history. The explorer draws the history from these.
 */
const PlanCommitFields = {
  commitId: MercurianCommitId,
  /** The commit's place in the store's global append order. */
  sequence: Schema.Number,
  /** Ordered; empty for the root, more than one for a merge. */
  parents: Schema.Array(MercurianCommitId),
  /** `false` is private work — the author's own, not yet shared. */
  published: Schema.Boolean,
  authorKind: PlanAuthorKind,
  createdAt: IsoDateTime,
} as const;

export const PlanMessage = Schema.Struct({
  ...PlanCommitFields,
  text: Schema.String,
  /**
   * Images the message carried. Metadata only — the bytes come from the assets
   * door by id. Optional because every commit written before messages could
   * carry images has to keep decoding.
   */
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  /**
   * The stopped-response mark: this reply was cut short and the partial text
   * is what there was. Optional like every turn fact below — commits written
   * before planning turns existed keep decoding, and absence means false.
   */
  interrupted: Schema.optional(Schema.Boolean),
  /** What the assistant consulted to ground this reply, folded away until expanded. */
  grounding: Schema.optional(Schema.Array(PlanGroundingItem)),
  /** Present only when grounding was narrowed by the provider's session shape. */
  groundingScope: Schema.optional(PlanGroundingScope),
  /** The structured question this reply asked, and what it was answered. */
  question: Schema.optional(PlanQuestionRecord),
  /** What this human message's turn ran under, when it opened one. */
  ranUnder: Schema.optional(PlanningModelSelection),
  /** What produced this assistant reply, captured when its turn started. */
  generatedBy: Schema.optional(PlanningModelSelection),
  memoryAmendment: Schema.optional(
    Schema.Struct({
      title: TrimmedNonEmptyString,
      memoryCommitSha: Schema.NullOr(Schema.String),
      notes: Schema.Array(TrimmedNonEmptyString),
    }),
  ),
});
export type PlanMessage = typeof PlanMessage.Type;

/**
 * A direct edit of the plan artifact, as the history records it. The revision
 * carries no text: the artifact's *current* text crosses once as
 * {@link PlanDetail.planText}, and re-sending every historical snapshot would
 * grow the payload with the square of editing activity. The text as of an
 * earlier commit is a frozen fact, read once through
 * {@link MercurianGetPlanTextAtInput} when someone looks back.
 */
const PlanSplitStamp = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  repositoryName: TrimmedNonEmptyString,
});

export const PlanRevision = Schema.Struct({
  ...PlanCommitFields,
  /** Present when this revision projects the plan onto one repository. */
  split: Schema.optional(PlanSplitStamp),
});
export type PlanRevision = typeof PlanRevision.Type;

/**
 * The behavioral contract a plan is planned from. A full snapshot, parallel
 * to the plan artifact rather than a live tracker object.
 */
export const SpecDocument = Schema.Struct({
  /** The outcome, user story, and behavioral context — prose, not a title. */
  goal: Schema.String,
  /** The observable conditions that make the goal complete. */
  acceptanceCriteria: Schema.String,
});
export type SpecDocument = typeof SpecDocument.Type;

/** Map a tracker's title/body pair into the spec's two semantic prose fields. */
export const specDocumentFromIssue = (title: string, description: string): SpecDocument => ({
  goal: title,
  acceptanceCriteria: description,
});

export const PlanSpecRevisionCause = Schema.Literals([
  "import",
  "refresh",
  "reconciliation",
  "direct",
]);
export type PlanSpecRevisionCause = typeof PlanSpecRevisionCause.Type;

/** A compact history row; the current full document crosses once on PlanDetail. */
export const PlanSpecRevision = Schema.Struct({
  ...PlanCommitFields,
  cause: PlanSpecRevisionCause,
  /** Present when a tracker issue caused the revision. */
  issueId: Schema.optional(Schema.String),
});
export type PlanSpecRevision = typeof PlanSpecRevision.Type;

/** Immutable facts stamped by the leaf about the plan revision it implements. */
export const PlanCodingSession = Schema.Struct({
  ...PlanCommitFields,
  repositoryId: MercurianRepositoryId,
  repositoryName: TrimmedNonEmptyString,
  planRevisionCommitId: MercurianCommitId,
  partial: Schema.optional(Schema.Boolean),
});
export type PlanCodingSession = typeof PlanCodingSession.Type;

export const PlanSpecAt = Schema.Struct({
  revisionCommitId: MercurianCommitId,
  document: SpecDocument,
});
export type PlanSpecAt = typeof PlanSpecAt.Type;

export const PlanOrigin = Schema.Struct({
  connectionId: TrackerConnectionId,
  issueId: Schema.String,
  issueUrl: Schema.String,
});
export type PlanOrigin = typeof PlanOrigin.Type;

/**
 * One commit on the planning space's path. Messages, plan revisions and an
 * imported issue are the same kind of thing here — one list, in commit order,
 * at equal standing.
 */
export const PlanTimelineItem = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("message"), ...PlanMessage.fields }),
  Schema.Struct({ _tag: Schema.Literal("plan-revision"), ...PlanRevision.fields }),
  Schema.Struct({ _tag: Schema.Literal("spec-revision"), ...PlanSpecRevision.fields }),
  Schema.Struct({ _tag: Schema.Literal("coding-session"), ...PlanCodingSession.fields }),
]);
export type PlanTimelineItem = typeof PlanTimelineItem.Type;

/**
 * The turn currently streaming in a planning space, as a joining window needs
 * it: the partial text so far, what has been consulted, and the question that
 * is waiting, if one is. Carried on the snapshot so a window opened — or
 * reconnected — mid-turn is coherent without any frame replay (ADR 002 §3).
 */
export const PlanInFlightTurn = Schema.Struct({
  turnId: PlanTurnId,
  /** The commit the reply will hang from when it settles. */
  parentCommitId: MercurianCommitId,
  text: Schema.String,
  grounding: Schema.Array(PlanGroundingItem),
  groundingScope: Schema.optional(PlanGroundingScope),
  /** Present while a structured question waits on the person. */
  questions: Schema.optional(Schema.Array(PlanQuestion)),
});
export type PlanInFlightTurn = typeof PlanInFlightTurn.Type;

export const PlanSplitProposal = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  repositoryName: TrimmedNonEmptyString,
  text: Schema.String,
});
export type PlanSplitProposal = typeof PlanSplitProposal.Type;

/** A commit whose recorded implementation verdict says it needs no projection. */
export const PlanImplementReady = Schema.Struct({
  commitId: MercurianCommitId,
  repositoryId: MercurianRepositoryId,
  repositoryName: TrimmedNonEmptyString,
});
export type PlanImplementReady = typeof PlanImplementReady.Type;

export const PlanImplementVerdict = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("atomic"),
    repositoryId: MercurianRepositoryId,
    repositoryName: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("needs-split"),
    rationale: Schema.optional(Schema.String),
    splits: Schema.NonEmptyArray(PlanSplitProposal),
  }),
  Schema.Struct({
    kind: Schema.Literal("already-covered"),
    repositories: Schema.NonEmptyArray(
      Schema.Struct({
        repositoryId: MercurianRepositoryId,
        repositoryName: TrimmedNonEmptyString,
      }),
    ),
  }),
]);
export type PlanImplementVerdict = typeof PlanImplementVerdict.Type;

export const PlanImplementProposal = Schema.Struct({
  turnId: PlanTurnId,
  parentCommitId: MercurianCommitId,
  verdict: PlanImplementVerdict,
});
export type PlanImplementProposal = typeof PlanImplementProposal.Type;

export const MemoryNoteChange = Schema.Struct({
  path: TrimmedNonEmptyString,
  before: Schema.NullOr(Schema.String),
  after: Schema.String,
});
export type MemoryNoteChange = typeof MemoryNoteChange.Type;

export const MemoryMapPlacement = Schema.Struct({
  map: TrimmedNonEmptyString,
  parent: TrimmedNonEmptyString,
  note: TrimmedNonEmptyString,
  type: Schema.optional(TrimmedNonEmptyString),
});
export type MemoryMapPlacement = typeof MemoryMapPlacement.Type;

export const MemoryAmendmentProposal = Schema.Struct({
  turnId: PlanTurnId,
  title: TrimmedNonEmptyString,
  changes: Schema.Array(MemoryNoteChange),
  patch: Schema.String,
  placements: Schema.Array(MemoryMapPlacement),
});
export type MemoryAmendmentProposal = typeof MemoryAmendmentProposal.Type;

export const PlanInFlightImplement = Schema.Struct({
  turnId: PlanTurnId,
  parentCommitId: MercurianCommitId,
  grounding: Schema.Array(PlanGroundingItem),
  groundingScope: Schema.optional(PlanGroundingScope),
});
export type PlanInFlightImplement = typeof PlanInFlightImplement.Type;

/**
 * A planning space: the plan artifact beside the history that evolves it.
 *
 * `planText` is derived, never stored — it is the last plan revision on the
 * current path, so an empty string is a real state (a plan born blank, or one
 * a person cleared) and not a missing value.
 */
export const PlanDetail = Schema.Struct({
  plan: PlanShell,
  planText: Schema.String,
  /** Null until a blank-born plan receives its first contract revision. */
  spec: Schema.NullOr(PlanSpecAt),
  /** Present only when the initial spec was derived from a tracker issue. */
  origin: Schema.optional(PlanOrigin),
  timeline: Schema.Array(PlanTimelineItem),
  /** The highest commit sequence this snapshot accounts for — the resume cursor. */
  snapshotSequence: Schema.Number,
  /** Ready verdicts keyed by commit identity rather than embedded in history items. */
  readyCommits: Schema.Array(PlanImplementReady),
  /** Mutable coding-session facts, keyed by their immutable leaf commits. */
  codingSessions: Schema.Array(PlanCodingSessionRecord),
  /** The turns streaming right now — one per branch. Runtime state, never stored. */
  inFlightTurns: Schema.Array(PlanInFlightTurn),
  /** An implement analysis currently running. Runtime state, never stored. */
  inFlightImplement: Schema.optional(PlanInFlightImplement),
  /** The latest analysis result awaiting a person's decision. */
  implementProposal: Schema.optional(PlanImplementProposal),
  memoryAmendmentProposal: Schema.optional(MemoryAmendmentProposal),
});
export type PlanDetail = typeof PlanDetail.Type;

/**
 * Why nothing is streaming after a message landed: the append succeeded — the
 * message is a commit regardless — and this frame says why no reply follows.
 * The composer's gate makes these rare; they exist for the second window that
 * raced a settings change or another send.
 */
export const PlanTurnRefusalReason = Schema.Literals([
  "unset",
  "no-instance",
  "not-signed-in",
  "model-unavailable",
  "option-unavailable",
  "turn-active",
]);
export type PlanTurnRefusalReason = typeof PlanTurnRefusalReason.Type;

/**
 * The planning space's live read. The commit DAG is the durable log, so the
 * events are commits and the cursor is their sequence (ADR 002 §2).
 *
 * The `turn-*` members are transient frames (ADR 002 §3): transport, not
 * record. They carry no sequence and never resume — a reconnect re-subscribes
 * and the snapshot's `inFlightTurns` carries the partial turns. Only the
 * settling commit is durable, and it arrives as an ordinary `commit` event
 * right after `turn-settled`.
 */
export const PlanStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: PlanDetail }),
  Schema.Struct({
    kind: Schema.Literal("commit"),
    sequence: Schema.Number,
    item: PlanTimelineItem,
    /** Present only when this commit changed the artifact: the new current text. */
    planText: Schema.optional(Schema.String),
    /** Present only when this commit changed the spec artifact. */
    spec: Schema.optional(PlanSpecAt),
  }),
  Schema.Struct({ kind: Schema.Literal("synchronized") }),
  Schema.Struct({
    kind: Schema.Literal("coding-sessions"),
    sessions: Schema.Array(PlanCodingSessionRecord),
  }),
  Schema.Struct({
    kind: Schema.Literal("turn-started"),
    turnId: PlanTurnId,
    parentCommitId: MercurianCommitId,
    groundingScope: Schema.optional(PlanGroundingScope),
  }),
  Schema.Struct({
    kind: Schema.Literal("turn-delta"),
    turnId: PlanTurnId,
    textDelta: Schema.String,
    /**
     * Characters of the reply already streamed before this delta. A window
     * joining mid-turn folds idempotently against its snapshot's partial
     * text: a delta wholly below the text it already holds is a replay.
     */
    offset: Schema.optional(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal("turn-grounding"),
    turnId: PlanTurnId,
    item: PlanGroundingItem,
  }),
  Schema.Struct({
    kind: Schema.Literal("turn-question"),
    turnId: PlanTurnId,
    questions: Schema.Array(PlanQuestion),
  }),
  Schema.Struct({ kind: Schema.Literal("turn-question-answered"), turnId: PlanTurnId }),
  /** The turn is over; the commit event that follows is the record arriving. */
  Schema.Struct({ kind: Schema.Literal("turn-settled"), turnId: PlanTurnId }),
  Schema.Struct({ kind: Schema.Literal("turn-refused"), reason: PlanTurnRefusalReason }),
  Schema.Struct({
    kind: Schema.Literal("implement-started"),
    implement: PlanInFlightImplement,
  }),
  Schema.Struct({
    kind: Schema.Literal("implement-analyzed"),
    proposal: PlanImplementProposal,
  }),
  Schema.Struct({
    kind: Schema.Literal("implement-ready"),
    ready: PlanImplementReady,
  }),
  Schema.Struct({
    kind: Schema.Literal("implement-cancelled"),
    turnId: PlanTurnId,
  }),
  Schema.Struct({
    kind: Schema.Literal("implement-failed"),
    turnId: PlanTurnId,
    reason: Schema.Literals(["no-proposal", "invalid-proposal", "stopped", "provider-error"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("memory-amendment-proposed"),
    proposal: MemoryAmendmentProposal,
  }),
  Schema.Struct({
    kind: Schema.Literal("memory-amendment-failed"),
    turnId: PlanTurnId,
    reason: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("memory-amendment-cancelled"),
    turnId: PlanTurnId,
  }),
]);
export type PlanStreamItem = typeof PlanStreamItem.Type;

/**
 * The whole tree in one value. Projects and plans are few and change only on
 * discrete human acts, so the subscription re-sends this rather than carrying
 * sequenced deltas; plans arrive newest-first within each project.
 */
export const PlanningTreeSnapshot = Schema.Struct({
  projects: Schema.Array(MercurianProject),
  plans: Schema.Array(PlanTreeRow),
});
export type PlanningTreeSnapshot = typeof PlanningTreeSnapshot.Type;

export const PlanningTreeStreamItem = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  snapshot: PlanningTreeSnapshot,
});
export type PlanningTreeStreamItem = typeof PlanningTreeStreamItem.Type;

// ===============================
// Inputs
// ===============================

export const MercurianSubscribeTreeInput = Schema.Struct({});
export type MercurianSubscribeTreeInput = typeof MercurianSubscribeTreeInput.Type;

export const MercurianCreateProjectInput = Schema.Struct({
  name: TrimmedNonEmptyString,
});
export type MercurianCreateProjectInput = typeof MercurianCreateProjectInput.Type;

/**
 * A plan is born with its first message — there is no way to ask for an empty
 * one, which is what keeps empty rows out of the tree.
 */
export const MercurianCreatePlanInput = Schema.Struct({
  projectId: MercurianProjectId,
  message: Schema.String,
  /** The birth message is a message: it composes with the same powers. */
  attachments: Schema.optional(Schema.Array(UploadChatAttachment)),
  /** Absent means seed from the pair this workspace last planned under. */
  modelChoice: Schema.optional(PlanningModelSelection),
});
export type MercurianCreatePlanInput = typeof MercurianCreatePlanInput.Type;

/**
 * Import an issue as a plan. The issue travels whole, exactly as the live
 * browse read it: the caller just fetched it, and no connector has a by-id read
 * to fetch it again with — that seam belongs to issue refresh.
 *
 * The server takes the issue's id, url, title and description and mints
 * everything else itself. `status` is ignored on purpose: where an issue stands
 * is a live tracker fact, and importing one stores no copy of it.
 */
export const MercurianImportPlanInput = Schema.Struct({
  projectId: MercurianProjectId,
  /** Which connection the issue was read through — half of the plan's origin. */
  connectionId: TrackerConnectionId,
  issue: TrackerIssue,
});
export type MercurianImportPlanInput = typeof MercurianImportPlanInput.Type;

/**
 * What an import did, beside the plan it landed on.
 *
 * Import is idempotent by origin, so re-importing is a success rather than a
 * refusal — you are taken to the plan either way. The outcome is what lets the
 * surface say which of the three happened without inventing an error for two of
 * them.
 */
export const PlanImportResult = Schema.Struct({
  detail: PlanDetail,
  outcome: Schema.Literals(["created", "existing", "resurfaced"]),
});
export type PlanImportResult = typeof PlanImportResult.Type;

/**
 * `parentCommitId` is where the sender stood: the composer acts from wherever
 * you are, so the act names its own point of departure rather than trusting
 * the server to guess. Naming a commit that already has a child is how a fork
 * is made, and the only way one can be — forks are human acts.
 *
 * Absent means the space's tip, which keeps the input honest for a caller with
 * no position of its own.
 */
export const MercurianAppendPlanMessageInput = Schema.Struct({
  planId: PlanId,
  text: Schema.String,
  parentCommitId: Schema.optional(MercurianCommitId),
  attachments: Schema.optional(Schema.Array(UploadChatAttachment)),
  /** Absent means inherit the nearest pair already carried by this branch. */
  modelChoice: Schema.optional(PlanningModelSelection),
});
export type MercurianAppendPlanMessageInput = typeof MercurianAppendPlanMessageInput.Type;

/**
 * The artifact's whole text after the edit — a revision is a snapshot, not a
 * diff. An empty string is a legal artifact state, so this is not trimmed.
 *
 * `parentCommitId` carries the same meaning as on a message: an edit saved
 * while standing on a branch has to land on *that* branch, not on whichever
 * one last received a commit.
 */
export const MercurianSavePlanRevisionInput = Schema.Struct({
  planId: PlanId,
  text: Schema.String,
  parentCommitId: Schema.optional(MercurianCommitId),
});
export type MercurianSavePlanRevisionInput = typeof MercurianSavePlanRevisionInput.Type;

export const MercurianSaveSpecRevisionInput = Schema.Struct({
  planId: PlanId,
  document: SpecDocument,
  parentCommitId: Schema.optional(MercurianCommitId),
  /** The revision the editor read, or null when drafting the first spec. */
  expectedSpecRevisionCommitId: Schema.NullOr(MercurianCommitId),
});
export type MercurianSaveSpecRevisionInput = typeof MercurianSaveSpecRevisionInput.Type;

export const MercurianRefreshSpecInput = Schema.Struct({
  planId: PlanId,
  parentCommitId: MercurianCommitId,
  expectedSpecRevisionCommitId: MercurianCommitId,
  /** Present only when confirming a reconciliation the user reviewed. */
  reviewedUpstream: Schema.optional(SpecDocument),
  resolvedDocument: Schema.optional(SpecDocument),
});
export type MercurianRefreshSpecInput = typeof MercurianRefreshSpecInput.Type;

export const MercurianRefreshSpecResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unchanged") }),
  Schema.Struct({
    kind: Schema.Literal("committed"),
    outcome: Schema.Literals(["upstream", "converged", "reconciled"]),
    revision: PlanSpecRevision,
  }),
  Schema.Struct({
    kind: Schema.Literal("reconciliation-required"),
    base: SpecDocument,
    local: SpecDocument,
    upstream: SpecDocument,
    expectedSpecRevisionCommitId: MercurianCommitId,
  }),
]);
export type MercurianRefreshSpecResult = typeof MercurianRefreshSpecResult.Type;

export const MercurianTryImplementInput = Schema.Struct({
  planId: PlanId,
  parentCommitId: Schema.optional(MercurianCommitId),
});
export type MercurianTryImplementInput = typeof MercurianTryImplementInput.Type;

export const MercurianConfirmSplitInput = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  text: Schema.String,
});
export type MercurianConfirmSplitInput = typeof MercurianConfirmSplitInput.Type;

export const MercurianConfirmSplitsInput = Schema.Struct({
  planId: PlanId,
  parentCommitId: MercurianCommitId,
  splits: Schema.Array(MercurianConfirmSplitInput),
});
export type MercurianConfirmSplitsInput = typeof MercurianConfirmSplitsInput.Type;

export const MercurianConfirmSplitsResult = Schema.Array(MercurianCommitId);
export type MercurianConfirmSplitsResult = typeof MercurianConfirmSplitsResult.Type;

export const MercurianConfirmMemoryAmendmentInput = Schema.Struct({
  planId: PlanId,
  parentCommitId: MercurianCommitId,
});
export type MercurianConfirmMemoryAmendmentInput = typeof MercurianConfirmMemoryAmendmentInput.Type;
export const MercurianCancelMemoryAmendmentInput = Schema.Struct({ planId: PlanId });
export type MercurianCancelMemoryAmendmentInput = typeof MercurianCancelMemoryAmendmentInput.Type;

export const MercurianStartCodingSessionInput = Schema.Struct({
  planId: PlanId,
  parentCommitId: MercurianCommitId,
  repositoryId: MercurianRepositoryId,
  baseRef: TrimmedNonEmptyString,
  startFromOrigin: Schema.Boolean,
  runtimeMode: Schema.Literals(["approval-required", "auto-accept-edits", "full-access"]),
  modelSelection: ModelSelection,
});
export type MercurianStartCodingSessionInput = typeof MercurianStartCodingSessionInput.Type;

export const MercurianStartCodingSessionResult = Schema.Struct({
  commitId: MercurianCommitId,
  threadId: ThreadId,
});
export type MercurianStartCodingSessionResult = typeof MercurianStartCodingSessionResult.Type;

export const MercurianCancelImplementProposalInput = Schema.Struct({ planId: PlanId });
export type MercurianCancelImplementProposalInput =
  typeof MercurianCancelImplementProposalInput.Type;

/**
 * The plan as of one commit — what the artifact showed when that commit
 * landed. Only the client's own subscription can name a commit here, so a
 * commit that does not belong to this plan's history is a bug, not a refusal
 * the surface renders.
 */
export const MercurianGetPlanTextAtInput = Schema.Struct({
  planId: PlanId,
  commitId: MercurianCommitId,
});
export type MercurianGetPlanTextAtInput = typeof MercurianGetPlanTextAtInput.Type;

/** History above a commit cannot change, so this answer never goes stale. */
export const PlanTextAt = Schema.Struct({ planText: Schema.String });
export type PlanTextAt = typeof PlanTextAt.Type;

/** The immutable position whose next rebuilt reply is being measured. */
export const MercurianMeasureReconstructionInput = Schema.Struct({
  planId: PlanId,
  commitId: MercurianCommitId,
});
export type MercurianMeasureReconstructionInput = typeof MercurianMeasureReconstructionInput.Type;

/** Exact character counts from the same renderer used by a rebuilt session. */
export const PlanReconstructionMeasure = Schema.Struct({
  transcriptChars: Schema.Number,
  entryCount: Schema.Number,
  fixedReservedChars: Schema.Number,
});
export type PlanReconstructionMeasure = typeof PlanReconstructionMeasure.Type;

export const MercurianGetSpecAtInput = Schema.Struct({
  planId: PlanId,
  commitId: MercurianCommitId,
});
export type MercurianGetSpecAtInput = typeof MercurianGetSpecAtInput.Type;

export const SpecAt = Schema.Struct({ spec: Schema.NullOr(PlanSpecAt) });
export type SpecAt = typeof SpecAt.Type;

/**
 * You opened this plan. The moment is the server's to mint — the act names the
 * plan and nothing else, so no client's clock can put a visit in the future and
 * silence a row forever.
 */
export const MercurianVisitPlanInput = Schema.Struct({ planId: PlanId });
export type MercurianVisitPlanInput = typeof MercurianVisitPlanInput.Type;

/** Put a plan back in front of you. Re-arms unseen in every open window. */
export const MercurianMarkPlanUnreadInput = Schema.Struct({ planId: PlanId });
export type MercurianMarkPlanUnreadInput = typeof MercurianMarkPlanUnreadInput.Type;

/**
 * The reversible disappearance, and its way back. Archive is every plan's —
 * published or not — and destroys nothing: the plan leaves the tree, the
 * listings, and the palette, and the Archived page in Settings restores it.
 */
export const MercurianArchivePlanInput = Schema.Struct({ planId: PlanId });
export type MercurianArchivePlanInput = typeof MercurianArchivePlanInput.Type;

export const MercurianUnarchivePlanInput = Schema.Struct({ planId: PlanId });
export type MercurianUnarchivePlanInput = typeof MercurianUnarchivePlanInput.Type;

/**
 * The irreversible one, and the only one with a precondition. A plan that has
 * never published a commit was never seen by anyone else, so destroying it
 * leaves no trace and re-importing its origin issue starts fresh. Once
 * anything is published this refuses with {@link PlanDeleteBlockedError}.
 */
export const MercurianDeletePlanInput = Schema.Struct({ planId: PlanId });
export type MercurianDeletePlanInput = typeof MercurianDeletePlanInput.Type;

/**
 * What every act on a tree row answers: nothing to render. Visiting, marking
 * unread, archiving, restoring and deleting all change state the tree
 * subscription re-sends, which is the one place row state is read from — so
 * there is one acknowledgement, not one per verb.
 */
export const MercurianPlanAcknowledged = Schema.Struct({});
export type MercurianPlanAcknowledged = typeof MercurianPlanAcknowledged.Type;

export const MercurianSubscribePlanInput = Schema.Struct({
  planId: PlanId,
  /** A cursor to resume from. Absent — or too far behind — means a fresh snapshot. */
  afterSequence: Schema.optional(Schema.Number),
});
export type MercurianSubscribePlanInput = typeof MercurianSubscribePlanInput.Type;

/**
 * Stop the reply streaming in this plan. The partial reply lands as a commit
 * marked interrupted — stopping means "this happened and was cut short", and
 * forking past it is the tree's own move. Idempotent when nothing is
 * streaming: there is nothing to stop, and that is not an error a person
 * caused.
 */
export const MercurianStopPlanningTurnInput = Schema.Struct({ planId: PlanId, turnId: PlanTurnId });
export type MercurianStopPlanningTurnInput = typeof MercurianStopPlanningTurnInput.Type;

/**
 * Answer the structured question the plan is waiting on. Answers are keyed by
 * question id; the shape of each answer is the question's own business.
 */
export const MercurianAnswerPlanningQuestionInput = Schema.Struct({
  planId: PlanId,
  turnId: PlanTurnId,
  answers: Schema.Record(Schema.String, Schema.Unknown),
});
export type MercurianAnswerPlanningQuestionInput = typeof MercurianAnswerPlanningQuestionInput.Type;

// ===============================
// Refusals
// ===============================

export class MercurianProjectNotFoundError extends Schema.TaggedErrorClass<MercurianProjectNotFoundError>()(
  "MercurianProjectNotFoundError",
  { projectId: MercurianProjectId },
) {
  override get message(): string {
    return `Project ${this.projectId} does not exist`;
  }
}

export class PlanNotFoundError extends Schema.TaggedErrorClass<PlanNotFoundError>()(
  "PlanNotFoundError",
  { planId: PlanId },
) {
  override get message(): string {
    return `Plan ${this.planId} does not exist`;
  }
}

/**
 * The lifecycle rule as a refusal: publish is the one deliberate crossing into
 * shared history, and after it the work is not only yours to destroy. Archive
 * is what remains, and it destroys nothing.
 *
 * A surface should never render this — it hides delete for a published plan
 * rather than offering it to fail. Reaching here means the plan crossed while
 * the menu was open, which is exactly the race the server exists to lose well.
 */
export class PlanDeleteBlockedError extends Schema.TaggedErrorClass<PlanDeleteBlockedError>()(
  "PlanDeleteBlockedError",
  { planId: PlanId },
) {
  override get message(): string {
    return "This plan has published work and can only be archived, not deleted.";
  }
}

/**
 * The one-turn-at-a-time rule as a refusal, from every window at once. While
 * the assistant is replying, human acts that would land on the same history —
 * a message, an edit — refuse rather than racing the settle into an illegal
 * assistant fork. Stopping the reply is the way to act now.
 */
export class PlanTurnActiveError extends Schema.TaggedErrorClass<PlanTurnActiveError>()(
  "PlanTurnActiveError",
  { planId: PlanId },
) {
  override get message(): string {
    return "The assistant is replying — stop it to act.";
  }
}

export class SpecRevisionOutdatedError extends Schema.TaggedErrorClass<SpecRevisionOutdatedError>()(
  "SpecRevisionOutdatedError",
  {
    expectedSpecRevisionCommitId: Schema.NullOr(MercurianCommitId),
    actualSpecRevisionCommitId: Schema.NullOr(MercurianCommitId),
  },
) {
  override get message(): string {
    return "The spec changed after this editor opened. Reload it before saving.";
  }
}

export class SpecRefreshUnavailableError extends Schema.TaggedErrorClass<SpecRefreshUnavailableError>()(
  "SpecRefreshUnavailableError",
  { reason: Schema.Literals(["no-origin", "issue-not-found", "spec-missing"]) },
) {
  override get message(): string {
    return `The spec cannot be refreshed: ${this.reason}.`;
  }
}

export const ImplementBlockedReason = Schema.Literals([
  "plan-empty",
  "model-unset",
  "no-instance",
  "not-signed-in",
  "model-unavailable",
  "option-unavailable",
]);
export type ImplementBlockedReason = typeof ImplementBlockedReason.Type;

export class ImplementBlockedError extends Schema.TaggedErrorClass<ImplementBlockedError>()(
  "ImplementBlockedError",
  { reason: ImplementBlockedReason },
) {
  override get message(): string {
    return `Implement analysis is blocked: ${this.reason}`;
  }
}

export const ConfirmSplitsBlockedReason = Schema.Literals([
  "no-splits",
  "duplicate-repository",
  "repository-not-in-project",
]);
export type ConfirmSplitsBlockedReason = typeof ConfirmSplitsBlockedReason.Type;

export class ConfirmSplitsBlockedError extends Schema.TaggedErrorClass<ConfirmSplitsBlockedError>()(
  "ConfirmSplitsBlockedError",
  { reason: ConfirmSplitsBlockedReason },
) {
  override get message(): string {
    return `Split confirmation is blocked: ${this.reason}`;
  }
}

export const ConfirmMemoryAmendmentBlockedReason = Schema.Literals([
  "no-proposal",
  "memory-changed",
  "not-designated",
]);
export class ConfirmMemoryAmendmentBlockedError extends Schema.TaggedErrorClass<ConfirmMemoryAmendmentBlockedError>()(
  "ConfirmMemoryAmendmentBlockedError",
  { reason: ConfirmMemoryAmendmentBlockedReason },
) {
  override get message(): string {
    switch (this.reason) {
      case "no-proposal":
        return "There is no memory amendment to confirm.";
      case "memory-changed":
        return "The project memory changed after this amendment was proposed.";
      case "not-designated":
        return "This project has no designated memory.";
    }
  }
}

export const CodingSessionBlockedReason = Schema.Literals([
  "not-ready",
  "repository-mismatch",
  "repository-not-in-project",
  "repository-not-git",
  "base-ref-missing",
  "no-instance",
  "model-unavailable",
  "pool-at-capacity",
]);
export type CodingSessionBlockedReason = typeof CodingSessionBlockedReason.Type;

export class CodingSessionBlockedError extends Schema.TaggedErrorClass<CodingSessionBlockedError>()(
  "CodingSessionBlockedError",
  { reason: CodingSessionBlockedReason },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-ready":
        return "This plan is not ready to implement.";
      case "repository-mismatch":
        return "The selected repository no longer matches this ready plan.";
      case "repository-not-in-project":
        return "The selected repository is no longer connected to this project.";
      case "repository-not-git":
        return "The selected repository is not a Git repository.";
      case "base-ref-missing":
        return "The selected local base branch no longer exists.";
      case "no-instance":
        return "The selected agent is not currently available.";
      case "model-unavailable":
        return "The selected model is not available from that agent.";
      case "pool-at-capacity":
        return "Every worktree slot for this project is currently in use.";
    }
  }
}

/** Nothing is waiting for an answer on this plan. */
export class NoPendingQuestionError extends Schema.TaggedErrorClass<NoPendingQuestionError>()(
  "NoPendingQuestionError",
  { planId: PlanId },
) {
  override get message(): string {
    return "This plan has no unanswered question.";
  }
}

export const isMercurianProjectNotFoundError = Schema.is(MercurianProjectNotFoundError);
export const isPlanNotFoundError = Schema.is(PlanNotFoundError);
export const isPlanDeleteBlockedError = Schema.is(PlanDeleteBlockedError);
export const isPlanTurnActiveError = Schema.is(PlanTurnActiveError);
export const isSpecRevisionOutdatedError = Schema.is(SpecRevisionOutdatedError);
export const isSpecRefreshUnavailableError = Schema.is(SpecRefreshUnavailableError);
export const isImplementBlockedError = Schema.is(ImplementBlockedError);
export const isConfirmSplitsBlockedError = Schema.is(ConfirmSplitsBlockedError);
export const isConfirmMemoryAmendmentBlockedError = Schema.is(ConfirmMemoryAmendmentBlockedError);
export const isCodingSessionBlockedError = Schema.is(CodingSessionBlockedError);
export const isNoPendingQuestionError = Schema.is(NoPendingQuestionError);

/**
 * Everything below the planning surface that a client cannot act on: storage
 * failures, decode failures, and commit-store refusals a planning bug caused.
 * The underlying failure rides as `cause` so the server log keeps the chain.
 */
export class MercurianPlanningError extends Schema.TaggedErrorClass<MercurianPlanningError>()(
  "MercurianPlanningError",
  {
    operation: Schema.Literals([
      "subscribeTree",
      "subscribePlan",
      "createProject",
      "createPlan",
      "importPlan",
      "appendPlanMessage",
      "savePlanRevision",
      "saveSpecRevision",
      "refreshSpec",
      "tryImplement",
      "confirmSplits",
      "confirmMemoryAmendment",
      "cancelMemoryAmendment",
      "startCodingSession",
      "cancelImplementProposal",
      "getPlanTextAt",
      "measurePlanReconstruction",
      "getSpecAt",
      "visitPlan",
      "markPlanUnread",
      "archivePlan",
      "unarchivePlan",
      "deletePlan",
      "stopPlanningTurn",
      "answerPlanningQuestion",
      "subscribeWorktreeSlots",
      "readLineUncommittedDiff",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian planning operation ${this.operation} failed`;
  }
}
