import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { EnvironmentId, PlanId } from "@t3tools/contracts";
import { useMemo } from "react";
import { Platform, View } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { EmptyState } from "../../components/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { usePlanDetail } from "../../state/mercurian";
import { usePlanPosition } from "../../state/plan-position";
import { buildPlanHistoryModel } from "./plan-history-model";
import { PlanHistoryScreen } from "./PlanHistoryScreen";

type PlanHistoryRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly planId: string;
}>;

export function PlanHistoryRouteScreen({ route }: PlanHistoryRouteScreenProps) {
  const environmentIdRaw = firstRouteParam(route.params.environmentId);
  const planIdRaw = firstRouteParam(route.params.planId);
  if (environmentIdRaw === null || planIdRaw === null) {
    return (
      <View className="flex-1 items-center justify-center bg-screen px-6">
        <NativeStackScreenOptions
          options={{ title: "History", headerShown: Platform.OS !== "android" }}
        />
        <EmptyState
          title="History unavailable"
          detail="This history link is missing its environment or plan identity."
          variant="plain"
        />
      </View>
    );
  }
  return (
    <PlanHistoryRouteContent
      environmentId={EnvironmentId.make(environmentIdRaw)}
      planId={PlanId.make(planIdRaw)}
    />
  );
}

function PlanHistoryRouteContent(props: {
  readonly environmentId: EnvironmentId;
  readonly planId: PlanId;
}) {
  const navigation = useNavigation();
  const state = usePlanDetail(props.environmentId, props.planId);
  const timeline = state.detail?.timeline ?? [];
  const graph = useMemo(() => buildPlanGraph(timeline), [timeline]);
  const position = usePlanPosition(props.environmentId, props.planId, graph);
  const model = useMemo(
    () =>
      buildPlanHistoryModel({ detail: state.detail }, position.position, position.parentChoices),
    [position.parentChoices, position.position, state.detail],
  );

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions
        options={{ title: "History", headerShown: Platform.OS !== "android" }}
      />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title="History" onBack={() => navigation.goBack()} />
      ) : null}
      {state.detail === null ? (
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            title={state.isPending ? "Opening history" : "History unavailable"}
            detail={state.error ?? "This plan is not available in the current environment."}
            variant="plain"
          />
        </View>
      ) : (
        <PlanHistoryScreen
          model={model}
          onSelect={(row) => {
            position.pick(row.commitId);
            navigation.goBack();
          }}
          onOpenSwitch={(row, selection) => {
            navigation.navigate("PlanBranches", {
              environmentId: String(props.environmentId),
              planId: String(props.planId),
              commitId: String(row.commitId),
              kind: selection.kind,
            });
          }}
        />
      )}
    </View>
  );
}

function firstRouteParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
