/**
 * Mercurian's planning surface on the wire: projects, plans, and the artifact
 * and history of a planning space.
 *
 * A project contains plans; a plan is the unit of work and owns exactly one
 * planning space. The DAG's shape does not cross — a commit arrives already
 * projected into what the surface renders, never as an opaque payload — with
 * one exception: `sequence`, the store's append order, which is what a
 * subscription resumes from.
 *
 * Names are `Mercurian`-prefixed wherever the fork already owns the word:
 * a t3code `Project` is an on-disk workspace root, a Mercurian project is a
 * container of plans, and the contracts barrel re-exports both.
 *
 * @module MercurianContracts
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MERCURIAN_WS_METHODS = {
  subscribeTree: "mercurian.subscribeTree",
  subscribePlan: "mercurian.subscribePlan",
  createProject: "mercurian.createProject",
  createPlan: "mercurian.createPlan",
  appendPlanMessage: "mercurian.appendPlanMessage",
  savePlanRevision: "mercurian.savePlanRevision",
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

/** What a plan looks like as a tree row: enough to render, nothing more. */
export const PlanShell = Schema.Struct({
  planId: PlanId,
  projectId: MercurianProjectId,
  title: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PlanShell = typeof PlanShell.Type;

export const PlanMessage = Schema.Struct({
  commitId: MercurianCommitId,
  /** The commit's place in the store's global append order. */
  sequence: Schema.Number,
  authorKind: PlanAuthorKind,
  text: Schema.String,
  createdAt: IsoDateTime,
});
export type PlanMessage = typeof PlanMessage.Type;

/**
 * A direct edit of the plan artifact, as the history records it. The revision
 * carries no text: the artifact's *current* text crosses once as
 * {@link PlanDetail.planText}, and re-sending every historical snapshot would
 * grow the payload with the square of editing activity.
 */
export const PlanRevision = Schema.Struct({
  commitId: MercurianCommitId,
  sequence: Schema.Number,
  authorKind: PlanAuthorKind,
  createdAt: IsoDateTime,
});
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
  plans: Schema.Array(PlanShell),
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
});
export type MercurianCreatePlanInput = typeof MercurianCreatePlanInput.Type;

export const MercurianAppendPlanMessageInput = Schema.Struct({
  planId: PlanId,
  text: Schema.String,
});
export type MercurianAppendPlanMessageInput = typeof MercurianAppendPlanMessageInput.Type;

/**
 * The artifact's whole text after the edit — a revision is a snapshot, not a
 * diff. An empty string is a legal artifact state, so this is not trimmed.
 */
export const MercurianSavePlanRevisionInput = Schema.Struct({
  planId: PlanId,
  text: Schema.String,
});
export type MercurianSavePlanRevisionInput = typeof MercurianSavePlanRevisionInput.Type;

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

export const isMercurianProjectNotFoundError = Schema.is(MercurianProjectNotFoundError);
export const isPlanNotFoundError = Schema.is(PlanNotFoundError);

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
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian planning operation ${this.operation} failed`;
  }
}
