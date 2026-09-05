/**
 * The node popover is a derived reading over recorded checkpoint facts.
 *
 * Nothing here invents history: model switches compare recorded turn choices,
 * effects come only from checkpoint members, and mutable coding-session facts
 * are joined by their leaf commit id. Keeping that work pure gives Thread,
 * Columns, and Graph one answer even though they summon the reading differently.
 */
import {
  planningModelSelectionsEqual,
  type BranchMovement,
  type MercurianCommitId,
  type PlanCodingSessionRecord,
  type PlanningModelSelection,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import { codingSessionEffects, planCheckpointEffectLabel } from "./PlanCheckpoints.logic";
import {
  planCommitDetail,
  planCommitSummary,
  type PlanGraph,
  type PlanGraphNode,
} from "./PlanGraph.logic";
export type PlanNodePopoverAct = "edit-and-branch" | "open-session";

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

export interface PlanNodePopoverReading {
  readonly kind: "turn" | "standalone";
  readonly label: string;
  readonly createdAt: string;
  readonly published: boolean;
  readonly query?: Extract<PlanTimelineItem, { readonly _tag: "message" }>;
  readonly response?: Extract<PlanTimelineItem, { readonly _tag: "message" }>;
  readonly queryText?: string;
  readonly responseExcerpt?: string;
  readonly effects: ReadonlyArray<string>;
  readonly modelSwitch?: PlanningModelSelection;
  readonly staleSpec: boolean;
  readonly stalePlan: boolean;
  readonly movedPastPlan: boolean;
  readonly movedPastRepositoryName?: string;
  readonly session?: PlanNodeSessionFacts;
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

export function branchMovementLabel(
  movement: NonNullable<PlanCodingSessionRecord["branchMovement"]>,
): string {
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
  const record =
    node.item._tag === "coding-session"
      ? codingSessionRecordFor(codingSessions, node.commitId)
      : undefined;
  const effects = (
    checkpoint?.effects ?? (record === undefined ? [] : codingSessionEffects(record))
  )
    .filter((effect) => !suppressUnanswered || effect !== "unanswered")
    .map(planCheckpointEffectLabel);
  const session =
    node.item._tag === "coding-session"
      ? {
          ...(node.item.repositoryName === undefined
            ? {}
            : { repositoryName: node.item.repositoryName }),
          planRevisionCommitId: node.item.planRevisionCommitId,
          ...(record === undefined
            ? {}
            : {
                status: codingSessionStatus(record),
                threadId: record.threadId,
                branch: record.branch,
                ...(record.branchMovement === null
                  ? {}
                  : { commits: branchMovementLabel(record.branchMovement) }),
                ...(record.departedRef === null ? {} : { departedRef: record.departedRef }),
                ...(record.repositories === undefined ? {} : { repositories: record.repositories }),
                ...(record.prUrl === null ? {} : { prUrl: record.prUrl }),
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
    effects,
    staleSpec,
    stalePlan,
    movedPastPlan:
      splitRepositoryName !== undefined && planMovedPastSplit(commitGraph, node.commitId),
    ...(splitRepositoryName === undefined ? {} : { movedPastRepositoryName: splitRepositoryName }),
    ...(session === undefined ? {} : { session }),
    acts: offeredActs(node, commitGraph, record !== undefined),
  };
}

export function offeredActs(
  node: PlanGraphNode,
  commitGraph: PlanGraph,
  hasCodingSessionRecord = false,
): ReadonlyArray<PlanNodePopoverAct> {
  if (node.item._tag === "coding-session") {
    return hasCodingSessionRecord ? ["open-session"] : [];
  }
  const query = node.checkpoint?.query ?? node.item;
  if (
    query._tag === "message" &&
    query.authorKind === "human" &&
    (commitGraph.byId.get(query.commitId)?.parents.length ?? 0) > 0
  ) {
    return ["edit-and-branch"];
  }
  return [];
}

const RESPONSE_EXCERPT_LENGTH = 240;

function excerpt(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= RESPONSE_EXCERPT_LENGTH
    ? trimmed
    : `${trimmed.slice(0, RESPONSE_EXCERPT_LENGTH - 1).trimEnd()}…`;
}
