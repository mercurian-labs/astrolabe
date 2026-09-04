/**
 * A continuable reading of planning history.
 *
 * The stored DAG remains commit-grained. This projection groups structurally
 * identifiable assistant turns, using either their terminal response or their
 * latest landed revision as the state continuation should use, while leaving
 * every other act independently addressable. The output deliberately keeps
 * the PlanGraph shape so all existing layouts and graph traversals retain one
 * source of truth.
 */
import type {
  MercurianCommitId,
  PlanCodingSessionRecord,
  PlanTimelineItem,
} from "@t3tools/contracts";

import {
  descendantClosure,
  planCommitDetail,
  planCommitSummary,
  type PlanCheckpoint,
  type PlanCheckpointEffect,
  type PlanGraph,
  type PlanGraphNode,
} from "./PlanGraph.logic";

export interface CondensedPlanGraph extends PlanGraph {
  /** Every source commit points at the continuable node that represents it. */
  readonly nodeIdByCommit: ReadonlyMap<string, MercurianCommitId>;
}

interface CheckpointCandidate {
  readonly entry: PlanGraphNode;
  readonly members: ReadonlyArray<PlanGraphNode>;
  readonly checkpoint: PlanCheckpoint;
  readonly identity: PlanGraphNode;
}

const EFFECT_LABELS: Readonly<Record<PlanCheckpointEffect, string>> = {
  "plan-updated": "Plan updated",
  "spec-updated": "Spec updated",
  interrupted: "Interrupted",
  unanswered: "Unanswered",
  partial: "Partial",
  departed: "Departed",
};

/**
 * Condense complete human-query/assistant-response turns without changing the
 * history they describe. Parent edges originate at the group's entry commit,
 * then remap through membership so even a fork from an interior revision
 * remains connected to the checkpoint that now represents that revision.
 */
export function condensePlanGraph(graph: PlanGraph): CondensedPlanGraph {
  if (graph.nodes.length === 0) {
    return { ...graph, nodeIdByCommit: new Map() };
  }

  const candidates = new Map<string, CheckpointCandidate>();
  const absorbed = new Set<string>();

  for (const node of graph.nodes) {
    if (absorbed.has(node.commitId)) continue;
    const candidate = checkpointCandidate(graph, node);
    if (candidate === null) continue;
    candidates.set(node.commitId, candidate);
    for (const member of candidate.members) absorbed.add(member.commitId);
  }

  const nodeIdByCommit = new Map<string, MercurianCommitId>();
  for (const node of graph.nodes) {
    const candidate = candidates.get(node.commitId);
    if (candidate !== undefined) {
      for (const member of candidate.members) {
        nodeIdByCommit.set(member.commitId, candidate.identity.commitId);
      }
    } else if (!absorbed.has(node.commitId)) {
      nodeIdByCommit.set(node.commitId, node.commitId);
    }
  }

  const projected = graph.nodes.flatMap((node): ReadonlyArray<PlanGraphNode> => {
    const candidate = candidates.get(node.commitId);
    if (candidate !== undefined) {
      return [
        {
          ...candidate.identity,
          checkpoint: candidate.checkpoint,
          parents: remapParents(candidate.entry.parents, nodeIdByCommit),
          childrenIds: [],
          isBranchPoint: false,
          isMerge: false,
        },
      ];
    }
    if (absorbed.has(node.commitId)) return [];
    return [
      {
        ...node,
        parents: remapParents(node.parents, nodeIdByCommit),
        childrenIds: [],
        isBranchPoint: false,
        isMerge: false,
      },
    ];
  });
  const nodesInSequence = projected.toSorted(
    (left, right) => left.item.sequence - right.item.sequence,
  );
  const childrenOf = new Map<string, Array<MercurianCommitId>>();
  for (const node of nodesInSequence) {
    for (const parentId of node.parents) {
      const children = childrenOf.get(parentId);
      if (children === undefined) childrenOf.set(parentId, [node.commitId]);
      else if (!children.includes(node.commitId)) children.push(node.commitId);
    }
  }
  const nodes = nodesInSequence.map((node): PlanGraphNode => ({
    ...node,
    childrenIds: childrenOf.get(node.commitId) ?? [],
    isBranchPoint: (childrenOf.get(node.commitId)?.length ?? 0) > 1,
    isMerge: node.parents.length > 1,
  }));

  return {
    nodes,
    byId: new Map(nodes.map((node) => [node.commitId as string, node])),
    roots: nodes.filter((node) => node.parents.length === 0).map((node) => node.commitId),
    latest: nodes.at(-1)?.commitId ?? null,
    nodeIdByCommit,
  };
}

function checkpointCandidate(graph: PlanGraph, opener: PlanGraphNode): CheckpointCandidate | null {
  if (
    opener.item._tag !== "message" ||
    opener.item.authorKind !== "human" ||
    opener.item.parents.length > 1
  ) {
    return null;
  }

  const revisions: Array<PlanGraphNode> = [];
  let cursor = opener;
  for (let step = 0; step < graph.nodes.length; step += 1) {
    const assistantChildren = cursor.childrenIds.flatMap((childId) => {
      const child = graph.byId.get(childId);
      return child?.item.authorKind === "assistant" ? [child] : [];
    });
    if (assistantChildren.length > 1) return null;

    const child = assistantChildren[0];
    if (child === undefined) {
      const members = [opener, ...revisions];
      return {
        entry: opener,
        members,
        checkpoint: {
          query: opener.item,
          revisions: revisions.map((revision) => revision.item),
          effects: effectsFor(
            members.map((member) => member.item),
            undefined,
          ),
        },
        identity: revisions.at(-1) ?? opener,
      };
    }
    if (child.item._tag === "message") {
      const members = [opener, ...revisions, child];
      return {
        entry: opener,
        members,
        checkpoint: {
          query: opener.item,
          revisions: revisions.map((revision) => revision.item),
          response: child.item,
          effects: effectsFor(
            members.map((member) => member.item),
            child.item,
          ),
        },
        identity: child,
      };
    }
    if (child.item._tag !== "plan-revision" && child.item._tag !== "spec-revision") return null;
    revisions.push(child);
    cursor = child;
  }
  return null;
}

