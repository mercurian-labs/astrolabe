import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, PlanTreeRow, PlanningTreeSnapshot } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useThemeColor } from "../../lib/useThemeColor";
import type { WorkspaceState } from "../../state/workspaceModel";
import {
  PlanListArchivedRow,
  PlanListArchivedShelfHeader,
  PlanListArchivedShowMoreRow,
  PlanListPlanRow,
} from "./plan-list-rows";
import {
  buildPlanListItems,
  derivePlanListEmptyState,
  planListItemsAreEqual,
  type PlanListItem,
} from "./planListItems";

export function PlanListScreen(props: {
  readonly catalogState: WorkspaceState;
  readonly environmentId: EnvironmentId | null;
  readonly environmentConnectionState: EnvironmentConnectionPhase | null;
  readonly snapshot: PlanningTreeSnapshot;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly projectScopeId: string | null;
  readonly projectScopeName: string | null;
  readonly onAddEnvironment: () => void;
  readonly onSelectPlan: (plan: PlanTreeRow) => void;
  readonly onRestorePlan: (plan: PlanTreeRow) => void;
}) {
  const insets = useSafeAreaInsets();
  const accentColor = useThemeColor("--color-primary");
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivedPage, setArchivedPage] = useState(0);
  const resetKey = `${props.environmentId ?? "none"}:${props.projectScopeId ?? "all"}`;

  useEffect(() => {
    setArchivedExpanded(false);
    setArchivedPage(0);
  }, [resetKey]);

  const items = useMemo(
    () =>
      buildPlanListItems({
        plans: props.snapshot.plans,
        projectScopeId: props.projectScopeId,
        archivedExpanded,
        archivedPage,
      }),
    [archivedExpanded, archivedPage, props.projectScopeId, props.snapshot.plans],
  );
  const [nowMinute, setNowMinute] = useState(() => new Date().toISOString().slice(0, 16));
  useEffect(() => {
    const id = setInterval(() => setNowMinute(new Date().toISOString().slice(0, 16)), 60_000);
    return () => clearInterval(id);
  }, []);

  const emptyState = derivePlanListEmptyState({
    catalogState: props.catalogState,
    environmentId: props.environmentId,
    environmentConnectionState: props.environmentConnectionState,
    treePending: props.isPending,
    itemCount: items.length,
    projectScopeName: props.projectScopeName,
  });
  const toggleArchived = useCallback(() => setArchivedExpanded((expanded) => !expanded), []);
  const showMoreArchived = useCallback(() => setArchivedPage((page) => page + 1), []);

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<PlanListItem>) => {
      switch (item.type) {
        case "plan":
          return (
            <PlanListPlanRow plan={item.plan} nowMinute={nowMinute} onSelect={props.onSelectPlan} />
          );
        case "archived-shelf":
          return (
            <PlanListArchivedShelfHeader
              count={item.count}
              expanded={item.expanded}
              onToggle={toggleArchived}
            />
          );
        case "archived-plan":
          return (
            <PlanListArchivedRow
              plan={item.plan}
              nowMinute={nowMinute}
              onRestore={props.onRestorePlan}
            />
          );
        case "archived-show-more":
          return (
            <PlanListArchivedShowMoreRow
              hiddenCount={item.hiddenCount}
              nextPageCount={item.nextPageCount}
              onShowMore={showMoreArchived}
            />
          );
      }
    },
    [nowMinute, props.onRestorePlan, props.onSelectPlan, showMoreArchived, toggleArchived],
  );

  const listEmpty =
    props.error === null && emptyState !== null ? (
      <View className="flex-1 items-center justify-center px-5 py-16">
        <EmptyState
          title={emptyState.title}
          detail={emptyState.detail}
          actionLabel={emptyState.canAddEnvironment ? "Add environment" : undefined}
          onAction={emptyState.canAddEnvironment ? props.onAddEnvironment : undefined}
          variant="plain"
        />
        {emptyState.loading ? (
          <View className="mt-4">
            <ActivityIndicator color={accentColor} />
          </View>
        ) : null}
      </View>
    ) : null;

  return (
    <View className="flex-1 bg-screen">
      <LegendList
        data={items}
        drawDistance={400}
        estimatedItemSize={52}
        extraData={nowMinute}
        getItemType={(item) => item.type}
        itemsAreEqual={planListItemsAreEqual}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={listEmpty}
        ListHeaderComponent={
          props.error ? (
            <View className="px-5 pb-2 pt-3">
              <ErrorBanner message={props.error} />
            </View>
          ) : Platform.OS === "android" ? (
            <View className="h-2" />
          ) : null
        }
        renderItem={renderItem}
        recycleItems
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        automaticallyAdjustsScrollIndicatorInsets={Platform.OS === "ios"}
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 24 }}
      />
    </View>
  );
}
