import "@mercurian/editor/markdown/theme.css";
import "@mercurian/editor/code/theme.css";

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { codeLanguageFor, codeView, isMarkdownPath } from "@mercurian/editor/code";
import {
  codeEditing,
  hasCodeEditing,
  setSoftWrap,
  softWrapOn,
} from "@mercurian/editor/code/editing";
import { gitChanges, setGitBase } from "@mercurian/editor/git";
import { livePreview } from "@mercurian/editor/markdown";
import { outline, type OutlineItem } from "@mercurian/editor/outline";
import { diagnosticsUi } from "@mercurian/editor/lsp/diagnostics";
import { environmentCompletion } from "@mercurian/editor/lsp/completion";
import { environmentHover } from "@mercurian/editor/lsp/hover";
import { codeLens } from "@mercurian/editor/lsp/code-lens";
import { inlayHints } from "@mercurian/editor/lsp/inlay-hints";
import { linkedEditing } from "@mercurian/editor/lsp/linked-editing";
import { semanticTokens } from "@mercurian/editor/lsp/semantic-tokens";
import { symbolHighlights } from "@mercurian/editor/lsp/symbol-highlights";
import {
  environmentNavigation,
  type NavigationHost,
  type NavigationLocation,
  type PlacesKind,
} from "@mercurian/editor/lsp/navigation";
import {
  environmentRename,
  type RenameHost,
  type RenameResult,
} from "@mercurian/editor/lsp/rename";
import { environmentFormat, formattingOptions } from "@mercurian/editor/lsp/format";
import {
  type AppliedCodeAction,
  type CodeActionHost,
  environmentCodeActions,
} from "@mercurian/editor/lsp/code-actions";
import { fileSave } from "./fileSave";
import { languageServersEnvironment } from "~/state/languageServers";
import { searchableSetting } from "../settings/settingsSearch";
import { useAtomCommand } from "~/state/use-atom-command";
import { lastRename, undoableEdit } from "./renameUndo";
import { inFileSearch } from "@mercurian/editor/search";
import { runMarkers, setRunContext, type RunHost } from "@mercurian/editor/run";
import type { RunContext, RunTarget } from "@mercurian/editor/run/command";
import { runLanguageFor } from "@mercurian/editor/run/detect";
import { codeContextMenu, type CodeContextMenuHost } from "@mercurian/editor/lsp/context-menu";
import { readTextFromClipboard, writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";
import { vimMode, vimNormalModeFont } from "@mercurian/editor/vim";
import {
  AuthFilesystemWriteScope,
  AuthTerminalOperateScope,
  type ClientSettings,
  type LanguageServerId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, GitBranchIcon, WaypointsIcon, WrapTextIcon } from "lucide-react";
import { useAtomMount } from "@effect/atom-react";
import type {
  DocumentSession,
  DocumentSessionState,
} from "@t3tools/client-runtime/state/document-session";
import {
  lazy,
  type ReactNode,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  useCodeEditorKeys,
  useEditorDiagnosticKeys,
  useEditorFindKeys,
  useEditorHunkKeys,
  useFileSaveKeys,
  useLspEditorKeys,
} from "~/editorKeybindings";
import { useClientSettings } from "~/hooks/useSettings";
import { PanesHostContext } from "~/panes/panesHost";
import { useStableCallback } from "~/hooks/useStableCallback";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { vcsEnvironment, vcsStatusRevalidation } from "~/state/vcs";
import { useProject, useThreadShells } from "~/state/entities";
import { activateTab, allTabs, openTab } from "~/panes/arrangement";
import { recordJump, trackJumpCursor } from "~/panes/jumpHistory";
import { leafWithTab } from "~/panes/tree";
import { toastManager } from "../ui/toast";
import { openLocationPicker, pathOfUri } from "../outline/LocationPicker";
import { projectSymbolsOpener } from "../outline/ProjectSymbolPicker";
import { navigationList } from "./multibuffer/multibufferInputs";
import { locationsTabKey } from "./multibuffer/openMultibuffer";
import { useVimScreenLines } from "~/vimScreenLines";
import { appVimKeys } from "~/whichKey/doors";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { composerHistory } from "../composerCodeMirror/composerUndo";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { isTurnRunning } from "../wiki/wiki.logic";
import { registerUnsavedCheck } from "~/panes/unsavedEdits";
import { repositoryFileReveal, revealLine } from "./repositoryFileReveal";
import {
  diffBaseControl,
  openingDiffBase,
  pickDiffBase,
  type DiffBaseControl,
  type FileDiffBase,
} from "./fileDiffBase";
import { followImportLine, importLineExtension, importLineKey } from "./importLineHighlight";
import { fileEditorChanged, registerFileEditor } from "./openFileEditors";
import { openLocalGraph } from "./localGraph";
import { workspace } from "~/panes/workspace";
import { TabHeader } from "~/panes/TabHeader";
import { FileBreadcrumbs, type OutlineTrail } from "./FileBreadcrumbs";
import { repositoryTabKey, type CheckedOutRepositoryTab } from "./repositoryTabs";

type FileTab = Extract<CheckedOutRepositoryTab, { kind: "file" }>;
import { projectSettingsKey, registerLanguageServerFile } from "./languageServerFile";
import { LanguageServerStatusEntry } from "./LanguageServerStatus";
import { lastRunStarter, startRun } from "./runTabs";
import { useLanguageServer } from "./useLanguageServer";
import { useRepositoryDocument } from "./useRepositoryDocument";
import { fileView, type RenderedForm } from "./fileView";
import { FileOpenIn, RenderedFormToggle, useRenderedForm } from "./RepositoryFileHeader";

// The editor reads the app's theme tokens, as a wiki note does. Module-level: a new object would
// rebuild the editor's styles.
const FILE_EDITOR_THEME = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    "--atlas-md-font-mono": "var(--font-mono)",
    "--atlas-md-syntax-color": "var(--muted-foreground)",
    "--atlas-md-code-label-color": "var(--muted-foreground)",
    "--atlas-md-border-color": "var(--border)",
    "--atlas-md-code-bg": "color-mix(in oklab, var(--muted-foreground) 12%, transparent)",
    "--atlas-md-link-color": "var(--primary)",
    "--atlas-md-focus-ring": "var(--ring)",
    "--atlas-selection": "color-mix(in oklab, var(--ring) 30%, transparent)",
    "--atlas-selection-unfocused": "color-mix(in oklab, var(--muted-foreground) 20%, transparent)",
    "--atlas-caret": "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-code .cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "13px" },
  // The sidebar's resize handle overhangs a pane's first 8px: the change strips sit past it.
  "&.cm-code .cm-gutters": { paddingLeft: "8px" },
  ".cm-scroller": { lineHeight: "inherit" },
  // Clears the fade under the tab's header at rest.
  "&.cm-editor .cm-content": {
    padding: "var(--workspace-titlebar-scroll-fade-height) 16px 40vh",
    caretColor: "currentColor",
  },
  // A note reads as a wiki's document does: a measure wide, in the middle of the pane.
  "&.cm-editor:not(.cm-code) .cm-content": {
    maxWidth: "48rem",
    margin: "0 auto",
    padding: "24px 32px 40vh",
  },
  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)" },
  // The import a hovered local-graph node names.
  ".cm-import-line": { backgroundColor: "color-mix(in oklab, var(--primary) 16%, transparent)" },
});