export function effectsFor(
  members: ReadonlyArray<PlanTimelineItem>,
  response?: PlanTimelineItem,
): ReadonlyArray<PlanCheckpointEffect> {
  const effects: Array<PlanCheckpointEffect> = [];
  if (members.some((member) => member._tag === "plan-revision")) effects.push("plan-updated");
  if (members.some((member) => member._tag === "spec-revision")) effects.push("spec-updated");
  if (response?._tag === "message" && response.interrupted === true) effects.push("interrupted");
  if (members.some((member) => member._tag === "coding-session" && member.partial === true)) {
    effects.push("partial");
  }
  if (response === undefined) effects.push("unanswered");
  return effects;
}

/** Mutable session marks are derived from the keyed record, not immutable checkpoint members. */
export function codingSessionEffects(
  record: PlanCodingSessionRecord,
): ReadonlyArray<PlanCheckpointEffect> {
  return [
    ...(record.partial ? (["partial"] as const) : []),
    ...(record.departedRef === null ? [] : (["departed"] as const)),
  ];
}

function remapParents(
  parents: ReadonlyArray<MercurianCommitId>,
  nodeIdByCommit: ReadonlyMap<string, MercurianCommitId>,
): ReadonlyArray<MercurianCommitId> {
  return [...new Set(parents.map((parentId) => nodeIdByCommit.get(parentId) ?? parentId))];
}

/** Surface a commit-keyed verdict or freshness mark on its projected node. */
export function mapMarksToNodes(
  marks: Iterable<string>,
  nodeIdByCommit: ReadonlyMap<string, MercurianCommitId>,
): ReadonlySet<string> {
  return new Set([...marks].map((commitId) => nodeIdByCommit.get(commitId) ?? commitId));
}

/** Resolve an exact historical position to the checkpoint that contains it. */
export function planNodeIdForCommit(
  commitId: MercurianCommitId | null,
  nodeIdByCommit: ReadonlyMap<string, MercurianCommitId>,
): MercurianCommitId | null {
  return commitId === null ? null : (nodeIdByCommit.get(commitId) ?? commitId);
}

/** A query on an active turn's descendant chain is streaming, not unanswered. */
export function isUnansweredCheckpointInFlight(
  node: PlanGraphNode,
  commitGraph: PlanGraph,
  inFlightAnchorCommitIds: ReadonlyArray<MercurianCommitId>,
): boolean {
  const checkpoint = node.checkpoint;
  if (checkpoint === undefined || checkpoint.response !== undefined) return false;
  if (inFlightAnchorCommitIds.length === 0) return false;
  const descendants = descendantClosure(commitGraph, checkpoint.query.commitId);
  return inFlightAnchorCommitIds.some((anchor) => descendants.has(anchor));
}

export function planCheckpointEffectLabel(effect: PlanCheckpointEffect): string {
  return EFFECT_LABELS[effect];
}

/** A checkpoint is named by the query that opened it, not its terminal id. */
export function planNodeSummary(node: PlanGraphNode): string {
  return planCommitSummary(node.checkpoint?.query ?? node.item);
}

/** Status marks keep their semantic order when several share one graph node. */
export function planNodeStatusDots({
  staleSpec,
  stalePlan,
}: {
  readonly staleSpec: boolean;
  readonly stalePlan: boolean;
}): ReadonlyArray<{ readonly key: string; readonly fillClass: string }> {
  return [
    ...(staleSpec ? [{ key: "stale-spec", fillClass: "fill-amber-500" }] : []),
    ...(stalePlan ? [{ key: "stale-plan", fillClass: "fill-orange-500" }] : []),
  ];
}

/** Complete map detail: query, landed effects, then a compact response excerpt. */
export function planNodeDetail(node: PlanGraphNode, suppressUnanswered = false): string {
  const checkpoint = node.checkpoint;
  if (checkpoint === undefined) return planCommitDetail(node.item);

  const query = `You: ${planCommitDetail(checkpoint.query)}`;
  const effects = checkpoint.effects
    .filter((effect) => !suppressUnanswered || effect !== "unanswered")
    .map(planCheckpointEffectLabel)
    .join(" · ");
  const response =
    checkpoint.response === undefined
      ? ""
      : `Assistant: ${responseExcerpt(planCommitDetail(checkpoint.response))}`;
  return [query, effects, response].filter((part) => part.length > 0).join("\n\n");
}

const RESPONSE_EXCERPT_LENGTH = 240;

function responseExcerpt(response: string): string {
  const trimmed = response.trim();
  return trimmed.length <= RESPONSE_EXCERPT_LENGTH
    ? trimmed
    : `${trimmed.slice(0, RESPONSE_EXCERPT_LENGTH - 1).trimEnd()}…`;
}
