import {
  modelChoiceForHead,
  planningModelGateNotice,
  providerLabel,
  resolveComposerControl,
  turnRefusalNotice,
} from "@t3tools/client-runtime/state/plan-composer";
import {
  resolvePlanningModel,
  type EnvironmentId,
  type MercurianCommitId,
  type PlanId,
  type PlanningModelSelection,
  type PlanTurnRefusalReason,
  type ServerProvider,
  type PlanTurnId,
} from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { Keyboard, View } from "react-native";

import { ComposerEditor } from "../../components/ComposerEditor";
import { ComposerToolbarTrigger } from "../../components/ComposerToolbarTrigger";
import { ControlPill } from "../../components/ControlPill";
import { AppText as Text } from "../../components/AppText";
import { useFontFamily } from "../../lib/useFontFamily";
import { useThemeColor } from "../../lib/useThemeColor";
import { mercurianPlanning } from "../../state/mercurian";
import {
  clearPlanComposerDraft,
  planComposerDraftKey,
  setPlanComposerDraftModelChoice,
  setPlanComposerDraftText,
  usePlanComposerDraft,
} from "../../state/use-plan-composer-drafts";
import { useAtomCommand } from "../../state/use-atom-command";
import { PlanModelSheet } from "./PlanModelSheet";

export function PlanComposerBar(props: {
  readonly environmentId: EnvironmentId;
  readonly planId: PlanId;
  readonly actingHead: MercurianCommitId | null;
  readonly standingChoice: PlanningModelSelection | null;
  readonly workspaceSetting: PlanningModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly turnActive: boolean;
  /** The live turn on this branch — what Stop addresses (M-158). */
  readonly activeTurnId?: PlanTurnId | undefined;
  readonly turnRefusal: PlanTurnRefusalReason | null;
  readonly onSent: (commitId: MercurianCommitId) => void;
}) {
  const key = planComposerDraftKey(props.environmentId, props.planId);
  const draft = usePlanComposerDraft(key);
  const [isSending, setIsSending] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const append = useAtomCommand(mercurianPlanning.appendPlanMessage, { reportFailure: false });
  const stop = useAtomCommand(mercurianPlanning.stopPlanningTurn, { reportFailure: false });
  const selection =
    modelChoiceForHead(draft, props.actingHead) ?? props.standingChoice ?? props.workspaceSetting;
  const resolution = useMemo(
    () => resolvePlanningModel(selection, props.providers),
    [props.providers, selection],
  );
  const gateNotice = planningModelGateNotice(selection, resolution);
  const refusalNotice =
    props.turnRefusal === null ? null : turnRefusalNotice(selection, props.turnRefusal);
  const control = resolveComposerControl({
    turnActive: props.turnActive,
    hasContent: draft.text.trim().length > 0,
    isSending,
    gateBlocked: gateNotice !== null,
  });
  const regularFontFamily = useFontFamily("regular");
  const foreground = useThemeColor("--color-foreground");
  const modelLabel =
    selection === null ? "Choose model" : modelSelectionLabel(selection, props.providers);

  const handleControl = async () => {
    if (!control.enabled) return;
    if (control.face === "stop") {
      if (props.activeTurnId === undefined) return;
      await stop({
        environmentId: props.environmentId,
        input: { planId: props.planId, turnId: props.activeTurnId },
      });
      return;
    }
    const text = draft.text.trim();
    if (text.length === 0) return;
    setIsSending(true);
    try {
      const result = await append({
        environmentId: props.environmentId,
        input: {
          planId: props.planId,
          text,
          ...(props.actingHead === null ? {} : { parentCommitId: props.actingHead }),
          ...(selection === null ? {} : { modelChoice: selection }),
        },
      });
      if (result._tag === "Success") {
        clearPlanComposerDraft(key);
        props.onSent(result.value.commitId);
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <View className="border-t border-border bg-screen px-3 pb-3 pt-2">
        {gateNotice ? (
          <Text className="mb-1 px-2 text-xs text-foreground-muted">{gateNotice}</Text>
        ) : null}
        {refusalNotice ? (
          <Text className="mb-1 px-2 text-xs text-danger-foreground">{refusalNotice}</Text>
        ) : null}
        <View className="rounded-[22px] border border-border bg-sheet px-2 pb-2 pt-2">
          <ComposerEditor
            multiline
            value={draft.text}
            editable={!isSending}
            placeholder="Continue planning…"
            onChangeText={(text) => setPlanComposerDraftText(key, text)}
            onSubmit={() => void handleControl()}
            style={{ minHeight: 58, maxHeight: 130, paddingHorizontal: 8, paddingVertical: 6 }}
            textStyle={{ color: foreground, fontFamily: regularFontFamily, fontSize: 16 }}
          />
          <View className="mt-1 flex-row items-center gap-2">
            <View className="min-w-0 flex-1">
              <ComposerToolbarTrigger
                accessibilityLabel="Choose planning model"
                disabled={props.turnActive}
                icon={{ ios: "sparkles", android: "auto_awesome" }}
                label={modelLabel}
                maxWidth={220}
                onPress={() => {
                  Keyboard.dismiss();
                  setSheetVisible(true);
                }}
              />
            </View>
            <ControlPill
              accessibilityLabel={control.face === "stop" ? "Stop reply" : "Send message"}
              disabled={!control.enabled}
              icon={control.face === "stop" ? "stop.fill" : "arrow.up"}
              variant={control.face === "stop" ? "danger" : "primary"}
              onPress={() => void handleControl()}
            />
          </View>
        </View>
      </View>
      <PlanModelSheet
        visible={sheetVisible}
        providers={props.providers}
        selection={selection}
        disabled={props.turnActive}
        onClose={() => setSheetVisible(false)}
        onSelect={(next) => setPlanComposerDraftModelChoice(key, next, props.actingHead)}
      />
    </>
  );
}

function modelSelectionLabel(
  selection: PlanningModelSelection,
  providers: ReadonlyArray<ServerProvider>,
): string {
  const model = providers
    .flatMap((provider) => (provider.driver === selection.provider ? provider.models : []))
    .find((candidate) => candidate.slug === selection.model)?.name;
  return `${providerLabel(selection.provider)} · ${model ?? selection.model}`;
}
