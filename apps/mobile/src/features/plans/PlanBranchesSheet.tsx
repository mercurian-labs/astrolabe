import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { EnvironmentId, MercurianCommitId, PlanId } from "@t3tools/contracts";
import { useMemo } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { usePlanDetail } from "../../state/mercurian";
import { usePlanPosition } from "../../state/plan-position";
import {
  buildPlanHistoryModel,
  findPlanHistorySwitch,
  type PlanHistorySwitchKind,
} from "./plan-history-model";

type PlanBranchesSheetProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly planId: string;
  readonly commitId: string;
  readonly kind: PlanHistorySwitchKind;
}>;

export function PlanBranchesSheet({ route }: PlanBranchesSheetProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const checkColor = useThemeColor("--color-icon");
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const planId = PlanId.make(route.params.planId);
  const commitId = MercurianCommitId.make(route.params.commitId);
  const kind = route.params.kind;
  const state = usePlanDetail(environmentId, planId);
  const timeline = state.detail?.timeline ?? [];
  const graph = useMemo(() => buildPlanGraph(timeline), [timeline]);
  const position = usePlanPosition(environmentId, planId, graph);
  const model = useMemo(
    () =>
      buildPlanHistoryModel({ detail: state.detail }, position.position, position.parentChoices),
    [position.parentChoices, position.position, state.detail],
  );
  const selection = findPlanHistorySwitch(model, commitId, kind);
  const title = kind === "parent-lines" ? "Parent lines" : "Branches";

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title }} />
      {Platform.OS === "android" ? (
        <AndroidSheetHeader title={title} onBack={() => navigation.goBack()} />
      ) : null}
      {selection === null ? (
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            title="Branches unavailable"
            detail="This divergence is no longer present in the plan history."
            variant="plain"
          />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
          contentContainerClassName="gap-2 px-5 pt-2"
        >
          {selection.options.map((option, index) => {
            const current = index === selection.index;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: current, disabled: current }}
                className={cn(
                  "flex-row items-center gap-3 rounded-[18px] border px-4 py-3",
                  current ? "border-subtle-strong bg-subtle" : "border-border bg-card",
                )}
                disabled={current}
                key={option.branchRootId}
                onPress={() => {
                  if (selection.kind === "siblings") position.pick(option.tipId);
                  else position.chooseParentLine(commitId, option.branchRootId);
                  navigation.goBack();
                }}
              >
                <View className="min-w-0 flex-1 gap-1">
                  <Text
                    className={cn(
                      "text-sm font-t3-medium",
                      option.published ? "text-foreground" : "text-foreground-muted",
                    )}
                    numberOfLines={2}
                  >
                    {option.summary}
                  </Text>
                  <Text className="text-xs tabular-nums text-foreground-tertiary">
                    {relativeTime(option.lastActiveAt)}
                  </Text>
                </View>
                {current ? (
                  <SymbolView
                    accessibilityLabel="Current line"
                    name="checkmark"
                    size={18}
                    tintColor={checkColor}
                  />
                ) : (
                  <View className="size-[18px]" />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
