/**
 * Mercurian's planning surface on the wire: projects, plans, and the messages
 * of a planning space.
 *
 * A project contains plans; a plan is the unit of work and owns exactly one
 * planning space. Nothing here carries the commit DAG's shape — the surface
 * renders a conversation, so a commit crosses as a {@link PlanMessage} with
 * its text, never as an opaque payload.
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
  createProject: "mercurian.createProject",
  createPlan: "mercurian.createPlan",
  appendPlanMessage: "mercurian.appendPlanMessage",
  getPlan: "mercurian.getPlan",
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
  authorKind: PlanAuthorKind,
  text: Schema.String,
  createdAt: IsoDateTime,
});
export type PlanMessage = typeof PlanMessage.Type;

export const PlanDetail = Schema.Struct({
  plan: PlanShell,
  messages: Schema.Array(PlanMessage),
});
export type PlanDetail = typeof PlanDetail.Type;

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

export const MercurianGetPlanInput = Schema.Struct({
  planId: PlanId,
});
export type MercurianGetPlanInput = typeof MercurianGetPlanInput.Type;

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
      "createProject",
      "createPlan",
      "appendPlanMessage",
      "getPlan",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian planning operation ${this.operation} failed`;
  }
}
