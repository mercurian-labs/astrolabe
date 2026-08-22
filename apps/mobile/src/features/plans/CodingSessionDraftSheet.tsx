import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { StackActions, type StaticScreenProps, useNavigation } from "@react-navigation/native";
import {
  CODING_SESSION_RUNTIME_MODES,
  localBranchOptions,
  seedBaseRef,
  startCodingSessionPayload,
  type CodingSessionDraft,
} from "@t3tools/client-runtime/state/coding-session-draft";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, MercurianRepositoryId, PlanId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentServerConfig } from "../../state/entities";
import { mercurianPlanning, useMercurianRepositories } from "../../state/mercurian";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useBranches } from "../../state/queries";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  buildMobileCodingSessionDraft,
  codingSessionStartDisabledReason,
  seedSessionModelSelection,
} from "./codingSessionDraftSheet.logic";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly planId: string;
  readonly parentCommitId: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
}>;

export function CodingSessionDraftSheet({ route }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const activeTrack = String(useThemeColor("--color-switch-active"));
  const track = String(useThemeColor("--color-secondary-border"));
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const planId = PlanId.make(route.params.planId);
  const repositoryId = MercurianRepositoryId.make(route.params.repositoryId);
  const repositories = useMercurianRepositories(environmentId);
  const repository = repositories.snapshot.repositories.find(
    (candidate) => candidate.repositoryId === repositoryId,
  );
  const branches = useBranches({ environmentId, cwd: repository?.path ?? null });
  const refs = useMemo(() => localBranchOptions(branches.data?.refs ?? []), [branches.data?.refs]);
  const config = useEnvironmentServerConfig(environmentId);
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferences = Option.getOrNull(AsyncResult.value(preferencesResult));
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const modelOptions = useMemo(() => buildModelOptions(config, null), [config]);
  const providerGroups = useMemo(() => groupByProvider(modelOptions), [modelOptions]);
  const [baseRef, setBaseRef] = useState("");
  const [startFromOrigin, setStartFromOrigin] = useState(
    () => config?.settings.newWorktreesStartFromOrigin ?? true,
  );
  const originSeededRef = useRef(config !== null);
  const [runtimeMode, setRuntimeMode] = useState<CodingSessionDraft["runtimeMode"]>("full-access");
  const [modelSelection, setModelSelection] = useState(() =>
    seedSessionModelSelection(modelOptions, preferences?.codingSessionModelSelection),
  );
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const start = useAtomCommand(mercurianPlanning.startCodingSession, { reportFailure: false });

  useEffect(() => {
    if (baseRef.length === 0 && refs.length > 0) setBaseRef(seedBaseRef(refs));
  }, [baseRef.length, refs]);
  useEffect(() => {
    if (config === null || originSeededRef.current) return;
    originSeededRef.current = true;
    setStartFromOrigin(config.settings.newWorktreesStartFromOrigin);
  }, [config]);
  useEffect(() => {
    const selectedAvailable = modelOptions.some(
      (option) =>
        option.selection.instanceId === modelSelection?.instanceId &&
        option.selection.model === modelSelection.model,
    );
    if (!selectedAvailable) {
      setModelSelection(
        seedSessionModelSelection(modelOptions, preferences?.codingSessionModelSelection),
      );
    }
  }, [modelOptions, modelSelection, preferences?.codingSessionModelSelection]);

  const disabledReason = codingSessionStartDisabledReason({ baseRef, modelSelection, starting });

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title: "Coding session" }} />
      {Platform.OS === "android" ? (
        <AndroidSheetHeader title="Coding session" onBack={() => navigation.goBack()} />
      ) : null}
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 18) + 24,
          gap: 18,
        }}
      >
        <View className="rounded-2xl border border-border bg-card p-4">
          <Text className="text-base font-t3-bold text-foreground">
            {route.params.repositoryName}
          </Text>
          <Text className="mt-1 text-xs text-foreground-muted">
            Implements commit {route.params.parentCommitId.slice(0, 8)}
          </Text>
        </View>

        <DraftSection title="Base branch">
          {branches.isPending ? (
            <Text className="text-sm text-foreground-muted">Loading branches…</Text>
          ) : null}
          {branches.error ? (
            <Text className="text-sm text-danger-foreground">{branches.error}</Text>
          ) : null}
          {refs.map((ref) => (
            <ChoiceRow
              key={ref.name}
              label={ref.name}
              selected={baseRef === ref.name}
              onPress={() => setBaseRef(ref.name)}
            />
          ))}
        </DraftSection>

        <View className="flex-row items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
          <Text className="text-sm font-t3-medium text-foreground">
            Start from origin when available
          </Text>
          <Switch
            ios_backgroundColor={track}
            trackColor={{ false: track, true: activeTrack }}
            value={startFromOrigin}
            onValueChange={setStartFromOrigin}
          />
        </View>

        <DraftSection title="Runtime mode">
          {CODING_SESSION_RUNTIME_MODES.map((mode) => (
            <ChoiceRow
              key={mode.value}
              label={mode.label}
              selected={runtimeMode === mode.value}
              onPress={() => setRuntimeMode(mode.value)}
            />
          ))}
        </DraftSection>

        <DraftSection title="Agent and model">
          {providerGroups.map((group) => (
            <View key={group.providerKey} className="gap-1">
              <Text className="px-3 pt-2 text-2xs font-t3-bold uppercase text-foreground-tertiary">
                {group.providerLabel}
              </Text>
              {group.models.map((model) => (
                <ChoiceRow
                  key={model.key}
                  label={model.label}
                  selected={
                    modelSelection?.instanceId === model.selection.instanceId &&
                    modelSelection.model === model.selection.model
                  }
                  onPress={() => setModelSelection(model.selection)}
                />
              ))}
            </View>
          ))}
          {providerGroups.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              Install and enable an agent before starting a coding session.
            </Text>
          ) : null}
        </DraftSection>

        {failure ? <Text className="text-sm text-danger-foreground">{failure}</Text> : null}
        {disabledReason ? (
          <Text className="text-xs text-foreground-muted">{disabledReason}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={disabledReason !== null}
          className={cn(
            "h-12 items-center justify-center rounded-full",
            disabledReason === null ? "bg-primary" : "bg-subtle-strong",
          )}
          onPress={async () => {
            if (modelSelection === null || disabledReason !== null) return;
            setFailure(null);
            setStarting(true);
            const draft = buildMobileCodingSessionDraft({
              planId: String(planId),
              parentCommitId: route.params.parentCommitId,
              repositoryId: String(repositoryId),
              repositoryName: route.params.repositoryName,
              baseRef,
              startFromOrigin,
              runtimeMode,
              modelSelection,
            });
            const result = await start({ environmentId, input: startCodingSessionPayload(draft) });
            setStarting(false);
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              setFailure(
                error instanceof Error ? error.message : "The coding session could not be started.",
              );
              return;
            }
            void savePreferences({ codingSessionModelSelection: modelSelection });
            // Interim M-151 seam: the session view will replace this existing Thread destination.
            navigation.dispatch(
              StackActions.replace("Thread", {
                environmentId: String(environmentId),
                threadId: String(result.value.threadId),
              }),
            );
          }}
        >
          <Text
            className={cn(
              "text-sm font-t3-bold",
              disabledReason === null ? "text-primary-foreground" : "text-foreground-muted",
            )}
          >
            Start
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function DraftSection(props: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <View className="gap-1 rounded-2xl border border-border bg-card p-2">
      <Text className="px-2 pb-1 pt-1 text-2xs font-t3-bold uppercase tracking-[0.8px] text-foreground-tertiary">
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}

function ChoiceRow(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      className={cn("rounded-xl px-3 py-3", props.selected ? "bg-primary" : "bg-transparent")}
      onPress={props.onPress}
    >
      <Text
        className={cn(
          "text-sm font-t3-medium",
          props.selected ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
