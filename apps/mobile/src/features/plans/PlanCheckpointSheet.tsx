import { StackActions, type StaticScreenProps, useNavigation } from "@react-navigation/native";
import {
  condensePlanGraph,
  isUnansweredCheckpointInFlight,
  mapMarksToNodes,
} from "@t3tools/client-runtime/state/plan-checkpoints";
import {
  PLAN_MAY_BE_STALE_DESCRIPTION,
  PLAN_MAY_BE_STALE_LABEL,
  stalePlanLeafIds,
  staleSpecLeafIds,
} from "@t3tools/client-runtime/state/plan-freshness";
import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { derivePlanNodePopover } from "@t3tools/client-runtime/state/plan-node-popover";
import { EnvironmentId, MercurianCommitId, PlanId } from "@t3tools/contracts";
import { useMemo, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { relativeTime } from "../../lib/time";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { usePlanDetail } from "../../state/mercurian";
import { usePlanPosition } from "../../state/plan-position";
import { checkpointSheetActions } from "./planCheckpointSheet.logic";
import { useImplementFromHere } from "./useImplementFromHere";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly planId: string;
  readonly commitId: string;
}>;

export function PlanCheckpointSheet({ route }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const planId = PlanId.make(route.params.planId);
  const commitId = MercurianCommitId.make(route.params.commitId);
  const state = usePlanDetail(environmentId, planId);
  const timeline = state.detail?.timeline ?? [];
  const commitGraph = useMemo(() => buildPlanGraph(timeline), [timeline]);
  const graph = useMemo(() => condensePlanGraph(commitGraph), [commitGraph]);
  const position = usePlanPosition(environmentId, planId, commitGraph);
  const implementFromHere = useImplementFromHere(planId);
  const node = graph.byId.get(commitId);
  const staleSpecNodeIds = useMemo(
    () => mapMarksToNodes(staleSpecLeafIds(commitGraph), graph.nodeIdByCommit),
    [commitGraph, graph.nodeIdByCommit],
  );
  const stalePlanNodeIds = useMemo(
    () => mapMarksToNodes(stalePlanLeafIds(commitGraph), graph.nodeIdByCommit),
    [commitGraph, graph.nodeIdByCommit],
  );
  const reading =
    node === undefined
      ? null
      : derivePlanNodePopover({
          node,
          commitGraph,
          codingSessions: state.detail?.codingSessions ?? [],
          ready: state.readyCommits.get(commitId),
          staleSpec: staleSpecNodeIds.has(commitId),
          stalePlan: stalePlanNodeIds.has(commitId),
          suppressUnanswered: isUnansweredCheckpointInFlight(
            node,
            commitGraph,
            (state.detail?.inFlightTurns ?? []).map((turn) => turn.parentCommitId),
          ),
        });
  const implement = implementFromHere(commitGraph, commitId);
  const actions = reading === null ? [] : checkpointSheetActions(reading.acts, implement);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title: "Checkpoint" }} />
      {Platform.OS === "android" ? (
        <AndroidSheetHeader title="Checkpoint" onBack={() => navigation.goBack()} />
      ) : null}
      {reading === null ? (
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            title="Checkpoint unavailable"
            detail="This checkpoint is no longer present in plan history."
            variant="plain"
          />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 18) + 18,
            gap: 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View className="gap-2 rounded-2xl border border-border bg-card p-4">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-1 text-base font-t3-bold text-foreground">
                {reading.label}
              </Text>
              <Text className="text-xs text-foreground-tertiary">
                {relativeTime(reading.createdAt)}
              </Text>
            </View>
            <Text className="text-xs font-t3-medium text-foreground-muted">
              {reading.published ? "Published" : "Private"} ·{" "}
              {reading.kind === "turn" ? "Checkpoint" : "Commit"}
            </Text>
          </View>
          {reading.queryText === undefined ? null : (
            <SheetSection title="You">
              <Text className="text-sm leading-5 text-foreground">{reading.queryText}</Text>
            </SheetSection>
          )}
          {reading.responseExcerpt === undefined ? null : (
            <SheetSection title="Assistant">
              <Text className="text-sm leading-5 text-foreground">{reading.responseExcerpt}</Text>
            </SheetSection>
          )}
          {reading.effects.length === 0 ? null : (
            <View className="flex-row flex-wrap gap-2">
              {reading.effects.map((effect) => (
                <View className="rounded-full bg-subtle px-2.5 py-1.5" key={effect}>
                  <Text className="text-xs font-t3-medium text-foreground-muted">{effect}</Text>
                </View>
              ))}
            </View>
          )}
          {reading.modelSwitch === undefined ? null : (
            <SheetSection title="Model changed">
              <Text className="text-sm text-foreground-muted">
                From {String(reading.modelSwitch.provider)} · {reading.modelSwitch.model}
              </Text>
            </SheetSection>
          )}
          {reading.session === undefined ? null : (
            <SheetSection title="Coding session">
              <Text className="text-sm text-foreground">
                {reading.session.repositoryName}
                {reading.session.status === undefined ? "" : ` · ${reading.session.status}`}
              </Text>
              {reading.session.branch === undefined ? null : (
                <Text className="text-xs text-foreground-muted">{reading.session.branch}</Text>
              )}
              {reading.session.prUrl === undefined ? null : (
                <Text className="text-xs text-foreground-muted">{reading.session.prUrl}</Text>
              )}
            </SheetSection>
          )}
          {reading.staleSpec ? (
            <Warning
              title="Spec is stale"
              detail="This line has not absorbed the newest spec revision."
            />
          ) : null}
          {reading.stalePlan ? (
            <Warning title={PLAN_MAY_BE_STALE_LABEL} detail={PLAN_MAY_BE_STALE_DESCRIPTION} />
          ) : null}
          {reading.movedPastPlan ? (
            <Warning
              title="Planning moved on"
              detail={`Planning continued past the ${reading.movedPastRepositoryName ?? "repository"} split.`}
            />
          ) : null}
          {reading.ready === undefined ? null : (
            <SheetSection title="Ready to implement">
              <Text className="text-sm text-foreground">{reading.ready.repositoryName}</Text>
            </SheetSection>
          )}
          <View className="gap-2">
            {actions.map((action) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: action.disabled }}
                className="rounded-2xl border border-border bg-card px-4 py-3.5 active:opacity-70 disabled:opacity-45"
                disabled={action.disabled}
                key={action.key}
                onPress={() => {
                  if (action.key !== "continue") return;
                  position.pick(commitId);
                  navigation.dispatch(
                    StackActions.popTo("Plan", {
                      environmentId: String(environmentId),
                      planId: String(planId),
                    }),
                  );
                }}
              >
                <Text className="text-sm font-t3-bold text-foreground">{action.label}</Text>
                {action.reason === undefined ? null : (
                  <Text className="mt-1 text-xs leading-4 text-foreground-muted">
                    {action.reason}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function SheetSection(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-4">
      <Text className="text-2xs font-t3-bold uppercase tracking-[0.8px] text-foreground-tertiary">
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}
function Warning(props: { readonly title: string; readonly detail: string }) {
  return (
    <View className="gap-1 rounded-2xl border border-warning/40 bg-warning/10 p-4">
      <Text className="text-sm font-t3-bold text-foreground">{props.title}</Text>
      <Text className="text-xs leading-4 text-foreground-muted">{props.detail}</Text>
    </View>
  );
}
