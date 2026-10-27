import type { WikiEditorCommand, WikiEditorEvent } from "@mercurian/wiki-editor/protocol";
import {
  StackActions,
  usePreventRemove,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  describeWikiFailure,
  isTurnRunning,
  queuedSaveStep,
  type QueuedWikiSave,
} from "@t3tools/client-runtime/wikiLogic";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, View } from "react-native";

import { LoadingScreen } from "../../components/LoadingScreen";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Toolbar } from "../../components/ui/Toolbar";
import { mobileHtmlRenderTheme } from "../../lib/htmlRenderTheme";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { wikiEnvironment } from "../../state/wiki";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  isSkillMapFile,
  wikiDocumentAuthor,
  wikiDocumentSubtitle,
} from "./document/wikiDocument.logic";
import { WikiEditorWebView, type WikiEditorHandle } from "./document/WikiEditorWebView";
import { WikiSaveSheet, type WikiSaveTarget } from "./document/WikiSaveSheet";
import type { WikiDocumentParams } from "./wikiRoutes";

/** The app's colours for the editor page, as the HTML render view themes agent pages. */
function useEditorTheme() {
  const { themeId, themeAppearance, themeVariables, systemColorsActive } =
    useAppearancePreferences();
  return useMemo(
    () =>
      mobileHtmlRenderTheme({
        themeId,
        appearance: themeAppearance,
        variables: themeVariables,
        systemColors: systemColorsActive,
        platform: Platform.OS,
      }),
    [themeId, themeAppearance, themeVariables, systemColorsActive],
  );
}

/** Whether the change request's thread is mid-turn, and the run it is in. */
function useChangeRequestTurn(environmentId: EnvironmentId, threadId: ThreadId | null | undefined) {
  const shell = useThreadShell(
    threadId === null || threadId === undefined ? null : scopeThreadRef(environmentId, threadId),
  );
  const running = isTurnRunning(shell?.source.status);
  return { running, runId: running ? (shell?.latestRun?.runId ?? null) : null };
}

/**
 * One wiki document, read first; Edit turns the page into the editor and edits stay on the phone
 * until saved to a change request. Inside a change request, an agent's amendments land live beside
 * the person's unsaved edits, and a save while the agent is mid-turn waits for the turn to end.
 * Links open the next document on top, read from the same place.
 */
