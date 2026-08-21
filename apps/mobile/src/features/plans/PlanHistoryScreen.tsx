import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { useCallback } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "../../components/EmptyState";
import { PlanHistoryItem } from "./plan-history-items";
import type { PlanHistoryModel, PlanHistoryRow, PlanHistorySwitch } from "./plan-history-model";

export function PlanHistoryScreen(props: {
  readonly model: PlanHistoryModel;
  readonly onSelect: (row: PlanHistoryRow) => void;
  readonly onOpenSwitch: (row: PlanHistoryRow, selection: PlanHistorySwitch) => void;
}) {
  const insets = useSafeAreaInsets();
  const currentIndex = props.model.rows.findIndex((row) => row.current);
  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<PlanHistoryRow>) => (
      <PlanHistoryItem row={item} onSelect={props.onSelect} onOpenSwitch={props.onOpenSwitch} />
    ),
    [props.onOpenSwitch, props.onSelect],
  );

  return (
    <View className="flex-1 bg-screen">
      <LegendList
        data={props.model.rows}
        estimatedItemSize={128}
        getItemType={(row) => row.kind}
        initialScrollIndex={currentIndex < 0 ? undefined : currentIndex}
        keyExtractor={(row) => row.commitId}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center px-6 py-16">
            <EmptyState
              title="No history yet"
              detail="Continue planning to create the first checkpoint."
              variant="plain"
            />
          </View>
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
