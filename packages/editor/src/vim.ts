import {
  EditorSelection,
  EditorState,
  Facet,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type RangeSet,
  type RangeValue,
  type Text,
} from "@codemirror/state";
import { EditorView, ViewPlugin, showPanel, type Panel } from "@codemirror/view";
import { CodeMirror, Vim, getCM, vim } from "@replit/codemirror-vim";
import { cellModalLayer } from "./markdown/tableCells.ts";

// Vim mode (live-preview spec 5.1): `@replit/codemirror-vim` with undo routed to the host's
// undo manager, normal-mode motions that never rest on hidden syntax, the same layer in
// table cells, and a mode panel. Off unless the host installs `vimMode`.

/** The host's undo history, which Vim's `u`, `U`, and `Ctrl-r` run instead of CodeMirror's. */
export interface VimHistory {
  undo(): void;
  redo(): void;
  /** Closes the current undo step. */
  stopCapturing(): void;
  /**
   * While on, undo steps close only through `stopCapturing` (never on a timeout), so a Vim
   * change of any length (an insert session, say) is one step.
   */
  groupExplicitly(on: boolean): void;
}

const vimHistory = Facet.define<VimHistory, VimHistory | null>({
  combine: (values) => values[0] ?? null,
});

type VimCM = NonNullable<ReturnType<typeof getCM>>;

/** Whether `cm`'s editor runs the Atlas Vim layer (its outer editor or one of its cells). */
const atlas = (cm: VimCM) => cm.cm6.state.facet(vimHistory) !== null;

let configured = false;

/**
 * Vim's shared configuration, done once and scoped: each addition acts only in editors that
 * run this layer and otherwise does what the package did before, so another Vim editor on
 * the page is unaffected. Undo and redo go to the editor's `vimHistory`; `U` undoes in
 * normal mode; `:w` (through the package's save hook) and `:q` do nothing, since the
 * document is always saved through Yjs.
 */
function configureVim() {
  if (configured) return;
  configured = true;
  const { commands } = CodeMirror;
  const { undo, redo } = commands;
  const save: unknown = commands.save;
  commands.undo = (cm) => {
    const history = cm.cm6.state.facet(vimHistory);
    if (history) history.undo();
    else undo(cm);
  };
  commands.redo = (cm) => {
    const history = cm.cm6.state.facet(vimHistory);
    if (history) history.redo();
    else redo(cm);
  };
  // `:w` runs this hook when it is set, else `cm.save()` when the editor has one.
  commands.save = (cm: VimCM) => {
    if (atlas(cm)) return;
    if (typeof save === "function") save(cm);
    else Reflect.get(cm, "save")?.call(cm);
  };
  // `U` is unmapped in normal mode by default: elsewhere it stays a no-op.
  Vim.defineAction("atlasUndo", (cm, args) => {
    if (!atlas(cm)) return;
    for (let i = 0; i < (args.repeat ?? 1); i++) commands.undo(cm);
  });
  Vim.mapCommand("U", "action", "atlasUndo", {}, { context: "normal" });
  // `:q` is not a command by default: elsewhere it reports that, as the package does.
  Vim.defineEx("quit", "q", (cm) => {
    if (atlas(cm)) return;
    const message = document.createElement("div");
    message.className = "cm-vim-message";
    message.style.cssText = "color: red; white-space: pre";
    message.textContent = 'Not an editor command ":q"';
    cm.openNotification(message, { bottom: true, duration: 15000 });
  });
}

/** The view's Vim state, when Vim is installed on it. */
function vimState(view: EditorView) {
  return getCM(view)?.state.vim ?? null;
}

/** Whether Vim has nothing pending: the next key starts a command. */
function atRest(view: EditorView) {
  const state = vimState(view);
  if (!state) return false;
  const input = state.inputState;
  return (
    input.keyBuffer.length === 0 &&
    !input.operator &&
    input.prefixRepeat.length === 0 &&
    !getCM(view)?.state.dialog
  );
}

/** Whether `view`'s Vim is in normal mode with no command pending. */
function idle(view: EditorView) {
  const state = vimState(view);
  return !!state && !state.insertMode && !state.visualMode && atRest(view);
}

/** A mode as the panel names it, from Vim's mode-change event. */
function modeName(event: { mode?: string; subMode?: string }) {
  const mode = event.mode ?? "normal";
  if (event.subMode === "linewise") return `${mode} line`;
  if (event.subMode === "blockwise") return `${mode} block`;
  return mode;
}

/** The mode the panel shows: the active cell's while one is open, else the editor's. */
const setVimMode = StateEffect.define<{ cell: boolean; mode: string | null }>();