const selectVimModeEnabled = (settings: ClientSettings) => settings.vimModeEnabled;
const selectWordWrap = (settings: ClientSettings) => settings.wordWrap;
const selectFormatOnSave = (settings: ClientSettings) => settings.formatOnSave;
const selectInlineDiagnostics = (settings: ClientSettings) => settings.inlineDiagnostics;
const selectSemanticTokens = (settings: ClientSettings) => settings.semanticTokens;
const selectCodeLens = (settings: ClientSettings) => settings.codeLens;
const selectRunMarkers = (settings: ClientSettings) => settings.runMarkers;
const selectInlayHintTypes = (settings: ClientSettings) =>
  settings.inlayHints && settings.inlayHintTypes;
const selectInlayHintParameters = (settings: ClientSettings) =>
  settings.inlayHints && settings.inlayHintParameters;

/**
 * A repository file in the wiki editor, as the environment's live document: it saves your edits
 * and sends everyone else's as they land. Without write access it is read only; files too big or
 * not text open read only from disk.
 */
export function RepositoryFileView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: FileTab;
}) {
  const { environmentId, cwd, path } = tab;
  const key = `${environmentId}\0${cwd}\0${path}`;
  const view = fileView(path);
  if (view.kind !== "text") {
    return (
      <Suspense fallback={<FileNotice>Opening…</FileNotice>}>
        <RepositoryFileViewer key={key} tab={tab} kind={view.kind} />
      </Suspense>
    );
  }
  // The view can be handed another tab: each file gets its own document session.
  return <RepositoryFile key={key} tabKey={tabKey} tab={tab} rendered={view.rendered} />;
}

// Viewers stay out of the bundle until a file needs one, as in the thread's file panel.
const RepositoryFileViewer = lazy(() => import("./RepositoryFileViewers"));
const RenderedFileView = lazy(() =>
  import("./RepositoryFileViewers").then((module) => ({ default: module.RenderedFileView })),
);
const WholeFileView = lazy(() =>
  import("./RepositoryFileViewers").then((module) => ({ default: module.WholeFileView })),
);

