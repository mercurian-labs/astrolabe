import type { WikiChangeRequest, WikiChangeRequestId } from "@t3tools/contracts";
import { defaultSaveTarget } from "@t3tools/client-runtime/wikiLogic";
import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { Button } from "../../../components/ui/Button";
import { Sheet } from "../../../components/ui/Sheet";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../../components/ui/AppText";

const NEW_CHANGE_REQUEST = "new";

/** Where a save lands: an open change request, or a new one with this title. */
export type WikiSaveTarget =
  | { readonly changeRequestId: WikiChangeRequestId }
  | { readonly title: string };

/**
 * Saving the person's edits as one amendment: into an open change request (the one the
 * document is read inside, by default) or a new one. Main changes only when one is merged.
 * While the target's agent is mid-turn, the save waits for the turn to end.
 */
export function WikiSaveSheet(props: {
  readonly noteName: string;
  readonly openChangeRequests: ReadonlyArray<WikiChangeRequest>;
  readonly viewing: WikiChangeRequestId | undefined;
  readonly canSave: boolean;
  /** Whether a change request's thread is mid-turn, so a save into it waits. */
  readonly turnRunning: (changeRequestId: WikiChangeRequestId) => boolean;
  readonly onClose: () => void;
  /** Saves now; resolves to the failure's message, or null. */
  readonly onSave: (target: WikiSaveTarget, message: string) => Promise<string | null>;
  /** Saves once the turn of the change request's thread ends. */
  readonly onQueue: (changeRequestId: WikiChangeRequestId, message: string) => void;
}) {
  const [target, setTarget] = useState<string>(
    () => defaultSaveTarget(props.openChangeRequests, props.viewing) ?? NEW_CHANGE_REQUEST,
  );
  const [title, setTitle] = useState(`Edit ${props.noteName}`);
  const [message, setMessage] = useState(`Edit ${props.noteName}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opensNew = target === NEW_CHANGE_REQUEST;
  const waits = !opensNew && props.turnRunning(target as WikiChangeRequestId);
  const canSubmit =
    props.canSave && message.trim().length > 0 && (!opensNew || title.trim().length > 0) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    if (waits) {
      props.onQueue(target as WikiChangeRequestId, message.trim());
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await props.onSave(
      opensNew ? { title: title.trim() } : { changeRequestId: target as WikiChangeRequestId },
      message.trim(),
    );
    setBusy(false);
    setError(failure);
  };

  const choices = [
    { value: NEW_CHANGE_REQUEST, label: "New change request" },
    ...props.openChangeRequests.map((changeRequest) => ({
      value: changeRequest.changeRequestId as string,
      label: changeRequest.title,
    })),
  ];

  return (
    <Sheet title="Save to change request" onClose={props.onClose}>
      <ScrollView
        // Below the sheet's translucent header, as the other app sheets lay out.
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        contentContainerClassName="gap-4 px-4 pt-4 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-sm text-foreground-muted">
          Your edit is added to a change request. Main changes only when someone merges it.
        </Text>
        <View className="overflow-hidden rounded-[20px] bg-grouped-card">
          {choices.map((choice, index) => (
            <Pressable
              key={choice.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: target === choice.value }}
              onPress={() => setTarget(choice.value)}
              className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${index > 0 ? "border-t border-border-subtle" : ""}`}
            >
              <Text className="flex-1 text-base text-foreground" numberOfLines={2}>
                {choice.label}
              </Text>
              {target === choice.value ? (
                <SymbolView name="checkmark" size={16} tintColorClassName="accent-primary" />
              ) : null}
            </Pressable>
          ))}
        </View>
        {opensNew ? (
          <View className="gap-1.5">
            <Text className="px-4 text-xs text-foreground-muted">Title</Text>
            <TextInput
              accessibilityLabel="Change request title"
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              className="rounded-[20px] bg-grouped-card px-4 py-3 text-base text-foreground"
            />
          </View>
        ) : null}
        <View className="gap-1.5">
          <Text className="px-4 text-xs text-foreground-muted">What changed</Text>
          <TextInput
            accessibilityLabel="What changed"
            value={message}
            onChangeText={setMessage}
            maxLength={2000}
            className="rounded-[20px] bg-grouped-card px-4 py-3 text-base text-foreground"
          />
        </View>
        {waits ? (
          <Text className="text-sm text-foreground-muted">
            The agent is working in this change request. Your edit is saved when its turn ends;
            until then the agent's writes keep landing around it.
          </Text>
        ) : null}
        {!props.canSave ? (
          <Text className="text-sm text-danger">
            You don't have permission to change this wiki.
          </Text>
        ) : null}
        {error ? <Text className="text-sm text-danger">{error}</Text> : null}
        <Button
          label={busy ? "Saving…" : waits ? "Save when the turn ends" : "Save"}
          tone="primary"
          fullWidth
          loading={busy}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </ScrollView>
    </Sheet>
  );
}
