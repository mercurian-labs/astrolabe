import { positionAfterPick, type PlanPosition } from "@t3tools/client-runtime/state/plan-position";
import type { PlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import type { PlanNodePopoverAct } from "@t3tools/client-runtime/state/plan-node-popover";
import type { MercurianCommitId } from "@t3tools/contracts";

export interface MobileCheckpointAct {
  readonly key: "continue" | "implement" | "open-session";
  readonly label: string;
  readonly disabled: boolean;
  readonly reason?: string;
}

export function checkpointSheetActions(
  offered: ReadonlyArray<PlanNodePopoverAct>,
  implement:
    | { readonly status: "available"; readonly failure?: string | null }
    | { readonly status: "unavailable"; readonly reason: string },
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
            disabled: implement.status === "unavailable",
            ...(implement.status === "unavailable"
              ? { reason: implement.reason }
              : implement.failure
                ? { reason: implement.failure }
                : {}),
          },
        ]
      : []),
    ...(offered.includes("open-session")
      ? [{ key: "open-session" as const, label: "Open session", disabled: false }]
      : []),
  ];
}

export const positionForGoHere = (graph: PlanGraph, commitId: MercurianCommitId): PlanPosition =>
  positionAfterPick(graph, commitId);
