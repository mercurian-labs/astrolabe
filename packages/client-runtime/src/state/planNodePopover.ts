import type {
  MercurianCommitId,
  PlanCodingSessionRecord,
  PlanImplementReady,
  PlanningModelSelection,
  PlanTimelineItem,
} from "@t3tools/contracts";

import { planCheckpointEffectLabel } from "./planCheckpoints.ts";
import {
  planCommitDetail,
  planCommitSummary,
  type PlanGraph,
  type PlanGraphNode,
} from "./planGraph.ts";
import { resolveActingHead } from "./planPosition.ts";

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

export function derivePlanNodePopover(input: {
  readonly node: PlanGraphNode;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly ready?: PlanImplementReady;
  readonly stalePlan: boolean;
  readonly staleSpec: boolean;
  readonly suppressUnanswered: boolean;
}): PlanNodePopoverReading {
  const checkpoint = input.node.checkpoint;
  const queryCandidate = checkpoint?.query ?? input.node.item;
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
      .filter((effect) => !input.suppressUnanswered || effect !== "unanswered")
      .map(planCheckpointEffectLabel) ?? [];
  const modelSwitch =
    query === undefined ? null : modelSwitchFor(input.commitGraph, query.commitId);
  const splitRepositoryName =
    input.node.item._tag === "plan-revision" ? input.node.item.split?.repositoryName : undefined;
  const record =
    input.node.item._tag === "coding-session"
      ? codingSessionRecordFor(input.codingSessions, input.node.commitId)
      : undefined;
  const session =
    input.node.item._tag === "coding-session"
      ? {
          repositoryName: input.node.item.repositoryName,
          planRevisionCommitId: input.node.item.planRevisionCommitId,
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
    label: planCommitSummary(checkpoint?.query ?? input.node.item),
    createdAt: input.node.item.createdAt,
    published: input.node.item.published,
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
    staleSpec: input.staleSpec,
    stalePlan: input.stalePlan,
    movedPastPlan:
      splitRepositoryName !== undefined &&
      planMovedPastSplit(input.commitGraph, input.node.commitId),
    ...(splitRepositoryName === undefined ? {} : { movedPastRepositoryName: splitRepositoryName }),
    ...(input.ready === undefined ? {} : { ready: input.ready }),
    ...(session === undefined ? {} : { session }),
    acts: offeredActs(input.node, input.commitGraph, record !== undefined),
  };
}

export function offeredActs(
  node: PlanGraphNode,
  commitGraph: PlanGraph,
  hasCodingSessionRecord = false,
): ReadonlyArray<PlanNodePopoverAct> {
  if (node.item._tag === "coding-session")
    return hasCodingSessionRecord ? ["continue", "open-session"] : ["continue"];
  const acts: Array<PlanNodePopoverAct> = ["continue"];
  const query = node.checkpoint?.query ?? node.item;
  if (
    query._tag === "message" &&
    query.authorKind === "human" &&
    (commitGraph.byId.get(query.commitId)?.parents.length ?? 0) > 0
  )
    acts.push("edit-and-branch");
  acts.push("implement");
  return acts;
}

export function resolveImplementFrom(
  graph: PlanGraph,
  fromCommitId: MercurianCommitId | null,
): MercurianCommitId | null {
  return resolveActingHead(graph, fromCommitId);
}

const excerpt = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length <= 240 ? trimmed : `${trimmed.slice(0, 239).trimEnd()}…`;
};
const sameModelPair = (left: PlanningModelSelection, right: PlanningModelSelection) =>
  left.provider === right.provider && left.model === right.model;
