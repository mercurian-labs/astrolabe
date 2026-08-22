import {
  PLAN_MAY_BE_STALE_LABEL,
  planMayBeStaleAt,
} from "@t3tools/client-runtime/state/plan-freshness";
import type { PlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { resolveImplementFrom } from "@t3tools/client-runtime/state/plan-node-popover";
import { implementFlowAction } from "@t3tools/client-runtime/state/plan-splits";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, MercurianCommitId, PlanId } from "@t3tools/contracts";
import { useCallback, useState } from "react";
import { Alert, Platform } from "react-native";

import { showConfirmDialog } from "../../components/ConfirmDialogHost";
import { mercurianPlanning } from "../../state/mercurian";
import { useAtomCommand } from "../../state/use-atom-command";
import { implementErrorMessage, STALE_PLAN_WARNING_MESSAGE } from "./useImplementFlow.logic";

export function useImplementFlow(input: {
  readonly environmentId: EnvironmentId;
  readonly planId: PlanId;
  readonly graph: PlanGraph;
  readonly onReviewPlan: () => void;
}) {
  const tryImplement = useAtomCommand(mercurianPlanning.tryImplement, { reportFailure: false });
  const [failure, setFailure] = useState<string | null>(null);

  const evaluate = useCallback(
    async (parentCommitId: MercurianCommitId | null) => {
      setFailure(null);
      const result = await tryImplement({
        environmentId: input.environmentId,
        input: {
          planId: input.planId,
          ...(parentCommitId === null ? {} : { parentCommitId }),
        },
      });
      if (result._tag === "Failure") {
        setFailure(implementErrorMessage(squashAtomCommandFailure(result)));
      }
    },
    [input.environmentId, input.planId, tryImplement],
  );

  const beginImplementFrom = useCallback(
    (fromCommitId: MercurianCommitId | null) => {
      const parentCommitId = resolveImplementFrom(input.graph, fromCommitId);
      const action = implementFlowAction({
        kind: "invoke",
        planMayBeStale: parentCommitId !== null && planMayBeStaleAt(input.graph, parentCommitId),
      });
      if (action === "evaluate-readiness") {
        void evaluate(parentCommitId);
        return;
      }
      const review = () => {
        if (implementFlowAction({ kind: "review-plan" }) === "show-plan") input.onReviewPlan();
      };
      const proceed = () => {
        if (implementFlowAction({ kind: "continue-anyway" }) === "evaluate-readiness") {
          void evaluate(parentCommitId);
        }
      };
      if (Platform.OS === "ios") {
        Alert.alert(PLAN_MAY_BE_STALE_LABEL, STALE_PLAN_WARNING_MESSAGE, [
          { text: "Review plan", onPress: review },
          { text: "Continue anyway", onPress: proceed },
        ]);
      } else {
        showConfirmDialog({
          title: PLAN_MAY_BE_STALE_LABEL,
          message: STALE_PLAN_WARNING_MESSAGE,
          cancelText: "Review plan",
          confirmText: "Continue anyway",
          onCancel: review,
          onConfirm: proceed,
        });
      }
    },
    [evaluate, input.graph, input.onReviewPlan],
  );

  return { beginImplementFrom, failure, clearFailure: () => setFailure(null) } as const;
}