function RepositoryFile({
  tabKey,
  tab,
  rendered,
}: {
  readonly tabKey: string;
  readonly tab: FileTab;
  readonly rendered: RenderedForm | null;
}) {
  const { environmentId, cwd, path } = tab;
  const renderedForm = useRenderedForm(rendered, tabKey);
  const editorView = useRef<EditorView | null>(null);
  const canWrite = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const { session, state } = useRepositoryDocument(environmentId, cwd, path, canWrite);
  const failure = state.status === "failed" ? (state.failure?.reason ?? null) : null;
  const fromDisk = failure === "other";
  const file = useProjectFileQuery(environmentId, cwd, path, fromDisk);
  // Read whole as bytes: too big for a document, or not text.
  const whole =
    failure === "too-large" || (fromDisk && file.data?.truncated === true)
      ? "large"
      : failure === "not-text" || (fromDisk && file.readError?.failure === "binary_file")
        ? "binary"
        : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this tab's unsaved-edits check until unmount
  useEffect(() => registerUnsavedCheck(tabKey, () => session.getState().unsent), [tabKey, session]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- write access came back: sends the edits the session kept meanwhile
  useEffect(() => {
    if (canWrite) session.changed();
  }, [canWrite, session]);
  const reveal = useSyncExternalStore(repositoryFileReveal.subscribe, repositoryFileReveal.get);
  const wordWrap = useClientSettings(selectWordWrap);

  const contents = fromDisk ? (file.data?.contents ?? null) : session.text();
  const showsRendered = rendered !== null && renderedForm.shown;
  // A store read: the compiler keeps `session.text()` above as it was when the session was made.
  const sessionText = useSyncExternalStore(session.onVersion, () =>
    showsRendered && !fromDisk ? session.text() : null,
  );
  const renderedText = (fromDisk ? contents : sessionText) ?? "";
  const readOnly = !canWrite || fromDisk;
  // The panes this file is in, which its local graph opens beside it in.
  const panes = useContext(PanesHostContext)?.controller ?? workspace.store;
  const navigate = useNavigate();
  const openLogs = useStableCallback((server: LanguageServerId) => {
    const key = repositoryTabKey({ kind: "language-server-logs", environmentId, cwd, server });
    panes.update((arrangement) =>
      allTabs(arrangement).includes(key)
        ? activateTab(arrangement, key)
        : openTab(arrangement, key, leafWithTab(arrangement.root, tabKey)?.id),
    );
  });
  const openSettings = useStableCallback((server: LanguageServerId) => {
    const project = "projectId" in tab ? projectSettingsKey(environmentId, tab.projectId) : null;
    void navigate({
      to: "/settings/projects",
      search: project === null ? { server } : { project, server },
      hash: searchableSetting("project-language-servers").id,
    });
  });
  // A wiki's links and notes have their own rules, which Marksman would call broken.
  const wikiNote = "wikiId" in tab && isMarkdownPath(path);
  const languageServer = useLanguageServer(
    environmentId,
    cwd,
    path,
    wikiNote ? null : session,
    !fromDisk && state.status !== "failed",
    { openLogs, openSettings: "projectId" in tab ? openSettings : null },
  );
  const serverFile = fromDisk ? null : languageServer.file;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lets commands find this tab's server until unmount
  useEffect(
    () => (serverFile ? registerLanguageServerFile(tabKey, serverFile) : undefined),
    [tabKey, serverFile],
  );
  const canRun = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const runContextAtom =
    !fromDisk && canRun && runLanguageFor(path) !== null
      ? languageServersEnvironment.runContext({ environmentId, input: { cwd, path } })
      : null;
  const runContext = useEnvironmentQuery(runContextAtom).data;
  const serverState = `${languageServer.status?.state}\0${languageServer.status?.restricted}`;
  const readServerState = useRef(serverState);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- trust moves on the environment, and a server's status is how this file hears of it
  useEffect(() => {
    if (readServerState.current === serverState) return;
    readServerState.current = serverState;
    if (runContextAtom !== null) appAtomRegistry.refresh(runContextAtom);
  }, [runContextAtom, serverState]);
  const runInTerminal = useStableCallback(({ name, command, directory }: RunTarget) => {
    const run = { kind: "run", environmentId, cwd, directory, path, name, command } as const;
    void startRun(run, panes, tabKey);
  });
  const runLast = useStableCallback(() => lastRunStarter(panes)?.());
  const agentWorking = useAgentWorkingIn(tab);
  const bases = useBaseTexts(tab, !isMarkdownPath(path));
  const [choice, setChoice] = useState<FileDiffBase | null>(null);
  // What the file opens on, decided again only when another turn's start becomes the base.
  const turnKey = bases.turn ? `${bases.turn.turn?.threadId}\0${bases.turn.hash}` : null;
  const [opening, setOpening] = useState<{ readonly key: string; readonly base: FileDiffBase }>();
  if (bases.turn && turnKey !== null && contents !== null && opening?.key !== turnKey) {
    setOpening({ key: turnKey, base: openingDiffBase(bases.turn, contents) });
  }
  const diffBase = pickDiffBase(
    choice,
    bases.turn,
    opening?.key === turnKey ? opening.base : undefined,
  );
  const baseText =
    diffBase === "turn" ? bases.turn?.text : diffBase === "head" ? bases.head : undefined;
  const turnAvailable = bases.turn != null;
  const currentBase = useStableCallback(() => ({ base: diffBase ?? "head", turnAvailable }));
  const toggleBase = useStableCallback(() => {
    if (turnAvailable) setChoice(diffBase === "turn" ? "head" : "turn");
  });
  const baseControl = { current: currentBase, toggle: toggleBase };
  const [trail, setTrail] = useState<OutlineTrail | null>(null);
  // A definition in another file of the checkout opens as a tab in this file's pane.
  const openLocation = useStableCallback((location: NavigationLocation) => {
    const target = pathOfUri(location.uri, cwd);
    if (target.startsWith("/") || target.includes("://")) {
      toastManager.add({ type: "info", title: "Outside this checkout", description: target });
      return;
    }
    const key = repositoryTabKey({ ...tab, path: target });
    recordJump(tabKey, key);
    panes.update((arrangement) =>
      allTabs(arrangement).includes(key)
        ? activateTab(arrangement, key)
        : openTab(arrangement, key, leafWithTab(arrangement.root, tabKey)?.id),
    );
    repositoryFileReveal.request(key, location.line, location.column);
  });
  // References and implementations open as one editor of excerpts beside this file.
  const pickLocation = useStableCallback(
    (
      view: EditorView,
      title: string,
      locations: readonly NavigationLocation[],
      kind: PlacesKind,
    ) => {
      const list = navigationList(kind, title, locations, (uri) => pathOfUri(uri, cwd));
      // A places tab is a project's; a wiki's file picks from a list instead.
      if (list === null || !("projectId" in tab)) {
        return openLocationPicker(view, title, locations, cwd);
      }
      const key = locationsTabKey(tab, list);
      recordJump(tabKey, key);
      panes.update((arrangement) =>
        openTab(arrangement, key, leafWithTab(arrangement.root, tabKey)?.id),
      );
    },
  );
  const [navigation] = useState<NavigationHost>(() => ({
    open: openLocation,
    pick: pickLocation,
    jumping: () => recordJump(tabKey, tabKey),
    projectSymbols: () => projectSymbolsOpener(panes)?.(),
    nothing: (title) =>
      toastManager.add({
        type: "info",
        title: `No ${title.charAt(0).toLowerCase()}${title.slice(1)}`,
      }),
  }));
  const showGraph = useStableCallback(() => {
    if ("projectId" in tab) panes.update((arrangement) => openLocalGraph(arrangement, tab));
  });
  const [contextMenu] = useState<CodeContextMenuHost>(() => ({
    show: async (entries, at) => (await readLocalApi()?.contextMenu.show(entries, at)) ?? null,
    readClipboard: () => readTextFromClipboard(),
    writeClipboard: async (text) => void (await writeTextToClipboard(text)),
    fileEntries: [
      {
        label: "Copy Relative Path",
        run: () => void writeTextToClipboard(path).catch(() => undefined),
      },
      // The code index, and so a local graph, is a project's.
      ...("projectId" in tab ? [{ label: "Open Local Graph", run: showGraph }] : []),
    ],
  }));
  const undoEdit = useAtomCommand(languageServersEnvironment.undoEdit, "undo rename");
  // An edit the environment applied for the language server (a rename, a code action): its
  // changed places with one Undo where a project's file can show them, else a notice with Undo.
  const offerUndo = useStableCallback(
    (
      title: string,
      result: AppliedCodeAction | RenameResult,
      labels: { readonly undo: string; readonly command: string },
      review: boolean,
    ) => {
      const files = result.files.length;
      const undo = undoableEdit(labels.command, () =>
        undoEdit({ environmentId, input: { id: result.id } }).then((outcome) => {
          if (outcome._tag !== "Success") return null;
          if (outcome.value.skipped.length > 0) {
            toastManager.add({
              type: "warning",
              title: "Some files changed since, and were left as they are",
              description: outcome.value.skipped.join(", "),
            });
          }
          return outcome.value;
        }),
      );
      lastRename.set(undo);
      if (review && "projectId" in tab && result.places.length > 0) {
        const key = locationsTabKey(tab, {
          title,
          locations: result.places,
          edit: { edits: result.edits, files, undoLabel: labels.undo, undo },
        });
        recordJump(tabKey, key);
        panes.update((arrangement) =>
          openTab(arrangement, key, leafWithTab(arrangement.root, tabKey)?.id),
        );
        return;
      }
      const toast = toastManager.add({
        type: "success",
        title,
        description: `${result.edits} ${result.edits === 1 ? "place" : "places"} in ${files} ${files === 1 ? "file" : "files"}`,
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toast);
            undo.run();
          },
        },
      });
    },
  );
  const renamed = useStableCallback((_view: EditorView, result: RenameResult) =>
    offerUndo(
      `Renamed ${result.from} to ${result.to}`,
      result,
      { undo: "Undo rename", command: `Undo rename of ${result.from} to ${result.to}` },
      true,
    ),
  );
  const [rename] = useState<RenameHost>(() => ({ renamed }));
  const appliedAction = useStableCallback((_view: EditorView, action: AppliedCodeAction) =>
    offerUndo(
      action.title,
      action,
      { undo: "Undo", command: `Undo ${action.title}` },
      action.files.length > 1,
    ),
  );
  const [codeActions] = useState<CodeActionHost>(() => ({ applied: appliedAction }));
  const [run] = useState<RunHost>(() => ({
    path,
    checkout: cwd,
    run: runInTerminal,
    runLast,
    copy: (command) => void writeTextToClipboard(command).catch(() => undefined),
    menu: contextMenu.show,
  }));

  // A file read whole shows below the header.
  if (whole === null) {
    if (fromDisk) {
      if (file.error !== null && file.data === null) return <FileNotice>{file.error}</FileNotice>;
      if (file.data === null) return <FileNotice>Opening…</FileNotice>;
    } else if (state.status === "failed") {
      return <FileNotice>{state.failure?.message ?? "This file cannot be opened."}</FileNotice>;
    } else if (state.status === "closed") {
      return <FileNotice>This file was deleted.</FileNotice>;
    } else if (state.status === "opening") {
      return <FileNotice>Opening…</FileNotice>;
    }
  }
  const serverStatus =
    fromDisk || whole !== null ? null : (
      <LanguageServerStatusEntry
        file={languageServer.file}
        status={languageServer.status}
        servers={languageServer.servers}
      />
    );
  return (
    <div className="@container/file flex min-h-0 flex-1 flex-col">
      <TabHeader.Root>
        <FileBreadcrumbs path={path} trail={trail} />
        <TabHeader.Status className="font-mono @max-[36rem]/file:hidden">
          <GitBranchIcon className="size-3.5" />
          {tab.checkoutName}
        </TabHeader.Status>
        {turnAvailable && whole === null ? (
          <ToggleGroup
            aria-label="Compare changes with"
            className="shrink-0 @max-[26rem]/file:hidden"
            value={diffBase === undefined ? [] : [diffBase]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "head" || next === "turn") setChoice(next);
            }}
          >
            <Toggle value="head" title="Changes since the last commit">
              HEAD
            </Toggle>
            <Toggle value="turn" title="Changes since the latest turn that changed this file">
              This turn
            </Toggle>
          </ToggleGroup>
        ) : null}
        {agentWorking ? (
          <TabHeader.Status className="text-info-foreground @max-[36rem]/file:hidden">
            <BotIcon className="size-3.5" />
            An agent is working in this checkout
          </TabHeader.Status>
        ) : null}
        <span className="contents @max-[48rem]/file:hidden">{serverStatus}</span>
        <TabHeader.Status>
          {whole !== null || readOnly ? "Read only" : documentStatusLabel(state)}
        </TabHeader.Status>
        <TabHeader.Actions>
          {rendered && whole === null ? (
            <RenderedFormToggle
              form={rendered}
              shown={renderedForm.shown}
              onToggle={renderedForm.toggle}
            />
          ) : null}
          {renderedForm.shown || isMarkdownPath(path) || whole !== null ? null : (
            <TabHeader.Action
              label="Toggle word wrap"
              onClick={() => {
                const view = editorView.current;
                if (view) setSoftWrap(view, !softWrapOn(view.state));
              }}
            >
              <WrapTextIcon />
            </TabHeader.Action>
          )}
          <FileOpenIn environmentId={environmentId} cwd={cwd} path={path} />
          {"projectId" in tab ? (
            <span className="contents @max-[26rem]/file:hidden">
              <TabHeader.Action label="Open local graph" onClick={showGraph}>
                <WaypointsIcon />
              </TabHeader.Action>
            </span>
          ) : null}
        </TabHeader.Actions>
      </TabHeader.Root>
      {/* Too wide for a narrow pane's header, where it would push the actions out of view. */}
      <div className="hidden shrink-0 px-(--workspace-gutter-start) pb-1 *:shrink *:flex-wrap @max-[48rem]/file:not-empty:flex">
        {serverStatus}
      </div>
      {!canWrite && state.unsent ? (
        <NoticeBar message="Read-only connection. Your unsaved edits are kept until write access returns." />
      ) : fromDisk || readOnly || whole !== null ? null : (
        <DocumentNotice state={state} session={session} onClosed={() => workspace.close(tabKey)} />
      )}
      {renderedForm.shown && rendered && whole === null ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense fallback={<FileNotice>Opening…</FileNotice>}>
            <RenderedFileView target={tab} form={rendered} contents={renderedText} />
          </Suspense>
        </div>
      ) : null}
      {whole !== null ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense fallback={<FileNotice>Opening…</FileNotice>}>
            <WholeFileView
              target={tab}
              whole={whole}
              reveal={reveal?.tabKey === tabKey ? reveal : null}
              wordWrap={wordWrap}
            />
          </Suspense>
        </div>
      ) : (
        // Kept while the rendered form shows, so the editor's undo and place stay.
        <div className={renderedForm.shown ? "hidden" : "min-h-0 flex-1 overflow-hidden"}>
          <FileEditor
            onView={(view) => {
              editorView.current = view;
            }}
            tabKey={tabKey}
            checkout={tab}
            file={importLineKey(tab)}
            path={path}
            source={fromDisk ? { contents: contents ?? "" } : { session }}
            languageServer={fromDisk ? null : languageServer.extension}
            navigation={navigation}
            contextMenu={contextMenu}
            rename={rename}
            codeActions={codeActions}
            run={run}
            runContext={runContext?.trusted ? runContext : null}
            readOnly={readOnly}
            baseText={baseText}
            baseControl={baseControl}
            onOutlinePath={(next, view) => setTrail({ path: next, view })}
          />
        </div>
      )}
    </div>
  );
}

