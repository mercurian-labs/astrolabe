/**
 * The planning store's values as the wire carries them.
 *
 * One thing changes at this boundary: rows hold `DateTime.Utc`, contracts hold
 * ISO strings. Commit ids narrow to the surface's own brand — the planning
 * space renders messages, not the DAG.
 *
 * @module PlanningWire
 */
import * as DateTime from "effect/DateTime";

import type * as Contracts from "@t3tools/contracts";
import { MercurianCommitId } from "@t3tools/contracts";

import type { MercurianProject, Plan } from "./schema.ts";
import type {
  PlanDetail,
  PlanMessage,
  PlanningTreeSnapshot,
  PlanRevision,
  PlanTimelineEvent,
  PlanTimelineItem,
  PlanTreeRow,
} from "./PlanningStore.ts";

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

export const toWireProject = (project: MercurianProject): Contracts.MercurianProject => ({
  projectId: project.projectId,
  name: project.name,
  createdAt: iso(project.createdAt),
  updatedAt: iso(project.updatedAt),
});

export const toWirePlanShell = (plan: Plan): Contracts.PlanShell => ({
  planId: plan.planId,
  projectId: plan.projectId,
  title: plan.title,
  createdAt: iso(plan.createdAt),
  updatedAt: iso(plan.updatedAt),
});

const toWirePlanCommitFields = (commit: PlanMessage | PlanRevision) => ({
  commitId: MercurianCommitId.make(commit.commitId),
  sequence: commit.sequence,
  parents: commit.parents.map((parentId) => MercurianCommitId.make(parentId)),
  published: commit.published,
  authorKind: commit.authorKind,
  createdAt: iso(commit.createdAt),
});

export const toWirePlanMessage = (message: PlanMessage): Contracts.PlanMessage => ({
  ...toWirePlanCommitFields(message),
  text: message.text,
  // Metadata only, by design: the bytes come from the assets door by id.
  ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
  // The planning turn's facts ride through unchanged: the store's payload
  // schemas and the wire schemas are structurally the same shapes.
  ...(message.interrupted === undefined ? {} : { interrupted: message.interrupted }),
  ...(message.grounding === undefined ? {} : { grounding: message.grounding }),
  ...(message.groundingScope === undefined ? {} : { groundingScope: message.groundingScope }),
  ...(message.question === undefined ? {} : { question: message.question }),
});

export const toWirePlanRevision = (revision: PlanRevision): Contracts.PlanRevision =>
  toWirePlanCommitFields(revision);

export const toWirePlanTimelineItem = (item: PlanTimelineItem): Contracts.PlanTimelineItem =>
  item._tag === "message"
    ? { _tag: "message", ...toWirePlanMessage(item) }
    : { _tag: "plan-revision", ...toWirePlanRevision(item) };

export const toWirePlanDetail = (detail: PlanDetail): Contracts.PlanDetail => ({
  plan: toWirePlanShell(detail.plan),
  planText: detail.planText,
  timeline: detail.timeline.map(toWirePlanTimelineItem),
  snapshotSequence: detail.snapshotSequence,
});

export const toWirePlanCommitEvent = (event: PlanTimelineEvent): Contracts.PlanStreamItem => ({
  kind: "commit",
  sequence: event.item.sequence,
  item: toWirePlanTimelineItem(event.item),
  ...(event.planText === undefined ? {} : { planText: event.planText }),
});

export const toWirePlanTextAt = (planText: string): Contracts.PlanTextAt => ({ planText });

/** The two live status facts a row composes in, from the planning runtime. */
export interface PlanRowStatus {
  readonly isWorking: boolean;
  readonly hasPendingInput: boolean;
}

const IDLE_STATUS: PlanRowStatus = { isWorking: false, hasPendingInput: false };

/**
 * A plan as a tree row — and the one place a row's status facts are composed.
 *
 * `isWorking` is a planning turn streaming right now and `hasPendingInput`
 * its structured question waiting, both read from the assistant runtime at
 * the subscription boundary — read-layer composition, never a cross-store
 * transaction (ADR 002 §4). M-114's coding sessions will contribute both
 * from the other store, composed here the same way.
 *
 * The lifecycle facts beside them are already real: `archivedAt` is the plan's
 * own column, and `hasPublishedCommits` the store's per-read answer about its
 * commits.
 */
export const toWirePlanTreeRow = (
  row: PlanTreeRow,
  status: PlanRowStatus = IDLE_STATUS,
): Contracts.PlanTreeRow => ({
  ...toWirePlanShell(row),
  hasPendingInput: status.hasPendingInput,
  isWorking: status.isWorking,
  archivedAt: row.archivedAt === null ? null : iso(row.archivedAt),
  hasPublishedCommits: row.hasPublishedCommits,
  ...(row.visitedAt === undefined ? {} : { visitedAt: iso(row.visitedAt) }),
});

export const toWireTreeSnapshot = (
  snapshot: PlanningTreeSnapshot,
  statusByPlan?: ReadonlyMap<string, PlanRowStatus>,
): Contracts.PlanningTreeSnapshot => ({
  projects: snapshot.projects.map(toWireProject),
  plans: snapshot.plans.map((plan) => toWirePlanTreeRow(plan, statusByPlan?.get(plan.planId))),
});
