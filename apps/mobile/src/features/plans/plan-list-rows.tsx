import { resolvePlanCardStatus } from "@t3tools/client-runtime/state/plan-listing";
import type { PlanTreeRow } from "@t3tools/contracts";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useThemeColor } from "../../lib/useThemeColor";

function planStatusPresentation(plan: PlanTreeRow) {
  const status = resolvePlanCardStatus(plan);
  if (status.slot === "awaiting-input") {
    return { ...status, label: "Input", className: "text-indigo-600 dark:text-indigo-300" };
  }
  if (status.slot === "working") {
    return { ...status, label: "Working", className: "text-sky-600 dark:text-sky-400" };
  }
  return { ...status, label: relativeTime(plan.updatedAt), className: "text-foreground-tertiary" };
}

export const PlanListPlanRow = memo(function PlanListPlanRow(props: {
  readonly plan: PlanTreeRow;
  readonly nowMinute: string;
  readonly onSelect: (plan: PlanTreeRow) => void;
}) {
  const presentation = planStatusPresentation(props.plan);
  const spokenStatus =
    presentation.slot === null
      ? `${presentation.unread ? "unread, " : ""}updated ${presentation.label} ago`
      : presentation.label;
  return (
    <Pressable
      accessibilityLabel={`${props.plan.title}, ${spokenStatus}`}
      accessibilityRole="button"
      className="bg-screen"
      onPress={() => props.onSelect(props.plan)}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
    >
      <View className="min-h-[50px] flex-row items-center gap-3 px-5 py-3">
        <Text
          className={cn(
            "min-w-0 flex-1 text-base",
            presentation.unread
              ? "font-t3-bold text-foreground"
              : "font-t3-medium text-foreground/90",
          )}
          numberOfLines={1}
        >
          {props.plan.title}
        </Text>
        <Text className={cn("text-xs font-t3-medium tabular-nums", presentation.className)}>
          {presentation.label}
        </Text>
      </View>
      <View className="ml-5 h-px bg-border-subtle" />
    </Pressable>
  );
});

export const PlanListArchivedShelfHeader = memo(function PlanListArchivedShelfHeader(props: {
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const mutedColor = useThemeColor("--color-foreground-muted");
  return (
    <Pressable
      accessibilityHint={
        props.expanded ? "Collapses the archived plans." : "Expands the archived plans."
      }
      accessibilityLabel={props.count === 1 ? "1 archived plan" : `${props.count} archived plans`}
      accessibilityRole="button"
      accessibilityState={{ expanded: props.expanded }}
      className="mb-1.5 mt-4 flex-row items-center gap-2.5 px-5"
      onPress={props.onToggle}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Text className="text-xs font-t3-medium text-foreground-tertiary">
        {props.expanded ? "Archived" : `Archived (${props.count})`}
      </Text>
      <View className="h-px flex-1 bg-border" />
      <SymbolView
        name={props.expanded ? "chevron.up" : "chevron.down"}
        size={10}
        tintColor={mutedColor}
        type="monochrome"
      />
    </Pressable>
  );
});

export const PlanListArchivedRow = memo(function PlanListArchivedRow(props: {
  readonly plan: PlanTreeRow;
  readonly nowMinute: string;
  readonly onRestore: (plan: PlanTreeRow) => void;
}) {
  const iconColor = useThemeColor("--color-icon-subtle");
  const timestamp = relativeTime(props.plan.archivedAt ?? props.plan.updatedAt);
  return (
    <View className="min-h-[44px] flex-row items-center gap-3 px-5 py-2">
      <Text className="min-w-0 flex-1 text-base text-foreground-tertiary" numberOfLines={1}>
        {props.plan.title}
      </Text>
      <Text className="text-xs tabular-nums text-foreground-tertiary">{timestamp}</Text>
      <Pressable
        accessibilityLabel={`Restore ${props.plan.title}`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => props.onRestore(props.plan)}
        className="size-9 items-center justify-center rounded-full bg-subtle"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <SymbolView name="arrow.uturn.backward" size={15} tintColor={iconColor} type="monochrome" />
      </Pressable>
    </View>
  );
});

export const PlanListArchivedShowMoreRow = memo(function PlanListArchivedShowMoreRow(props: {
  readonly hiddenCount: number;
  readonly nextPageCount: number;
  readonly onShowMore: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`Show ${props.nextPageCount} more archived plans`}
      accessibilityRole="button"
      className="mx-5 my-2 items-center rounded-lg border border-dashed border-border py-2.5"
      onPress={props.onShowMore}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Text className="text-xs font-t3-medium text-foreground-muted">
        Show more ({props.hiddenCount} archived hidden)
      </Text>
    </Pressable>
  );
});
