import type { PlanReconstruction } from "@t3tools/contracts";
import { planCommitSummary, type PlanGraph } from "./PlanGraph.logic";

export function reconstructionBoundaryLabel(record: PlanReconstruction, graph: PlanGraph): string {
  if (record.compacted === null) return "Start of history";
  const node = graph.byId.get(record.verbatimFromCommitId);
  return `Verbatim from ${node === undefined ? record.verbatimFromCommitId.slice(0, 8) : planCommitSummary(node.item)}`;
}