export function WikiDocumentRouteScreen({ route }: StaticScreenProps<WikiDocumentParams>) {
  const navigation = useNavigation();
  const environmentId = route.params.environmentId as EnvironmentId;
  const wikiId = route.params.wikiId as WikiId;
  const name = route.params.name;
  const changeRequestId = route.params.changeRequestId as WikiChangeRequestId | undefined;
  const scope = changeRequestId === undefined ? {} : { changeRequestId };

  const note = useEnvironmentQuery(
    wikiEnvironment.note({ environmentId, input: { wikiId, name, ...scope } }),
  );
  const wikis = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const changeRequests = useEnvironmentQuery(
    wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }),
  );
  const openChangeRequests = useMemo(
    () =>
      (changeRequests.data?.changeRequests ?? []).filter(
        (changeRequest) => changeRequest.status === "open",
      ),
    [changeRequests.data],
  );
  const wiki = wikis.data?.wikis.find((entry) => entry.wikiId === wikiId) ?? null;
  const viewing = openChangeRequests.find(
    (changeRequest) => changeRequest.changeRequestId === changeRequestId,
  );
  const viewingTurn = useChangeRequestTurn(environmentId, viewing?.threadId);
  const file = note.data?.file ?? null;
  const readOnly = file !== null && isSkillMapFile(file);
  const unwritten = note.data !== null && !note.data.exists && !readOnly;

  const editor = useRef<WikiEditorHandle>(null);
  const theme = useEditorTheme();
  // Null until the person picks: a document not written yet opens ready to write.
  const [chosenMode, setMode] = useState<"read" | "edit" | null>(null);
  const mode = readOnly ? "read" : (chosenMode ?? (unwritten ? "edit" : "read"));
  const [state, setState] = useState({ dirty: false, changedUnderneath: false });
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [queued, setQueued] = useState<QueuedWikiSave | null>(null);

  // What the page shows: sent on every new version, theme and mode, and resent from scratch
  // whenever the page (re)loads.
  const incoming = note.data?.source ?? null;
  const live = changeRequestId !== undefined;
  const receive = useMemo<WikiEditorCommand | null>(
    () =>
      incoming === null
        ? null
        : {
            type: "receive",
            source: incoming,
            author:
              live && file !== null
                ? wikiDocumentAuthor({ changeRequest: viewing, file, runId: viewingTurn.runId })
                : null,
            turnRunning: viewingTurn.running,
          },
    [incoming, live, file, viewing, viewingTurn.runId, viewingTurn.running],
  );
  const shown = useRef({ receive, theme, mode });
  useLayoutEffect(() => {
    shown.current = { receive, theme, mode };
  });
  const initialCommands = useCallback((): WikiEditorCommand[] => {
    const current = shown.current;
    return [
      { type: "theme", theme: current.theme },
      { type: "mode", mode: current.mode },
      ...(current.receive ? [current.receive] : []),
    ];
  }, []);
  useEffect(() => {
    if (receive) editor.current?.send(receive);
  }, [receive]);
  useEffect(() => {
    editor.current?.send({ type: "theme", theme });
  }, [theme]);
  useEffect(() => {
    editor.current?.send({ type: "mode", mode });
  }, [mode]);

  // The buffer's text, asked of the page when saving.
  const textRequests = useRef(new Map<number, (text: string) => void>());
  const nextRequest = useRef(1);
  const requestText = () =>
    new Promise<string>((resolve) => {
      const requestId = nextRequest.current++;
      textRequests.current.set(requestId, resolve);
      editor.current?.send({ type: "requestText", requestId });
    });

  const onEvent = (event: WikiEditorEvent) => {
    switch (event.type) {
      case "state":
        setState({ dirty: event.dirty, changedUnderneath: event.changedUnderneath });
        return;
      case "openNote":
        navigation.dispatch(
          StackActions.push("WikiDocument", {
            environmentId: route.params.environmentId,
            wikiId: route.params.wikiId,
            name: event.name,
            ...(changeRequestId === undefined ? {} : { changeRequestId }),
          }),
        );
        return;
      case "openUrl":
        void Linking.openURL(event.href).catch(() => undefined);
        return;
      case "text":
        textRequests.current.get(event.requestId)?.(event.text);
        textRequests.current.delete(event.requestId);
        return;
      case "ready":
        return;
      case "error":
        console.warn("The wiki editor page failed:", event.message);
        setPageError(event.message);
        return;
    }
  };

  const canAmend = useAtomValue(wikiEnvironment.amend.permissionAtom(environmentId));
  const amend = useAtomCommand(wikiEnvironment.amend, { reportFailure: false });
  /** Commits the buffer as it stands now; the failure's message, or null on success. */
  const commit = async (target: WikiSaveTarget, message: string): Promise<string | null> => {
    if (file === null) return "The document isn't loaded yet.";
    const text = await requestText();
    const result = await amend({
      environmentId,
      input: { wikiId, message, changes: { [file]: text }, ...target },
    });
    if (result._tag !== "Success") {
      return isAtomCommandInterrupted(result)
        ? "The save was cancelled."
        : describeWikiFailure(squashAtomCommandFailure(result));
    }
    editor.current?.send({ type: "markSaved", text });
    setMode("read");
    const savedTo = result.value.changeRequest.changeRequestId;
    // Saved from main, the document now reads inside the change request it was saved to.
    if (savedTo !== changeRequestId) navigation.setParams({ changeRequestId: savedTo });
    return null;
  };

  // A save queued behind a running turn commits once that turn ends.
  const queuedChange = openChangeRequests.find(
    (changeRequest) => changeRequest.changeRequestId === queued?.changeRequestId,
  );
  const queuedTurn = useChangeRequestTurn(environmentId, queuedChange?.threadId);
  const committing = useRef(false);
  useEffect(() => {
    const step = queuedSaveStep({
      queued,
      turnRunning: queuedTurn.running,
      committing: committing.current,
    });
    if (step !== "commit" || queued === null) return;
    committing.current = true;
    void commit({ changeRequestId: queued.changeRequestId }, queued.message).then((failure) => {
      committing.current = false;
      setQueued(null);
      if (failure) Dialog.alert("Couldn't save the document", failure);
    });
  });

  // Leaving with unsaved edits asks first.
  usePreventRemove(state.dirty && queued === null, ({ data }) => {
    Dialog.confirm({
      title: "Discard your edits?",
      message: `Your unsaved edits to ${name} will be lost.`,
      cancelText: "Keep editing",
      confirmText: "Discard",
      destructive: true,
      onConfirm: () => navigation.dispatch(data.action),
    });
  });

  const subtitle = wikiDocumentSubtitle({
    wikiName: wiki?.name ?? null,
    changeRequest: viewing ?? null,
    readsChangeRequest: changeRequestId !== undefined,
    agentWorking: viewingTurn.running,
  });

  const header = (
    <NativeStackScreenOptions
      options={{ title: name, unstable_headerSubtitle: subtitle }}
      optionsVersion={`${subtitle}|${mode}|${state.dirty}|${queued !== null}|${readOnly}`}
    />
  );
  const toolbar =
    note.data === null ? null : (
      // Direct children only: the toolbar reads its items by component, not through fragments.
      <Toolbar placement="right">
        {queued !== null ? (
          <Toolbar.Button
            label="Cancel save"
            accessibilityLabel="Cancel the save waiting for the agent's turn"
            onPress={() => setQueued(null)}
          />
        ) : null}
        {queued === null && state.dirty ? (
          <Toolbar.Menu icon="ellipsis" accessibilityLabel="Document actions" title={name}>
            <Toolbar.MenuAction
              icon="arrow.uturn.backward"
              destructive
              onPress={() => editor.current?.send({ type: "discard" })}
            >
              <Toolbar.Label>Discard edits</Toolbar.Label>
            </Toolbar.MenuAction>
          </Toolbar.Menu>
        ) : null}
        {queued === null && state.dirty ? (
          <Toolbar.Button
            label="Save"
            variant="done"
            accessibilityLabel="Save to a change request"
            onPress={() => setSaving(true)}
          />
        ) : null}
        {queued === null && !state.dirty && !readOnly ? (
          <Toolbar.Button
            label={mode === "read" ? "Edit" : "Done"}
            variant={mode === "edit" ? "done" : "plain"}
            accessibilityLabel={mode === "read" ? "Edit the document" : "Stop editing"}
            onPress={() => setMode(mode === "read" ? "edit" : "read")}
          />
        ) : null}
      </Toolbar>
    );

  if (note.data === null) {
    return (
      <View className="flex-1 bg-screen">
        {header}
        {note.error !== null ? (
          <EmptyState title={`Couldn't open ${name}`} detail={note.error} />
        ) : (
          <LoadingScreen message="Opening the document…" />
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-screen">
      {header}
      {toolbar}
      {pageError !== null ? (
        <Notice text={`This document couldn't be shown: ${pageError}`} />
      ) : queued !== null ? (
        <Notice text="Your edit saves when the agent's turn ends." />
      ) : state.changedUnderneath ? (
        <Notice
          text="This document changed while you were editing. Your edits are kept."
          action="Load new version"
          onAction={() => editor.current?.send({ type: "loadChanged" })}
        />
      ) : !note.data.exists ? (
        <Notice text={`No document is called ${name} yet. Write it, then save it.`} />
      ) : null}
      <WikiEditorWebView ref={editor} onEvent={onEvent} initialCommands={initialCommands} />
      {saving ? (
        <WikiSaveSheet
          noteName={name}
          openChangeRequests={openChangeRequests}
          viewing={changeRequestId}
          canSave={canAmend}
          // Only the turn of the change request read here is followed; saving into another
          // one goes straight in.
          turnRunning={(id) => id === changeRequestId && viewingTurn.running}
          onClose={() => setSaving(false)}
          onSave={async (target, message) => {
            const failure = await commit(target, message);
            if (failure === null) setSaving(false);
            return failure;
          }}
          onQueue={(id, message) => {
            setQueued({ changeRequestId: id, message });
            setSaving(false);
          }}
        />
      ) : null}
    </View>
  );
}

/** A line above the document about its state, with an optional action. */
function Notice(props: {
  readonly text: string;
  readonly action?: string;
  readonly onAction?: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3 border-b border-border-subtle bg-subtle px-4 py-2.5">
      <Text className="flex-1 text-sm text-foreground-muted">{props.text}</Text>
      {props.action ? (
        <Pressable accessibilityRole="button" onPress={props.onAction} hitSlop={8}>
          <Text className="text-sm font-t3-medium text-primary">{props.action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
