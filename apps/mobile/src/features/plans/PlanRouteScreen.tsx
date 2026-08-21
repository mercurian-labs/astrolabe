import { type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, PlanId } from "@t3tools/contracts";
import { useEffect } from "react";
import { ScrollView } from "react-native";

import { EmptyState } from "../../components/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useMercurianTree, useVisitPlan } from "../../state/mercurian";

type PlanRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly planId: string;
}>;

function firstRouteParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export function PlanRouteScreen({ route }: PlanRouteScreenProps) {
  const environmentIdRaw = firstRouteParam(route.params.environmentId);
  const planIdRaw = firstRouteParam(route.params.planId);
  const environmentId = environmentIdRaw ? EnvironmentId.make(environmentIdRaw) : null;
  const planId = planIdRaw ? PlanId.make(planIdRaw) : null;
  const tree = useMercurianTree(environmentId);
  const visitPlan = useVisitPlan(environmentId);
  const row = tree.snapshot.plans.find((plan) => plan.planId === planId) ?? null;

  useEffect(() => {
    if (row === null) return;
    void visitPlan({ planId: row.planId });
  }, [row?.planId, row?.updatedAt, visitPlan]);

  return (
    <>
      <NativeStackScreenOptions options={{ title: row?.title ?? "Plan" }} />
      <ScrollView
        className="flex-1 bg-screen"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
      >
        <EmptyState
          title={row?.title ?? (tree.isPending ? "Opening plan" : "Plan unavailable")}
          detail={
            row
              ? "The mobile planning space arrives with M-147."
              : (tree.error ?? "This plan is not available in the current workspace snapshot.")
          }
          variant="plain"
        />
      </ScrollView>
    </>
  );
}
