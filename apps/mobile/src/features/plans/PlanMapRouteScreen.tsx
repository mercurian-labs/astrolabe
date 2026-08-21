import { type StaticScreenProps, useFocusEffect, useNavigation } from "@react-navigation/native";
import {
  condensePlanGraph,
  mapMarksToNodes,
  planNodeIdForCommit,
} from "@t3tools/client-runtime/state/plan-checkpoints";
import { stalePlanLeafIds, staleSpecLeafIds } from "@t3tools/client-runtime/state/plan-freshness";
import { buildPlanGraph, dagLayout } from "@t3tools/client-runtime/state/plan-graph";
import { resolveHead } from "@t3tools/client-runtime/state/plan-position";
import { EnvironmentId, PlanId, type MercurianCommitId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";
import { Platform, View } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { EmptyState } from "../../components/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { usePlanDetail } from "../../state/mercurian";
import { usePlanPosition } from "../../state/plan-position";
import { PlanMap } from "./PlanMap";

type Props = StaticScreenProps<{ readonly environmentId: string; readonly planId: string }>;

export function PlanMapRouteScreen({ route }: Props) {
  const environmentIdRaw = firstRouteParam(route.params.environmentId);
  const planIdRaw = firstRouteParam(route.params.planId);
  if (environmentIdRaw === null || planIdRaw === null) {
    return (
      <View className="flex-1 items-center justify-center bg-screen px-6">
        <NativeStackScreenOptions options={{ title: "Map" }} />
        <EmptyState
          title="Map unavailable"
          detail="This map link is missing its environment or plan identity."
          variant="plain"
        />
      </View>
    );
  }
  return (
    <PlanMapRouteContent
      environmentId={EnvironmentId.make(environmentIdRaw)}
      planId={PlanId.make(planIdRaw)}
    />
  );
}

function PlanMapRouteContent(props: {
  readonly environmentId: EnvironmentId;
  readonly planId: PlanId;
}) {
  const navigation = useNavigation();
  const state = usePlanDetail(props.environmentId, props.planId);
  const timeline = state.detail?.timeline ?? [];
  const commitGraph = useMemo(() => buildPlanGraph(timeline), [timeline]);
  const graph = useMemo(() => condensePlanGraph(commitGraph), [commitGraph]);
  const layout = useMemo(() => dagLayout(graph, { layout: "sugiyama" }), [graph]);
  const position = usePlanPosition(props.environmentId, props.planId, commitGraph);
  const currentCommitId = planNodeIdForCommit(
    resolveHead(commitGraph, position.position),
    graph.nodeIdByCommit,
  );
  const staleSpecNodeIds = useMemo(
    () => mapMarksToNodes(staleSpecLeafIds(commitGraph), graph.nodeIdByCommit),
    [commitGraph, graph.nodeIdByCommit],
  );
  const stalePlanNodeIds = useMemo(
    () => mapMarksToNodes(stalePlanLeafIds(commitGraph), graph.nodeIdByCommit),
    [commitGraph, graph.nodeIdByCommit],
  );
  const readyNodeIds = useMemo(
    () => mapMarksToNodes(state.readyCommits.keys(), graph.nodeIdByCommit),
    [graph.nodeIdByCommit, state.readyCommits],
  );
  const [selectedCommitId, setSelectedCommitId] = useState<MercurianCommitId | null>(null);
  useFocusEffect(
    useCallback(() => {
      setSelectedCommitId(null);
    }, []),
  );

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions
        options={{ title: "Map", headerShown: Platform.OS !== "android" }}
      />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title="Map" onBack={() => navigation.goBack()} />
      ) : null}
      {state.detail === null ? (
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            title={state.isPending ? "Opening map" : "Map unavailable"}
            detail={state.error ?? "This plan is not available in the current environment."}
            variant="plain"
          />
        </View>
      ) : (
        <PlanMap
          graph={graph}
          layout={layout}
          currentCommitId={currentCommitId}
          selectedCommitId={selectedCommitId}
          readyNodeIds={readyNodeIds}
          staleSpecNodeIds={staleSpecNodeIds}
          stalePlanNodeIds={stalePlanNodeIds}
          onOpenNode={(commitId) => {
            setSelectedCommitId(commitId);
            navigation.navigate("PlanCheckpoint", {
              environmentId: String(props.environmentId),
              planId: String(props.planId),
              commitId: String(commitId),
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
