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
  PlanImport,
  PlanMessage,
  PlanSpecAt,
  PlanSpecRevision,
  PlanningTreeSnapshot,
  PlanRevision,
  PlanTimelineEvent,
  PlanTimelineItem,
  PlanTreeRow,
  PlanCodingSession,
} from "./PlanningStore.ts";
import { toWireCodingSessionRecord, toWireLineRuntimeRecord } from "../lineRuntimes/wire.ts";

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

export const toWireProject = (project: MercurianProject): Contracts.MercurianProject => ({
  projectId: project.projectId,
  orchestrationProjectId: project.orchestrationProjectId,
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
  ...(plan.archivedAt === null ? {} : { archivedAt: iso(plan.archivedAt) }),
});

const toWirePlanCommitFields = (
  commit: PlanMessage | PlanRevision | PlanSpecRevision | PlanCodingSession,
) => ({
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
  ...(message.ranUnder === undefined ? {} : { ranUnder: message.ranUnder }),
  ...(message.generatedBy === undefined ? {} : { generatedBy: message.generatedBy }),
  ...(message.sourceUserMessageId === undefined
    ? {}
    : { sourceUserMessageId: MercurianCommitId.make(message.sourceUserMessageId) }),
  ...(message.reconstructionId === undefined ? {} : { reconstructionId: message.reconstructionId }),
  ...(message.memoryAmendment === undefined ? {} : { memoryAmendment: message.memoryAmendment }),
});

export const toWirePlanRevision = (revision: PlanRevision): Contracts.PlanRevision => ({
  ...toWirePlanCommitFields(revision),
  ...(revision.split === undefined ? {} : { split: revision.split }),
});

export const toWirePlanSpecRevision = (revision: PlanSpecRevision): Contracts.PlanSpecRevision => ({
  ...toWirePlanCommitFields(revision),
  cause: revision.cause,
  ...(revision.issueId === undefined ? {} : { issueId: revision.issueId }),
});

export const toWirePlanCodingSession = (
  session: PlanCodingSession,
  partial = false,
): Contracts.PlanCodingSession => ({
  ...toWirePlanCommitFields(session),
  ...(session.repositoryId === undefined ? {} : { repositoryId: session.repositoryId }),
  ...(session.repositoryName === undefined ? {} : { repositoryName: session.repositoryName }),
  planRevisionCommitId: MercurianCommitId.make(session.planRevisionCommitId),
  ...(partial ? { partial: true } : {}),
});

export const toWirePlanSpecAt = (spec: PlanSpecAt): Contracts.PlanSpecAt => ({
  revisionCommitId: MercurianCommitId.make(spec.revisionCommitId),
  document: spec.document,
});

export const toWirePlanTimelineItem = (item: PlanTimelineItem): Contracts.PlanTimelineItem => {
  if (item._tag === "message") {
    return { _tag: "message", ...toWirePlanMessage(item) };
  }
  if (item._tag === "spec-revision") {
    return { _tag: "spec-revision", ...toWirePlanSpecRevision(item) };
  }
  if (item._tag === "coding-session") {
    return { _tag: "coding-session", ...toWirePlanCodingSession(item) };
  }
  return { _tag: "plan-revision", ...toWirePlanRevision(item) };
};

export const toWirePlanDetail = (detail: PlanDetail): Contracts.PlanDetail => {
  const codingSessions = new Map(
    detail.codingSessions.map((session) => [String(session.commitId), session]),
  );
  return {
    plan: toWirePlanShell(detail.plan),
    planText: detail.planText,
    spec: detail.spec === null ? null : toWirePlanSpecAt(detail.spec),
    ...(detail.origin === undefined ? {} : { origin: detail.origin }),
    timeline: detail.timeline.map((item) =>
      item._tag === "coding-session"
        ? {
            _tag: "coding-session" as const,
            ...toWirePlanCodingSession(
              item,
              codingSessions.get(String(item.commitId))?.partial !== false &&
                codingSessions.get(String(item.commitId))?.partial !== 0 &&
                codingSessions.get(String(item.commitId)) !== undefined,
            ),
          }
        : toWirePlanTimelineItem(item),
    ),
    snapshotSequence: detail.snapshotSequence,
    codingSessions: detail.codingSessions.map(toWireCodingSessionRecord),
    lineRuntimes: detail.lineRuntimes.map(toWireLineRuntimeRecord),
    ...(detail.lastVisitedThreadId === undefined
      ? {}
      : { lastVisitedThreadId: detail.lastVisitedThreadId }),
    // The store's detail knows nothing live; the subscribe path overlays the
    // assistant's actual in-flight turns onto this.
    inFlightTurns: [],
  };
};

export const toWirePlanCommitEvent = (event: PlanTimelineEvent): Contracts.PlanStreamItem => ({
  kind: "commit",
  sequence: event.item.sequence,
  item: toWirePlanTimelineItem(event.item),
  ...(event.planText === undefined ? {} : { planText: event.planText }),
  ...(event.spec === undefined ? {} : { spec: toWirePlanSpecAt(event.spec) }),
});

/**
 * What an import answered: the plan, and which of the three things happened to
 * it. The outcome is not a status code — it is what the surface says out loud
 * when re-importing lands you somewhere you already were.
 */
export const toWirePlanImport = (result: PlanImport): Contracts.PlanImportResult => ({
  detail: toWirePlanDetail(result.detail),
  outcome: result.outcome,
});

export const toWirePlanTextAt = (planText: string): Contracts.PlanTextAt => ({ planText });

export const toWireSpecAt = (spec: PlanSpecAt | null): Contracts.SpecAt => ({
  spec: spec === null ? null : toWirePlanSpecAt(spec),
});

/** The two live status facts a row composes in, from the planning runtime. */
export interface PlanRowStatus {
  readonly isWorking: boolean;
  readonly hasPendingInput: boolean;
}

export interface SessionLiveStatus {
  readonly isWorking: boolean;
  readonly hasPendingInput: boolean;
}

const IDLE_STATUS: PlanRowStatus = { isWorking: false, hasPendingInput: false };

/**
 * A plan as a tree row — and the one place a row's status facts are composed.
 *
 * `isWorking` composes planning turns with live coding sessions, while
 * `hasPendingInput` is the planning assistant's structured question state.
 * Both are joined at the subscription boundary, never in a cross-store
 * transaction (ADR 002 §4).
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

export const composePlanRowStatus = (
  status: PlanRowStatus | undefined,
  sessions: ReadonlyArray<SessionLiveStatus | null>,
): PlanRowStatus => ({
  isWorking:
    (status?.isWorking ?? false) || sessions.some((session) => session?.isWorking === true),
  hasPendingInput:
    (status?.hasPendingInput ?? false) ||
    sessions.some((session) => session?.hasPendingInput === true),
});

export const toWireTreeSnapshot = (
  snapshot: PlanningTreeSnapshot,
  statusByPlan?: ReadonlyMap<string, PlanRowStatus>,
  threadPlanLinks: Contracts.PlanningTreeSnapshot["threadPlanLinks"] = [],
): Contracts.PlanningTreeSnapshot => ({
  projects: snapshot.projects.map(toWireProject),
  plans: snapshot.plans.map((plan) => toWirePlanTreeRow(plan, statusByPlan?.get(plan.planId))),
  threadPlanLinks,
});
