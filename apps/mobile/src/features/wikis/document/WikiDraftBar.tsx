/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import {
  changeRequestFiles,
  describeWikiFailure,
  draftLabel,
  mergeBlockedReason,
  wikiTerms,
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
  /** Lands what's still unsaved first; false if it couldn't. */
  readonly flush?: () => Promise<boolean>;
  /** Forgets what's still unsaved, as discarding the draft it would land in does. */
  readonly drop?: () => void;
  /** The change request the draft became, once its pull request is open. */
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

/**
 * Open pull request, or Discard. The draft stays a draft, on this server only, until the person
 * opens its pull request: that names it and pushes it to the host in one go.
 */
function WikiDraftSheet(props: DraftActions & { readonly onClose: () => void }) {
  const { environmentId, draft, onClose } = props;
  const target = { wikiId: draft.wikiId, changeRequestId: draft.changeRequestId };
  const canAct = useAtomValue(wikiEnvironment.promoteDraft.permissionAtom(environmentId));
  const detail = useEnvironmentQuery(
    wikiEnvironment.changeRequest({ environmentId, input: target }),
  );
  const wikis = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const terms = wikiTerms(wikis.data?.wikis.find((entry) => entry.wikiId === draft.wikiId));
  const promote = useAtomCommand(wikiEnvironment.promoteDraft, { reportFailure: false });
  const publish = useAtomCommand(wikiEnvironment.publishChangeRequest, { reportFailure: false });
  const setStatus = useAtomCommand(wikiEnvironment.setChangeRequestStatus, {
    reportFailure: false,
  });
  const files = changeRequestFiles(draft);
  const [title, setTitle] = useState(draft.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflict =
    detail.data?.mergePreview.status === "conflict"
      ? mergeBlockedReason({ canWrite: true, preview: detail.data.mergePreview })
      : null;

  const failed = (result: AtomCommandResult<unknown, unknown>) =>
    result._tag === "Success"
      ? ""
      : isAtomCommandInterrupted(result)
        ? "That was cancelled."
        : describeWikiFailure(squashAtomCommandFailure(result));

  const openPullRequest = async () => {
    setBusy(true);
    setError(null);
    const promoted = await promote({ environmentId, input: { ...target, title: title.trim() } });
    if (promoted._tag !== "Success") {
      setBusy(false);
      setError(failed(promoted));
      return;
    }
    // No longer a draft, the bar and this sheet can go before the host answers.
    const published = await publish({ environmentId, input: target });
    setBusy(false);
    onClose();
    props.onLanded?.(promoted.value.changeRequestId, files);
    if (published._tag !== "Success") {
      Dialog.alert(
        `The ${terms.singular} isn't open yet`,
        `Your edits are kept as “${title.trim()}”. ${failed(published)}`,
      );
    }
  };

  return (
    <Sheet title="Your draft" onClose={onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        contentContainerClassName="gap-4 px-4 pt-4 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-sm text-foreground-muted">
          {`Your edits save to this draft by themselves, and stay here until you open a ${terms.singular}. The repository changes only when it merges.`}
        </Text>
        {conflict ? <Text className="text-sm text-foreground-muted">{conflict}</Text> : null}

        <View className="gap-1.5">
          <Text className="px-4 text-xs text-foreground-muted">Title</Text>
          <TextInput
            accessibilityLabel={`${terms.Singular} title`}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            className="rounded-[20px] bg-grouped-card px-4 py-3 text-base text-foreground"
          />
        </View>
        <Button
          label={`Open ${terms.singular}`}
          tone="primary"
          fullWidth
          loading={busy}
          disabled={!canAct || busy || title.trim().length === 0}
          onPress={() => void openPullRequest()}
        />

        <Button
          label="Discard"
          tone="danger"
          fullWidth
          disabled={!canAct || busy}
          onPress={() =>
            Dialog.confirm({
              title: "Discard this draft?",
              message: "Its edits leave your documents.",
              cancelText: "Keep it",
              confirmText: "Discard",
              destructive: true,
              onConfirm: () => {
                props.drop?.();
                void (async () => {
                  setBusy(true);
                  setError(null);
                  const result = await setStatus({
                    environmentId,
                    input: { ...target, status: "closed" },
                  });
                  setBusy(false);
                  if (result._tag === "Success") onClose();
                  else setError(failed(result));
                })();
              },
            })
          }
        />
        {!canAct ? (
          <Text className="text-sm text-danger">
            You don't have permission to change this repository's documents.
          </Text>
        ) : null}
        {error ? <Text className="text-sm text-danger">{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}
