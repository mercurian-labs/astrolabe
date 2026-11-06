import type { WikiEditorCommand, WikiEditorEvent } from "@mercurian/wiki-editor/protocol";
import { StackActions, useNavigation, usePreventRemove } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { withEdit } from "@t3tools/client-runtime/wikiBaseEdits";
import { describeWikiFailure } from "@t3tools/client-runtime/wikiLogic";
import type { EnvironmentId, WikiBaseEdit, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Linking, View } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { Toolbar } from "../../components/ui/Toolbar";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { wikiEnvironment } from "../../state/wiki";
import { useEditorTheme } from "./document/useEditorTheme";
import { wikiBaseTitle, wikiDocumentSubtitle } from "./document/wikiDocument.logic";
import type { WikiBaseAnswer } from "./document/WikiBaseQueries";
import { WikiEditorWebView, type WikiEditorHandle } from "./document/WikiEditorWebView";
import { WikiSaveSheet, type WikiSaveTarget } from "./document/WikiSaveSheet";
import type { WikiDocumentParams } from "./wikiRoutes";

/**
 * A `.base` file on its own: the editor page draws its view as it draws a ```base block in a
 * note, and the header's View menu picks among the base's views. A row's note opens on top, read
 * from the same place. A note's cell edits in place, and a board's card moves with its picker;
 * the edits show at once and stay unsaved until saved to a change request.
 */
