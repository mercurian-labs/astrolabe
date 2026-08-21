import {
  condensePlanGraph,
  isUnansweredCheckpointInFlight,
  planNodeIdForCommit,
} from "@t3tools/client-runtime/state/plan-checkpoints";
import {
  buildPlanGraph,
  planCommitSummary,
  type PlanCheckpointEffect,
  type PlanGraph,
} from "@t3tools/client-runtime/state/plan-graph";
import { resolveHead, type PlanPosition } from "@t3tools/client-runtime/state/plan-position";
import {
  branchOption,
  threadLayout,
  type BranchOption,
  type ThreadSwitch,
} from "@t3tools/client-runtime/state/plan-thread";
import type { PlanSubscriptionState } from "@t3tools/client-runtime/state/mercurian-planning";
import type { MercurianCommitId, PlanTimelineItem } from "@t3tools/contracts";

export type PlanHistorySwitchKind = "siblings" | "parent-lines";

export interface PlanHistorySwitch {
  readonly kind: PlanHistorySwitchKind;
  readonly index: number;
  readonly options: ReadonlyArray<BranchOption>;
}

interface PlanHistoryRowBase {
  readonly commitId: MercurianCommitId;
  readonly published: boolean;
  readonly createdAt: string;
  readonly current: boolean;
  readonly siblings?: PlanHistorySwitch;
  readonly parentLines?: PlanHistorySwitch;
}

export interface PlanHistoryCheckpointRow extends PlanHistoryRowBase {
  readonly kind: "checkpoint";
  readonly query: PlanTimelineItem;
  readonly response?: PlanTimelineItem;
  readonly effects: ReadonlyArray<PlanCheckpointEffect>;
}

export interface PlanHistoryCommitRow extends PlanHistoryRowBase {
  readonly kind: "commit";
  readonly item: PlanTimelineItem;
  readonly summary: string;
}

export type PlanHistoryRow = PlanHistoryCheckpointRow | PlanHistoryCommitRow;

export interface PlanHistoryModel {
  readonly commitGraph: PlanGraph;
  readonly currentNodeId: MercurianCommitId | null;
  readonly rows: ReadonlyArray<PlanHistoryRow>;
  readonly inFlightUnansweredNodeIds: ReadonlySet<string>;
}

export function buildPlanHistoryModel(
  state: Pick<PlanSubscriptionState, "detail">,
  position: PlanPosition,
  parentChoices: ReadonlyMap<string, MercurianCommitId>,
): PlanHistoryModel {
  const timeline = state.detail?.timeline ?? [];
  const commitGraph = buildPlanGraph(timeline);
  const graph = condensePlanGraph(commitGraph);
  const head = resolveHead(commitGraph, position);
  const currentNodeId = planNodeIdForCommit(head, graph.nodeIdByCommit);
  // Every live turn's anchor: replies stream concurrently across branches
  // (M-158), so a query is streaming if any of them descends from it.
  const inFlightAnchorCommitIds = (state.detail?.inFlightTurns ?? []).map(
    (turn) => turn.parentCommitId,
  );
  const inFlightUnansweredNodeIds = new Set(
    graph.nodes
      .filter((node) => isUnansweredCheckpointInFlight(node, commitGraph, inFlightAnchorCommitIds))
      .map((node) => node.commitId as string),
  );
  const rows = threadLayout(graph, currentNodeId, parentChoices).rows.map(
    (node): PlanHistoryRow => {
      const shared = {
        commitId: node.commitId,
        published: node.item.published,
        createdAt: node.item.createdAt,
        current: node.commitId === currentNodeId,
        ...(node.siblings === undefined
          ? {}
          : { siblings: historySwitch(graph, "siblings", node.siblings) }),
        ...(node.parentLines === undefined
          ? {}
          : { parentLines: historySwitch(graph, "parent-lines", node.parentLines) }),
      };
      if (node.checkpoint === undefined) {
        return {
          ...shared,
          kind: "commit",
          item: node.item,
          summary: planCommitSummary(node.item),
        };
      }
      return {
        ...shared,
        kind: "checkpoint",
        query: node.checkpoint.query,
        ...(node.checkpoint.response === undefined ? {} : { response: node.checkpoint.response }),
        effects: node.checkpoint.effects.filter(
          (effect) => effect !== "unanswered" || !inFlightUnansweredNodeIds.has(node.commitId),
        ),
      };
    },
  );
  return { commitGraph, currentNodeId, rows, inFlightUnansweredNodeIds };
}

export function findPlanHistorySwitch(
  model: PlanHistoryModel,
  commitId: MercurianCommitId,
  kind: PlanHistorySwitchKind,
): PlanHistorySwitch | null {
  const row = model.rows.find((candidate) => candidate.commitId === commitId);
  if (row === undefined) return null;
  return kind === "siblings" ? (row.siblings ?? null) : (row.parentLines ?? null);
}

function historySwitch(
  graph: PlanGraph,
  kind: PlanHistorySwitchKind,
  selection: ThreadSwitch,
): PlanHistorySwitch {
  return {
    kind,
    index: selection.index,
    options: selection.options.map((optionId) => branchOption(graph, optionId)),
  };
}
