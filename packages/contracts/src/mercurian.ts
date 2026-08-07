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

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ChatAttachment, UploadChatAttachment } from "./orchestration.ts";

export const MERCURIAN_WS_METHODS = {
  subscribeTree: "mercurian.subscribeTree",
  subscribePlan: "mercurian.subscribePlan",
  createProject: "mercurian.createProject",
  createPlan: "mercurian.createPlan",
  appendPlanMessage: "mercurian.appendPlanMessage",
  savePlanRevision: "mercurian.savePlanRevision",
  getPlanTextAt: "mercurian.getPlanTextAt",
  visitPlan: "mercurian.visitPlan",
  markPlanUnread: "mercurian.markPlanUnread",
  archivePlan: "mercurian.archivePlan",
  unarchivePlan: "mercurian.unarchivePlan",
  deletePlan: "mercurian.deletePlan",
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

/** Mirrors the commit store's author axis. Only `human` is written today. */
export const PlanAuthorKind = Schema.Literals(["human", "assistant"]);
export type PlanAuthorKind = typeof PlanAuthorKind.Type;

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
export const PlanRevision = Schema.Struct(PlanCommitFields);
export type PlanRevision = typeof PlanRevision.Type;

/**
 * One commit on the planning space's path. Messages and plan revisions are the
 * same kind of thing here — one list, in commit order, at equal standing.
 */
export const PlanTimelineItem = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("message"), ...PlanMessage.fields }),
  Schema.Struct({ _tag: Schema.Literal("plan-revision"), ...PlanRevision.fields }),
]);
export type PlanTimelineItem = typeof PlanTimelineItem.Type;

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
  timeline: Schema.Array(PlanTimelineItem),
  /** The highest commit sequence this snapshot accounts for — the resume cursor. */
  snapshotSequence: Schema.Number,
});
export type PlanDetail = typeof PlanDetail.Type;

/**
 * The planning space's live read. The commit DAG is the durable log, so the
 * events are commits and the cursor is their sequence (ADR 002 §2).
 */
export const PlanStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: PlanDetail }),
  Schema.Struct({
    kind: Schema.Literal("commit"),
    sequence: Schema.Number,
    item: PlanTimelineItem,
    /** Present only when this commit changed the artifact: the new current text. */
    planText: Schema.optional(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("synchronized") }),
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
});
export type MercurianCreatePlanInput = typeof MercurianCreatePlanInput.Type;

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

export const isMercurianProjectNotFoundError = Schema.is(MercurianProjectNotFoundError);
export const isPlanNotFoundError = Schema.is(PlanNotFoundError);
export const isPlanDeleteBlockedError = Schema.is(PlanDeleteBlockedError);

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
      "appendPlanMessage",
      "savePlanRevision",
      "getPlanTextAt",
      "visitPlan",
      "markPlanUnread",
      "archivePlan",
      "unarchivePlan",
      "deletePlan",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian planning operation ${this.operation} failed`;
  }
}