export function WikiBaseScreen({ params }: { readonly params: WikiDocumentParams }) {
  const navigation = useNavigation();
  const environmentId = params.environmentId as EnvironmentId;
  const wikiId = params.wikiId as WikiId;
  const file = params.name;
  const changeRequestId = params.changeRequestId as WikiChangeRequestId | undefined;
  const scope = changeRequestId === undefined ? {} : { changeRequestId };

  const [view, setView] = useState<string | null>(null);
  const [edits, setEdits] = useState<ReadonlyArray<WikiBaseEdit>>([]);
  const [saving, setSaving] = useState(false);
  const canEdit = useAtomValue(wikiEnvironment.transform.permissionAtom(environmentId));
  const transform = useAtomCommand(wikiEnvironment.transform, { reportFailure: false });
  const editable = canEdit && /^[^/]+\.base$/.test(file);
  const query = useEnvironmentQuery(
    wikiEnvironment.query({
      environmentId,
      input: {
        wikiId,
        ...scope,
        base: file,
        ...(view === null ? {} : { view }),
        ...(edits.length ? { edits: [...edits] } : {}),
      },
    }),
  );
  const wikis = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const changeRequests = useEnvironmentQuery(
    wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }),
  );
  const wiki = wikis.data?.wikis.find((entry) => entry.wikiId === wikiId) ?? null;
  const viewing =
    changeRequests.data?.changeRequests.find(
      (changeRequest) => changeRequest.changeRequestId === changeRequestId,
    ) ?? null;

  // A view switch keeps the last view, and the View menu, until the next one lands.
  const [lastResult, setLastResult] = useState(query.data);
  if (query.data !== null && query.data !== lastResult) setLastResult(query.data);
  const result = query.data ?? lastResult;

  const editor = useRef<WikiEditorHandle>(null);
  const theme = useEditorTheme();
  const answer = useMemo<WikiBaseAnswer | null>(
    () =>
      query.error !== null
        ? { result: null, error: query.error }
        : result !== null
          ? { result, error: null }
          : null,
    [result, query.error],
  );
  const shown = useRef({ theme, answer, editable });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a reloaded web view reads the latest theme and view
  useLayoutEffect(() => {
    shown.current = { theme, answer, editable };
  });
  const initialCommands = useCallback((): WikiEditorCommand[] => {
    const current = shown.current;
    return [
      { type: "theme", theme: current.theme },
      { type: "showBase", source: file, editable: current.editable },
      ...(current.answer ? [{ type: "baseResult" as const, source: file, ...current.answer }] : []),
    ];
  }, [file]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the theme crosses into the web view, outside React
  useEffect(() => {
    editor.current?.send({ type: "theme", theme });
  }, [theme]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- each answer crosses into the web view, outside React
  useEffect(() => {
    if (answer) editor.current?.send({ type: "baseResult", source: file, ...answer });
  }, [answer, file]);

  const onEvent = (event: WikiEditorEvent) => {
    switch (event.type) {
      case "queryBase":
        if (shown.current.answer) {
          editor.current?.send({ type: "baseResult", source: file, ...shown.current.answer });
        }
        return;
      case "openNote":
        navigation.dispatch(
          StackActions.push("WikiDocument", {
            environmentId: params.environmentId,
            wikiId: params.wikiId,
            name: event.name,
            ...scope,
          }),
        );
        return;
      case "openUrl":
        void Linking.openURL(event.href).catch(() => undefined);
        return;
      case "editBase":
        setEdits((current) =>
          withEdit(current, {
            kind: "property",
            file: event.file,
            property: event.property,
            value: event.value,
          }),
        );
        return;
      case "error":
        console.warn("The wiki editor page failed:", event.message);
        return;
      case "ready":
      case "state":
      case "text":
      case "readNote":
        return;
    }
  };

  /** Lands the edits as one amendment; the failure's message, or null on success. */
  const save = async (target: WikiSaveTarget, message: string): Promise<string | null> => {
    const outcome = await transform({
      environmentId,
      input: { wikiId, message, transform: { kind: "base-edits", edits: [...edits] }, ...target },
    });
    if (outcome._tag !== "Success") {
      return isAtomCommandInterrupted(outcome)
        ? "The save was cancelled."
        : describeWikiFailure(squashAtomCommandFailure(outcome));
    }
    setEdits([]);
    const savedTo = outcome.value.changeRequest.changeRequestId;
    // Saved from main, the base now reads inside the change request it was saved to.
    if (savedTo !== changeRequestId) navigation.setParams({ changeRequestId: savedTo });
    return null;
  };

  // Leaving with unsaved edits asks first.
  usePreventRemove(edits.length > 0, ({ data }) => {
    Dialog.confirm({
      title: "Discard your changes?",
      message: `Your unsaved changes to ${wikiBaseTitle(file)} will be lost.`,
      cancelText: "Keep editing",
      confirmText: "Discard",
      destructive: true,
      onConfirm: () => navigation.dispatch(data.action),
    });
  });

  const subtitle = [
    wikiDocumentSubtitle({
      wikiName: wiki?.name ?? null,
      changeRequest: viewing,
      readsChangeRequest: changeRequestId !== undefined,
      agentWorking: false,
    }),
    edits.length
      ? edits.length === 1
        ? "1 unsaved change"
        : `${edits.length} unsaved changes`
      : editable
        ? "Base"
        : "Base · read only",
  ].join(" · ");
  const openChangeRequests = (changeRequests.data?.changeRequests ?? []).filter(
    (changeRequest) => changeRequest.status === "open",
  );
  const views = result?.views ?? [];
  const current = result?.view.name ?? null;

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions
        options={{ title: wikiBaseTitle(file), unstable_headerSubtitle: subtitle }}
        optionsVersion={`${subtitle}|${views.join("\n")}|${current}`}
      />
      {views.length > 1 || edits.length > 0 ? (
        // Direct children only: the toolbar reads its items by component, not through fragments.
        <Toolbar placement="right">
          {views.length > 1 ? (
            <Toolbar.Menu icon="rectangle.stack" accessibilityLabel="View" title="View">
              {views.map((name) => (
                <Toolbar.MenuAction
                  key={name}
                  isOn={name === current}
                  onPress={() => setView(name)}
                >
                  <Toolbar.Label>{name}</Toolbar.Label>
                </Toolbar.MenuAction>
              ))}
            </Toolbar.Menu>
          ) : null}
          {edits.length > 0 ? (
            <Toolbar.Menu
              icon="ellipsis"
              accessibilityLabel="Base actions"
              title={wikiBaseTitle(file)}
            >
              <Toolbar.MenuAction
                icon="arrow.uturn.backward"
                destructive
                onPress={() => setEdits([])}
              >
                <Toolbar.Label>Discard changes</Toolbar.Label>
              </Toolbar.MenuAction>
            </Toolbar.Menu>
          ) : null}
          {edits.length > 0 ? (
            <Toolbar.Button
              label="Save"
              variant="done"
              accessibilityLabel="Save to a change request"
              onPress={() => setSaving(true)}
            />
          ) : null}
        </Toolbar>
      ) : null}
      <WikiEditorWebView ref={editor} onEvent={onEvent} initialCommands={initialCommands} />
      {saving ? (
        <WikiSaveSheet
          noteName={wikiBaseTitle(file)}
          openChangeRequests={openChangeRequests}
          viewing={changeRequestId}
          canSave={canEdit}
          // Edits land on whatever the head holds when saved, so a running turn needn't wait.
          turnRunning={() => false}
          onClose={() => setSaving(false)}
          onSave={async (target, message) => {
            const failure = await save(target, message);
            if (failure === null) setSaving(false);
            return failure;
          }}
          onQueue={() => setSaving(false)}
        />
      ) : null}
    </View>
  );
}
