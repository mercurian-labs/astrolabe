import { positionAfterPick, type PlanPosition } from "@t3tools/client-runtime/state/plan-position";
import type { PlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import type { PlanNodePopoverAct } from "@t3tools/client-runtime/state/plan-node-popover";
import type { MercurianCommitId } from "@t3tools/contracts";

export interface MobileCheckpointAct {
  readonly key: "continue" | "implement";
  readonly label: string;
  readonly disabled: boolean;
  readonly reason?: string;
}

export function checkpointSheetActions(
  offered: ReadonlyArray<PlanNodePopoverAct>,
  implement: { readonly status: "unavailable"; readonly reason: string },
): ReadonlyArray<MobileCheckpointAct> {
  return [
    ...(offered.includes("continue")
      ? [{ key: "continue" as const, label: "Go here", disabled: false }]
      : []),
    ...(offered.includes("implement")
      ? [
          {
            key: "implement" as const,
            label: "Implement from here",
            disabled: true,
            reason: implement.reason,
          },
        ]
      : []),
  ];
}

export const positionForGoHere = (graph: PlanGraph, commitId: MercurianCommitId): PlanPosition =>
  positionAfterPick(graph, commitId);
