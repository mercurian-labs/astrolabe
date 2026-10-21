import { useEffect, useRef } from "react";
import { defaultKeymap, isolateHistory } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { livePreview } from "./markdown/livePreview.ts";
import type { LivePreviewOptions } from "./markdown/config.ts";
import { agentChanges } from "./collab/agentChanges.ts";
import { vimMode, type VimHistory } from "./vim.ts";

export interface AtlasEditorProps {
  text: Y.Text;
  awareness: Awareness;
  /** Appended after the editor's own extensions. Keep the array stable; a new one remounts. */
  extensions?: Extension[];
  /** Vim mode (live-preview spec 5.1). Switching it reconfigures the editor in place. */
  vim?: boolean;
  /**
   * Vim's mode panel under the editor; off for a host that shows the mode itself (see
   * `vimNormalModeFont`). Read when the editor mounts.
   */
  vimPanel?: boolean;
  /** How the live preview opens links and embeds. Keep the object stable; a new one remounts. */
  livePreview?: LivePreviewOptions;
  /**
   * The person watches and does not type: the file's writer is the only author, and each
   * change it lands scrolls into view.
   */
  locked?: boolean;
  /**
   * Whether the document can be typed into. Switching it reconfigures the editor in place, so
   * a reading view becomes an editing one without losing its scroll position.
   */
  readOnly?: boolean;
  className?: string;
}

// Remote cursors show their name all the time rather than on hover, so an agent's cursor
// says whose it is, in the editor's own font (y-codemirror's base theme sets serif).
const collabTheme = EditorView.theme({
  ".cm-ySelectionInfo": { opacity: 1, fontFamily: "inherit" },
});

// No `history()`: undo belongs to Yjs, and CodeMirror history would otherwise record every
// transaction, agent syncs included, for nothing. The live preview's bindings sit above the
// default keymap, which supplies motion and deletion that respect hidden syntax. Astrolabe: less
// its Mod-/, which in Markdown wraps the line in an HTML comment; the app's Search has the key.
const liveMarkdown = (options: LivePreviewOptions | undefined) => [
  livePreview(options),
  EditorView.lineWrapping,
  EditorState.allowMultipleSelections.of(true),
  keymap.of(defaultKeymap.filter((binding) => binding.key !== "Mod-/")),
];

// Read only: no typing and no caret, but selecting and following links still work.
const readOnlyView = [EditorState.readOnly.of(true), EditorView.editable.of(false)];

// Locked: no typing, no caret, and every change the writer lands is brought into view. The
// scroll rides the change's own transaction, so it never moves anything on its own.
const lockedView = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  EditorState.transactionExtender.of((tr) => {
    if (!tr.docChanged) return null;
    let start = -1;
    let end = 0;
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      if (start < 0) start = fromB;
      end = toB;
    });
    // Head at the start: a change taller than the view shows its beginning.
    return {
      effects: EditorView.scrollIntoView(EditorSelection.range(end, start), { y: "center" }),
    };
  }),
];

/**
 * Gives transactions annotated with `isolateHistory` (a formatting toggle, a checkbox
 * click) their own Yjs undo step, closing the capture group before and after them.
 */
export function isolatedUndoSteps(undoManager: Y.UndoManager): Extension {
  return [
    EditorState.transactionFilter.of((tr) => {
      if (tr.annotation(isolateHistory)) undoManager.stopCapturing();
      return tr;
    }),
    EditorView.updateListener.of((update) => {
      if (update.transactions.some((tr) => tr.annotation(isolateHistory))) {
        undoManager.stopCapturing();
      }
    }),
  ];
}

/** Yjs's default undo capture window, in milliseconds. */
const CAPTURE_TIMEOUT = 500;

/**
 * A live-preview Markdown editor bound to `text`. Uncontrolled: the Yjs document is the
 * source of truth, so edits reach the host through `text`, not through callbacks.
 */
export function AtlasEditor({
  text,
  awareness,
  extensions,
  className,
  vim = false,
  vimPanel = true,
  livePreview: livePreviewOptions,
  locked = false,
  readOnly = false,
}: AtlasEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // The mounted editor, its Vim compartment, and the undo history Vim runs.
  const mounted = useRef<{
    view: EditorView;
    vimSlot: Compartment;
    readOnlySlot: Compartment;
    history: VimHistory;
    vimOn: boolean;
    readOnlyOn: boolean;
  } | null>(null);
  // Read when the editor mounts; later changes reconfigure it (below).
  const vimRef = useRef(vim);
  const readOnlyRef = useRef(readOnly);
  useEffect(() => {
    vimRef.current = vim;
    readOnlyRef.current = readOnly;
  }, [vim, readOnly]);
  const vimPanelRef = useRef(vimPanel);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const undoManager = new Y.UndoManager(text, { captureTimeout: CAPTURE_TIMEOUT });
    const history: VimHistory = {
      undo: () => undoManager.undo(),
      redo: () => undoManager.redo(),
      stopCapturing: () => undoManager.stopCapturing(),
      // Yjs's default capture window, restored when Vim mode is switched off.
      groupExplicitly: (on) => {
        undoManager.captureTimeout = on ? Number.POSITIVE_INFINITY : CAPTURE_TIMEOUT;
      },
    };
    const vimSlot = new Compartment();
    const readOnlySlot = new Compartment();
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          // Undo is Yjs's, so it only reverts the local user's own changes: the keymap is
          // Prec.high so a host's history keymap cannot shadow it, and yCollab handles the
          // browser's historyUndo/historyRedo input events.
          yCollab(text, awareness, { undoManager }),
          Prec.high(keymap.of(yUndoManagerKeymap)),
          isolatedUndoSteps(undoManager),
          liveMarkdown(livePreviewOptions),
          locked ? lockedView : [],
          agentChanges(text, awareness),
          collabTheme,
          vimSlot.of(vimRef.current ? vimMode(history, { panel: vimPanelRef.current }) : []),
          readOnlySlot.of(readOnlyRef.current ? readOnlyView : []),
          extensions ?? [],
        ],
      }),
    });
    mounted.current = {
      view,
      vimSlot,
      readOnlySlot,
      history,
      vimOn: vimRef.current,
      readOnlyOn: readOnlyRef.current,
    };
    return () => {
      mounted.current = null;
      view.destroy();
      undoManager.destroy();
    };
  }, [text, awareness, extensions, livePreviewOptions, locked]);

  // Vim on or off without remounting: the compartment is reconfigured in place.
  useEffect(() => {
    const editor = mounted.current;
    if (!editor || editor.vimOn === vim) return;
    editor.vimOn = vim;
    editor.view.dispatch({
      effects: editor.vimSlot.reconfigure(
        vim ? vimMode(editor.history, { panel: vimPanelRef.current }) : [],
      ),
    });
  }, [vim]);

  useEffect(() => {
    const editor = mounted.current;
    if (!editor || editor.readOnlyOn === readOnly) return;
    editor.readOnlyOn = readOnly;
    editor.view.dispatch({
      effects: editor.readOnlySlot.reconfigure(readOnly ? readOnlyView : []),
    });
  }, [readOnly]);

  return <div ref={hostRef} className={className} />;
}