function documentStatusLabel(state: DocumentSessionState): string {
  if (state.status === "conflict" || state.status === "recovering") return "Not saved";
  if (state.missing) return state.unsaved ? "Deleted, not saved" : "Deleted";
  return state.unsaved ? "Saving…" : "Saved";
}

/** What needs a decision: a deleted file, edits the environment refused, a failed push. */
function DocumentNotice({
  state,
  session,
  onClosed,
}: {
  readonly state: DocumentSessionState;
  readonly session: DocumentSession;
  readonly onClosed: () => void;
}) {
  if (state.status === "conflict") {
    return (
      <NoticeBar
        message={`This file changed while your edits were offline, so they were not applied. Your text is kept here.${
          state.failure ? ` ${state.failure.message}` : ""
        }`}
      >
        <Button size="xs" variant="outline" onClick={() => session.keepMine()}>
          Keep mine
        </Button>
        <Button size="xs" variant="ghost" onClick={() => session.takeTheirs()}>
          Use the file’s
        </Button>
      </NoticeBar>
    );
  }
  if (state.status === "recovering") {
    return <NoticeBar message="Sending your offline edits…" />;
  }
  if (state.missing) {
    return (
      <NoticeBar
        message={
          state.unsaved
            ? "This file was deleted. Save to recreate it, or discard."
            : "This file was deleted. Save to recreate it."
        }
      >
        <Button size="xs" variant="outline" onClick={() => void session.save()}>
          Save
        </Button>
        {state.unsaved ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              void session.discard().then((result) => {
                if (result?.ok) onClosed();
              });
            }}
          >
            Discard
          </Button>
        ) : null}
      </NoticeBar>
    );
  }
  if (state.failure !== null) return <NoticeBar message={state.failure.message} />;
  return null;
}

