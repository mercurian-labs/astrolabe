import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import { useNavigation } from "@react-navigation/native";
import { EnvironmentId, type PlanTreeRow } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPill";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useMercurianTree, useUnarchivePlan } from "../../state/mercurian";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../state/workspace";
import { checkForAppUpdateOnLaunch } from "../updates/app-updates";
import { getConnectionAwareBrandHeaderOptions } from "../home/WorkspaceConnectionTitle";
import { buildPlanListFilterMenu } from "./plan-list-filter-menu";
import { PlanListScreen } from "./PlanListScreen";
import { resolvePlanListEnvironmentId } from "./planListItems";

export function PlanListRouteScreen() {
  const navigation = useNavigation();
  const iconColor = useThemeColor("--color-icon");
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    void checkForAppUpdateOnLaunch();
  }, []);

  const environments = useMemo(() => {
    const connectionStateByEnvironmentId = new Map(
      workspaceEnvironments.map(
        (environment) => [environment.environmentId, environment.connectionState] as const,
      ),
    );
    return Arr.sort(
      Object.values(savedConnectionsById).map((connection) => ({
        environmentId: connection.environmentId,
        label: connection.environmentLabel,
        connectionState:
          connectionStateByEnvironmentId.get(connection.environmentId) ?? "available",
      })),
      Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
    );
  }, [savedConnectionsById, workspaceEnvironments]);
  const environmentId = resolvePlanListEnvironmentId(
    selectedEnvironmentId,
    environments.map((environment) => environment.environmentId),
  );
  const tree = useMercurianTree(environmentId);
  const unarchivePlan = useUnarchivePlan(environmentId);
  const selectedProject = tree.snapshot.projects.find(
    (project) => project.projectId === selectedProjectId,
  );

  useEffect(() => {
    if (
      selectedProjectId !== null &&
      !tree.snapshot.projects.some((project) => project.projectId === selectedProjectId)
    ) {
      setSelectedProjectId(null);
    }
  }, [selectedProjectId, tree.snapshot.projects]);

  const menuActions = useMemo(
    () =>
      buildPlanListFilterMenu({
        environments,
        projects: tree.snapshot.projects,
        selectedEnvironmentId: environmentId,
        selectedProjectId,
      }),
    [environmentId, environments, selectedProjectId, tree.snapshot.projects],
  );
  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      const id = nativeEvent.event;
      if (id.startsWith("workspace:")) {
        const selected = environments.find(
          (environment) => String(environment.environmentId) === id.slice("workspace:".length),
        );
        if (selected) {
          setSelectedEnvironmentId(selected.environmentId);
          setSelectedProjectId(null);
        }
        return;
      }
      if (id === "project:all") {
        setSelectedProjectId(null);
        return;
      }
      if (id.startsWith("project:")) {
        const projectId = id.slice("project:".length);
        if (tree.snapshot.projects.some((project) => project.projectId === projectId)) {
          setSelectedProjectId(projectId);
        }
      }
    },
    [environments, tree.snapshot.projects],
  );
  const handleSelectPlan = useCallback(
    (plan: PlanTreeRow) => {
      if (environmentId === null) return;
      navigation.navigate("Plan", {
        environmentId: String(environmentId),
        planId: String(plan.planId),
      });
    },
    [environmentId, navigation],
  );
  const handleRestorePlan = useCallback(
    (plan: PlanTreeRow) => {
      void unarchivePlan({ planId: plan.planId });
    },
    [unarchivePlan],
  );
  const hasCustomFilter = selectedEnvironmentId !== null || selectedProjectId !== null;
  const environmentConnectionState =
    environments.find((environment) => environment.environmentId === environmentId)
      ?.connectionState ?? null;

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions
        options={getConnectionAwareBrandHeaderOptions({
          onOpenEnvironments: () =>
            navigation.navigate("SettingsSheet", { screen: "SettingsEnvironments" }),
        })}
      />
      <View className="flex-row justify-end gap-2 px-5 py-2">
        <ControlPillMenu actions={menuActions} onPressAction={handleMenuAction}>
          <Pressable
            accessibilityLabel="Filter plans"
            accessibilityRole="button"
            className="size-11 items-center justify-center rounded-full bg-subtle"
          >
            <SymbolView
              name={
                hasCustomFilter
                  ? "line.3.horizontal.decrease.circle.fill"
                  : "line.3.horizontal.decrease.circle"
              }
              size={17}
              tintColor={iconColor}
              type="monochrome"
            />
          </Pressable>
        </ControlPillMenu>
        <Pressable
          accessibilityLabel="Open settings"
          accessibilityRole="button"
          className="size-11 items-center justify-center rounded-full bg-subtle"
          onPress={() => navigation.navigate("SettingsSheet", { screen: "Settings" })}
        >
          <SymbolView name="gearshape" size={18} tintColor={iconColor} type="monochrome" />
        </Pressable>
      </View>
      <PlanListScreen
        catalogState={catalogState}
        environmentId={environmentId}
        environmentConnectionState={environmentConnectionState}
        snapshot={tree.snapshot}
        isPending={tree.isPending}
        error={tree.error}
        projectScopeId={selectedProjectId}
        projectScopeName={selectedProject?.name ?? null}
        onAddEnvironment={() =>
          navigation.navigate("SettingsSheet", { screen: "SettingsEnvironmentNew" })
        }
        onRestorePlan={handleRestorePlan}
        onSelectPlan={handleSelectPlan}
      />
    </View>
  );
}
