/**
 * A continuable reading of planning history.
 *
 * The stored DAG remains commit-grained. This projection groups structurally
 * identifiable assistant turns, using either their terminal response or their
 * latest landed revision as the state continuation should use, while leaving
 * every other act independently addressable. The output deliberately keeps
 * the PlanGraph shape so all existing layouts and graph traversals retain one
 * source of truth.
 *
 * Durable checkpoint records join by exact ownership: a record's owner is the
 * query that opened the turn it describes, or the standalone act that attached
 * it. Workspace effects come from recorded file roles and landed revision
 * commits; lifecycle marks stay separate, so a saving or unknown capture never
 * reads as a verified plain turn.
 */
import {
  checkpointEffects,
  type CheckpointEffect,
} from "@t3tools/client-runtime/state/mercurian-checkpoint-effects";
import type {
  MercurianCommitId,
  MercurianReadCheckpointDiffResult,
  PlanCheckpointRecord,
  PlanCodingSessionRecord,
  PlanTimelineItem,
} from "@t3tools/contracts";

import {
  descendantClosure,
  planCommitDetail,
  planCommitSummary,
  type PlanCheckpoint,
  type PlanCheckpointStatus,
  type PlanGraph,
  type PlanGraphNode,
} from "./PlanGraph.logic";

export interface CondensedPlanGraph extends PlanGraph {
  /** Every source commit points at the continuable node that represents it. */
  readonly nodeIdByCommit: ReadonlyMap<string, MercurianCommitId>;
}

/** Effects and marks without the members they were read from. */
export interface PlanCheckpointReading {
  readonly effects: ReadonlyArray<CheckpointEffect>;
  readonly status: ReadonlyArray<PlanCheckpointStatus>;
}

export interface PlanCheckpointMark {
  readonly key: string;
  readonly label: string;
  readonly kind: "effect" | "status";
}

interface CheckpointCandidate {
  readonly entry: PlanGraphNode;
  readonly members: ReadonlyArray<PlanGraphNode>;
  readonly checkpoint: PlanCheckpoint;
  readonly identity: PlanGraphNode;
  readonly record: PlanCheckpointRecord | undefined;
}

const EFFECT_LABELS: Readonly<Record<CheckpointEffect, string>> = {
  code: "Code changed",
  memory: "Memory updated",
  plan: "Plan updated",
  spec: "Spec updated",
};

const STATUS_LABELS: Readonly<Record<PlanCheckpointStatus, string>> = {
  interrupted: "Interrupted",
  unanswered: "Unanswered",
  partial: "Partial",
  departed: "Departed",
  saving: "Saving…",
  failed: "Capture failed",
  unknown: "Capture unknown",
};

/** Glyph precedence on the map, and chip order everywhere else. */
const EFFECT_ORDER: ReadonlyArray<CheckpointEffect> = ["code", "memory", "plan", "spec"];
const STATUS_ORDER: ReadonlyArray<PlanCheckpointStatus> = [
  "interrupted",
  "unanswered",
  "partial",
  "departed",
  "saving",
  "failed",
  "unknown",
];

const NO_RECORDS: ReadonlyArray<PlanCheckpointRecord> = [];

/**
 * Condense complete human-query/assistant-response turns without changing the
 * history they describe. Parent edges originate at the group's entry commit,
 * then remap through membership so even a fork from an interior revision
 * remains connected to the checkpoint that now represents that revision.
 */
