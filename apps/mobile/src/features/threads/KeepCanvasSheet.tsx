import { useNavigation } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { describeWikiFailure, keepCanvasName } from "@t3tools/client-runtime/wikiLogic";
import {
  COMPOSER_CONTEXT_CANVAS_COMMENT_MAX_CHARS,
  type EnvironmentId,
  type ThreadId,
  type TurnItemId,
  type WikiKeepCanvasResult,
  type WikiSummary,
} from "@t3tools/contracts";
import {
  canvasContextRecord,
  formatComposerContextReference,
} from "@t3tools/shared/composerContextReferences";
import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useAtomCommand } from "../../state/use-atom-command";
import { insertComposerDraftContext } from "../../state/use-composer-drafts";
import { useEnvironmentQuery } from "../../state/query";
import { wikiEnvironment } from "../../state/wiki";

interface Kept {
  readonly wikiId: WikiSummary["wikiId"];
  readonly result: WikiKeepCanvasResult;
}

/**
 * Keeps a thread's board: as a chip in its composer, for the person's own instruction, or in a wiki
 * they pick here, as a change request. Placing says what happened to its code cards, and the board
 * stays in the thread whatever becomes of the change request.
 */
export function KeepCanvasSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly title: string;
  readonly canPlace: boolean;
  readonly onClose: () => void;
  readonly onAdded: () => void;
}) {
  const { environmentId } = props;
  const navigation = useNavigation();
  const list = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const wikis = list.data?.wikis ?? [];
  const keep = useAtomCommand(wikiEnvironment.keepCanvas, { reportFailure: false });
  const [comment, setComment] = useState("");
  const [placing, setPlacing] = useState(false);
  const [picked, setPicked] = useState<WikiSummary["wikiId"] | null>(null);
  const [name, setName] = useState(() => keepCanvasName(props.title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<Kept | null>(null);
  const wikiId = picked ?? wikis[0]?.wikiId ?? null;
  const canSubmit = wikiId !== null && name.trim().length > 0 && !busy;

  const addToChat = () => {
    const record = canvasContextRecord({
      threadId: props.threadId,
      itemId: props.itemId,
      title: props.title,
      comment,
    });
    const added = insertComposerDraftContext(scopedThreadKey(environmentId, props.threadId), {
      text: formatComposerContextReference(record),
      context: { version: 1, records: [record] },
    });
    if (added) props.onAdded();
    else setError("The composer has no room for this. Remove something from it first.");
  };

  const submit = async () => {
    if (!canSubmit || wikiId === null) return;
    setBusy(true);
    setError(null);
    const trimmed = comment.trim();
    const outcome = await keep({
      environmentId,
      input: {
        wikiId,
        threadId: props.threadId,
        itemId: props.itemId,
        name: name.trim(),
        ...(trimmed === "" ? {} : { comment: trimmed }),
      },
    });
    setBusy(false);
    if (outcome._tag === "Success") setKept({ wikiId, result: outcome.value });
    else {
      setError(
        isAtomCommandInterrupted(outcome)
          ? "The canvas wasn't kept."
          : describeWikiFailure(squashAtomCommandFailure(outcome)),
      );
    }
  };

  const body = () => {
    if (kept !== null) {
      const { changeRequest, file, notes } = kept.result;
      return (
        <>
          <Text className="text-sm text-foreground-muted">
            {`${file} is in “${changeRequest.title}”. Merge it to put it on the wiki, or close it to discard it. The canvas stays in this thread either way.`}
          </Text>
          {notes.map((note) => (
            <Text key={note} className="text-sm text-foreground">
              {note}
            </Text>
          ))}
          <Button
            label="Open it"
            tone="primary"
            fullWidth
            onPress={() => {
              props.onClose();
              navigation.navigate("WikiDocument", {
                environmentId: String(environmentId),
                wikiId: String(kept.wikiId),
                name: file,
                changeRequestId: String(changeRequest.changeRequestId),
              });
            }}
          />
        </>
      );
    }
    if (!placing) {
      return (
        <>
          <TextInput
            accessibilityLabel="Comment on this canvas"
            placeholder="Add an optional comment..."
            value={comment}
            onChangeText={setComment}
            maxLength={COMPOSER_CONTEXT_CANVAS_COMMENT_MAX_CHARS}
            multiline
            className="min-h-24 rounded-[20px] bg-grouped-card px-4 py-3 text-base text-foreground"
          />
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
          <Button label="Add to chat" tone="primary" fullWidth onPress={addToChat} />
          {props.canPlace ? (
            <Button
              label="Place in wiki"
              fullWidth
              onPress={() => {
                setError(null);
                setPlacing(true);
              }}
            />
          ) : null}
        </>
      );
    }
    if (list.data !== null && wikis.length === 0) {
      return (
        <Text className="text-sm text-foreground-muted">
          A canvas is kept in a wiki, and this server has none yet. Add one from the app on a
          computer, then keep it.
        </Text>
      );
    }
    return (
      <>
        <Text className="text-sm text-foreground-muted">
          It goes to a change request on a wiki. Main changes only when someone merges it.
        </Text>
        <View className="overflow-hidden rounded-[20px] bg-grouped-card">
          {wikis.map((wiki, index) => (
            <Pressable
              key={wiki.wikiId}
              accessibilityRole="radio"
              accessibilityState={{ checked: wikiId === wiki.wikiId }}
              onPress={() => setPicked(wiki.wikiId)}
              className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${index > 0 ? "border-t border-border-subtle" : ""}`}
            >
              <Text className="flex-1 text-base text-foreground" numberOfLines={2}>
                {wiki.name}
              </Text>
              {wikiId === wiki.wikiId ? (
                <SymbolView name="checkmark" size={16} tintColorClassName="accent-primary" />
              ) : null}
            </Pressable>
          ))}
        </View>
        <View className="gap-1.5">
          <Text className="px-4 text-xs text-foreground-muted">Name</Text>
          <TextInput
            accessibilityLabel="Canvas name"
            value={name}
            onChangeText={setName}
            maxLength={200}
            className="rounded-[20px] bg-grouped-card px-4 py-3 text-base text-foreground"
          />
        </View>
        {error ? <Text className="text-sm text-danger">{error}</Text> : null}
        <Button
          label={busy ? "Placing…" : "Place it"}
          tone="primary"
          fullWidth
          loading={busy}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </>
    );
  };

  return (
    <Sheet title={kept === null ? "Keep this canvas" : "Kept"} onClose={props.onClose}>
      <ScrollView
        // Below the sheet's translucent header, as the other app sheets lay out.
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        contentContainerClassName="gap-4 px-4 pt-4 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        {body()}
      </ScrollView>
    </Sheet>
  );
}
