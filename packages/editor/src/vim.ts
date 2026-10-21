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
import { EditorView, ViewPlugin, drawSelection, showPanel, type Panel } from "@codemirror/view";
import { CodeMirror, Vim, getCM, vim, type CodeMirrorV } from "@replit/codemirror-vim";
import { cellModalLayer } from "./markdown/tableCells.ts";

// Vim mode (live-preview spec 5.1): `@replit/codemirror-vim` with undo routed to the host's
// undo manager, normal-mode motions that never rest on hidden syntax, the same layer in
// table cells, the selection drawn by CodeMirror, and the mode in a panel and a
// `data-vim-mode` attribute on the editor. Off unless the host installs `vimMode`.

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

/** A direction `<C-w>` moves in, as `vimHostKeys`' `window` receives it. */
export type VimWindowDirection = "left" | "down" | "up" | "right";

const WINDOW_KEYS: Readonly<Record<string, VimWindowDirection>> = {
  h: "left",
  j: "down",
  k: "up",
  l: "right",
};

/** The host's `<C-w>` handler (see `vimHostKeys`), per editor. */
const vimWindowHost = Facet.define<
  (view: EditorView, direction: VimWindowDirection) => void,
  ((view: EditorView, direction: VimWindowDirection) => void) | null
>({ combine: (values) => values[0] ?? null });

/**
 * `<C-w>h`, `<C-w>j`, `<C-w>k`, `<C-w>l` in normal mode, which Vim moves between windows with:
 * here they go to the host's `window` (see `vimHostKeys`), and do nothing in an editor without
 * one, as the package's `<C-w>` did. They are one entry of Vim's own keymap, `<C-w><character>`,
 * standing where the package's do-nothing `<C-w>` stood, so they are default keys: a vimrc can
 * map onto them (`nnoremap <C-h> <C-w>h`) or over them (`nmap <C-w>h …`), and undoing its
 * mappings never removes them. `<C-w>` with an arrow or with Ctrl held (`<C-w><C-l>`) maps onto
 * them, as Vim reads those too.
 */
function defineWindowKeys() {
  // The package's `<C-w>` (normal mode) does nothing, but as a full match it would end the key
  // there: it gives way to the entry below, which keeps the keymap's count of defaults.
  Vim.unmap("<C-w>", "normal");
  Vim.defineAction("atlasWindow", (cm, args) => {
    const direction = WINDOW_KEYS[args.selectedCharacter ?? ""];
    const host = cm.cm6.state.facet(vimWindowHost);
    if (!direction || !host) return;
    const view = cm.cm6;
    // After Vim has finished with the key, since the host moves focus out of the editor.
    queueMicrotask(() => host(view, direction));
  });
  Vim.mapCommand("<C-w><character>", "action", "atlasWindow", {}, { context: "normal" });
  for (const [key, arrow] of [
    ["h", "Left"],
    ["j", "Down"],
    ["k", "Up"],
    ["l", "Right"],
  ] as const) {
    Vim.noremap(`<C-w><${arrow}>`, `<C-w>${key}`, "normal");
    Vim.noremap(`<C-w><C-${key}>`, `<C-w>${key}`, "normal");
  }
}

/** Whether `j` and `k` move by screen line (see `setVimScreenLineMotion`). */
let screenLines = false;

/**
 * Astrolabe: whether `j` and `k` (and the arrows, which Vim reads as them) move one line as it
 * shows on screen, as `gj` and `gk` do, in the editors running this layer: a line that wraps is
 * as many lines as it shows. With a count, or after an operator (`dj`, `yk`), they still move by
 * lines of text, so counts read off line numbers and operators act on whole lines.
 */
export function setVimScreenLineMotion(on: boolean) {
  screenLines = on;
}

/**
 * `j` and `k` as Vim's own, where `screenLines` holds by screen line: one entry of Vim's keymap
 * standing over the package's, so a vimrc maps onto or over them as before. Vim calls a motion
 * with its table of motions as `this`; the package's two line motions keep each other's goal
 * column, so this one stands in as the motion it ran for the next.
 */
