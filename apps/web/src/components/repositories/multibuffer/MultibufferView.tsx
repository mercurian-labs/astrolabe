import "@mercurian/editor/code/theme.css";

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { codeLanguageFor, codeView } from "@mercurian/editor/code";
import { codeEditing } from "@mercurian/editor/code/editing";
import { gitChanges, setGitBase } from "@mercurian/editor/git";
import { excerptKeys } from "@mercurian/editor/multibuffer/excerpt";
import type {
  Multibuffer,
  MultibufferExcerpt,
  MultibufferFile,
  MultibufferRow,
} from "@mercurian/editor/multibuffer";
import { inFileSearch } from "@mercurian/editor/search";
import { vimMode, vimNormalModeFont, type VimHistory } from "@mercurian/editor/vim";
import type { ClientSettings, EnvironmentId } from "@t3tools/contracts";
import { useAtomMount } from "@effect/atom-react";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  useCodeEditorKeys,
  useEditorFindKeys,
  useEditorHunkKeys,
  useMultibufferKeys,
} from "~/editorKeybindings";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment, vcsStatusRevalidation } from "~/state/vcs";
import { useVimScreenLines } from "~/vimScreenLines";
import { appVimKeys } from "~/whichKey/doors";
import { PierreEntryIcon } from "../../chat/PierreEntryIcon";
import { composerHistory } from "../../composerCodeMirror/composerUndo";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";

/**
 * Astrolabe: a multi-file view as a virtualised list of stacked editors: a header row per file and
 * one small code editor per excerpt, built when it scrolls into view and kept (with its undo)
 * when it scrolls out. The excerpts are the files' live documents: what you type lands in the file.
 */

// Module-level: a new object would rebuild every excerpt's styles.
const EXCERPT_THEME = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    "--atlas-md-font-mono": "var(--font-mono)",
    "--atlas-md-syntax-color": "var(--muted-foreground)",
    "--atlas-md-border-color": "var(--border)",
    "--atlas-selection": "color-mix(in oklab, var(--ring) 30%, transparent)",
    "--atlas-selection-unfocused": "color-mix(in oklab, var(--muted-foreground) 20%, transparent)",
    "--atlas-caret": "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-code .cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "13px" },
  ".cm-scroller": { lineHeight: "inherit" },
  "&.cm-editor .cm-content": { padding: "2px 16px", caretColor: "currentColor" },
  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)" },
});

/** What each excerpt's editor is made of; shared by the view's excerpts so they reconfigure alike. */
interface ExcerptSetup {
  readonly compartments: {
    readonly vim: Compartment;
    readonly keys: Compartment;
    readonly language: Compartment;
    readonly readOnly: Compartment;
    readonly extra: Compartment;
  };
  /** Each excerpt's undo history, for Vim's `u`. */
  readonly vimHistory: WeakMap<MultibufferExcerpt, VimHistory>;
}

const selectVimModeEnabled = (settings: ClientSettings) => settings.vimModeEnabled;

function readOnlyExtension(readOnly: boolean) {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}

export function MultibufferView({
  multibuffer,
  environmentId,
  cwd,
  readOnly,
  extensions,
  renderHeaderExtra,
  empty,
}: {
  readonly multibuffer: Multibuffer;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly readOnly: boolean;
  /** What the caller adds to every excerpt (match highlights, problems), by file. */
  readonly extensions?: (file: MultibufferFile) => Extension;
  readonly renderHeaderExtra?: (file: MultibufferFile) => ReactNode;
  /** Shown with no excerpts. */
  readonly empty: ReactNode;
}) {
  const rows = useSyncExternalStore(multibuffer.subscribe, multibuffer.rows);
  const listRef = useRef<LegendListRef | null>(null);
  const [setup] = useState((): ExcerptSetup => ({
    compartments: {
      vim: new Compartment(),
      keys: new Compartment(),
      language: new Compartment(),
      readOnly: new Compartment(),
      extra: new Compartment(),
    },
    vimHistory: new WeakMap(),
  }));
  useVimScreenLines();
  useAtomMount(vcsStatusRevalidation({ environmentId, cwd }));

  // A caret move to an excerpt scrolled out of view: scroll it in; its editor takes the caret.
  // oxlint-disable-next-line t3code/react-effect-budget -- scrolls the virtual list to the excerpt the caret moved to
  useEffect(
    () =>
      multibuffer.onFocusRequest(() => {
        const request = multibuffer.focusRequest();
        if (request === null) return;
        const index = multibuffer
          .rows()
          .findIndex((row) => row.kind === "excerpt" && row.excerpt === request.excerpt);
        if (index !== -1) {
          void listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: false });
        }
      }),
    [multibuffer],
  );

  if (rows.length === 0) return <>{empty}</>;
  return (
    <LegendList<MultibufferRow>
      ref={listRef}
      className="min-h-0 flex-1"
      data={rows}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.kind}
      estimatedItemSize={140}
      renderItem={({ item: row }) =>
        row.kind === "header" ? (
          <FileHeader
            file={row.file}
            multibuffer={multibuffer}
            extra={renderHeaderExtra?.(row.file) ?? null}
          />
        ) : (
          <ExcerptRow
            item={row.excerpt}
            multibuffer={multibuffer}
            setup={setup}
            readOnly={readOnly}
            environmentId={environmentId}
            cwd={cwd}
            extensions={extensions}
          />
        )
      }
    />
  );
}

