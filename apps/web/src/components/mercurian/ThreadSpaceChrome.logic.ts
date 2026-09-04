import type {
  MercurianCommitId,
  MercurianThreadPlanLink,
  PlanDetail,
  PlanInFlightTurn,
  PlanLineRuntimeRecord,
} from "@t3tools/contracts";

import type { ChatMessage } from "../../types";
import type { PlanGraph } from "./PlanGraph.logic";

type LineOwnershipDetail = Readonly<{
  plan: Pick<PlanDetail["plan"], "planId">;
  lineRuntimes: PlanDetail["lineRuntimes"];
}>;

type LineInFlightDetail = LineOwnershipDetail & Pick<PlanDetail, "inFlightTurns">;

export function resolveForkHereInput(
  graph: PlanGraph,
  message: Pick<ChatMessage, "id" | "text">,
): { readonly parentCommitId: MercurianCommitId; readonly seedText: string } | null {
  const node = graph.byId.get(message.id);
  const parentCommitId = node?.parents[0];
  return parentCommitId === undefined ? null : { parentCommitId, seedText: message.text };
}

function knownLineRootIds(
  detail: LineOwnershipDetail,
  threadPlanLinks: ReadonlyArray<MercurianThreadPlanLink>,
) {
  return new Set<string>([
    ...detail.lineRuntimes.flatMap((runtime) =>
      runtime.lineRootCommitId === null ? [] : [runtime.lineRootCommitId],
    ),
    ...threadPlanLinks.flatMap((link) =>
      link.planId !== detail.plan.planId || link.lineRootCommitId == null
        ? []
        : [link.lineRootCommitId],
    ),
  ]);
}

function lineRootCommitIdFor(
  graph: PlanGraph,
  commitId: MercurianCommitId,
  lineRootIds: ReadonlySet<string>,
): MercurianCommitId | null {
  const planRoot = graph.nodes.find(
    (node) => node.item._tag !== "coding-session" && node.parents.length === 0,
  )?.commitId;
  let current: MercurianCommitId | undefined = commitId;
  while (current !== undefined) {
    if (lineRootIds.has(current)) return current;
    current = graph.byId.get(current)?.parents[0];
  }
  return planRoot ?? null;
}

export function resolveLineInFlightTurn(
  detail: LineInFlightDetail | null,
  graph: PlanGraph,
  runtime: PlanLineRuntimeRecord | null,
  threadPlanLinks: ReadonlyArray<MercurianThreadPlanLink>,
): PlanInFlightTurn | undefined {
  if (detail === null || runtime?.lineRootCommitId === null || runtime === null) return undefined;
  const lineRootIds = knownLineRootIds(detail, threadPlanLinks);
  return detail.inFlightTurns.find(
    (turn) =>
      lineRootCommitIdFor(graph, turn.parentCommitId, lineRootIds) === runtime.lineRootCommitId,
  );
}

export function resolveLineTip(
  detail: LineOwnershipDetail | null,
  graph: PlanGraph,
  runtime: PlanLineRuntimeRecord | null,
  threadPlanLinks: ReadonlyArray<MercurianThreadPlanLink>,
): MercurianCommitId | null {
  if (runtime === null) return null;
  if (runtime.lineRootCommitId === null) return runtime.forkParentCommitId ?? null;
  if (detail === null) return null;
  const lineRootIds = knownLineRootIds(detail, threadPlanLinks);
  return (
    graph.nodes
      .filter(
        (node) =>
          node.item._tag !== "coding-session" &&
          lineRootCommitIdFor(graph, node.commitId, lineRootIds) === runtime.lineRootCommitId,
      )
      .toSorted((left, right) => right.item.sequence - left.item.sequence)[0]?.commitId ?? null
  );
}