function NoticeBar({
  message,
  children,
}: {
  readonly message: string;
  readonly children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-warning-surface px-3 py-1.5 text-xs text-warning-foreground"
    >
      <span className="min-w-0 flex-1">{message}</span>
      {children}
    </div>
  );
}

function FileNotice({ children }: { readonly children: string }) {
  return (
    <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * The CodeMirror view. Built once per file; what changes later goes through compartments: Vim,
 * the editor's keys, the file's language once it loads, read-only, and wrapping (code follows the
 * word wrap setting, notes always wrap). A document's edits from elsewhere arrive through its
 * session and stay out of undo.
 */
function FileEditor({
  onView,
  tabKey,
  checkout,
  file,
  path,
  source,
  languageServer,
  navigation,
  contextMenu,
  rename,
  codeActions,
  run,
  runContext,
  readOnly,
  baseText,
  baseControl,
  onOutlinePath,
}: {
  /** Told of the CodeMirror view when it is built and gone, for the tab's header. */
  readonly onView: (view: EditorView | null) => void;
  readonly tabKey: string;
  /** Where the file is, for edits made to many files at once (`openFileEditors`). */
  readonly checkout: Pick<FileTab, "environmentId" | "cwd">;
  /** The file as the import-line highlight names it (`importLineKey`). */
  readonly file: string;
  readonly path: string;
  /** The live document, or a file read once from disk (read only). */
  readonly source: { readonly session: DocumentSession } | { readonly contents: string };
  /** The file's language server client, when one reads it. */
  readonly languageServer: Extension | null;
  /** Where its definitions and references open. */
  readonly navigation: NavigationHost;
  /** What a code file's right-click menu shows and runs beyond the editor's own. */
  readonly contextMenu: CodeContextMenuHost;
  /** Told of each rename the environment applied. */
  readonly rename: RenameHost;
  /** Told of each code action the environment applied. */
  readonly codeActions: CodeActionHost;
  /** Where its run markers run things. */
  readonly run: RunHost;
  /** What running here is built from; null while nothing may run. */
  readonly runContext: RunContext | null;
  readonly readOnly: boolean;
  /** The text the changes are marked against; null for none, undefined while loading. */
  readonly baseText: string | null | undefined;
  readonly baseControl: DiffBaseControl;
  /** The outline items around the cursor, whenever they change (the header's breadcrumbs). */
  readonly onOutlinePath: (path: readonly OutlineItem[], view: EditorView) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimRef = useRef<(() => Extension) | null>(null);
  const outlinePath = useStableCallback(onOutlinePath);
  const vim = useClientSettings(selectVimModeEnabled);
  useVimScreenLines();
  const findKeys = useEditorFindKeys();
  const hunkKeys = useEditorHunkKeys();
  const editingKeys = useCodeEditorKeys();
  const diagnosticKeys = useEditorDiagnosticKeys();
  const lspKeys = useLspEditorKeys();
  const saveKeys = useFileSaveKeys();
  const wordWrap = useClientSettings(selectWordWrap);
  const formatOnSave = useClientSettings(selectFormatOnSave);
  const hintTypes = useClientSettings(selectInlayHintTypes);
  const hintParameters = useClientSettings(selectInlayHintParameters);
  const inlineDiagnostics = useClientSettings(selectInlineDiagnostics);
  const semanticColours = useClientSettings(selectSemanticTokens);
  const lenses = useClientSettings(selectCodeLens);
  const markers = useClientSettings(selectRunMarkers);
  // The save you ask for (mod+s, `:w`): a code file with a language server is formatted first.
  const save = useStableCallback(() => {
    const view = viewRef.current;
    if (!view || !("session" in source) || view.state.readOnly) return;
    const format = formatOnSave && languageServer ? formattingOptions(view.state) : undefined;
    void source.session.save(format ? { format } : {});
  });
  const reveal = useSyncExternalStore(repositoryFileReveal.subscribe, repositoryFileReveal.get);
  const revealHere = reveal?.tabKey === tabKey ? reveal : null;
  const [compartments] = useState(() => ({
    vim: new Compartment(),
    keys: new Compartment(),
    language: new Compartment(),
    readOnly: new Compartment(),
    server: new Compartment(),
    run: new Compartment(),
  }));
  // The view is built from the file as it first shows (the parent keys it by path).
  const [initial] = useState(() => ({
    onView,
    tabKey,
    environmentId: checkout.environmentId,
    cwd: checkout.cwd,
    file,
    path,
    source,
    languageServer,
    navigation,
    contextMenu,
    rename,
    codeActions,
    run,
    markers,
    readOnly,
    vim,
    wordWrap,
    baseControl,
    outlinePath,
    save,
  }));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- creates the CodeMirror file editor in the host DOM node and destroys it on unmount
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const markdown = isMarkdownPath(initial.path);
    const session = "session" in initial.source ? initial.source.session : null;
    const document = session?.initialState() ?? null;
    const history = composerHistory(() => viewRef.current!);
    const vimExtension = (): Extension => [
      vimMode(history.vim, { panel: false }),
      vimNormalModeFont,
    ];
    vimRef.current = vimExtension;
    const view = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: document?.text ?? ("contents" in initial.source ? initial.source.contents : ""),
        extensions: [
          FILE_EDITOR_THEME,
          history.extension,
          document?.extension ?? [],
          compartments.vim.of(initial.vim ? vimExtension() : []),
          session ? fileSave.of(initial.save) : [],
          appVimKeys((target) =>
            session && !target.state.readOnly
              ? { label: "Save the file", run: initial.save }
              : null,
          ),
          compartments.keys.of([]),
          markdown ? [] : diffBaseControl.of(initial.baseControl),
          markdown ? livePreview() : [codeView(), codeContextMenu(initial.contextMenu)],
          compartments.run.of(
            session ? runMarkers({ host: initial.run, markers: initial.markers }) : [],
          ),
          compartments.language.of([]),
          compartments.readOnly.of(readOnlyExtension(initial.readOnly)),
          outline({ onPath: initial.outlinePath }),
          importLineExtension,
          compartments.server.of(initial.languageServer ?? []),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            session?.changed();
            fileEditorChanged(update.view, update.changes);
          }),
        ],
      }),
    });
    viewRef.current = view;
    initial.onView(view);
    session?.attach(view);
    const unregister = registerFileEditor({
      environmentId: initial.environmentId,
      cwd: initial.cwd,
      path: initial.path,
      view,
      writable: () =>
        session !== null && session.getState().status === "open" && !view.state.readOnly,
      save: async () => {
        if (!session?.getState().unsaved) return true;
        return (await session.save())?.ok === true;
      },
    });
    const stopCursor = trackJumpCursor(initial.tabKey, () => {
      const { head } = view.state.selection.main;
      const line = view.state.doc.lineAt(head);
      return { line: line.number, column: head - line.from + 1 };
    });
    const stopLighting = followImportLine(view, initial.file);
    let cancelled = false;
    const language = markdown ? null : codeLanguageFor(initial.path);
    if (language) {
      void language.load().then((support) => {
        if (!cancelled) view.dispatch({ effects: compartments.language.reconfigure(support) });
      });
    }
    return () => {
      cancelled = true;
      unregister();
      stopCursor();
      stopLighting();
      session?.detach();
      view.destroy();
      viewRef.current = null;
      initial.onView(null);
    };
  }, [compartments, initial]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- turns Vim mode on or off in the CodeMirror view
  useEffect(() => {
    const view = viewRef.current;
    const vimExtension = vimRef.current;
    if (!view || !vimExtension) return;
    view.dispatch({ effects: compartments.vim.reconfigure(vim ? vimExtension() : []) });
  }, [compartments, vim]);

  const runnable = "session" in initial.source;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- turns the run markers' column on or off in the CodeMirror view
  useEffect(() => {
    if (!runnable) return;
    viewRef.current?.dispatch({
      effects: compartments.run.reconfigure(runMarkers({ host: initial.run, markers })),
    });
  }, [compartments, initial, markers, runnable]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the CodeMirror view what the environment says of running here
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setRunContext.of(runContext) });
  }, [runContext]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the CodeMirror view to the client of the server settings put on this file
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || (compartments.server.get(view.state) ?? null) === languageServer) return;
    view.dispatch({ effects: compartments.server.reconfigure(languageServer ?? []) });
  }, [compartments, languageServer]);

  const serverUi = languageServer !== null;
  // The find bar's, change, editing and save keys follow the keybindings; wrapping, folds, the find bar
  // and shown changes stay.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- carries rebound keys into the CodeMirror view
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const wrap = hasCodeEditing(view.state)
      ? softWrapOn(view.state)
      : isMarkdownPath(initial.path) || initial.wordWrap;
    view.dispatch({
      effects: compartments.keys.reconfigure([
        // Ahead of the default keymap (in `codeEditing`), so a find key it also binds opens the bar.
        inFileSearch({ keys: findKeys }),
        isMarkdownPath(initial.path) ? [] : gitChanges({ keys: hunkKeys }),
        codeEditing({ keys: editingKeys, softWrap: wrap }),
        serverUi
          ? languageServerUi(lspKeys, diagnosticKeys, initial, {
              hintTypes,
              hintParameters,
              inlineDiagnostics,
              semanticColours,
              lenses,
            })
          : [],
        "session" in initial.source
          ? keymap.of(
              saveKeys.map((key) => ({
                key,
                run: () => {
                  initial.save();
                  return true;
                },
              })),
            )
          : [],
      ]),
    });
  }, [
    compartments,
    initial,
    serverUi,
    findKeys,
    hunkKeys,
    editingKeys,
    diagnosticKeys,
    lspKeys,
    saveKeys,
    hintTypes,
    hintParameters,
    inlineDiagnostics,
    semanticColours,
    lenses,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies the read-only state to the CodeMirror view
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.readOnly.reconfigure(readOnlyExtension(readOnly)),
    });
  }, [compartments, readOnly]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the server's base text to CodeMirror
  useEffect(() => {
    if (baseText !== undefined) viewRef.current?.dispatch({ effects: setGitBase(baseText) });
  }, [baseText]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the CodeMirror view to the line project search asked for
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !revealHere) return;
    view.dispatch(revealLine(view.state, revealHere.line, revealHere.column));
    view.focus();
    repositoryFileReveal.done(revealHere.id);
  }, [revealHere]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- carries the word wrap setting into the CodeMirror view
  useEffect(() => {
    const view = viewRef.current;
    if (view && !isMarkdownPath(initial.path)) setSoftWrap(view, wordWrap);
  }, [initial, wordWrap]);

  return (
    <div
      ref={host}
      className="h-full min-h-0 overflow-hidden text-sm leading-relaxed text-foreground [&_.cm-scroller]:topbar-scroll-fade"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    />
  );
}

