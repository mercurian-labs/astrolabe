import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { condensePlanGraph, mapMarksToNodes } from "@t3tools/client-runtime/state/plan-checkpoints";
import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { stalePlanLeafIds, staleSpecLeafIds } from "@t3tools/client-runtime/state/plan-freshness";
import { EnvironmentId, PlanId } from "@t3tools/contracts";
import { useMemo } from "react";
import { Platform, View } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { EmptyState } from "../../components/EmptyState";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { usePlanDetail } from "../../state/mercurian";
import { usePlanPosition } from "../../state/plan-position";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
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
  const iconColor = useThemeColor("--color-icon");
  const state = usePlanDetail(props.environmentId, props.planId);
  const timeline = state.detail?.timeline ?? [];
  const graph = useMemo(() => buildPlanGraph(timeline), [timeline]);
  const displayGraph = useMemo(() => condensePlanGraph(graph), [graph]);
  const position = usePlanPosition(props.environmentId, props.planId, graph);
  const stalePlanIds = useMemo(
    () => mapMarksToNodes(stalePlanLeafIds(graph), displayGraph.nodeIdByCommit),
    [displayGraph.nodeIdByCommit, graph],
  );
  const staleSpecIds = useMemo(
    () => mapMarksToNodes(staleSpecLeafIds(graph), displayGraph.nodeIdByCommit),
    [displayGraph.nodeIdByCommit, graph],
  );
  const readyCommitIds = useMemo(
    () => mapMarksToNodes(state.readyCommits.keys(), displayGraph.nodeIdByCommit),
    [displayGraph.nodeIdByCommit, state.readyCommits],
  );
  const model = useMemo(
    () =>
      buildPlanHistoryModel({ detail: state.detail }, position.position, position.parentChoices),
    [position.parentChoices, position.position, state.detail],
  );
  const openMap = () =>
    navigation.navigate("PlanMap", {
      environmentId: String(props.environmentId),
      planId: String(props.planId),
    });

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions
        optionsVersion={[String(props.environmentId), String(props.planId)]}
        options={{
          title: "History",
          headerShown: Platform.OS !== "android",
          headerTintColor: iconColor,
          unstable_headerRightItems:
            Platform.OS === "ios"
              ? () => [
                  withNativeGlassHeaderItem({
                    accessibilityLabel: "Show checkpoint map",
                    icon: {
                      name: "point.3.connected.trianglepath.dotted",
                      type: "sfSymbol",
                    } as const,
                    identifier: "plan-map",
                    label: "",
                    onPress: openMap,
                    type: "button",
                  }),
                ]
              : undefined,
        }}
      />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title="History"
          onBack={() => navigation.goBack()}
          actions={[
            {
              accessibilityLabel: "Show checkpoint map",
              icon: "point.3.connected.trianglepath.dotted",
              onPress: openMap,
            },
          ]}
        />
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
          readyCommitIds={readyCommitIds}
          stalePlanIds={stalePlanIds}
          staleSpecIds={staleSpecIds}
          onSelect={(row) => {
            navigation.navigate("PlanCheckpoint", {
              environmentId: String(props.environmentId),
              planId: String(props.planId),
              commitId: String(row.commitId),
            });
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