export function condensePlanGraph(
  graph: PlanGraph,
  records: ReadonlyArray<PlanCheckpointRecord> = NO_RECORDS,
): CondensedPlanGraph {
  if (graph.nodes.length === 0) {
    return { ...graph, nodeIdByCommit: new Map() };
  }

  const recordByOwner = new Map(records.map((record) => [record.ownerCommitId as string, record]));
  const candidates = new Map<string, CheckpointCandidate>();
  const absorbed = new Set<string>();

  for (const node of graph.nodes) {
    if (absorbed.has(node.commitId)) continue;
    const candidate = checkpointCandidate(graph, node, recordByOwner.get(node.commitId));
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
          ...(candidate.record === undefined ? {} : { record: candidate.record }),
          parents: remapParents(candidate.entry.parents, nodeIdByCommit),
          childrenIds: [],
          isBranchPoint: false,
          isMerge: false,
        },
      ];
    }
    if (absorbed.has(node.commitId)) return [];
    const record = recordByOwner.get(node.commitId);
    return [
      {
        ...node,
        ...(record === undefined ? {} : { record }),
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

function checkpointCandidate(
  graph: PlanGraph,
  opener: PlanGraphNode,
  record: PlanCheckpointRecord | undefined,
): CheckpointCandidate | null {
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
        record,
        checkpoint: {
          query: opener.item,
          revisions: revisions.map((revision) => revision.item),
          ...checkpointReading(
            members.map((member) => member.item),
            undefined,
            record,
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
        record,
        checkpoint: {
          query: opener.item,
          revisions: revisions.map((revision) => revision.item),
          response: child.item,
          ...checkpointReading(
            members.map((member) => member.item),
            child.item,
            record,
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

/**
 * Effects come from recorded file roles and landed revision commits. Marks come
 * from the reply, the members, and the record's request and capture lifecycle.
 */
export function checkpointReading(
  members: ReadonlyArray<PlanTimelineItem>,
  response: PlanTimelineItem | undefined,
  record: PlanCheckpointRecord | undefined,
): PlanCheckpointReading {
  const effects = new Set<CheckpointEffect>(
    record === undefined ? [] : checkpointEffects(record).categories,
  );
  if (record === undefined) {
    if (members.some((member) => member._tag === "plan-revision")) effects.add("plan");
    if (members.some((member) => member._tag === "spec-revision")) effects.add("spec");
  }

  const status = new Set<PlanCheckpointStatus>(
    record === undefined ? [] : recordStatusMarks(record),
  );
  if (response?._tag === "message" && response.interrupted === true) status.add("interrupted");
  if (response === undefined) status.add("unanswered");
  if (members.some((member) => member._tag === "coding-session" && member.partial === true)) {
    status.add("partial");
  }
  return {
    effects: EFFECT_ORDER.filter((effect) => effects.has(effect)),
    status: STATUS_ORDER.filter((mark) => status.has(mark)),
  };
}

/** Marks a record carries on its own, for turns and standalone acts alike. */
export function recordStatusMarks(
  record: PlanCheckpointRecord,
): ReadonlyArray<PlanCheckpointStatus> {
  const recorded = checkpointEffects(record);
  return STATUS_ORDER.filter((mark) => {
    switch (mark) {
      case "interrupted":
        return recorded.status.interrupted;
      case "unanswered":
        return false;
      case "partial":
        return recorded.status.partial;
      case "departed":
        return recordDeparted(record);
      case "saving":
        return recorded.status.saving;
      case "failed":
        return recorded.status.failed;
      case "unknown":
        return isUnknownCapture(record);
    }
  });
}

/**
 * A capture that never reached a terminal state and is not being saved. A query
 * that was never answered or was cancelled before dispatch has no capture to be
 * unknown about.
 */
export function isUnknownCapture(record: PlanCheckpointRecord): boolean {
  const state = record.request?.state;
  return (
    checkpointEffects(record).status.captureUnknown &&
    state !== "unanswered" &&
    state !== "cancelled"
  );
}

function recordDeparted(record: PlanCheckpointRecord): boolean {
  const capture = record.capture;
  if (capture === undefined) return false;
  return (
    (capture.departedRef !== undefined && capture.departedRef.length > 0) ||
    (capture.repositories ?? []).some(
      (group) => group.departedRef !== undefined && group.departedRef.length > 0,
    )
  );
}

/** Mutable session marks are derived from the keyed record, not immutable checkpoint members. */
export function codingSessionStatusMarks(
  record: PlanCodingSessionRecord,
): ReadonlyArray<PlanCheckpointStatus> {
  return [
    ...(record.partial ? (["partial"] as const) : []),
    ...(record.departedRef === null ? [] : (["departed"] as const)),
  ];
}

export function mergeStatusMarks(
  ...lists: ReadonlyArray<ReadonlyArray<PlanCheckpointStatus>>
): ReadonlyArray<PlanCheckpointStatus> {
  const present = new Set(lists.flat());
  return STATUS_ORDER.filter((mark) => present.has(mark));
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

export function planCheckpointEffectLabel(effect: CheckpointEffect): string {
  return EFFECT_LABELS[effect];
}

export function planCheckpointStatusLabel(status: PlanCheckpointStatus): string {
  return STATUS_LABELS[status];
}

/** Row and popover chips: effects first, then the marks that qualify them. */
export function planCheckpointMarks(
  reading: PlanCheckpointReading,
  suppressUnanswered = false,
): ReadonlyArray<PlanCheckpointMark> {
  return [
    ...reading.effects.map((effect) => ({
      key: `effect:${effect}`,
      label: EFFECT_LABELS[effect],
      kind: "effect" as const,
    })),
    ...reading.status
      .filter((mark) => !suppressUnanswered || mark !== "unanswered")
      .map((mark) => ({
        key: `status:${mark}`,
        label: STATUS_LABELS[mark],
        kind: "status" as const,
      })),
  ];
}

/** The one effect a turn disc wears on the map: code over memory over plan over spec. */
export function checkpointGlyphEffect(
  effects: ReadonlyArray<CheckpointEffect>,
): CheckpointEffect | null {
  return EFFECT_ORDER.find((effect) => effects.includes(effect)) ?? null;
}

/** A checkpoint is named by the query that opened it, not its terminal id. */
export function planNodeSummary(node: PlanGraphNode): string {
  return planCommitSummary(node.checkpoint?.query ?? node.item);
}

/** Status marks keep their semantic order when several share one graph node. */
export function planNodeStatusDots({
  staleSpec,
  stalePlan,
  status = [],
}: {
  readonly staleSpec: boolean;
  readonly stalePlan: boolean;
  readonly status?: ReadonlyArray<PlanCheckpointStatus>;
}): ReadonlyArray<{ readonly key: string; readonly fillClass: string }> {
  return [
    ...(status.includes("saving") ? [{ key: "saving", fillClass: "fill-sky-500" }] : []),
    ...(status.includes("failed") || status.includes("unknown")
      ? [{ key: "capture-unavailable", fillClass: "fill-red-500" }]
      : []),
    ...(status.includes("interrupted") || status.includes("partial")
      ? [{ key: "incomplete", fillClass: "fill-rose-500" }]
      : []),
    ...(staleSpec ? [{ key: "stale-spec", fillClass: "fill-amber-500" }] : []),
    ...(stalePlan ? [{ key: "stale-plan", fillClass: "fill-orange-500" }] : []),
  ];
}

/** Complete map detail: query, landed effects and marks, then a compact response excerpt. */
export function planNodeDetail(node: PlanGraphNode, suppressUnanswered = false): string {
  const checkpoint = node.checkpoint;
  if (checkpoint === undefined) return planCommitDetail(node.item);

  const query = `You: ${planCommitDetail(checkpoint.query)}`;
  const marks = planCheckpointMarks(checkpoint, suppressUnanswered)
    .map((mark) => mark.label)
    .join(" · ");
  const response =
    checkpoint.response === undefined
      ? ""
      : `Assistant: ${responseExcerpt(planCommitDetail(checkpoint.response))}`;
  return [query, marks, response].filter((part) => part.length > 0).join("\n\n");
}

/** Why a saved checkpoint diff is not shown. Never a current-HEAD fallback. */
export function recordedCheckpointDiffUnavailableLabel(
  reason: Extract<MercurianReadCheckpointDiffResult, { readonly status: "unavailable" }>["reason"],
): string {
  switch (reason) {
    case "record-missing":
      return "This checkpoint has no saved capture record yet.";
    case "record-changed":
      return "This checkpoint's record changed. Open its changes again to read the latest capture.";
    case "capture-pending":
      return "The workspace capture for this checkpoint is still saving.";
    case "snapshot-missing":
      return "The saved snapshot for this checkpoint is unavailable, so its changes cannot be shown.";
    case "repository-not-recorded":
      return "This repository was not recorded at this checkpoint.";
    case "repository-unavailable":
      return "The repository is not reachable right now. Refresh to try again.";
  }
}

const RESPONSE_EXCERPT_LENGTH = 240;

function responseExcerpt(response: string): string {
  const trimmed = response.trim();
  return trimmed.length <= RESPONSE_EXCERPT_LENGTH
    ? trimmed
    : `${trimmed.slice(0, RESPONSE_EXCERPT_LENGTH - 1).trimEnd()}…`;
}