const vimModeField = StateField.define<{ editor: string; cell: string | null }>({
  create: () => ({ editor: "normal", cell: null }),
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (!effect.is(setVimMode)) continue;
      const { cell, mode } = effect.value;
      next = cell ? { ...next, cell: mode } : { ...next, editor: mode ?? "normal" };
    }
    return next;
  },
  provide: (field) => showPanel.from(field, () => modePanel),
});

function panelText(view: EditorView) {
  const { editor, cell } = view.state.field(vimModeField);
  return `--${(cell ?? editor).toUpperCase()}--`;
}

/** The mode indicator at the bottom of the editor. */
function modePanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-vim-panel atlas-vim-mode";
  dom.textContent = panelText(view);
  return {
    dom,
    update(update) {
      if (update.state.field(vimModeField) !== update.startState.field(vimModeField)) {
        dom.textContent = panelText(update.view);
      }
    },
  };
}

/** The ranges the caret steps over as hidden syntax, as they stood before a key. */
interface Snapshot {
  head: number;
  ranges: readonly RangeSet<RangeValue>[];
}

/**
 * Snapshots taken at a keydown in normal mode, keyed by the document they were taken in,
 * and dropped once the key's handling has finished (a microtask later). Vim moves the
 * selection while it handles the key, without a user event, against that document.
 */
const snapshots = new WeakMap<Text, Snapshot>();

/**
 * Where a motion that came to rest at `head` should rest instead: never on a character
 * hidden syntax covers (the block cursor sits on a visible character). Forward motions go
 * past the hidden range, backward ones stop before it (or past it, at a line's start).
 */
function visibleHead(snapshot: Snapshot, head: number, doc: Text) {
  let at = head;
  for (let step = 0; step < 16; step++) {
    const range = hiddenAt(snapshot, at);
    if (!range) return at;
    const lineStart = doc.lineAt(range.from).from;
    at = at >= snapshot.head || range.from <= lineStart ? range.to : range.from - 1;
  }
  return at;
}

/** The hidden range covering the character at `at`, if any. */
function hiddenAt(snapshot: Snapshot, at: number) {
  for (const ranges of snapshot.ranges) {
    for (let iter = ranges.iter(at); iter.value; iter.next()) {
      if (iter.from > at) break;
      if (iter.to > at) return { from: iter.from, to: iter.to };
    }
  }
  return null;
}

/**
 * Moves a normal-mode resting position Vim sets while handling a key off hidden syntax,
 * judged by the syntax hidden before the key (the motion may reveal the construct it lands
 * in), so normal-mode motions treat hidden syntax as the arrow keys do. A visual selection
 * (never empty) is left to Vim, and reveals what it covers as a mouse selection does.
 */
const restOnVisibleText = EditorState.transactionFilter.of((tr) => {
  const snapshot = tr.selection && !tr.docChanged && snapshots.get(tr.startState.doc);
  if (!snapshot || !tr.selection || tr.annotation(Transaction.userEvent) !== undefined) return tr;
  if (tr.selection.ranges.some((range) => !range.empty)) return tr;
  let changed = false;
  const ranges = tr.selection.ranges.map((range) => {
    const head = visibleHead(snapshot, range.head, tr.startState.doc);
    if (head === range.head) return range;
    changed = true;
    return EditorSelection.cursor(head);
  });
  if (!changed) return tr;
  return [
    tr,
    { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true },
  ];
});

/**
 * Per view: closes an undo step where a Vim change begins (a key that starts a command in
 * normal or visual mode) and when insert mode ends, never between insert-mode keys; and
 * snapshots the hidden syntax ahead of each normal-mode key, for `restOnVisibleText`. The
 * outer editor's instance also reports its mode to the panel and owns the history's grouping.
 */