function defineScreenLineKeys() {
  type MotionFn = Parameters<typeof Vim.defineMotion>[1];
  type Motions = Record<"moveByLines" | "moveByDisplayLines", MotionFn>;
  const lines: MotionFn = function (this: Motions, cm, head, motionArgs, state, inputState) {
    if (state.lastMotion === lines) state.lastMotion = this.moveByLines;
    // `explicitRepeat` leaves the count as typed: 0 for none.
    const counted = motionArgs.repeat > 0;
    motionArgs.repeat = Math.max(motionArgs.repeat, 1);
    const byScreen = screenLines && atlas(cm) && !counted && !inputState.operator;
    return (byScreen ? this.moveByDisplayLines : this.moveByLines).call(
      this,
      cm,
      head,
      motionArgs,
      state,
      inputState,
    );
  };
  Vim.defineMotion("atlasLines", lines);
  for (const [key, forward] of [
    ["j", true],
    ["k", false],
  ] as const) {
    Vim.mapCommand(
      key,
      "motion",
      "atlasLines",
      { forward, linewise: true, explicitRepeat: true },
      {},
    );
  }
}

/**
 * Vim's shared configuration, done once and scoped: each addition acts only in editors that
 * run this layer and otherwise does what the package did before, so another Vim editor on
 * the page is unaffected. Undo and redo go to the editor's `vimHistory`; `U` undoes in
 * normal mode; `:w` (through the package's save hook) and `:q` do nothing, since the
 * document is always saved through Yjs; `<C-w>` with a direction goes to the host.
 * The window keys come first, before any other mapping, so they stand among Vim's defaults.
 */
function configureVim() {
  if (configured) return;
  configured = true;
  defineWindowKeys();
  defineScreenLineKeys();
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

/**
 * Whether Vim's panel holds a prompt waiting for input (the ex line, a search). A status
 * notification there ("Found 1 matches…") waits for nothing: Vim's next key closes it.
 */
function promptOpen(view: EditorView) {
  const dialog: unknown = getCM(view)?.state.dialog;
  return dialog instanceof Element && dialog.querySelector("input, textarea") !== null;
}

/** Closes the status notification in Vim's panel, if one shows, as Vim's next key would. */
function closeNotification(view: EditorView) {
  const state = getCM(view)?.state as { currentNotificationClose?: () => void } | undefined;
  state?.currentNotificationClose?.();
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
    !promptOpen(view)
  );
}

/** Whether `view`'s Vim is in normal mode with no command pending. */
function idle(view: EditorView) {
  const state = vimState(view);
  return !!state && !state.insertMode && !state.visualMode && atRest(view);
}

/** Whether `view`'s Vim is in insert (or replace) mode; null when the view has no Vim. */
export function vimInsertMode(view: EditorView): boolean | null {
  const state = vimState(view);
  return state ? state.insertMode : null;
}

/** Whether `view`'s Vim is in normal mode with no command pending, so Escape has nothing to end. */
export function vimAtRest(view: EditorView): boolean {
  return idle(view);
}

/** Takes `view`'s Vim to insert mode from whichever mode it is in. */
export function enterInsertMode(view: EditorView) {
  const cm = getCM(view);
  const state = cm?.state.vim;
  if (!cm || !state || state.insertMode) return;
  // Visual `i` starts a text object, and a pending command would take the `i`: end them first.
  if (!idle(view)) Vim.handleKey(cm, "<Esc>", "api");
  Vim.handleKey(cm, "i", "api");
}

/** `view`'s Vim mode as the panel names it, read from its state rather than an event. */
function currentMode(view: EditorView) {
  const state = vimState(view);
  if (!state) return "normal";
  if (state.insertMode) return getCM(view)?.state.overwrite ? "replace" : "insert";
  if (!state.visualMode) return "normal";
  return state.visualLine ? "visual line" : state.visualBlock ? "visual block" : "visual";
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
  // The mode as an attribute, so a host can style by it (`insert`, `normal`, `visual`…).
  provide: (field) =>
    EditorView.editorAttributes.from(field, ({ editor, cell }) => ({
      "data-vim-mode": cell ?? editor,
    })),
});

const modePanelExtension = showPanel.from(vimModeField, () => modePanel);

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
        if (!cm) return;
        cm.on("vim-mode-change", onMode);
        // The host may have changed mode before this listened (insert mode from the start).
        const mode = currentMode(view);
        if (outer && view.state.field(vimModeField).editor !== mode) {
          report(view, setVimMode.of({ cell: false, mode }));
        }
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

