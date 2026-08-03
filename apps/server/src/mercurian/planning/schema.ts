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
 */
export const Plan = Schema.Struct({
  planId: PlanId,
  projectId: MercurianProjectId,
  historyId: HistoryId,
  title: TrimmedNonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type Plan = typeof Plan.Type;
