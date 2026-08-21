import { planCheckpointEffectLabel } from "@t3tools/client-runtime/state/plan-checkpoints";
import { planCommitDetail } from "@t3tools/client-runtime/state/plan-graph";
import type { PlanTimelineItem } from "@t3tools/contracts";
import type { GestureResponderEvent } from "react-native";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useThemeColor } from "../../lib/useThemeColor";
import type { PlanHistoryRow, PlanHistorySwitch } from "./plan-history-model";
import { ReadyBadge, StalePlanBadge, StaleSpecBadge } from "./MercurianBadges";

export function PlanHistoryItem(props: {
  readonly row: PlanHistoryRow;
  readonly ready: boolean;
  readonly stalePlan: boolean;
  readonly staleSpec: boolean;
  readonly onSelect: (row: PlanHistoryRow) => void;
  readonly onOpenSwitch: (row: PlanHistoryRow, selection: PlanHistorySwitch) => void;
}) {
  const iconColor = useThemeColor("--color-icon-muted");
  const publishedIconColor = useThemeColor("--color-icon");
  const textClass = props.row.published ? "text-foreground" : "text-foreground-muted";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.row.current }}
      className={cn(
        "mx-3 my-1 rounded-2xl border px-3 py-3 active:opacity-70",
        props.row.current ? "border-primary bg-subtle-strong" : "border-transparent",
      )}
      onPress={() => props.onSelect(props.row)}
    >
      {props.row.kind === "checkpoint" ? (
        <View className="gap-2.5">
          <View className="flex-row items-start justify-end gap-2 pl-8">
            <View className="min-w-0 flex-1 items-end">
              <Text className="text-2xs font-t3-bold uppercase tracking-[0.8px] text-foreground-tertiary">
                You
              </Text>
              <Text
                className={cn(
                  "text-right text-sm leading-5",
                  props.row.query.published ? "text-foreground" : "text-foreground-muted",
                )}
              >
                {planCommitDetail(props.row.query)}
              </Text>
            </View>
            <SymbolView
              accessibilityLabel="You"
              name={{ ios: "bubble.right", android: "chat_bubble" }}
              size={16}
              tintColor={props.row.query.published ? publishedIconColor : iconColor}
            />
          </View>
          {props.row.effects.length > 0 ? (
            <View className="flex-row flex-wrap justify-end gap-1.5">
              {props.row.effects.map((effect) => (
                <View className="rounded-full bg-subtle px-2 py-1" key={effect}>
                  <Text className="text-2xs font-t3-medium text-foreground-muted">
                    {planCheckpointEffectLabel(effect)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {props.row.response === undefined ? null : (
            <View className="flex-row items-start gap-2 pr-8">
              <SymbolView
                accessibilityLabel="Assistant"
                name={{ ios: "bubble.left", android: "chat_bubble" }}
                size={16}
                tintColor={props.row.response.published ? publishedIconColor : iconColor}
              />
              <View className="min-w-0 flex-1">
                <Text className="text-2xs font-t3-bold uppercase tracking-[0.8px] text-foreground-tertiary">
                  Assistant
                </Text>
                <Text
                  className={cn(
                    "text-sm leading-5",
                    props.row.response.published ? "text-foreground" : "text-foreground-muted",
                  )}
                >
                  {planCommitDetail(props.row.response)}
                </Text>
              </View>
            </View>
          )}
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          <SymbolView name={commitSymbol(props.row.item._tag)} size={17} tintColor={iconColor} />
          <Text className={cn("min-w-0 flex-1 text-sm", textClass)} numberOfLines={2}>
            {props.row.summary}
          </Text>
        </View>
      )}

      <View className="mt-2 flex-row items-center justify-end gap-2">
        {props.ready ? <ReadyBadge /> : null}
        {props.stalePlan ? <StalePlanBadge /> : null}
        {props.staleSpec ? <StaleSpecBadge /> : null}
        {props.row.siblings === undefined ? null : (
          <DivergenceBadge
            selection={props.row.siblings}
            onPress={(event) => {
              event.stopPropagation();
              props.onOpenSwitch(props.row, props.row.siblings!);
            }}
          />
        )}
        {props.row.parentLines === undefined ? null : (
          <DivergenceBadge
            selection={props.row.parentLines}
            onPress={(event) => {
              event.stopPropagation();
              props.onOpenSwitch(props.row, props.row.parentLines!);
            }}
          />
        )}
        <Text className="text-2xs tabular-nums text-foreground-tertiary">
          {relativeTime(props.row.createdAt)}
        </Text>
      </View>
    </Pressable>
  );
}

function DivergenceBadge(props: {
  readonly selection: PlanHistorySwitch;
  readonly onPress: (event: GestureResponderEvent) => void;
}) {
  const iconColor = useThemeColor("--color-foreground-muted");
  const label = `${props.selection.kind === "siblings" ? "Switch branch" : "Choose parent line"}, ${props.selection.index + 1}/${props.selection.options.length}`;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="flex-row items-center gap-1 rounded-lg bg-subtle px-2 py-1 active:opacity-70"
      hitSlop={8}
      onPress={props.onPress}
    >
      <SymbolView
        name={
          props.selection.kind === "siblings"
            ? "arrow.triangle.branch"
            : "point.topleft.down.curvedto.point.bottomright.up"
        }
        size={14}
        tintColor={iconColor}
      />
      <Text className="text-2xs tabular-nums text-foreground-muted">
        {props.selection.index + 1}/{props.selection.options.length}
      </Text>
    </Pressable>
  );
}

function commitSymbol(tag: PlanTimelineItem["_tag"]) {
  switch (tag) {
    case "coding-session":
      return "arrow.branch" as const;
    case "message":
      return "text.bubble" as const;
    default:
      return "doc.text" as const;
  }
}