/**
 * The selection and insert-mode caret, drawn by CodeMirror's layers: Vim hides the native
 * selection outside insert mode, so a visual selection shows only through these. A host colours
 * the selection with `--atlas-selection` (focused) and `--atlas-selection-unfocused`.
 */
const drawnSelection: Extension = [
  drawSelection(),
  EditorView.theme({
    ".cm-selectionBackground": {
      background: "var(--atlas-selection-unfocused, #d9d9d9)",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      background: "var(--atlas-selection, #d7d4f0)",
    },
    // In the text's colour, as the native caret it replaces.
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "currentColor" },
  }),
];

/**
 * Outside insert mode the editor's text reads in the monospace font (`--atlas-md-font-mono`), so
 * the mode shows without a panel. For a host that shows the mode this way; it acts only while
 * Vim is on, since the attribute it reads is `vimMode`'s.
 */
export const vimNormalModeFont: Extension = EditorView.theme({
  "&[data-vim-mode]:not([data-vim-mode=insert]):not([data-vim-mode=replace]) .cm-content": {
    fontFamily:
      "var(--atlas-md-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
  },
});

/** Vim in a table cell's editor: the outer editor's panel shows its mode, same history. */
function cellVim(history: VimHistory): Extension {
  return [
    vim(),
    vimHistory.of(history),
    Prec.highest(cellSupport),
    restOnVisibleText,
    drawnSelection,
  ];
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
 * Vim mode for an Atlas editor: modal editing with the mode in a panel at the bottom (unless
 * `panel` is false, for a host that shows the mode itself through `data-vim-mode`, as
 * `vimNormalModeFont` does), the selection drawn so visual mode shows it, `u`,
 * `U`, and `Ctrl-r` on `history`, and the same layer in table cell editors. Vim's keys take
 * precedence in normal, visual, and operator-pending modes; in insert mode every other
 * binding still runs.
 */
export function vimMode(
  history: VimHistory,
  { panel = true }: { panel?: boolean } = {},
): Extension {
  configureVim();
  return [
    // Above the keymaps (which CodeMirror runs at default precedence), so normal-mode keys
    // reach Vim first; Vim passes on what it does not handle in insert mode. Vim's own panel
    // only opens for the ex line; the mode panel is this layer's.
    Prec.high(vim()),
    textwidthTracker,
    vimHistory.of(history),
    vimModeField,
    panel ? modePanelExtension : [],
    Prec.highest(editorSupport),
    restOnVisibleText,
    drawnSelection,
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

/**
 * Reports each command entered on the editor's ex line (`:`), without the colon, before Vim
 * runs it. Vim's ex line is an input in the editor's bottom panel; a search (`/`, `?`) is
 * not reported.
 */
export function vimExLine(onSubmit: (input: string, view: EditorView) => void): Extension {
  return ViewPlugin.define((view) => {
    const onKeyDown = (event: KeyboardEvent) => {
      const input = event.target;
      if (event.key !== "Enter" || event.isComposing) return;
      if (!(input instanceof HTMLInputElement) || !input.closest(".cm-panels")) return;
      // The prompt's prefix, the only text beside its input.
      if (input.parentElement?.textContent !== ":") return;
      onSubmit(input.value, view);
    };
    // Capturing, ahead of the input's own handler, which runs the command and closes the line.
    view.dom.addEventListener("keydown", onKeyDown, true);
    return { destroy: () => view.dom.removeEventListener("keydown", onKeyDown, true) };
  });
}

/** What a host does with the normal-mode keys `vimHostKeys` offers it. */
export interface VimHostKeys {
  /** The leader key in normal or visual mode; true when the host took it. */
  leader?: (view: EditorView) => boolean;
  /**
   * The leader key as `KeyboardEvent.key` names it, read at each key: Space (`" "`) when not
   * given, null for none.
   */
  leaderKey?: () => string | null;
  /** `:` in normal mode, in place of Vim's ex line; true when the host took it. */
  exLine?: (view: EditorView) => boolean;
  /** `<C-w>h`, `<C-w>j`, `<C-w>k`, `<C-w>l` (and the arrows) in normal mode: Vim's window keys. */
  window?: (view: EditorView, direction: VimWindowDirection) => void;
}

/**
 * Offers the host its leader key, Space unless it says otherwise (in normal and visual mode), and
 * `:` (in normal mode) ahead of Vim. A key the host declines stays Vim's: Space moves right, `:`
 * opens Vim's ex line. Only when Vim has nothing pending, so `3:`, `d<Space>`, and visual `:`
 * (with its `'<,'>` range) are always Vim's. Vim's window keys (`<C-w>h` …) go to `window`, as
 * keys of Vim's own (see `defineWindowKeys`). Does nothing in an editor without Vim.
 */
export function vimHostKeys(host: VimHostKeys): Extension {
  return [host.window ? vimWindowHost.of(host.window) : [], hostKeyHandler(host)];
}

function hostKeyHandler(host: VimHostKeys): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
        const state = vimState(view);
        if (!state || state.insertMode || !atRest(view)) return false;
        const leaderKey = host.leaderKey ? host.leaderKey() : " ";
        // Shift+Space is not Space.
        const isLeader =
          leaderKey !== null && event.key === leaderKey && !(leaderKey === " " && event.shiftKey);
        const take = isLeader
          ? host.leader
          : event.key === ":" && !state.visualMode
            ? host.exLine
            : undefined;
        if (!take?.(view)) return false;
        event.preventDefault();
        closeNotification(view);
        return true;
      },
    }),
  );
}

