import { StackActions, useNavigation, useRoute } from "@react-navigation/native";
import { buildPlanGraph, type PlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { resolveImplementFrom } from "@t3tools/client-runtime/state/plan-node-popover";
import { EnvironmentId, type MercurianCommitId, type PlanId } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { usePlanDetail } from "../../state/mercurian";
import { useImplementFlow } from "./useImplementFlow";

export interface ImplementFromHereAvailability {
  readonly status: "available";
  readonly parentCommitId: MercurianCommitId | null;
  readonly begin: () => void;
  readonly failure: string | null;
}

/** The node-sheet seam shared by history and map entry points. */
export function useImplementFromHere(planId: PlanId) {
  const navigation = useNavigation();
  const route = useRoute();
  const environmentId = EnvironmentId.make(
    String((route.params as { readonly environmentId: string }).environmentId),
  );
  const state = usePlanDetail(environmentId, planId);
  const graph = useMemo(
    () => buildPlanGraph(state.detail?.timeline ?? []),
    [state.detail?.timeline],
  );
  const flow = useImplementFlow({
    environmentId,
    planId,
    graph,
    onReviewPlan: () => {
      navigation.dispatch(
        StackActions.popTo("Plan", {
          environmentId: String(environmentId),
          planId: String(planId),
          view: "artifact",
        }),
      );
    },
  });

  return useCallback(
    (commitGraph: PlanGraph, fromCommitId: MercurianCommitId): ImplementFromHereAvailability => ({
      status: "available",
      parentCommitId: resolveImplementFrom(commitGraph, fromCommitId),
      begin: () => flow.beginImplementFrom(fromCommitId),
      failure: flow.failure,
    }),
    [flow.beginImplementFrom, flow.failure],
  );
}
