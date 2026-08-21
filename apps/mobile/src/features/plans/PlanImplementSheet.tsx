import { StackActions, type StaticScreenProps, useNavigation } from "@react-navigation/native";
import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import type { LandedPlan, SplitCard } from "@t3tools/client-runtime/state/plan-splits";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, PlanId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { mercurianPlanning, usePlanDetail } from "../../state/mercurian";
import { pickPlanPosition, pinPlanPosition, planPositionKey } from "../../state/plan-position";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  derivePlanImplementSheetState,
  landedPlansFromConfirmation,
  PLAN_IMPLEMENT_COPY,
  sessionDraftParams,
} from "./planImplementSheet.logic";

type Props = StaticScreenProps<{ readonly environmentId: string; readonly planId: string }>;

export function PlanImplementSheet({ route }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const inputColor = useThemeColor("--color-foreground");
  const placeholderColor = useThemeColor("--color-foreground-muted");
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const planId = PlanId.make(route.params.planId);
  const state = usePlanDetail(environmentId, planId);
  const proposal = state.detail?.implementProposal;
  const graph = useMemo(
    () => buildPlanGraph(state.detail?.timeline ?? []),
    [state.detail?.timeline],
  );
  const [cards, setCards] = useState<ReadonlyArray<SplitCard>>([]);
  const [landedPlans, setLandedPlans] = useState<ReadonlyArray<LandedPlan>>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const proposalTurnRef = useRef<string | null>(null);
  const cancel = useAtomCommand(mercurianPlanning.cancelImplementProposal, {
    reportFailure: false,
  });
  const confirm = useAtomCommand(mercurianPlanning.confirmSplits, { reportFailure: false });

  const derived = useMemo(
    () =>
      proposal === undefined
        ? null
        : derivePlanImplementSheetState({ proposal, graph, ...(cards.length ? { cards } : {}) }),
    [cards, graph, proposal],
  );
  const readyVerdict = proposal?.verdict.kind === "atomic" ? proposal.verdict : null;

  useEffect(() => {
    if (proposal === undefined || proposalTurnRef.current === proposal.turnId) return;
    proposalTurnRef.current = proposal.turnId;
    setCards(derivePlanImplementSheetState({ proposal, graph }).cards);
    setLandedPlans([]);
    setFailure(null);
  }, [graph, proposal]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", () => {
      if (proposal !== undefined) {
        void cancel({ environmentId, input: { planId } });
      }
    });
    return unsubscribe;
  }, [cancel, environmentId, navigation, planId, proposal]);

  useEffect(() => {
    if (!state.isPending && proposal === undefined && landedPlans.length === 0) {
      navigation.goBack();
    }
  }, [landedPlans.length, navigation, proposal, state.isPending]);

  const openDraft = (plan: LandedPlan) => {
    navigation.dispatch(
      StackActions.replace("SessionDraft", {
        environmentId: String(environmentId),
        ...sessionDraftParams(String(planId), plan.commitId, plan),
      }),
    );
  };
  const goToPlan = (commitId: LandedPlan["commitId"]) => {
    pickPlanPosition(planPositionKey(environmentId, planId), graph, commitId);
    navigation.dispatch(
      StackActions.popTo("Plan", {
        environmentId: String(environmentId),
        planId: String(planId),
      }),
    );
  };

  if (proposal === undefined && landedPlans.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-sheet px-6">
        <NativeStackScreenOptions options={{ title: PLAN_IMPLEMENT_COPY.title }} />
        <EmptyState
          title="Opening implementation"
          detail="Loading the readiness result."
          variant="plain"
        />
      </View>
    );
  }

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title: PLAN_IMPLEMENT_COPY.title }} />
      {Platform.OS === "android" ? (
        <AndroidSheetHeader title={PLAN_IMPLEMENT_COPY.title} onBack={() => navigation.goBack()} />
      ) : null}
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 18) + 24,
          gap: 14,
        }}
      >
        <Text className="text-sm leading-5 text-foreground-muted">
          {landedPlans.length > 0
            ? PLAN_IMPLEMENT_COPY.landedDescription
            : PLAN_IMPLEMENT_COPY.pendingDescription}
        </Text>
        {landedPlans.length > 0 ? (
          landedPlans.map((plan) => (
            <PlanJumpRow
              key={plan.commitId}
              title={`You added a plan for ${plan.repositoryName}`}
              onGo={() => goToPlan(plan.commitId)}
              onStart={() => openDraft(plan)}
            />
          ))
        ) : proposal?.verdict.kind === "atomic" ? (
          <View className="rounded-2xl border border-border bg-card p-4">
            <Text className="text-sm font-t3-bold text-foreground">
              {PLAN_IMPLEMENT_COPY.ready}
            </Text>
            <Text className="mt-1 text-sm text-foreground-muted">
              A coding session will run in {proposal.verdict.repositoryName}.
            </Text>
          </View>
        ) : proposal === undefined || derived === null ? null : (
          <>
            {proposal.verdict.kind === "needs-split" ? (
              <View className="gap-1">
                <Text className="text-sm leading-5 text-foreground-muted">
                  {PLAN_IMPLEMENT_COPY.multiRepository}
                </Text>
                {proposal.verdict.rationale ? (
                  <Text className="text-sm leading-5 text-foreground-muted">
                    {proposal.verdict.rationale}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {derived.alreadySplit.map((plan) => (
              <PlanJumpRow
                key={plan.repositoryId}
                title={plan.repositoryName}
                detail={PLAN_IMPLEMENT_COPY.existing}
                onGo={() => goToPlan(plan.commitId)}
              />
            ))}
            {cards.map((card, index) =>
              card.removed ? null : (
                <View
                  key={card.repositoryId}
                  className="gap-2 rounded-2xl border border-border bg-card p-4"
                >
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="text-sm font-t3-bold text-foreground">
                      {card.repositoryName}
                    </Text>
                    <Pressable
                      accessibilityLabel={`Remove plan for ${card.repositoryName}`}
                      accessibilityRole="button"
                      onPress={() =>
                        setCards((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, removed: true } : item,
                          ),
                        )
                      }
                    >
                      <Text className="text-xs font-t3-bold text-danger-foreground">Remove</Text>
                    </Pressable>
                  </View>
                  <TextInput
                    accessibilityLabel={`Plan for ${card.repositoryName}`}
                    multiline
                    value={card.text}
                    onChangeText={(text) =>
                      setCards((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, text } : item,
                        ),
                      )
                    }
                    placeholder="Repository plan"
                    placeholderTextColor={String(placeholderColor)}
                    style={{ minHeight: 132, color: String(inputColor), textAlignVertical: "top" }}
                    className="rounded-xl border border-border bg-sheet px-3 py-3 text-sm"
                  />
                </View>
              ),
            )}
          </>
        )}
        {failure ? <Text className="text-sm text-danger-foreground">{failure}</Text> : null}
        <View className="flex-row justify-end gap-2 pt-2">
          <SheetButton
            label={landedPlans.length > 0 ? PLAN_IMPLEMENT_COPY.done : PLAN_IMPLEMENT_COPY.cancel}
            onPress={() => navigation.goBack()}
          />
          {landedPlans.length > 0 || proposal === undefined || derived === null ? null : proposal
              .verdict.kind === "atomic" ? (
            <SheetButton
              primary
              label={PLAN_IMPLEMENT_COPY.start}
              onPress={() =>
                openDraft({
                  commitId: proposal.parentCommitId,
                  repositoryId: readyVerdict!.repositoryId,
                  repositoryName: readyVerdict!.repositoryName,
                })
              }
            />
          ) : derived.payload === null ? null : (
            <SheetButton
              primary
              disabled={confirming}
              label={PLAN_IMPLEMENT_COPY.addEach}
              onPress={async () => {
                setConfirming(true);
                const payload = derived.payload!;
                const result = await confirm({
                  environmentId,
                  input: {
                    planId,
                    parentCommitId: proposal.parentCommitId,
                    splits: payload.map(({ repositoryId, text }) => ({ repositoryId, text })),
                  },
                });
                setConfirming(false);
                if (result._tag === "Failure") {
                  const error = squashAtomCommandFailure(result);
                  setFailure(
                    error instanceof Error
                      ? error.message
                      : "The repository plans could not be added.",
                  );
                  return;
                }
                pinPlanPosition(planPositionKey(environmentId, planId), proposal.parentCommitId);
                setLandedPlans(landedPlansFromConfirmation(result.value, payload));
              }}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function PlanJumpRow(props: {
  readonly title: string;
  readonly detail?: string;
  readonly onGo: () => void;
  readonly onStart?: () => void;
}) {
  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-4">
      <Text className="text-sm font-t3-bold text-foreground">{props.title}</Text>
      {props.detail ? <Text className="text-xs text-foreground-muted">{props.detail}</Text> : null}
      <View className="flex-row gap-2">
        <SheetButton label={PLAN_IMPLEMENT_COPY.go} onPress={props.onGo} />
        {props.onStart ? (
          <SheetButton primary label={PLAN_IMPLEMENT_COPY.start} onPress={props.onStart} />
        ) : null}
      </View>
    </View>
  );
}

function SheetButton(props: {
  readonly label: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "min-h-11 items-center justify-center rounded-full px-4",
        props.primary ? "bg-primary" : "border border-border bg-card",
        props.disabled && "opacity-45",
      )}
    >
      <Text
        className={cn(
          "text-xs font-t3-bold",
          props.primary ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
