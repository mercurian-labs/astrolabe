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
import {
  environmentNavigation,
  type NavigationHost,
  type NavigationLocation,
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
import { useAtomCommand } from "~/state/use-atom-command";
import { lastRename, type UndoableRename } from "./renameUndo";
import { inFileSearch } from "@mercurian/editor/search";
import { vimMode, vimNormalModeFont } from "@mercurian/editor/vim";
import { AuthFilesystemWriteScope, type ClientSettings } from "@t3tools/contracts";
import { BotIcon, WaypointsIcon } from "lucide-react";
import { useAtomMount } from "@effect/atom-react";
import type {
  DocumentSession,
  DocumentSessionState,
} from "@t3tools/client-runtime/state/document-session";
import {
  type ReactNode,
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
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { vcsEnvironment, vcsStatusRevalidation } from "~/state/vcs";
import { useProject, useThreadShells } from "~/state/entities";
import { activateTab, allTabs, openTab } from "~/panes/arrangement";
import { leafWithTab } from "~/panes/tree";
import { toastManager } from "../ui/toast";
import { openLocationPicker, pathOfUri } from "../outline/LocationPicker";
import { useVimScreenLines } from "~/vimScreenLines";
import { appVimKeys } from "~/whichKey/doors";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { composerHistory } from "../composerCodeMirror/composerUndo";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { isTurnRunning } from "../wiki/wiki.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { registerUnsavedCheck } from "../wiki/wikiPanes";
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
import { repositoryPanes } from "./repositoryPanes";
import { FileBreadcrumbs, type OutlineTrail } from "./FileBreadcrumbs";
import { repositoryTabKey, type RepositoryFileTab as FileTab } from "./repositoryTabs";
import { LanguageServerStatusEntry } from "./LanguageServerStatus";
import { useLanguageServer } from "./useLanguageServer";
import { useRepositoryDocument } from "./useRepositoryDocument";

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
  "&.cm-editor .cm-content": { padding: "12px 16px 40vh", caretColor: "currentColor" },
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
  // The view can be handed another tab: each file gets its own document session.
  return <RepositoryFile key={`${environmentId}\0${cwd}\0${path}`} tabKey={tabKey} tab={tab} />;
}

// Files these failures leave out open read only from disk, as before documents.
const READ_FROM_DISK = new Set(["too-large", "not-text", "other"]);

function RepositoryFile({ tabKey, tab }: { readonly tabKey: string; readonly tab: FileTab }) {
  const { environmentId, cwd, path } = tab;
  const canWrite = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const { session, state } = useRepositoryDocument(environmentId, cwd, path, canWrite);
  const fromDisk =
    state.status === "failed" && state.failure !== null && READ_FROM_DISK.has(state.failure.reason);
  const file = useProjectFileQuery(environmentId, cwd, path, fromDisk);
  useEffect(() => registerUnsavedCheck(tabKey, () => session.getState().unsent), [tabKey, session]);

  const contents = fromDisk ? (file.data?.contents ?? null) : session.text();
  const readOnly = !canWrite || fromDisk;
  const languageServer = useLanguageServer(
    environmentId,
    cwd,
    path,
    session,
    !fromDisk && state.status !== "failed",
  );
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
  // The panes this file is in, which its local graph opens beside it in.
  const panes = useContext(PanesHostContext)?.controller ?? repositoryPanes.store;
  // A definition in another file of the checkout opens as a tab in this file's pane.
  const openLocation = useStableCallback((location: NavigationLocation) => {
    const target = pathOfUri(location.uri, cwd);
    if (target.startsWith("/") || target.includes("://")) {
      toastManager.add({ type: "info", title: "Outside this checkout", description: target });
      return;
    }
    const key = repositoryTabKey({ ...tab, path: target });
    panes.update((arrangement) =>
      allTabs(arrangement).includes(key)
        ? activateTab(arrangement, key)
        : openTab(arrangement, key, leafWithTab(arrangement.root, tabKey)?.id),
    );
    repositoryFileReveal.request(key, location.line, location.column);
  });
  const pickLocation = useStableCallback(
    (view: EditorView, title: string, locations: readonly NavigationLocation[]) =>
      openLocationPicker(view, title, locations, cwd),
  );
  const [navigation] = useState<NavigationHost>(() => ({
    open: openLocation,
    pick: pickLocation,
  }));
  const undoEdit = useAtomCommand(languageServersEnvironment.undoEdit, "undo rename");
  // The environment applied the rename to every file: it offers Undo here, and to Undo Rename.
  // An edit the environment applied for the language server (a rename, a code action): a notice
  // with Undo, which Undo Rename runs too while it is the last.
  const offerUndo = useStableCallback(
    (title: string, result: AppliedCodeAction | RenameResult, undoLabel: string) => {
      const files = result.files.length;
      let done = false;
      const undo: UndoableRename = {
        label: undoLabel,
        run: () => {
          if (done) return;
          done = true;
          if (lastRename.get() === undo) lastRename.set(null);
          void undoEdit({ environmentId, input: { id: result.id } }).then((outcome) => {
            if (outcome._tag !== "Success" || outcome.value.skipped.length === 0) return;
            toastManager.add({
              type: "warning",
              title: "Some files changed since, and were left as they are",
              description: outcome.value.skipped.join(", "),
            });
          });
        },
      };
      lastRename.set(undo);
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
      `Undo rename of ${result.from} to ${result.to}`,
    ),
  );
  const [rename] = useState<RenameHost>(() => ({ renamed }));
  const appliedAction = useStableCallback((_view: EditorView, action: AppliedCodeAction) =>
    offerUndo(action.title, action, `Undo ${action.title}`),
  );
  const [codeActions] = useState<CodeActionHost>(() => ({ applied: appliedAction }));

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
  const tooBig =
    fromDisk && (file.data?.truncated === true || state.failure?.reason === "too-large");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <FileBreadcrumbs path={path} trail={trail} />
        {turnAvailable ? (
          <ToggleGroup
            aria-label="Compare changes with"
            className="shrink-0"
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
          <span className="flex shrink-0 items-center gap-1 text-info-foreground">
            <BotIcon className="size-3.5" />
            An agent is working in this checkout
          </span>
        ) : null}
        {fromDisk ? null : (
          <LanguageServerStatusEntry environmentId={environmentId} status={languageServer.status} />
        )}
        <span className="shrink-0">
          {readOnly ? (tooBig ? "Too big to edit here" : "Read only") : documentStatusLabel(state)}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Open local graph"
                className="shrink-0"
                size="icon-xs"
                variant="ghost-muted"
                onClick={() => panes.update((arrangement) => openLocalGraph(arrangement, tab))}
              />
            }
          >
            <WaypointsIcon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Open local graph</TooltipPopup>
        </Tooltip>
      </div>
      {fromDisk || readOnly ? null : (
        <DocumentNotice
          state={state}
          session={session}
          onClosed={() => repositoryPanes.close(tabKey)}
        />
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileEditor
          tabKey={tabKey}
          checkout={tab}
          file={importLineKey(tab)}
          path={path}
          source={fromDisk ? { contents: contents ?? "" } : { session }}
          languageServer={fromDisk ? null : languageServer.extension}
          navigation={navigation}
          rename={rename}
          codeActions={codeActions}
          readOnly={readOnly}
          baseText={baseText}
          baseControl={baseControl}
          onOutlinePath={(next, view) => setTrail({ path: next, view })}
        />
      </div>
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
  tabKey,
  checkout,
  file,
  path,
  source,
  languageServer,
  navigation,
  rename,
  codeActions,
  readOnly,
  baseText,
  baseControl,
  onOutlinePath,
}: {
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
  /** Told of each rename the environment applied. */
  readonly rename: RenameHost;
  /** Told of each code action the environment applied. */
  readonly codeActions: CodeActionHost;
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
  }));
  // The view is built from the file as it first shows (the parent keys it by path).
  const [initial] = useState(() => ({
    environmentId: checkout.environmentId,
    cwd: checkout.cwd,
    file,
    path,
    source,
    languageServer,
    navigation,
    rename,
    codeActions,
    readOnly,
    vim,
    wordWrap,
    baseControl,
    outlinePath,
    save,
  }));

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
          markdown ? livePreview() : codeView(),
          compartments.language.of([]),
          compartments.readOnly.of(readOnlyExtension(initial.readOnly)),
          outline({ onPath: initial.outlinePath }),
          importLineExtension,
          initial.languageServer ?? [],
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            session?.changed();
            fileEditorChanged(update.view, update.changes);
          }),
        ],
      }),
    });
    viewRef.current = view;
    session?.attach(view);
    const unregister = registerFileEditor({
      environmentId: initial.environmentId,
      cwd: initial.cwd,
      path: initial.path,
      view,
      writable: () =>
        session !== null && session.getState().status === "open" && !view.state.readOnly,
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
      stopLighting();
      session?.detach();
      view.destroy();
      viewRef.current = null;
    };
  }, [compartments, initial]);

  useEffect(() => {
    const view = viewRef.current;
    const vimExtension = vimRef.current;
    if (!view || !vimExtension) return;
    view.dispatch({ effects: compartments.vim.reconfigure(vim ? vimExtension() : []) });
  }, [compartments, vim]);

  // The find bar's, change, editing and save keys follow the keybindings; wrapping, folds, the find bar
  // and shown changes stay.
  // oxlint-disable-next-line t3code/react-effect-budget -- carries rebound keys into the CodeMirror view
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
        initial.languageServer ? languageServerUi(lspKeys, diagnosticKeys, initial) : [],
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
  }, [compartments, initial, findKeys, hunkKeys, editingKeys, diagnosticKeys, lspKeys, saveKeys]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.readOnly.reconfigure(readOnlyExtension(readOnly)),
    });
  }, [compartments, readOnly]);

  // oxlint-disable-next-line t3code/react-effect-budget -- hands the server's base text to CodeMirror
  useEffect(() => {
    if (baseText !== undefined) viewRef.current?.dispatch({ effects: setGitBase(baseText) });
  }, [baseText]);

  // oxlint-disable-next-line t3code/react-effect-budget -- moves the CodeMirror view to the line project search asked for
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !revealHere) return;
    view.dispatch(revealLine(view.state, revealHere.line, revealHere.column));
    view.focus();
    repositoryFileReveal.done(revealHere.id);
  }, [revealHere]);

  // oxlint-disable-next-line t3code/react-effect-budget -- carries the word wrap setting into the CodeMirror view
  useEffect(() => {
    const view = viewRef.current;
    if (view && !isMarkdownPath(initial.path)) setSoftWrap(view, wordWrap);
  }, [initial, wordWrap]);

  return (
    <div
      ref={host}
      className="h-full min-h-0 overflow-hidden text-sm leading-relaxed text-foreground"
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
): Extension {
  return [
    diagnosticsUi({ keys: diagnosticKeys }),
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
  const project = useProject({ environmentId: tab.environmentId, projectId: tab.projectId });
  const threads = useThreadShells();
  return threads.some(
    (thread) =>
      thread.environmentId === tab.environmentId &&
      thread.projectId === tab.projectId &&
      (thread.worktreePath ?? project?.workspaceRoot) === tab.cwd &&
      isTurnRunning(thread.source.status),
  );
}
