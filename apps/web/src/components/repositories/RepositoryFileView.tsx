import "@mercurian/editor/markdown/theme.css";
import "@mercurian/editor/code/theme.css";

import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { codeLanguageFor, codeView, isMarkdownPath } from "@mercurian/editor/code";
import { livePreview } from "@mercurian/editor/markdown";
import { vimMode, vimNormalModeFont } from "@mercurian/editor/vim";
import { AuthFilesystemWriteScope, type ClientSettings } from "@t3tools/contracts";
import { BotIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useEnvironmentScope } from "~/state/session";
import { useProject, useThreadShells } from "~/state/entities";
import { useVimScreenLines } from "~/vimScreenLines";
import { appVimKeys } from "~/whichKey/doors";
import { composerHistory } from "../composerCodeMirror/composerUndo";
import { setProjectFileQueryData, useProjectFileQuery } from "../files/projectFilesQueryState";
import { useFileSaveCoordinator } from "../files/useFileSaveCoordinator";
import { isTurnRunning } from "../wiki/wiki.logic";
import { registerUnsavedCheck } from "../wiki/wikiPanes";
import type { RepositoryTab } from "./repositoryTabs";

type FileTab = Extract<RepositoryTab, { kind: "file" }>;

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
  ".cm-scroller": { lineHeight: "inherit" },
  "&.cm-editor .cm-content": { padding: "12px 16px 40vh", caretColor: "currentColor" },
  // A note reads as a wiki's document does: a measure wide, in the middle of the pane.
  "&.cm-editor:not(.cm-code) .cm-content": {
    maxWidth: "48rem",
    margin: "0 auto",
    padding: "24px 32px 40vh",
  },
  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)" },
});

const selectVimModeEnabled = (settings: ClientSettings) => settings.vimModeEnabled;

/**
 * A repository file in the wiki editor (Markdown preview, code colours, Vim when on). Edits
 * autosave after typing stops through the thread Files view's save, which never overwrites newer
 * contents an agent or another editor saved. Files without write access or too big to read whole
 * are read only, and the view says when an agent works in the same checkout.
 */
export function RepositoryFileView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: FileTab;
}) {
  const { environmentId, cwd, path } = tab;
  const file = useProjectFileQuery(environmentId, cwd, path);
  const canWrite = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  // One identity: the save coordinator starts over when its pending callback changes.
  const onPendingChange = useStableCallback((_path: string, next: boolean) => {
    pendingRef.current = next;
    setPending(next);
  });
  const save = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath: path,
    onPendingChange,
  });
  useEffect(() => registerUnsavedCheck(tabKey, () => pendingRef.current), [tabKey]);
  // What an agent or another editor saved meanwhile shows when the window comes back.
  const refresh = file.refresh;
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const contents = file.data?.contents ?? null;
  const readOnly = !canWrite || file.data?.truncated === true;
  const agentWorking = useAgentWorkingIn(tab);

  if (file.error !== null && contents === null) {
    return <FileNotice>{file.error}</FileNotice>;
  }
  if (contents === null) {
    return <FileNotice>{file.isPending ? "Opening…" : "Nothing to show."}</FileNotice>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
        {agentWorking ? (
          <span className="flex shrink-0 items-center gap-1 text-info-foreground">
            <BotIcon className="size-3.5" />
            An agent is working in this checkout
          </span>
        ) : null}
        <span className="shrink-0">
          {readOnly
            ? file.data?.truncated
              ? "Too big to edit here"
              : "Read only"
            : pending
              ? "Saving…"
              : "Saved"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileEditor
          key={`${environmentId}\0${cwd}\0${path}`}
          path={path}
          contents={contents}
          readOnly={readOnly}
          pendingRef={pendingRef}
          onChange={(next) => {
            setProjectFileQueryData(environmentId, cwd, path, next);
            save.change(next);
          }}
        />
      </div>
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
 * the file's language once it loads, and read-only. Contents saved by someone else replace the
 * text, unless edits here are still on their way.
 */
function FileEditor({
  path,
  contents,
  readOnly,
  pendingRef,
  onChange,
}: {
  readonly path: string;
  readonly contents: string;
  readonly readOnly: boolean;
  readonly pendingRef: { readonly current: boolean };
  readonly onChange: (contents: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimRef = useRef<(() => Extension) | null>(null);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const vim = useClientSettings(selectVimModeEnabled);
  useVimScreenLines();
  const [compartments] = useState(() => ({
    vim: new Compartment(),
    language: new Compartment(),
    readOnly: new Compartment(),
  }));
  // The view is built from the file as it first shows (the parent keys it by path).
  const [initial] = useState(() => ({ path, contents, readOnly, vim }));

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const markdown = isMarkdownPath(initial.path);
    const history = composerHistory(() => viewRef.current!);
    const vimExtension = (): Extension => [
      vimMode(history.vim, { panel: false }),
      vimNormalModeFont,
    ];
    vimRef.current = vimExtension;
    const view = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: initial.contents,
        extensions: [
          FILE_EDITOR_THEME,
          history.extension,
          compartments.vim.of(initial.vim ? vimExtension() : []),
          appVimKeys(() => null),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown ? [livePreview(), EditorView.lineWrapping] : codeView(),
          compartments.language.of([]),
          compartments.readOnly.of(readOnlyExtension(initial.readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    let cancelled = false;
    const language = markdown ? null : codeLanguageFor(initial.path);
    if (language) {
      void language.load().then((support) => {
        if (!cancelled) view.dispatch({ effects: compartments.language.reconfigure(support) });
      });
    }
    return () => {
      cancelled = true;
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

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.readOnly.reconfigure(readOnlyExtension(readOnly)),
    });
  }, [compartments, readOnly]);

  // Newer contents from elsewhere (an agent's edit, the thread's Files view) replace the text,
  // unless edits typed here are still saving, which would otherwise be lost.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || pendingRef.current) return;
    const current = view.state.doc.toString();
    if (current === contents) return;
    const head = Math.min(view.state.selection.main.head, contents.length);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: contents },
      selection: { anchor: head },
    });
  }, [contents, pendingRef]);

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

function readOnlyExtension(readOnly: boolean) {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
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
