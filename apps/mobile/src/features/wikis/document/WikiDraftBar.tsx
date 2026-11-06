import {
  changeRequestFiles,
  describeWikiFailure,
  documentTitle,
  draftLabel,
  draftMoveTargets,
  mergeBlockedReason,
  noteNameOfFile,
} from "@t3tools/client-runtime/wikiLogic";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, WikiChangeRequest, WikiChangeRequestId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { Button } from "../../../components/ui/Button";
import * as Dialog from "../../../components/ui/Dialog";
import { Sheet } from "../../../components/ui/Sheet";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../../components/ui/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { wikiEnvironment } from "../../../state/wiki";

interface DraftActions {
  readonly environmentId: EnvironmentId;
  readonly draft: WikiChangeRequest;
  readonly changeRequests: ReadonlyArray<WikiChangeRequest>;
  /** Lands what's still unsaved first; false if it couldn't. */
  readonly flush?: () => Promise<boolean>;
  /** Forgets what's still unsaved, as discarding the draft it would land in does. */
  readonly drop?: () => void;
  /** The change request the draft's documents went to. */
  readonly onLanded?: (changeRequestId: WikiChangeRequestId, files: ReadonlyArray<string>) => void;
}

/** Where a document with a draft says so, in place of `Main`, with the ways out behind it. */
export function WikiDraftBar(props: DraftActions) {
  const [open, setOpen] = useState(false);
  const { draft } = props;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${draftLabel(draft)}. Actions for your draft.`}
        onPress={() => {
          void (props.flush?.() ?? Promise.resolve(true)).then(() => setOpen(true));
        }}
        className="flex-row items-center gap-2 border-b border-border-subtle bg-subtle px-4 py-2.5 active:opacity-70"
      >
        <SymbolView name="square.and.pencil" size={14} tintColorClassName="accent-icon" />
        <Text className="flex-1 text-sm text-foreground-muted">{draftLabel(draft)}</Text>
        <SymbolView name="chevron.right" size={12} tintColorClassName="accent-icon" />
      </Pressable>
      {open ? <WikiDraftSheet {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Make it a change request, Move to another one, or Discard. */
export function WikiDraftSheet(props: DraftActions & { readonly onClose: () => void }) {
  const { environmentId, draft, onClose } = props;
  const target = { wikiId: draft.wikiId, changeRequestId: draft.changeRequestId };
  const canAct = useAtomValue(wikiEnvironment.promoteDraft.permissionAtom(environmentId));
  const detail = useEnvironmentQuery(
    wikiEnvironment.changeRequest({ environmentId, input: target }),
  );
  const promote = useAtomCommand(wikiEnvironment.promoteDraft, { reportFailure: false });
  const move = useAtomCommand(wikiEnvironment.moveDraft, { reportFailure: false });
  const setStatus = useAtomCommand(wikiEnvironment.setChangeRequestStatus, {
    reportFailure: false,
  });
  const files = changeRequestFiles(draft);
  const targets = draftMoveTargets(props.changeRequests);
  const [title, setTitle] = useState(draft.title);
  const [moveTo, setMoveTo] = useState<WikiChangeRequestId | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(files));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflict =
    detail.data?.mergePreview.status === "conflict"
      ? mergeBlockedReason({ canWrite: true, preview: detail.data.mergePreview })
      : null;

  const run = async <A, E>(
    action: () => Promise<AtomCommandResult<A, E>>,
    landed?: (value: A) => void,
  ) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result._tag !== "Success") {
      setError(
        isAtomCommandInterrupted(result)
          ? "That was cancelled."
          : describeWikiFailure(squashAtomCommandFailure(result)),
      );
      return;
    }
    onClose();
    landed?.(result.value);
  };

  return (
    <Sheet title="Your draft" onClose={onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        contentContainerClassName="gap-4 px-4 pt-4 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-sm text-foreground-muted">
          Your edits save here by themselves. Main changes only when a change request merges.
        </Text>
        {conflict ? <Text className="text-sm text-foreground-muted">{conflict}</Text> : null}

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
        <Button
          label="Make it a change request"
          tone="primary"
          fullWidth
          loading={busy}
          disabled={!canAct || busy || title.trim().length === 0}
          onPress={() =>
            void run(
              () => promote({ environmentId, input: { ...target, title: title.trim() } }),
              (changeRequest) => props.onLanded?.(changeRequest.changeRequestId, files),
            )
          }
        />

        {targets.length > 0 ? (
          <>
            <Text className="px-4 text-xs text-foreground-muted">Move to another one</Text>
            <View className="overflow-hidden rounded-[20px] bg-grouped-card">
              {targets.map((choice, index) => (
                <Pressable
                  key={choice.changeRequestId}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: moveTo === choice.changeRequestId }}
                  onPress={() => setMoveTo(choice.changeRequestId)}
                  className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${index > 0 ? "border-t border-border-subtle" : ""}`}
                >
                  <Text className="flex-1 text-base text-foreground" numberOfLines={2}>
                    {choice.title}
                  </Text>
                  {moveTo === choice.changeRequestId ? (
                    <SymbolView name="checkmark" size={16} tintColorClassName="accent-primary" />
                  ) : null}
                </Pressable>
              ))}
            </View>
            <View className="overflow-hidden rounded-[20px] bg-grouped-card">
              {files.map((file, index) => (
                <Pressable
                  key={file}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: picked.has(file) }}
                  onPress={() =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (!next.delete(file)) next.add(file);
                      return next;
                    })
                  }
                  className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${index > 0 ? "border-t border-border-subtle" : ""}`}
                >
                  <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                    {documentTitle(noteNameOfFile(file))}
                  </Text>
                  {picked.has(file) ? (
                    <SymbolView name="checkmark" size={16} tintColorClassName="accent-primary" />
                  ) : null}
                </Pressable>
              ))}
            </View>
            <Button
              label="Move"
              fullWidth
              loading={busy}
              disabled={!canAct || busy || moveTo === null || picked.size === 0}
              onPress={() => {
                if (moveTo === null) return;
                const moving = [...picked];
                void run(
                  () =>
                    move({
                      environmentId,
                      input: {
                        ...target,
                        to: moveTo,
                        ...(picked.size === files.length ? {} : { files: moving }),
                      },
                    }),
                  () => props.onLanded?.(moveTo, moving),
                );
              }}
            />
          </>
        ) : null}

        <Button
          label="Discard"
          tone="danger"
          fullWidth
          disabled={!canAct || busy}
          onPress={() =>
            Dialog.confirm({
              title: "Discard this draft?",
              message: "Its edits leave your documents. You can reopen it from Changes.",
              cancelText: "Keep it",
              confirmText: "Discard",
              destructive: true,
              onConfirm: () => {
                props.drop?.();
                void run(() =>
                  setStatus({ environmentId, input: { ...target, status: "closed" } }),
                );
              },
            })
          }
        />
        {!canAct ? (
          <Text className="text-sm text-danger">
            You don't have permission to change this wiki.
          </Text>
        ) : null}
        {error ? <Text className="text-sm text-danger">{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}
