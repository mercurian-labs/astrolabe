/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { canvasFile } from "@mercurian/wiki/placement";
import { useNavigation } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { describeWikiFailure, keepCanvasName } from "@t3tools/client-runtime/wikiLogic";
import {
  COMPOSER_CONTEXT_CANVAS_COMMENT_MAX_CHARS,
  type EnvironmentId,
  type RootKey,
  type ThreadId,
  type TurnItemId,
  type WikiKeepCanvasResult,
} from "@t3tools/contracts";
import {
  canvasContextRecord,
  formatComposerContextReference,
} from "@t3tools/shared/composerContextReferences";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  View,
} from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useThreadShell } from "../../state/entities";
import { projectRootsEnvironment } from "../../state/projectRoots";
import { useAtomCommand } from "../../state/use-atom-command";
import { insertComposerDraftContext } from "../../state/use-composer-drafts";
import { useEnvironmentQuery } from "../../state/query";
import { wikiEnvironment } from "../../state/wiki";

/**
 * Keeps a thread's board: as a chip in its composer, for the person's own instruction, or as a
 * file in a folder of the thread's project they pick here. Placing says where it went and what
 * happened to its code cards, and the board stays in the thread whatever becomes of the file.
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
  const [placing, setPlacing] = useState(false);
  const shell = useThreadShell({ environmentId, threadId: props.threadId });
  const projectId = shell?.projectId ?? null;
  // A person's choice is any folder on disk; the server writes the thread's checkout of it.
  const list = useEnvironmentQuery(
    projectId === null || !placing
      ? null
      : projectRootsEnvironment.list({ environmentId, input: { projectId } }),
  );
  const roots = (list.data?.roots ?? []).filter((root) => root.writable);
  const keep = useAtomCommand(wikiEnvironment.keepCanvas, { reportFailure: false });
  const [comment, setComment] = useState("");
  const [picked, setPicked] = useState<RootKey | null>(null);
  const [name, setName] = useState(() => keepCanvasName(props.title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<WikiKeepCanvasResult | null>(null);
  const rootKey = picked ?? roots[0]?.key ?? null;
  const placeable = canvasFile(name) !== null;
  const canSubmit = projectId !== null && rootKey !== null && placeable && !busy;
  const scroll = useRef<ScrollViewInstance>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the keyboard is the system's, and what it covers is the button the name is filled in for; the comment box sits at the top and stays put
  useEffect(() => {
    if (!placing) return;
    const shown = Keyboard.addListener("keyboardDidShow", () => scroll.current?.scrollToEnd());
    return () => shown.remove();
  }, [placing]);

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
    if (!canSubmit || projectId === null || rootKey === null) return;
    setBusy(true);
    setError(null);
    const trimmed = comment.trim();
    const outcome = await keep({
      environmentId,
      input: {
        projectId,
        repository: rootKey,
        threadId: props.threadId,
        itemId: props.itemId,
        name: name.trim(),
        ...(trimmed === "" ? {} : { comment: trimmed }),
      },
    });
    setBusy(false);
    if (outcome._tag === "Success") setKept(outcome.value);
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
      const { changeRequest, file, notes } = kept;
      const folder = roots.find((root) => root.key === kept.rootKey)?.name ?? kept.rootKey;
      return (
        <>
          <Text className="text-sm text-foreground-muted">
            {changeRequest === null
              ? `${file} is written in ${folder}, uncommitted: commit it with your other changes. The canvas stays in this thread either way.`
              : `${file} is in your draft in ${folder}. Open a pull request from the draft's menu when you're ready. The canvas stays in this thread either way.`}
          </Text>
          {notes.map((note) => (
            <Text key={note} className="text-sm text-foreground">
              {note}
            </Text>
          ))}
          {projectId === null ? (
            <Button label="Done" tone="primary" fullWidth onPress={props.onClose} />
          ) : (
            <Button
              label="Open it"
              tone="primary"
              fullWidth
              onPress={() => {
                props.onClose();
                navigation.navigate("ProjectDocument", {
                  environmentId: String(environmentId),
                  projectId: String(projectId),
                  rootKey: kept.rootKey,
                  name: file,
                  // A draft reads by itself; a change request it went to is named.
                  ...(changeRequest !== null && !changeRequest.draft
                    ? { changeRequestId: String(changeRequest.changeRequestId) }
                    : {}),
                  ...(kept.checkout === undefined ? {} : { checkout: kept.checkout }),
                });
              }}
            />
          )}
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
              label="Place in the project"
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
    if (projectId === null) {
      return (
        <Text className="text-sm text-foreground-muted">
          A canvas is kept in its thread's project, and this thread has none.
        </Text>
      );
    }
    if (list.error !== null) {
      return (
        <Text className="text-sm text-danger">{`Couldn't read the project's folders. ${list.error}`}</Text>
      );
    }
    if (list.data !== null && roots.length === 0) {
      return (
        <Text className="text-sm text-foreground-muted">
          None of this project's folders is on disk, so there's nowhere to keep it.
        </Text>
      );
    }
    return (
      <>
        <Text className="text-sm text-foreground-muted">
          It's saved as a file in the project. In a hosted repository's main checkout it goes in
          your draft, for a pull request when you open one; anywhere else it's written for you to
          commit.
        </Text>
        {roots.length < 2 ? null : (
          <View className="overflow-hidden rounded-[20px] bg-grouped-card">
            {roots.map((root, index) => (
              <Pressable
                key={root.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: rootKey === root.key }}
                onPress={() => setPicked(root.key)}
                className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${index > 0 ? "border-t border-border-subtle" : ""}`}
              >
                <Text className="flex-1 text-base text-foreground" numberOfLines={2}>
                  {root.name}
                </Text>
                {rootKey === root.key ? (
                  <SymbolView name="checkmark" size={16} tintColorClassName="accent-primary" />
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
        <View className="gap-1.5">
          <Text className="px-4 text-xs text-foreground-muted">Name</Text>
          <TextInput
            accessibilityLabel="Canvas name"
            value={name}
            onChangeText={setName}
            maxLength={200}
            autoCapitalize="none"
            className="rounded-[20px] bg-grouped-card px-4 py-3 text-base text-foreground"
          />
          <Text className="px-4 text-xs text-foreground-muted">
            {!placeable && name.trim() !== ""
              ? "A folder can't hold a canvas at this path."
              : "It lands at the top of the folder. Type a folder to file it there: ops/Board."}
          </Text>
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
        ref={scroll}
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        // Below the sheet's translucent header, as the other app sheets lay out.
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        contentContainerClassName="gap-4 px-4 pt-4 pb-10"
        keyboardShouldPersistTaps="always"
      >
        {body()}
      </ScrollView>
    </Sheet>
  );
}
