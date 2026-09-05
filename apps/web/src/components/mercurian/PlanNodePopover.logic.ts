/**
 * The node popover is a derived reading over recorded checkpoint facts.
 *
 * Nothing here invents history: model switches compare recorded turn choices,
 * effects come only from checkpoint members and the durable capture record,
 * and mutable coding-session facts are joined by their leaf commit id. Keeping
 * that work pure gives Thread, Columns, and Graph one answer even though they
 * summon the reading differently.
 */
import { checkpointEffects } from "@t3tools/client-runtime/state/mercurian-checkpoint-effects";
import {
  planningModelSelectionsEqual,
  type BranchMovement,
  type MercurianCommitId,
  type OrchestrationCheckpointDocumentRole,
  type OrchestrationCheckpointFile,
  type PlanCheckpointRecord,
  type PlanCodingSessionRecord,
  type PlanningModelSelection,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import {
  codingSessionStatusMarks,
  isUnknownCapture,
  mergeStatusMarks,
  planCheckpointMarks,
  recordStatusMarks,
  type PlanCheckpointMark,
} from "./PlanCheckpoints.logic";
import {
  planCommitDetail,
  planCommitSummary,
  type PlanGraph,
  type PlanGraphNode,
} from "./PlanGraph.logic";

export type PlanNodePopoverAct =
  | "edit-and-branch"
  | "open-session"
  | "open-memory"
  | "continue-from-checkpoint";

/** How a recorded amendment addresses the Memory tab: by its commit, else by its first note. */
export function memoryAmendmentSelection(
  amendment: NonNullable<
    Extract<PlanTimelineItem, { readonly _tag: "message" }>["memoryAmendment"]
  >,
):
  | { readonly kind: "amendment"; readonly id: string }
  | { readonly kind: "note"; readonly name: string }
  | null {
  if (amendment.memoryCommitSha !== null)
    return { kind: "amendment", id: amendment.memoryCommitSha };
  const note = amendment.notes[0];
  return note === undefined ? null : { kind: "note", name: note };
}

export interface PlanNodeSessionFacts {
  readonly repositoryName?: string;
  readonly repositories?: PlanCodingSessionRecord["repositories"];
  readonly planRevisionCommitId: MercurianCommitId;
  readonly threadId?: PlanCodingSessionRecord["threadId"];
  readonly status?: "Running" | "Completed" | "Stopped" | "Ended";
  readonly branch?: string;
  readonly commits?: string;
  readonly departedRef?: string;
  readonly prUrl?: string;
}

export interface PlanNodeCapturedFile {
  readonly path: string;
  readonly kind: string;
  readonly previousPath?: string;
  readonly deleted: boolean;
  readonly role?: OrchestrationCheckpointDocumentRole;
  readonly additions: number;
  readonly deletions: number;
}

export interface PlanNodeCapturedRepository {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly branch?: string;
  readonly commits?: string;
  readonly departedRef?: string;
  readonly captureError?: string;
  readonly summaryError?: string;
  readonly files: ReadonlyArray<PlanNodeCapturedFile>;
  /** A recorded member may be opened on its own; the panel says when it is unavailable. */
  readonly changesAvailable: boolean;
}

/** Recorded capture facts. Current runtime values never replace these. */
export interface PlanNodeCaptureFacts {
  readonly repositories: ReadonlyArray<PlanNodeCapturedRepository>;
  /** Terminal, complete, and verified to have changed nothing. */
  readonly plain: boolean;
  readonly saving: boolean;
  readonly failed: boolean;
  readonly unknown: boolean;
  readonly partial: boolean;
  /** Every required member snapshot exists, so a coherent continuation can be offered. */
  readonly continuable: boolean;
}

export interface PlanNodePopoverReading {
  readonly kind: "turn" | "standalone";
  readonly label: string;
  readonly createdAt: string;
  readonly published: boolean;
  readonly query?: Extract<PlanTimelineItem, { readonly _tag: "message" }>;
  readonly response?: Extract<PlanTimelineItem, { readonly _tag: "message" }>;
  readonly queryText?: string;
  readonly responseExcerpt?: string;
  readonly marks: ReadonlyArray<PlanCheckpointMark>;
  readonly modelSwitch?: PlanningModelSelection;
  readonly staleSpec: boolean;
  readonly stalePlan: boolean;
  readonly movedPastPlan: boolean;
  readonly movedPastRepositoryName?: string;
  readonly session?: PlanNodeSessionFacts;
  readonly capture?: PlanNodeCaptureFacts;
  readonly acts: ReadonlyArray<PlanNodePopoverAct>;
}

/** The previous recorded turn choice when the query actually changed it. */
export function modelSwitchFor(
  graph: PlanGraph,
  queryCommitId: MercurianCommitId,
): PlanningModelSelection | null {
  const query = graph.byId.get(queryCommitId)?.item;
  if (query?._tag !== "message" || query.ranUnder === undefined) return null;

  let current = graph.byId.get(queryCommitId)?.parents[0];
  for (let step = 0; current !== undefined && step <= graph.nodes.length; step += 1) {
    const node = graph.byId.get(current);
    const item = node?.item;
    if (item?._tag === "message" && item.authorKind === "human" && item.ranUnder !== undefined) {
      return planningModelSelectionsEqual(query.ranUnder, item.ranUnder) ? null : item.ranUnder;
    }
    current = node?.parents[0];
  }
  return null;
}

/** Planning continued beside this repository projection on its parent line. */
export function planMovedPastSplit(graph: PlanGraph, splitCommitId: MercurianCommitId): boolean {
  const split = graph.byId.get(splitCommitId);
  if (split?.item._tag !== "plan-revision" || split.item.split === undefined) return false;
  const parent = graph.byId.get(split.parents[0] ?? "");
  if (parent === undefined) return false;
  return parent.childrenIds.some((childId) => {
    if (childId === splitCommitId) return false;
    const child = graph.byId.get(childId)?.item;
    return child?._tag !== "plan-revision" || child.split === undefined;
  });
}

export function codingSessionRecordFor(
  codingSessions: ReadonlyArray<PlanCodingSessionRecord>,
  commitId: MercurianCommitId,
): PlanCodingSessionRecord | undefined {
  return codingSessions.find((session) => session.commitId === commitId);
}

export function codingSessionStatus(
  record: PlanCodingSessionRecord,
): "Running" | "Completed" | "Stopped" | "Ended" {
  if (record.endedAt === null) return "Running";
  if (record.outcome === "completed") return "Completed";
  if (record.outcome === "stopped") return "Stopped";
  return "Ended";
}

export function branchMovementLabel(movement: BranchMovement): string {
  switch (movement.kind) {
    case "unchanged":
      return "no commits";
    case "added":
      return `${movement.count} ${movement.count === 1 ? "commit" : "commits"} added`;
    case "rewritten":
      return "history rewritten";
  }
}

/** One repository's line on a session card: what its branch did, and where the tree went. */
export function repositoryFactsLabel(repository: {
  readonly branchMovement: BranchMovement | null;
  readonly departedRef: string | null;
}): string {
  const movement =
    repository.branchMovement === null
      ? "not yet built"
      : branchMovementLabel(repository.branchMovement);
  return repository.departedRef === null
    ? movement
    : `${movement} · departed to ${repository.departedRef}`;
}

/** Recorded branch facts for one captured repository, or nothing when none were saved. */
export function capturedRepositoryFactsLabel(
  repository: PlanNodeCapturedRepository,
): string | null {
  const parts = [
    repository.branch,
    repository.commits,
    repository.departedRef === undefined ? undefined : `departed to ${repository.departedRef}`,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function documentRoleLabel(role: OrchestrationCheckpointDocumentRole): string {
  switch (role) {
    case "plan":
      return "Plan";
    case "spec":
      return "Spec";
    case "memory":
      return "Memory";
  }
}

function capturedFile(file: OrchestrationCheckpointFile): PlanNodeCapturedFile {
  const role = file.afterDocumentRole ?? file.beforeDocumentRole;
  return {
    path: file.path,
    kind: file.kind,
    ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
    deleted: file.kind === "deleted",
    ...(role === undefined ? {} : { role }),
    additions: file.additions,
    deletions: file.deletions,
  };
}

/**
 * What the record saved, exactly. Repository groups are authoritative; a legacy
 * flat file list reads as one unnamed workspace that cannot be diffed. Returns
 * nothing when there is nothing recorded to say.
 */
export function captureFacts(record: PlanCheckpointRecord): PlanNodeCaptureFacts | null {
  const recorded = checkpointEffects(record);
  const capture = record.capture;
  const groups = capture?.repositories;
  const repositories: ReadonlyArray<PlanNodeCapturedRepository> =
    groups === undefined
      ? capture === undefined || capture.files.length === 0
        ? []
        : [
            {
              repositoryId: "",
              repositoryName: "Workspace",
              files: capture.files.map(capturedFile),
              changesAvailable: false,
            },
          ]
      : groups.map((group) => ({
          repositoryId: group.repositoryId,
          repositoryName: group.repositoryName,
          ...(group.branchName === undefined ? {} : { branch: group.branchName }),
          ...(group.branchMovement === undefined
            ? {}
            : { commits: branchMovementLabel(group.branchMovement) }),
          ...(group.departedRef === undefined || group.departedRef.length === 0
            ? {}
            : { departedRef: group.departedRef }),
          ...(group.captureError === undefined ? {} : { captureError: group.captureError }),
          ...(group.summaryError === undefined ? {} : { summaryError: group.summaryError }),
          files: group.files.map(capturedFile),
          changesAvailable: true,
        }));
  const facts: PlanNodeCaptureFacts = {
    repositories,
    plain: recorded.plain,
    saving: recorded.status.saving,
    failed: recorded.status.failed,
    unknown: isUnknownCapture(record),
    partial: recorded.status.partial,
    continuable: recorded.status.snapshotsAvailable,
  };
  return facts.repositories.length === 0 &&
    !facts.plain &&
    !facts.saving &&
    !facts.failed &&
    !facts.unknown
    ? null
    : facts;
}

export function derivePlanNodePopover({
  node,
  commitGraph,
  codingSessions,
  stalePlan,
  staleSpec,
  suppressUnanswered,
}: {
  readonly node: PlanGraphNode;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly stalePlan: boolean;
  readonly staleSpec: boolean;
  readonly suppressUnanswered: boolean;
}): PlanNodePopoverReading {
  const checkpoint = node.checkpoint;
  const record = node.record;
  const queryCandidate = checkpoint?.query ?? node.item;
  const query =
    queryCandidate._tag === "message" &&
    queryCandidate.authorKind === "human" &&
    queryCandidate.memoryAmendment === undefined
      ? queryCandidate
      : undefined;
  const response =
    checkpoint?.response?._tag === "message" && checkpoint.response.authorKind === "assistant"
      ? checkpoint.response
      : undefined;
  const modelSwitch = query === undefined ? null : modelSwitchFor(commitGraph, query.commitId);
  const splitRepositoryName =
    node.item._tag === "plan-revision" ? node.item.split?.repositoryName : undefined;
  const sessionRecord =
    node.item._tag === "coding-session"
      ? codingSessionRecordFor(codingSessions, node.commitId)
      : undefined;
  const marks = planCheckpointMarks(
    checkpoint ?? {
      effects: record === undefined ? [] : checkpointEffects(record).categories,
      status: mergeStatusMarks(
        sessionRecord === undefined ? [] : codingSessionStatusMarks(sessionRecord),
        record === undefined ? [] : recordStatusMarks(record),
      ),
    },
    suppressUnanswered,
  );
  const capture = record === undefined ? null : captureFacts(record);
  const session =
    node.item._tag === "coding-session"
      ? {
          ...(node.item.repositoryName === undefined
            ? {}
            : { repositoryName: node.item.repositoryName }),
          planRevisionCommitId: node.item.planRevisionCommitId,
          ...(sessionRecord === undefined
            ? {}
            : {
                status: codingSessionStatus(sessionRecord),
                threadId: sessionRecord.threadId,
                branch: sessionRecord.branch,
                ...(sessionRecord.branchMovement === null
                  ? {}
                  : { commits: branchMovementLabel(sessionRecord.branchMovement) }),
                ...(sessionRecord.departedRef === null
                  ? {}
                  : { departedRef: sessionRecord.departedRef }),
                ...(sessionRecord.repositories === undefined
                  ? {}
                  : { repositories: sessionRecord.repositories }),
                ...(sessionRecord.prUrl === null ? {} : { prUrl: sessionRecord.prUrl }),
              }),
        }
      : undefined;

  return {
    kind: query === undefined ? "standalone" : "turn",
    label: planCommitSummary(checkpoint?.query ?? node.item),
    createdAt: node.item.createdAt,
    published: node.item.published,
    ...(query === undefined
      ? {}
      : {
          query,
          queryText: planCommitDetail(query),
          ...(modelSwitch === null ? {} : { modelSwitch }),
        }),
    ...(response === undefined
      ? {}
      : { response, responseExcerpt: excerpt(planCommitDetail(response)) }),
    marks,
    staleSpec,
    stalePlan,
    movedPastPlan:
      splitRepositoryName !== undefined && planMovedPastSplit(commitGraph, node.commitId),
    ...(splitRepositoryName === undefined ? {} : { movedPastRepositoryName: splitRepositoryName }),
    ...(session === undefined ? {} : { session }),
    ...(capture === null ? {} : { capture }),
    acts: offeredActs(node, commitGraph, sessionRecord !== undefined, capture ?? undefined),
  };
}

/**
 * Query editing forks at the query's parent and seeds its text; continuation
 * restores this checkpoint's saved files and reconstructs through it. They are
 * different acts and are offered independently.
 */
export function offeredActs(
  node: PlanGraphNode,
  commitGraph: PlanGraph,
  hasCodingSessionRecord = false,
  capture?: PlanNodeCaptureFacts,
): ReadonlyArray<PlanNodePopoverAct> {
  if (node.item._tag === "coding-session") {
    return hasCodingSessionRecord ? ["open-session"] : [];
  }
  if (node.item._tag === "message" && node.item.memoryAmendment !== undefined) {
    return memoryAmendmentSelection(node.item.memoryAmendment) === null ? [] : ["open-memory"];
  }
  const acts: Array<PlanNodePopoverAct> = [];
  const query = node.checkpoint?.query ?? node.item;
  if (
    query._tag === "message" &&
    query.authorKind === "human" &&
    (commitGraph.byId.get(query.commitId)?.parents.length ?? 0) > 0
  ) {
    acts.push("edit-and-branch");
  }
  if (capture?.continuable === true) acts.push("continue-from-checkpoint");
  return acts;
}

const RESPONSE_EXCERPT_LENGTH = 240;

function excerpt(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= RESPONSE_EXCERPT_LENGTH
    ? trimmed
    : `${trimmed.slice(0, RESPONSE_EXCERPT_LENGTH - 1).trimEnd()}…`;
}
