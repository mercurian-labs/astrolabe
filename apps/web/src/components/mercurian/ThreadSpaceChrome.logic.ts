import type {
  MercurianCommitId,
  MercurianThreadPlanLink,
  PlanDetail,
  PlanInFlightTurn,
  PlanLineRuntimeRecord,
  PlanStreamItem,
} from "@t3tools/contracts";

import type { ChatMessage } from "../../types";
import type { PlanGraph } from "./PlanGraph.logic";
import { knownLineRootIds, lineRootCommitIdFor } from "./planLineOwnership.logic";

type LineInFlightDetail = Readonly<{
  plan: Pick<PlanDetail["plan"], "planId">;
  lineRuntimes: PlanDetail["lineRuntimes"];
  inFlightTurns: PlanDetail["inFlightTurns"];
}>;

/** The provisional fork parent becomes the line root's parent after its first turn. */
export function resolveLineOrigin(
  graph: PlanGraph,
  runtime: Pick<PlanLineRuntimeRecord, "lineRootCommitId" | "forkParentCommitId"> | null,
): MercurianCommitId | null {
  if (runtime === null) return null;
  if (runtime.forkParentCommitId !== undefined) return runtime.forkParentCommitId;
  if (runtime.lineRootCommitId === null) return null;
  return graph.byId.get(runtime.lineRootCommitId)?.item.parents[0] ?? null;
}

export function resolveForkHereInput(
  graph: PlanGraph,
  message: Pick<ChatMessage, "id" | "text">,
): { readonly parentCommitId: MercurianCommitId; readonly seedText: string } | null {
  const node = graph.byId.get(message.id);
  const parentCommitId = node?.parents[0];
  return parentCommitId === undefined ? null : { parentCommitId, seedText: message.text };
}

export function memoryAmendmentFailureNotice(
  failure: Extract<PlanStreamItem, { readonly kind: "memory-amendment-failed" }>,
): string {
  return `The assistant couldn't produce a usable memory amendment; nothing landed. ${failure.reason}`;
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