/** What a code file with a language server shows and binds, under the keybindings' keys. */
function languageServerUi(
  keys: ReturnType<typeof useLspEditorKeys>,
  diagnosticKeys: ReturnType<typeof useEditorDiagnosticKeys>,
  hosts: {
    readonly navigation: NavigationHost;
    readonly rename: RenameHost;
    readonly codeActions: CodeActionHost;
  },
  shown: {
    readonly hintTypes: boolean;
    readonly hintParameters: boolean;
    readonly inlineDiagnostics: boolean;
    readonly semanticColours: boolean;
    readonly lenses: boolean;
  },
): Extension {
  return [
    diagnosticsUi({ keys: diagnosticKeys, inline: shown.inlineDiagnostics }),
    shown.hintTypes || shown.hintParameters
      ? inlayHints({ types: shown.hintTypes, parameters: shown.hintParameters })
      : [],
    symbolHighlights(),
    linkedEditing(),
    shown.semanticColours ? semanticTokens() : [],
    shown.lenses ? codeLens() : [],
    environmentCompletion({ keys: { complete: keys["lsp.complete"] } }),
    environmentHover({
      keys: { hover: keys["lsp.hover"], signatureHelp: keys["lsp.signatureHelp"] },
    }),
    environmentNavigation({
      keys: {
        definition: keys["lsp.definition"],
        declaration: keys["lsp.declaration"],
        typeDefinition: keys["lsp.typeDefinition"],
        implementation: keys["lsp.implementation"],
        references: keys["lsp.references"],
        incomingCalls: keys["lsp.incomingCalls"],
        outgoingCalls: keys["lsp.outgoingCalls"],
      },
      host: hosts.navigation,
    }),
    environmentRename({ keys: keys["lsp.rename"], host: hosts.rename }),
    environmentFormat({ keys: keys["lsp.format"] }),
    environmentCodeActions({ keys: keys["lsp.codeActions"], host: hosts.codeActions }),
  ];
}