/**
 * Runs an ex command (without its colon) in `view` as Vim's ex line would: a host that took
 * `:` routes the editor's own commands (`:s/a/b/`, `:%s`, `:noh`, `:12`) back through this.
 */
export function runVimEx(view: EditorView, input: string) {
  const cm = getCM(view);
  if (cm && hasVim(cm)) Vim.handleEx(cm, input);
}

function hasVim(cm: VimCM): cm is VimCM & CodeMirrorV {
  return cm.state.vim != null;
}

/**
 * The vimrc's `textwidth` (what `gq` wraps to): an option each editor holds in the package, so
 * every Vim editor takes it as it starts and whenever it changes. Null leaves the package's 80.
 */
let vimrcTextwidth: number | null = null;
const vimEditors = new Set<EditorView>();

function applyTextwidth(view: EditorView) {
  getCM(view)?.setOption("textwidth", vimrcTextwidth ?? undefined);
}

const textwidthTracker = ViewPlugin.define((view) => {
  vimEditors.add(view);
  // After Vim's own plugin has attached its CodeMirror adapter.
  queueMicrotask(() => applyTextwidth(view));
  return { destroy: () => vimEditors.delete(view) };
});

const TEXTWIDTH_NAMES = new Set(["textwidth", "tw"]);

/** The part of `Vim` a vimrc uses; a mapping for every mode (`:map`) has no context. */
interface VimConfiguration {
  map(lhs: string, rhs: string, context?: string): void;
  noremap(lhs: string, rhs: string, context?: string): void;
  unmap(lhs: string, context?: string): unknown;
  setOption(name: string, value: unknown): Error | undefined;
  getOption(name: string): unknown;
}

const vimGlobals: VimConfiguration = Vim;

/**
 * Vim's shared configuration (every Vim editor on the page), as a vimrc applies it: see
 * `createVimrcApplier` in `@t3tools/shared/vimrc`. `textwidth` reaches each editor.
 */
export const vimConfiguration: VimConfiguration = {
  // Configured first, so a vimrc applied before any editor mounts maps after the window keys.
  map: (lhs, rhs, context) => (configureVim(), vimGlobals.map(lhs, rhs, context)),
  noremap: (lhs, rhs, context) => (configureVim(), vimGlobals.noremap(lhs, rhs, context)),
  unmap: (lhs, context) => (configureVim(), vimGlobals.unmap(lhs, context)),
  setOption(name, value) {
    if (!TEXTWIDTH_NAMES.has(name)) return vimGlobals.setOption(name, value);
    vimrcTextwidth = typeof value === "number" && value > 1 ? Math.round(value) : null;
    for (const view of vimEditors) applyTextwidth(view);
    return undefined;
  },
  getOption: (name) =>
    TEXTWIDTH_NAMES.has(name) ? (vimrcTextwidth ?? 80) : vimGlobals.getOption(name),
};
