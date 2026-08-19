/**
 * The node popover is a derived reading over recorded checkpoint facts.
 *
 * Nothing here invents history: model switches compare recorded turn pairs,
 * effects come only from checkpoint members, and mutable coding-session facts
 * are joined by their leaf commit id. Keeping that work pure gives Thread,
 * Columns, and Graph one answer even though they summon the reading differently.
 */
import type {
  MercurianCommitId,
  PlanCodingSessionRecord,
  PlanImplementReady,
  PlanningModelSelection,
  PlanTimelineItem,
} from "@t3tools/contracts";

import { planCheckpointEffectLabel } from "./PlanCheckpoints.logic";
import {
  planCommitDetail,
  planCommitSummary,
  type PlanGraph,
  type PlanGraphNode,
} from "./PlanGraph.logic";
import { resolveActingHead } from "./PlanPosition.logic";

export type PlanNodePopoverAct = "continue" | "edit-and-branch" | "implement" | "open-session";

export interface PlanNodeSessionFacts {
  readonly repositoryName: string;
  readonly planRevisionCommitId: MercurianCommitId;
  readonly threadId?: PlanCodingSessionRecord["threadId"];
  readonly status?: "Running" | "Completed" | "Stopped" | "Ended";
  readonly branch?: string;
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
  readonly ready?: PlanImplementReady;
  readonly session?: PlanNodeSessionFacts;
  readonly acts: ReadonlyArray<PlanNodePopoverAct>;
}

/** The previous recorded turn pair when the query actually changed it. */
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
      return sameModelPair(query.ranUnder, item.ranUnder) ? null : item.ranUnder;
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

export function derivePlanNodePopover({
  node,
  commitGraph,
  codingSessions,
  ready,
  stalePlan,
  staleSpec,
  suppressUnanswered,
}: {
  readonly node: PlanGraphNode;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly ready?: PlanImplementReady;
  readonly stalePlan: boolean;
  readonly staleSpec: boolean;
  readonly suppressUnanswered: boolean;
}): PlanNodePopoverReading {
  const checkpoint = node.checkpoint;
  const queryCandidate = checkpoint?.query ?? node.item;
  const query =
    queryCandidate._tag === "message" && queryCandidate.authorKind === "human"
      ? queryCandidate
      : undefined;
  const response =
    checkpoint?.response?._tag === "message" && checkpoint.response.authorKind === "assistant"
      ? checkpoint.response
      : undefined;
  const effects =
    checkpoint?.effects
      .filter((effect) => !suppressUnanswered || effect !== "unanswered")
      .map(planCheckpointEffectLabel) ?? [];
  const modelSwitch = query === undefined ? null : modelSwitchFor(commitGraph, query.commitId);
  const splitRepositoryName =
    node.item._tag === "plan-revision" ? node.item.split?.repositoryName : undefined;
  const record =
    node.item._tag === "coding-session"
      ? codingSessionRecordFor(codingSessions, node.commitId)
      : undefined;
  const session =
    node.item._tag === "coding-session"
      ? {
          repositoryName: node.item.repositoryName,
          planRevisionCommitId: node.item.planRevisionCommitId,
          ...(record === undefined
            ? {}
            : {
                status: codingSessionStatus(record),
                branch: record.branch,
                threadId: record.threadId,
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
    ...(ready === undefined ? {} : { ready }),
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
    return hasCodingSessionRecord ? ["continue", "open-session"] : ["continue"];
  }
  const acts: Array<PlanNodePopoverAct> = ["continue"];
  const query = node.checkpoint?.query ?? node.item;
  if (
    query._tag === "message" &&
    query.authorKind === "human" &&
    (commitGraph.byId.get(query.commitId)?.parents.length ?? 0) > 0
  ) {
    acts.push("edit-and-branch");
  }
  acts.push("implement");
  return acts;
}

/** The parent an implementation act names, including inspect-only session leaves. */
export function resolveImplementFrom(
  graph: PlanGraph,
  fromCommitId: MercurianCommitId | null,
): MercurianCommitId | null {
  return resolveActingHead(graph, fromCommitId);
}

const RESPONSE_EXCERPT_LENGTH = 240;

function excerpt(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= RESPONSE_EXCERPT_LENGTH
    ? trimmed
    : `${trimmed.slice(0, RESPONSE_EXCERPT_LENGTH - 1).trimEnd()}…`;
}

function sameModelPair(left: PlanningModelSelection, right: PlanningModelSelection): boolean {
  return left.provider === right.provider && left.model === right.model;
}