function readOnlyExtension(readOnly: boolean) {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}

/**
 * A code file's base texts, kept current: its committed text as commits and checkouts change it
 * (the checkout's status is read again when the window comes back), and the turn base as turns
 * in the checkout run. Undefined while they load or when not wanted.
 */
function useBaseTexts(tab: FileTab, wanted: boolean) {
  const { environmentId, cwd, path } = tab;
  useAtomMount(vcsStatusRevalidation(wanted ? { environmentId, cwd } : null));
  const head = useEnvironmentQuery(
    wanted ? vcsEnvironment.baseText({ environmentId, input: { cwd, path, base: "head" } }) : null,
  );
  const turn = useEnvironmentQuery(
    wanted ? vcsEnvironment.baseText({ environmentId, input: { cwd, path, base: "turn" } }) : null,
  );
  return {
    head: head.isSuccess ? (head.data?.text ?? null) : undefined,
    // A turn base that cannot load (an older server) leaves the file on HEAD.
    turn: turn.isSuccess ? turn.data : turn.error === null ? undefined : null,
  };
}

/** Whether a thread's agent is mid-turn in the tab's checkout. */
function useAgentWorkingIn(tab: FileTab): boolean {
  // No thread runs in a wiki.
  const projectId = "projectId" in tab ? tab.projectId : null;
  const project = useProject(
    projectId === null ? null : { environmentId: tab.environmentId, projectId },
  );
  const threads = useThreadShells();
  return threads.some(
    (thread) =>
      thread.environmentId === tab.environmentId &&
      thread.projectId === projectId &&
      (thread.worktreePath ?? project?.workspaceRoot) === tab.cwd &&
      isTurnRunning(thread.source.status),
  );
}