function vimSupport(outer: boolean) {
  return ViewPlugin.define(
    (view) => {
      const history = () => view.state.facet(vimHistory);
      const onMode = (event: { mode?: string; subMode?: string }) => {
        if (event.mode !== "insert") history()?.stopCapturing();
        if (outer) report(view, setVimMode.of({ cell: false, mode: modeName(event) }));
      };
      // This plugin runs ahead of Vim's (for its key handler), so Vim's editor object does
      // not exist yet when it is constructed: listen once it does.
      let cm: ReturnType<typeof getCM> = null;
      let destroyed = false;
      const bind = () => {
        if (cm || destroyed) return;
        cm = getCM(view);
        cm?.on("vim-mode-change", onMode);
      };
      // Held from the start: when Vim is switched off, this plugin is destroyed in a state
      // that no longer has the history, and the grouping must still be handed back.
      const grouping = outer ? history() : null;
      grouping?.groupExplicitly(true);
      queueMicrotask(bind);
      return {
        update: bind,
        beforeKey() {
          bind();
          const state = vimState(view);
          if (!state || state.insertMode) return;
          if (atRest(view)) history()?.stopCapturing();
          if (state.visualMode) return;
          const { doc } = view.state;
          snapshots.set(doc, {
            head: view.state.selection.main.head,
            ranges: view.state.facet(EditorView.atomicRanges).map((source) => source(view)),
          });
          queueMicrotask(() => snapshots.delete(doc));
        },
        destroy() {
          destroyed = true;
          cm?.off("vim-mode-change", onMode);
          grouping?.groupExplicitly(false);
        },
      };
    },
    {
      eventHandlers: {
        // Ahead of Vim's own key handler.
        keydown() {
          this.beforeKey();
          return false;
        },
      },
    },
  );
}

const editorSupport = vimSupport(true);
const cellSupport = vimSupport(false);

/** Vim in a table cell's editor: the outer editor's panel shows its mode, same history. */
function cellVim(history: VimHistory): Extension {
  return [vim(), vimHistory.of(history), Prec.highest(cellSupport), restOnVisibleText];
}

/**
 * Dispatches `effect` to `view` now, or after the update in progress when there is one (a
 * cell opens and closes inside its outer editor's update, and Vim can change mode there).
 */
function report(view: EditorView, effect: StateEffect<unknown>) {
  try {
    view.dispatch({ effects: effect });
  } catch (error) {
    if (!(error instanceof Error) || !/update is in progress/.test(error.message)) throw error;
    queueMicrotask(() => {
      if (view.dom.isConnected) view.dispatch({ effects: effect });
    });
  }
}

/** The cell editor whose mode each outer editor's panel shows, and its listener. */
const panelCells = new WeakMap<
  EditorView,
  { child: EditorView; listener: (event: { mode?: string; subMode?: string }) => void }
>();

/**
 * Vim mode for an Atlas editor: modal editing with the mode in a panel at the bottom, `u`,
 * `U`, and `Ctrl-r` on `history`, and the same layer in table cell editors. Vim's keys take
 * precedence in normal, visual, and operator-pending modes; in insert mode every other
 * binding still runs.
 */
export function vimMode(history: VimHistory): Extension {
  configureVim();
  return [
    // Above the keymaps (which CodeMirror runs at default precedence), so normal-mode keys
    // reach Vim first; Vim passes on what it does not handle in insert mode. Vim's own panel
    // only opens for the ex line; the mode panel is this layer's.
    Prec.high(vim()),
    vimHistory.of(history),
    vimModeField,
    Prec.highest(editorSupport),
    restOnVisibleText,
    cellModalLayer.of({
      extension: cellVim(history),
      idle,
      start(child, outer, from) {
        const childCm = getCM(child);
        if (!childCm) return;
        // A cell opened from another cell (Tab, Enter) starts in that cell's mode; one opened
        // from the editor in insert mode carries on in insert mode, and the editor drops to
        // normal mode, as it would on Escape, so leaving the cell lands in normal mode.
        const departing = from ? vimState(from) : null;
        const outerCm = getCM(outer);
        if (departing?.insertMode) {
          Vim.handleKey(childCm, "i", "user");
        } else if (!from && outerCm?.state.vim?.insertMode) {
          Vim.handleKey(childCm, "i", "user");
          queueMicrotask(() => Vim.handleKey(outerCm, "<Esc>", "user"));
        }
        // The panel follows this cell from now on (a cell replacing another takes over
        // before the old one closes).
        const previous = panelCells.get(outer);
        if (previous) getCM(previous.child)?.off("vim-mode-change", previous.listener);
        const listener = (event: { mode?: string; subMode?: string }) =>
          report(outer, setVimMode.of({ cell: true, mode: modeName(event) }));
        panelCells.set(outer, { child, listener });
        childCm.on("vim-mode-change", listener);
        const mode = childCm.state.vim?.insertMode ? "insert" : "normal";
        report(outer, setVimMode.of({ cell: true, mode }));
      },
      stop(child, outer) {
        const current = panelCells.get(outer);
        if (current?.child !== child) return;
        getCM(child)?.off("vim-mode-change", current.listener);
        panelCells.delete(outer);
        report(outer, setVimMode.of({ cell: true, mode: null }));
      },
    }),
  ];
}
