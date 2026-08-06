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

import type { MercurianProject, PlanSummary } from "./schema.ts";
import type {
  PlanDetail,
  PlanMessage,
  PlanningTreeSnapshot,
  PlanRevision,
  PlanTimelineEvent,
  PlanTimelineItem,
} from "./PlanningStore.ts";

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

export const toWireProject = (project: MercurianProject): Contracts.MercurianProject => ({
  projectId: project.projectId,
  name: project.name,
  createdAt: iso(project.createdAt),
  updatedAt: iso(project.updatedAt),
});

export const toWirePlanShell = (plan: PlanSummary): Contracts.PlanShell => ({
  planId: plan.planId,
  projectId: plan.projectId,
  title: plan.title,
  createdAt: iso(plan.createdAt),
  updatedAt: iso(plan.updatedAt),
  archivedAt: plan.archivedAt === null ? null : iso(plan.archivedAt),
  hasPublishedCommits: plan.hasPublishedCommits,
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

export const toWireTreeSnapshot = (
  snapshot: PlanningTreeSnapshot,
): Contracts.PlanningTreeSnapshot => ({
  projects: snapshot.projects.map(toWireProject),
  plans: snapshot.plans.map(toWirePlanShell),
});