function splitPath(path: string) {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { name: path, directory: "" }
    : { name: path.slice(slash + 1), directory: path.slice(0, slash) };
}

function FileHeader({
  file,
  multibuffer,
  extra,
}: {
  readonly file: MultibufferFile;
  readonly multibuffer: Multibuffer;
  readonly extra: ReactNode;
}) {
  const { resolvedTheme } = useTheme();
  const { name, directory } = splitPath(file.path);
  const first = file.excerpts[0];
  const open = () => {
    const bounds = first ? multibuffer.boundsOf(first) : null;
    const line =
      first && bounds && file.hub
        ? file.hub.doc.lineAt(bounds.from).number
        : (first?.span.first ?? 1);
    multibuffer.openFileAt(file.path, line);
  };
  return (
    <div className="flex h-8 items-center gap-2 border-y border-border bg-muted/40 px-3 text-xs">
      <PierreEntryIcon
        pathValue={file.path}
        kind="file"
        theme={resolvedTheme}
        className="size-3.5"
      />
      <button
        type="button"
        className="min-w-0 truncate text-left font-medium text-foreground hover:underline"
        onClick={open}
      >
        {name}
      </button>
      {directory ? (
        <span className="min-w-0 truncate text-muted-foreground">{directory}</span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {file.failed ? <span className="text-destructive-foreground">{file.failed}</span> : null}
        {extra}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={`Open ${name}`}
                size="icon-xs"
                variant="ghost-muted"
                onClick={open}
              />
            }
          >
            <SquareArrowOutUpRightIcon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Open file</TooltipPopup>
        </Tooltip>
      </span>
    </div>
  );
}

/** The lines as last seen, while the file's live document opens. */
function ExcerptPreview({ item }: { readonly item: MultibufferExcerpt }) {
  const lines: number[] = [];
  for (let line = item.span.first; line <= item.span.last && lines.length < 400; line++) {
    lines.push(line);
  }
  return (
    <div aria-hidden="true" className="py-0.5 font-mono text-xs text-muted-foreground">
      {lines.map((line) => (
        <div key={line} className="flex whitespace-pre">
          <span className="w-12 shrink-0 pr-3 text-right tabular-nums opacity-60">{line}</span>
          <span className="min-w-0 truncate pl-4">{item.file.preview.get(line) ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

const languageLoads = new Map<string, Promise<Extension | null>>();

function languageFor(path: string): Promise<Extension | null> {
  const description = codeLanguageFor(path);
  if (description === null) return Promise.resolve(null);
  let load = languageLoads.get(description.name);
  if (load === undefined) {
    load = description.load().then(
      (support) => support,
      () => null,
    );
    languageLoads.set(description.name, load);
  }
  return load;
}

function ExcerptRow({
  item,
  multibuffer,
  setup,
  readOnly,
  environmentId,
  cwd,
  extensions,
}: {
  readonly item: MultibufferExcerpt;
  readonly multibuffer: Multibuffer;
  readonly setup: ExcerptSetup;
  readonly readOnly: boolean;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly extensions: ((file: MultibufferFile) => Extension) | undefined;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const file = item.file;
  const open = file.hub !== null;
  // A file's document opens again after the view let it go: its editors are built again.
  const liveDocument = file.document;
  const vim = useClientSettings(selectVimModeEnabled);
  const findKeys = useEditorFindKeys();
  const hunkKeys = useEditorHunkKeys();
  const editingKeys = useCodeEditorKeys();
  const keys = useMultibufferKeys();
  const head = useEnvironmentQuery(
    open
      ? vcsEnvironment.baseText({ environmentId, input: { cwd, path: file.path, base: "head" } })
      : null,
  );
  const baseText = head.isSuccess ? (head.data?.text ?? null) : undefined;
  const { compartments } = setup;
  const [initial] = useState(() => ({ vim, readOnly, extensions }));

  // oxlint-disable-next-line t3code/react-effect-budget -- opens the file's live document once an excerpt of it is on screen
  useEffect(() => multibuffer.need(file), [multibuffer, file]);

  // oxlint-disable-next-line t3code/react-effect-budget -- builds the excerpt's CodeMirror view once its document is open
  useLayoutEffect(() => {
    const element = host.current;
    if (!open || liveDocument === null || element === null) return;
    const state = multibuffer.stateFor(item, (excerpt) => {
      const history = composerHistory(() => excerpt.view!);
      setup.vimHistory.set(excerpt, history.vim);
      return [
        EXCERPT_THEME,
        history.extension,
        compartments.vim.of(
          initial.vim ? [vimMode(history.vim, { panel: false }), vimNormalModeFont] : [],
        ),
        appVimKeys(() => null),
        compartments.keys.of([]),
        codeView(),
        compartments.language.of([]),
        compartments.readOnly.of(readOnlyExtension(initial.readOnly)),
        compartments.extra.of(initial.extensions?.(excerpt.file) ?? []),
      ];
    });
    if (state === null) return;
    const view = new EditorView({
      parent: element,
      state,
      dispatchTransactions: multibuffer.dispatchFrom(item),
    });
    viewRef.current = view;
    multibuffer.shown(item, view);
    let cancelled = false;
    void languageFor(file.path).then((support) => {
      if (!cancelled && support !== null) {
        view.dispatch({ effects: compartments.language.reconfigure(support) });
      }
    });
    const request = multibuffer.focusRequest();
    if (request?.excerpt === item) multibuffer.applyFocus(request, view);
    return () => {
      cancelled = true;
      viewRef.current = null;
      multibuffer.hidden(item, view);
      view.destroy();
    };
  }, [multibuffer, item, file, open, liveDocument, setup, compartments, initial]);

  // Settings and keys apply to every excerpt, also one whose state was made under older ones.
  // oxlint-disable-next-line t3code/react-effect-budget -- carries settings and rebound keys into the CodeMirror view
  useLayoutEffect(() => {
    const view = viewRef.current;
    // Runs again right after the view is built, which happens when the document opens.
    if (!open || liveDocument === null || view === null) return;
    const history = setup.vimHistory.get(item);
    view.dispatch({
      effects: [
        compartments.vim.reconfigure(
          vim && history ? [vimMode(history, { panel: false }), vimNormalModeFont] : [],
        ),
        compartments.keys.reconfigure([
          excerptKeys(keys),
          inFileSearch({ keys: findKeys }),
          gitChanges({ keys: hunkKeys }),
          codeEditing({ keys: editingKeys }),
        ]),
        compartments.readOnly.reconfigure(readOnlyExtension(readOnly)),
        compartments.extra.reconfigure(extensions?.(file) ?? []),
      ],
    });
  }, [
    open,
    liveDocument,
    item,
    file,
    setup,
    compartments,
    vim,
    keys,
    findKeys,
    hunkKeys,
    editingKeys,
    readOnly,
    extensions,
  ]);

  // oxlint-disable-next-line t3code/react-effect-budget -- hands the file's committed text to the excerpt's change markers
  useEffect(() => {
    if (open && baseText !== undefined) {
      viewRef.current?.dispatch({ effects: setGitBase(baseText) });
    }
  }, [baseText, open]);

  if (!open) {
    return file.failed ? (
      <p className="px-4 py-2 text-xs text-muted-foreground">{file.failed}</p>
    ) : (
      <ExcerptPreview item={item} />
    );
  }
  return (
    <div
      ref={host}
      className="min-w-0 text-sm leading-relaxed text-foreground"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    />
  );
}
