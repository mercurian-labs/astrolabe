import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { ancestorClosure, buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { standingModelChoice } from "@t3tools/client-runtime/state/plan-model-choice";
import {
  advance,
  LATEST,
  resolveActingHead,
  resolveHead,
  type PlanPosition,
} from "@t3tools/client-runtime/state/plan-position";
import { EnvironmentId, type MercurianCommitId, PlanId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { EmptyState } from "../../components/EmptyState";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { mercurianPlanning, usePlanDetail, useVisitPlan } from "../../state/mercurian";
import { usePlanningModel } from "../../state/mercurianWorkspace";
import { useAtomCommand } from "../../state/use-atom-command";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { PlanArtifactPane } from "./PlanArtifactPane";
import { PlanComposerBar } from "./PlanComposerBar";
import { PlanTimelineList } from "./PlanTimelineList";

type PlanRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly planId: string;
}>;

function firstRouteParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export function PlanRouteScreen({ route }: PlanRouteScreenProps) {
  const environmentIdRaw = firstRouteParam(route.params.environmentId);
  const planIdRaw = firstRouteParam(route.params.planId);
  if (!environmentIdRaw || !planIdRaw) {
    return (
      <View className="flex-1 items-center justify-center bg-screen px-6">
        <NativeStackScreenOptions options={{ title: "Plan" }} />
        <EmptyState
          title="Plan unavailable"
          detail="This plan link is missing its environment or plan identity."
          variant="plain"
        />
      </View>
    );
  }
  return (
    <PlanRouteContent
      environmentId={EnvironmentId.make(environmentIdRaw)}
      planId={PlanId.make(planIdRaw)}
    />
  );
}

function PlanRouteContent(props: {
  readonly environmentId: EnvironmentId;
  readonly planId: PlanId;
}) {
  const navigation = useNavigation();
  const iconColor = useThemeColor("--color-icon");
  const state = usePlanDetail(props.environmentId, props.planId);
  const planningModel = usePlanningModel(props.environmentId);
  const visitPlan = useVisitPlan(props.environmentId);
  const answerQuestion = useAtomCommand(mercurianPlanning.answerPlanningQuestion, {
    reportFailure: false,
  });
  const stopTurn = useAtomCommand(mercurianPlanning.stopPlanningTurn, { reportFailure: false });
  const [position, setPosition] = useState<PlanPosition>(LATEST);
  const [view, setView] = useState<"conversation" | "artifact">("conversation");
  const detail = state.detail;
  const timeline = detail?.timeline ?? [];
  const graph = useMemo(() => buildPlanGraph(timeline), [timeline]);

  useEffect(() => {
    setPosition(LATEST);
    setView("conversation");
  }, [props.planId]);

  useEffect(() => {
    setPosition((current) => advance(graph, current));
  }, [graph]);

  useEffect(() => {
    if (detail === null) return;
    void visitPlan({ planId: detail.plan.planId });
  }, [detail?.plan.updatedAt, detail?.plan.planId, visitPlan]);

  const head = resolveHead(graph, position);
  const actingHead = resolveActingHead(graph, head);
  const visibleCommitIds = useMemo(
    () =>
      head === null
        ? new Set(timeline.map((item) => item.commitId as string))
        : ancestorClosure(graph, head),
    [graph, head, timeline],
  );
  const visibleTimeline = useMemo(
    () => timeline.filter((item) => visibleCommitIds.has(item.commitId)),
    [timeline, visibleCommitIds],
  );
  const itemsById = useMemo(
    () => new Map(timeline.map((item) => [item.commitId as string, item])),
    [timeline],
  );
  const standingChoice = useMemo(
    () => standingModelChoice(graph, itemsById, actingHead),
    [actingHead, graph, itemsById],
  );
  const turnActive = detail?.inFlightTurn !== undefined || detail?.inFlightImplement !== undefined;
  const toggleArtifact = () =>
    setView((current) => (current === "artifact" ? "conversation" : "artifact"));
  const title = detail?.plan.title ?? "Plan";

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions
        optionsVersion={[title, view]}
        options={{
          title,
          headerShown: Platform.OS !== "android",
          headerTintColor: iconColor,
          unstable_headerRightItems:
            Platform.OS === "ios"
              ? () => [
                  withNativeGlassHeaderItem({
                    accessibilityLabel:
                      view === "artifact" ? "Hide plan artifact" : "Show plan artifact",
                    icon: {
                      name: view === "artifact" ? "text.bubble" : "doc.text",
                      type: "sfSymbol",
                    } as const,
                    identifier: "plan-artifact",
                    label: "",
                    onPress: toggleArtifact,
                    type: "button",
                  }),
                ]
              : undefined,
        }}
      />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title={title}
          onBack={() => navigation.goBack()}
          actions={[
            {
              accessibilityLabel: view === "artifact" ? "Hide plan artifact" : "Show plan artifact",
              icon: view === "artifact" ? "text.bubble" : "doc.text",
              onPress: toggleArtifact,
            },
          ]}
        />
      ) : null}
      {detail === null ? (
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            title={state.isPending ? "Opening plan" : "Plan unavailable"}
            detail={state.error ?? "This plan is not available in the current environment."}
            variant="plain"
          />
        </View>
      ) : (
        <>
          {view === "artifact" ? (
            <View className="flex-1 border-b border-border">
              <PlanArtifactPane
                environmentId={props.environmentId}
                planId={props.planId}
                head={head}
                timeline={timeline}
                visibleTimeline={visibleTimeline}
                snapshotText={detail.planText}
              />
            </View>
          ) : null}
          <View className="flex-1">
            <PlanTimelineList
              timeline={timeline}
              visibleCommitIds={visibleCommitIds}
              inFlightTurn={detail.inFlightTurn}
              inFlightImplement={detail.inFlightImplement}
              codingSessions={detail.codingSessions}
              providers={planningModel.providers}
              onAnswerQuestion={(answers) => {
                void answerQuestion({
                  environmentId: props.environmentId,
                  input: { planId: props.planId, answers },
                });
              }}
              onStop={() => {
                void stopTurn({
                  environmentId: props.environmentId,
                  input: { planId: props.planId },
                });
              }}
            />
            <PlanComposerBar
              environmentId={props.environmentId}
              planId={props.planId}
              actingHead={actingHead}
              standingChoice={standingChoice}
              workspaceSetting={planningModel.setting}
              providers={planningModel.providers}
              turnActive={turnActive}
              turnRefusal={state.turnRefusal}
              onSent={(commitId: MercurianCommitId) =>
                setPosition({ _tag: "at", commitId, live: true })
              }
            />
          </View>
        </>
      )}
    </View>
  );
}
