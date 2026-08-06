/**
 * Projects and plans as the store holds them.
 *
 * The identifiers and the author axis are the contracts' — a plan id means the
 * same thing on both sides of the wire, so there is one brand, not two. What
 * differs here is time: rows carry `DateTime.Utc`, and the wire boundary
 * formats them.
 *
 * @module PlanningSchema
 */
import * as Schema from "effect/Schema";

import { MercurianProjectId, PlanId, TrimmedNonEmptyString } from "@t3tools/contracts";

import { HistoryId } from "../commitTree/schema.ts";

export { MercurianProjectId, PlanId };

/** A container of plans. Its repository set arrives with repository management. */
export const MercurianProject = Schema.Struct({
  projectId: MercurianProjectId,
  name: TrimmedNonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type MercurianProject = typeof MercurianProject.Type;

/**
 * A plan: the unit of work, and the owner of exactly one planning space. The
 * history it names is the space — `history_id` is unique across plans.
 *
 * `archivedAt` is the whole of the plan's lifecycle state: null while the plan
 * is in the tree, stamped once it has left it. Deletion stores nothing, having
 * nothing left to store it on.
 */
export const Plan = Schema.Struct({
  planId: PlanId,
  projectId: MercurianProjectId,
  historyId: HistoryId,
  title: TrimmedNonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  archivedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type Plan = typeof Plan.Type;

/**
 * A plan as a reader of it sees it: the row, plus the one fact about its
 * history that decides which verbs it offers.
 *
 * `hasPublishedCommits` is computed per read rather than stored, because it is
 * a question about the commits — "is any of this shared yet" — and the commit
 * graph is where publishing happens. A column would be a second truth to drift
 * from the first.
 */
export const PlanSummary = Schema.Struct({
  ...Plan.fields,
  hasPublishedCommits: Schema.Boolean,
});
export type PlanSummary = typeof PlanSummary.Type;
