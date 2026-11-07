import type {
  WikiEditorCommand,
  WikiEditorEmbeddedFile,
  WikiEditorEvent,
} from "@mercurian/wiki-editor/protocol";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import {
  documentFile,
  documentTitle,
  exactWikiPath,
  filesHoldDocument,
  isCanvasName,
  draftMovedTo,
  isSettledChangeRequest,
  isTurnRunning,
  wikiDocumentScope,
  wikiDraft,
  NO_NOTE_FROM_RELATIVE_LINK,
  wikiDocumentFilesWithDraft,
  wikiLinkOpens,
} from "@t3tools/client-runtime/wikiLogic";
import { linkFiles } from "@mercurian/wiki/resolve-link";
import type { EnvironmentId, ThreadId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { useWikiPlacement } from "./wikiPreferences";
import { Linking, View } from "react-native";

import { LoadingScreen } from "../../components/LoadingScreen";
import { EmptyState } from "../../components/ui/EmptyState";
import { Toolbar } from "../../components/ui/Toolbar";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { assetEnvironment } from "../../state/assets";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { usePreparedConnection } from "../../state/session";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { wikiEnvironment } from "../../state/wiki";
import {
  isSkillMapFile,
  isWikiBaseFile,
  wikiDocumentAuthor,
  wikiDocumentSubtitle,
} from "./document/wikiDocument.logic";
import { useEditorTheme } from "./document/useEditorTheme";
import {
  WikiBaseQueries,
  WikiFileReads,
  WikiNoteReads,
  type WikiBaseAnswer,
  type WikiNoteReadsProps,
} from "./document/WikiBaseQueries";
import { WikiDraftBar } from "./document/WikiDraftBar";
import { WikiEditorWebView, type WikiEditorHandle } from "./document/WikiEditorWebView";
import { WikiBelowHeader } from "./document/WikiBelowHeader";
import { WikiNotice } from "./document/WikiNotice";
import { useWikiAutosave, useWikiAutosaveCommand, wikiSaveLabel } from "./document/useWikiAutosave";
import { WikiBaseScreen } from "./WikiBaseScreen";
import { WikiCanvasScreen } from "./WikiCanvasScreen";
import type { WikiDocumentParams } from "./wikiRoutes";

const QUIET_MINT = { reportFailure: false, reportDefect: false, refresh: true };

/** Whether the change request's thread is mid-turn, and the run it is in. */
function useChangeRequestTurn(environmentId: EnvironmentId, threadId: ThreadId | null | undefined) {
  const shell = useThreadShell(
    threadId === null || threadId === undefined ? null : scopeThreadRef(environmentId, threadId),
  );
  const running = isTurnRunning(shell?.source.status);
  return { running, runId: running ? (shell?.latestRun?.runId ?? null) : null };
}

/** A wiki document: a note, or a `.base` or `.canvas` file opened by its file name, as on web. */
export function WikiDocumentRouteScreen({ route }: StaticScreenProps<WikiDocumentParams>) {
  // A link from before wikis had folders holds a note's bare name.
  const params = { ...route.params, name: documentFile(route.params.name) };
  if (isCanvasName(params.name)) return <WikiCanvasScreen params={params} />;
  return isWikiBaseFile(params.name) ? (
    <WikiBaseScreen params={params} />
  ) : (
    <WikiNoteScreen params={params} />
  );
}

/**
 * One wiki note, read first; Edit turns the page into the editor. Edits save by themselves, to the
 * change request the route names, else the person's draft. Inside a change request, an agent's
 * amendments land live beside what hasn't saved yet, and saves wait for its turn to end. Links open
 * the next document on top, read from the same place.
 */
function WikiNoteScreen({ params }: { readonly params: WikiDocumentParams }) {
  const navigation = useNavigation();
  const environmentId = params.environmentId as EnvironmentId;
  const wikiId = params.wikiId as WikiId;
  const requested = params.name;
  const title = documentTitle(requested);
  const routeChangeRequestId = params.changeRequestId as WikiChangeRequestId | undefined;

  const wikis = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const changeRequests = useEnvironmentQuery(
    wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }),
  );
  const all = changeRequests.data?.changeRequests;
  const draft = wikiDraft(all);
  const placement = useWikiPlacement(environmentId);
  const movedTo = routeChangeRequestId === undefined ? draftMovedTo(draft, requested) : undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a move landed elsewhere reaches the native route from here
  useEffect(() => {
    if (movedTo !== undefined) navigation.setParams({ name: movedTo });
  }, [movedTo, navigation]);
  const changeRequestId = wikiDocumentScope({
    tabChangeRequestId: routeChangeRequestId,
    draft,
    file: requested,
  });
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  // Waits for the list to say whether a draft holds this, or a draft's document would first draw
  // from main and then seem to change.
  const located = changeRequests.data !== null || changeRequests.error !== null;
  const note = useEnvironmentQuery(
    located
      ? wikiEnvironment.note({
          environmentId,
          input: { wikiId, name: exactWikiPath(requested), ...scope },
        })
      : null,
  );
  const index = useEnvironmentQuery(
    wikiEnvironment.index({ environmentId, input: { wikiId, ...scope } }),
  );
  const wiki = wikis.data?.wikis.find((entry) => entry.wikiId === wikiId) ?? null;
  const viewing = all?.find((changeRequest) => changeRequest.changeRequestId === changeRequestId);
  const settled = isSettledChangeRequest(viewing);
  const viewingTurn = useChangeRequestTurn(
    environmentId,
    viewing?.status === "open" ? viewing.threadId : null,
  );
  // A first save moves the read from main to the draft; the note stays on screen across it.
  const [lastNote, setLastNote] = useState(note.data);
  if (note.data !== null && note.data !== lastNote) setLastNote(note.data);
  const data = note.data ?? lastNote;
  const file = data?.file ?? null;
  const canEdit = useAtomValue(wikiEnvironment.autosave.permissionAtom(environmentId));
  const readOnly = (file !== null && isSkillMapFile(file)) || settled || !canEdit;
  const unwritten = data !== null && !data.exists && !readOnly;

  const editor = useRef<WikiEditorHandle>(null);
  const theme = useEditorTheme();
  // Null until the person picks: a document not written yet opens ready to write.
  const [chosenMode, setMode] = useState<"read" | "edit" | null>(null);
  const mode = readOnly ? "read" : (chosenMode ?? (unwritten ? "edit" : "read"));
  const [changedUnderneath, setChangedUnderneath] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // What the page shows: sent on every new version, theme and mode, and resent from scratch
  // whenever the page (re)loads.
  const incoming = note.data?.source ?? null;
  const incomingCommit = note.data?.commit;
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
            commit: incomingCommit,
          },
    [incoming, incomingCommit, live, file, viewing, viewingTurn.runId, viewingTurn.running],
  );
  const shown = useRef({ receive, theme, mode });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest command, theme and mode for the initial commands a reloaded web view reads
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends each incoming command into the editor web view
  useEffect(() => {
    if (receive) editor.current?.send(receive);
  }, [receive]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends the theme into the editor web view as it changes
  useEffect(() => {
    editor.current?.send({ type: "theme", theme });
  }, [theme]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends the editing mode into the editor web view as it changes
  useEffect(() => {
    editor.current?.send({ type: "mode", mode });
  }, [mode]);

  // The buffer's text and the commit it agrees with, asked of the page when saving.
  const textRequests = useRef(
    new Map<number, (read: { text: string; commit: string | undefined }) => void>(),
  );
  const nextRequest = useRef(1);
  const requestText = () =>
    new Promise<{ text: string; commit: string | undefined }>((resolve) => {
      const requestId = nextRequest.current++;
      textRequests.current.set(requestId, resolve);
      editor.current?.send({ type: "requestText", requestId });
    });

  // The ```base blocks the page shows, run here where the connection is; answers are kept so a
  // reloaded page gets them again at once.
  const [baseSources, setBaseSources] = useState<ReadonlyArray<string>>([]);
  const baseAnswers = useRef(new Map<string, WikiBaseAnswer>());
  const onBaseAnswer = useCallback((source: string, answer: WikiBaseAnswer) => {
    baseAnswers.current.set(source, answer);
    editor.current?.send({ type: "baseResult", source, ...answer });
  }, []);

  const linkTypes = index.data?.linkTypes;
  const outsideDraft = changeRequestId === undefined ? draft : null;
  const documents = useMemo(
    () => (index.data ? wikiDocumentFilesWithDraft(index.data, outsideDraft) : null),
    [index.data, outsideDraft],
  );
  const linkedFiles = useMemo(() => (documents ? linkFiles(documents) : null), [documents]);
  const linkingFile = data?.file ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the wiki's types cross into the editor's web view, outside React
  useEffect(() => {
    if (!linkTypes || documents === null) return;
    editor.current?.send({
      type: "linkTypes",
      types: linkTypes,
      files: documents,
      ...(linkingFile === null ? {} : { from: linkingFile }),
    });
  }, [linkTypes, documents, linkingFile]);

  // The notes the page's link previews show, read here, as the blocks are.
  const [previewNames, setPreviewNames] = useState<ReadonlyArray<string>>([]);
  const onNoteRead = useCallback<WikiNoteReadsProps["onRead"]>((name, source, link) => {
    editor.current?.send({ type: "noteRead", name, source, link });
  }, []);

  // The canvases the note embeds, read here, and kept so a reloaded page gets them at once.
  const [embeddedPaths, setEmbeddedPaths] = useState<ReadonlyArray<string>>([]);
  const embeddedFiles = useRef(new Map<string, WikiEditorEmbeddedFile>());
  const onFileRead = useCallback((path: string, read: WikiEditorEmbeddedFile) => {
    embeddedFiles.current.set(path, read);
    editor.current?.send({ type: "fileRead", path, file: read });
  }, []);

  const mintUrl = useAtomQueryRunner(assetEnvironment.createUrl, QUIET_MINT);
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  /** An image the note embeds: found from the note, at the commit it reads. */
  const answerAsset = async (path: string) => {
    const revision = data?.commit;
    if (revision === undefined) return;
    const result = await mintUrl({
      environmentId,
      input: {
        resource: { _tag: "wiki-file", wikiId, commit: revision, path, from: file ?? requested },
      },
    });
    const state = assetUrlStateFromResult(result, httpBaseUrl);
    editor.current?.send({
      type: "assetRead",
      path,
      revision,
      url: state._tag === "Success" ? state.url : null,
      expiresAt: state._tag === "Success" ? state.expiresAt : 0,
    });
  };

  const onEvent = (event: WikiEditorEvent) => {
    switch (event.type) {
      case "readNote":
        setPreviewNames((names) => (names.includes(event.name) ? names : [...names, event.name]));
        return;
      case "readAsset":
        void answerAsset(event.path);
        return;
      case "readFile": {
        const known = embeddedFiles.current.get(event.path);
        if (known) editor.current?.send({ type: "fileRead", path: event.path, file: known });
        setEmbeddedPaths((paths) => (paths.includes(event.path) ? paths : [...paths, event.path]));
        return;
      }
      case "queryBase": {
        const known = baseAnswers.current.get(event.source);
        if (known) editor.current?.send({ type: "baseResult", source: event.source, ...known });
        setBaseSources((sources) =>
          sources.includes(event.source) ? sources : [...sources, event.source],
        );
        return;
      }
      case "state":
        setChangedUnderneath(event.changedUnderneath);
        return;
      case "edited":
        autosave.edited();
        return;
      case "openNote": {
        const name = wikiLinkOpens(
          index.data,
          event.name,
          event.from ?? file ?? requested,
          placement,
        );
        if (name === null) {
          Dialog.alert("No note made", NO_NOTE_FROM_RELATIVE_LINK);
          return;
        }
        navigation.dispatch(
          StackActions.push("WikiDocument", {
            environmentId: params.environmentId,
            wikiId: params.wikiId,
            name,
            ...(routeChangeRequestId === undefined
              ? {}
              : { changeRequestId: routeChangeRequestId }),
          }),
        );
        return;
      }
      case "openUrl":
        void Linking.openURL(event.href).catch(() => undefined);
        return;
      case "text":
        textRequests.current.get(event.requestId)?.({ text: event.text, commit: event.commit });
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

  const send = useWikiAutosaveCommand();
  const { autosave, status } = useWikiAutosave({
    subject: title,
    save: async () => {
      if (file === null) return { ok: true };
      const { text, commit } = await requestText();
      const outcome = await send({
        environmentId,
        input: {
          wikiId,
          ...(routeChangeRequestId === undefined ? {} : { changeRequestId: routeChangeRequestId }),
          document: file,
          write: {
            kind: "text",
            file,
            text,
            ...(commit === undefined ? {} : { readAt: commit }),
          },
        },
      });
      if (!outcome.ok) return outcome;
      editor.current?.send({
        type: "markSaved",
        text,
        ...(outcome.value.commit === null ? {} : { commit: outcome.value.commit }),
      });
      return { ok: true };
    },
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a running turn holds the autosave store, which lives outside React
  useEffect(() => autosave.setHeld(viewingTurn.running), [autosave, viewingTurn.running]);

  const subtitle = wikiDocumentSubtitle({
    wikiName: wiki?.name ?? null,
    file: requested,
    changeRequest: viewing ?? null,
    readsChangeRequest: changeRequestId !== undefined,
    agentWorking: viewingTurn.running,
    saving: wikiSaveLabel(status),
  });

  const header = (
    <NativeStackScreenOptions
      options={{ title, unstable_headerSubtitle: subtitle }}
      optionsVersion={`${subtitle}|${mode}|${readOnly}`}
    />
  );
  const toolbar =
    data === null || readOnly ? null : (
      // Direct children only: the toolbar reads its items by component, not through fragments.
      <Toolbar placement="right">
        <Toolbar.Button
          label={mode === "read" ? "Edit" : "Done"}
          variant={mode === "edit" ? "done" : "plain"}
          accessibilityLabel={mode === "read" ? "Edit the document" : "Stop editing"}
          onPress={() => {
            setMode(mode === "read" ? "edit" : "read");
            if (mode === "edit") void autosave.flush();
          }}
        />
      </Toolbar>
    );

  if (data === null) {
    return (
      <View className="flex-1 bg-screen">
        {header}
        {note.error !== null ? (
          <EmptyState title={`Couldn't open ${title}`} detail={note.error} />
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
      <WikiBelowHeader>
        {routeChangeRequestId === undefined || viewing?.draft ? (
          draft !== null ? (
            <WikiDraftBar
              environmentId={environmentId}
              draft={draft}
              changeRequests={all ?? []}
              flush={autosave.flush}
              drop={autosave.cancel}
              onLanded={(id, files) => {
                // The document on screen follows where its edits went.
                if (filesHoldDocument(files, requested)) {
                  navigation.setParams({ changeRequestId: id });
                }
              }}
            />
          ) : null
        ) : null}
        {pageError !== null ? (
          <WikiNotice text={`This document couldn't be shown: ${pageError}`} />
        ) : status.kind === "failed" ? (
          <WikiNotice
            text={`Your edits aren't saved. ${status.message}${status.retrying ? " Still trying." : ""}`}
            action="Try again"
            onAction={autosave.retry}
          />
        ) : status.kind === "waiting-for-turn" ? (
          <WikiNotice text="Your edit saves when the agent's turn ends." />
        ) : changedUnderneath ? (
          <WikiNotice
            text="This document changed while you were editing. Your edits are kept, and they save over it unless you load the new version."
            action="Load new version"
            onAction={() => editor.current?.send({ type: "loadChanged" })}
          />
        ) : !data.exists ? (
          <WikiNotice
            text={`No document is called ${title} yet. Write it, and it saves by itself.`}
          />
        ) : null}
      </WikiBelowHeader>
      <WikiEditorWebView ref={editor} onEvent={onEvent} initialCommands={initialCommands} />
      <WikiBaseQueries
        sources={baseSources}
        environmentId={environmentId}
        wikiId={wikiId}
        changeRequestId={changeRequestId}
        note={data.name}
        onAnswer={onBaseAnswer}
      />
      <WikiNoteReads
        names={previewNames}
        environmentId={environmentId}
        wikiId={wikiId}
        changeRequestId={changeRequestId}
        draft={draft}
        files={linkedFiles}
        from={data.file}
        onRead={onNoteRead}
      />
      <WikiFileReads
        paths={embeddedPaths}
        environmentId={environmentId}
        wikiId={wikiId}
        changeRequestId={changeRequestId}
        from={data.file}
        onRead={onFileRead}
      />
    </View>
  );
}
