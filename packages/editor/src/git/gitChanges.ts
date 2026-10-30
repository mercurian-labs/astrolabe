import { language, type Language } from "@codemirror/language";
import { Chunk, type DiffConfig } from "@codemirror/merge";
import {
  EditorSelection,
  EditorState,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  Text,
  type Extension,
  type Range,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  keymap,
  type Command,
  type KeyBinding,
} from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";
import { lineBlocks, setLineBlocks, type LineBlock } from "../blocks/lineBlocks.ts";
import { oldLinesBlock, oldTextStyles } from "../blocks/oldText.ts";

/**
 * Changes since a base text (a file's last commit): gutter strips per changed run of lines (a
 * hunk), collapsed until expanded; an expanded hunk shows its old lines above it under a bar to
 * restore it or step to its neighbours. Restoring is an ordinary edit.
 */

export type HunkKind = "added" | "modified" | "deleted";

/** One changed run of lines: in the document `from`–`to`, in the base `baseFrom`–`baseTo`. */
export interface Hunk {
  readonly kind: HunkKind;
  /** The start of its first line in the document; a deletion's is the line after it. */
  readonly from: number;
  /** The end of its last line in the document; a deletion's equals `from`. */
  readonly to: number;
  readonly baseFrom: number;
  readonly baseTo: number;
}

export type HunkCommand = "toggle" | "expandAll" | "restore" | "next" | "previous";

export interface GitChangesOptions {
  /** Each command's keys in CodeMirror's notation; a command left out has none. */
  readonly keys?: Partial<Record<HunkCommand, readonly string[]>>;
}

// Re-diffing is bounded: past this many changed characters a range falls back to a rougher diff.
const DIFF_CONFIG: DiffConfig = { scanLimit: 1000, timeout: 200 };

interface GitState {
  readonly base: Text | null;
  readonly chunks: readonly Chunk[];
  /** Positions in the document, one inside each expanded hunk, mapped through edits. */
  readonly expanded: readonly number[];
  /** What the expanded hunks' blocks last drew, to set them again only when it changes. */
  readonly drawn: Drawn;
}

/** The blocks as drawn: what they show, and where each hunk's sit, mapped through edits. */
interface Drawn {
  readonly key: string;
  readonly anchors: readonly number[];
}

const EMPTY: GitState = { base: null, chunks: [], expanded: [], drawn: { key: "", anchors: [] } };

const setBase = StateEffect.define<Text | null>();
const setExpanded = StateEffect.define<readonly number[]>({
  map: (positions, changes) => positions.map((pos) => changes.mapPos(pos, -1)),
});
/** Draws the expanded hunks again: their language changed. */
const redraw = StateEffect.define<null>();
/** The state the transaction extender worked out, so the field does not work it out again. */
const adopt = StateEffect.define<GitState>();

/** Sets the text the document is compared against, or none (no markers). */
export function setGitBase(text: string | null) {
  return setBase.of(text === null ? null : Text.of(text.split(/\r?\n/)));
}

function hunkOf(chunk: Chunk): Hunk {
  const kind: HunkKind =
    chunk.fromA === chunk.toA ? "added" : chunk.fromB === chunk.toB ? "deleted" : "modified";
  return {
    kind,
    from: chunk.fromB,
    to: kind === "deleted" ? chunk.fromB : chunk.endB,
    baseFrom: chunk.fromA,
    baseTo: chunk.toA,
  };
}

/** Whether `pos` lies in `hunk`: on one of its lines, or, for a deletion, where it was. */
function holds(hunk: Hunk, pos: number) {
  return hunk.from <= pos && pos <= hunk.to;
}

/** `expanded` with each position kept once per hunk, and positions in no hunk dropped. */
function resolveExpanded(hunks: readonly Hunk[], expanded: readonly number[]) {
  const kept: number[] = [];
  const seen = new Set<Hunk>();
  for (const pos of expanded) {
    const hunk = hunks.find((candidate) => holds(candidate, pos));
    if (!hunk || seen.has(hunk)) continue;
    seen.add(hunk);
    kept.push(pos);
  }
  return kept;
}

function advance(value: GitState, tr: Transaction): GitState {
  let { base, chunks, expanded, drawn } = value;
  if (tr.docChanged) {
    if (expanded.length > 0) expanded = expanded.map((pos) => tr.changes.mapPos(pos, -1));
    if (drawn.anchors.length > 0) {
      drawn = { ...drawn, anchors: drawn.anchors.map((pos) => tr.changes.mapPos(pos, 1)) };
    }
    if (base) chunks = Chunk.updateB(chunks, base, tr.newDoc, tr.changes, DIFF_CONFIG);
  }
  for (const effect of tr.effects) {
    if (effect.is(setBase)) {
      base = effect.value;
      chunks = base ? Chunk.build(base, tr.newDoc, DIFF_CONFIG) : [];
    } else if (effect.is(setExpanded)) {
      expanded = effect.value;
    }
  }
  if (base === value.base && chunks === value.chunks && expanded === value.expanded) return value;
  return { base, chunks, expanded: resolveExpanded(chunks.map(hunkOf), expanded), drawn };
}

const gitField = StateField.define<GitState>({
  create: () => EMPTY,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(adopt)) return effect.value;
    return advance(value, tr);
  },
});

/** The hunks of `state`'s document against its base, in document order; none without a base. */
export function gitHunks(state: EditorState): readonly Hunk[] {
  return (state.field(gitField, false)?.chunks ?? []).map(hunkOf);
}

/** The expanded hunks of `state`, in document order. */
export function expandedHunks(state: EditorState): readonly Hunk[] {
  const value = state.field(gitField, false);
  if (!value) return [];
  return value.chunks.map(hunkOf).filter((hunk) => value.expanded.some((pos) => holds(hunk, pos)));
}

/** Whether `state`'s editor shows changes against a base, so the hunk commands can act. */
export function hasGitChanges(state: EditorState): boolean {
  return state.field(gitField, false)?.base != null;
}

/** The base text `hunk` replaced, without the line break after its last line. */
function oldTextOf(base: Text, hunk: Hunk) {
  return base.sliceString(hunk.baseFrom, Math.min(hunk.baseTo, base.length)).replace(/\n$/, "");
}

/**
 * The hunks a selection touches: those with one of its lines, and a deletion whose lines went
 * just above or just below it.
 */
export function hunksTouching(state: EditorState, ranges = state.selection.ranges) {
  const doc = state.doc;
  return gitHunks(state).filter((hunk) =>
    ranges.some((range) => {
      const first = doc.lineAt(range.from).number;
      const last = doc.lineAt(range.to).number;
      if (hunk.kind === "deleted") {
        const at = doc.lineAt(hunk.from).number;
        return first <= at && last >= at - 1;
      }
      return first <= doc.lineAt(hunk.to).number && last >= doc.lineAt(hunk.from).number;
    }),
  );
}

/** The changes that put `hunks` back as the base has them. */
function restoreChanges(state: EditorState, hunks: readonly Hunk[]) {
  const value = state.field(gitField, false);
  const base = value?.base;
  if (!base) return [];
  const doc = state.doc;
  return hunks.map((hunk) => {
    const chunk = value.chunks.find((candidate) => candidate.fromB === hunk.from);
    const toB = Math.min(chunk?.toB ?? hunk.to, doc.length);
    return {
      from: hunk.from,
      to: toB,
      insert: base.sliceString(hunk.baseFrom, Math.min(hunk.baseTo, base.length)),
    };
  });
}

function restore(view: EditorView, hunks: readonly Hunk[]) {
  if (hunks.length === 0 || view.state.readOnly) return false;
  view.dispatch({
    changes: restoreChanges(view.state, hunks),
    userEvent: "input.restore",
    scrollIntoView: true,
  });
  return true;
}

/** Expands the touched hunks, or collapses them when all are already expanded. */
const toggleHunks: Command = (view) => {
  const touched = hunksTouching(view.state);
  if (touched.length === 0) return false;
  view.dispatch({ effects: setExpanded.of(toggled(view.state.field(gitField), touched)) });
  return true;
};

/** `value`'s expanded positions with `hunks` expanded, or collapsed when all already are. */
function toggled(value: GitState, hunks: readonly Hunk[]) {
  const isOpen = (hunk: Hunk) => value.expanded.some((pos) => holds(hunk, pos));
  return hunks.every(isOpen)
    ? value.expanded.filter((pos) => !hunks.some((hunk) => holds(hunk, pos)))
    : [...value.expanded, ...hunks.map((hunk) => hunk.from)];
}

const expandAllHunks: Command = (view) => {
  const hunks = gitHunks(view.state);
  if (hunks.length === 0) return false;
  view.dispatch({ effects: setExpanded.of(hunks.map((hunk) => hunk.from)) });
  return true;
};

/** Collapses every expanded hunk; false when none is, so Escape goes on to other uses. */
const collapseAllHunks: Command = (view) => {
  if ((view.state.field(gitField, false)?.expanded.length ?? 0) === 0) return false;
  view.dispatch({ effects: setExpanded.of([]) });
  return true;
};

const restoreHunks: Command = (view) => restore(view, hunksTouching(view.state));

/** The hunk after (`step` 1) or before (-1) the line holding `pos`, wrapping at the ends. */
export function hunkBeside(state: EditorState, pos: number, step: 1 | -1): Hunk | null {
  const hunks = gitHunks(state);
  if (hunks.length === 0) return null;
  const doc = state.doc;
  const line = doc.lineAt(pos).number;
  const start = (hunk: Hunk) => doc.lineAt(hunk.from).number;
  if (step === 1) return hunks.find((hunk) => start(hunk) > line) ?? hunks[0]!;
  return hunks.findLast((hunk) => start(hunk) < line) ?? hunks.at(-1)!;
}

function goToHunk(view: EditorView, hunk: Hunk | null) {
  if (!hunk) return false;
  const at = view.state.doc.lineAt(hunk.from).from;
  view.dispatch({
    selection: EditorSelection.cursor(at),
    effects: EditorView.scrollIntoView(at, { y: "nearest", yMargin: 48 }),
    userEvent: "select.hunk",
  });
  return true;
}

const nextHunk: Command = (view) =>
  goToHunk(view, hunkBeside(view.state, view.state.selection.main.head, 1));
const previousHunk: Command = (view) =>
  goToHunk(view, hunkBeside(view.state, view.state.selection.main.head, -1));

const COMMANDS: Record<HunkCommand, Command> = {
  toggle: toggleHunks,
  expandAll: expandAllHunks,
  restore: restoreHunks,
  next: nextHunk,
  previous: previousHunk,
};

/** Runs a hunk command in `view`, as its key would; false when there was nothing to act on. */
export function runHunkCommand(view: EditorView, command: HunkCommand): boolean {
  return hasGitChanges(view.state) && COMMANDS[command](view);
}

/** The hunk that replaced the base's lines from `baseFrom`, as the document now stands. */
function hunkFrom(state: EditorState, baseFrom: number) {
  return gitHunks(state).find((hunk) => hunk.baseFrom === baseFrom) ?? null;
}

/** A hunk's bar: Restore, then the hunks before and after. It floats over the hunk's top right. */
class HunkControlsWidget extends WidgetType {
  constructor(readonly baseFrom: number) {
    super();
  }

  override eq(other: HunkControlsWidget) {
    return other.baseFrom === this.baseFrom;
  }

  override toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "atlas-git-controls";
    const bar = document.createElement("div");
    bar.className = "atlas-git-controls-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Change");
    const button = (label: string, title: string, run: (hunk: Hunk) => void) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "atlas-git-control";
      element.textContent = label;
      element.title = title;
      element.setAttribute("aria-label", title);
      element.addEventListener("mousedown", (event) => event.preventDefault());
      element.addEventListener("click", (event) => {
        event.preventDefault();
        const hunk = hunkFrom(view.state, this.baseFrom);
        if (hunk) run(hunk);
      });
      bar.append(element);
    };
    button("Restore", "Restore this change", (hunk) => restore(view, [hunk]));
    button("↑", "Previous change", (hunk) => goToHunk(view, hunkBeside(view.state, hunk.from, -1)));
    button("↓", "Next change", (hunk) => goToHunk(view, hunkBeside(view.state, hunk.from, 1)));
    dom.append(bar);
    return dom;
  }

  override ignoreEvent() {
    return true;
  }

  override get estimatedHeight() {
    return 0;
  }
}

const OWNER = "git";

/**
 * The blocks for the expanded hunks in `value` over `doc`: each one's bar, then its old lines;
 * `key` names what they show and `anchors` where each hunk's sit.
 */
function expandedBlocks(value: GitState, doc: Text, syntax: Language | undefined) {
  const blocks: LineBlock[] = [];
  const keys: string[] = [syntax ? "coloured" : "plain"];
  const anchors: number[] = [];
  const base = value.base;
  if (!base) return { blocks, drawn: { key: "", anchors } };
  for (const chunk of value.chunks) {
    const hunk = hunkOf(chunk);
    if (!value.expanded.some((pos) => holds(hunk, pos))) continue;
    // A deletion at the end of a file without a final line break sits below its last line.
    const below = hunk.from === doc.length && hunk.from > doc.lineAt(hunk.from).from;
    const placement = below ? "below" : "above";
    const id = `hunk-${hunk.baseFrom}`;
    blocks.push({
      id: `${id}-controls`,
      placement,
      from: hunk.from,
      widget: new HunkControlsWidget(hunk.baseFrom),
      priority: 1,
      rows: 0,
    });
    const text = hunk.kind === "added" ? null : oldTextOf(base, hunk);
    if (text !== null) {
      blocks.push(
        oldLinesBlock(
          {
            key: id,
            text,
            tint: "var(--atlas-git-deleted, #d4524a)",
            className: "atlas-git-old-lines",
            label: "Lines before this change",
            ...(syntax ? { language: syntax } : {}),
            actions: [
              {
                label: "Restore",
                run: (view) => {
                  const current = hunkFrom(view.state, hunk.baseFrom);
                  if (current) restore(view, [current]);
                },
              },
            ],
          },
          hunk.from,
          placement,
        ),
      );
    }
    keys.push(`${id}:${placement}:${text ?? ""}`);
    anchors.push(hunk.from);
  }
  return { blocks, drawn: { key: keys.join("\n"), anchors } };
}

/** Whether `drawn` still shows `next` in `doc`: the same blocks, each still on its hunk's line. */
function stillDrawn(drawn: Drawn, next: Drawn, doc: Text) {
  return (
    drawn.key === next.key &&
    drawn.anchors.length === next.anchors.length &&
    drawn.anchors.every((pos, i) => doc.lineAt(pos).number === doc.lineAt(next.anchors[i]!).number)
  );
}

/**
 * Works out the field's next state once per transaction, and with it sets the expanded hunks'
 * blocks in the same transaction whenever what they draw changes.
 */
const syncBlocks = EditorState.transactionExtender.of((tr) => {
  const value = tr.startState.field(gitField, false);
  if (!value) return null;
  const redrawn = tr.effects.some((effect) => effect.is(redraw));
  const next = advance(value, tr);
  if (next === value && !redrawn) return null;
  const { blocks, drawn } = expandedBlocks(
    next,
    tr.newDoc,
    tr.startState.facet(language) ?? undefined,
  );
  if (!redrawn && stillDrawn(next.drawn, drawn, tr.newDoc)) return { effects: adopt.of(next) };
  return { effects: [adopt.of({ ...next, drawn }), setLineBlocks(OWNER, blocks)] };
});

/** Lines of the expanded hunks that are new, tinted. */
const newLineTint = EditorView.decorations.compute([gitField], (state) => {
  const ranges: Range<Decoration>[] = [];
  const doc = state.doc;
  for (const hunk of expandedHunks(state)) {
    if (hunk.kind === "deleted") continue;
    for (let pos = hunk.from; pos <= hunk.to;) {
      const line = doc.lineAt(pos);
      ranges.push(NEW_LINE.range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges);
});
const NEW_LINE = Decoration.line({ class: "atlas-git-new-line" });

class HunkMarker extends GutterMarker {
  constructor(
    readonly kind: HunkKind,
    readonly expanded: boolean,
  ) {
    super();
  }

  override eq(other: HunkMarker) {
    return other.kind === this.kind && other.expanded === this.expanded;
  }

  override toDOM() {
    const dom = document.createElement("div");
    dom.className = `atlas-git-marker atlas-git-${this.kind}`;
    if (this.expanded) dom.classList.add("atlas-git-marker-expanded");
    return dom;
  }
}

const MARKERS: Record<string, HunkMarker> = {};
function marker(kind: HunkKind, expanded: boolean) {
  return (MARKERS[`${kind}:${expanded}`] ??= new HunkMarker(kind, expanded));
}

/**
 * One marker per line a hunk covers, and a deletion's on the line after it (or its last), for
 * the lines from `from` to `to` (the viewport: the gutter asks again on every update).
 */
function hunkMarkers(state: EditorState, { from, to }: { from: number; to: number }) {
  const doc = state.doc;
  const open = expandedHunks(state);
  const ranges: Range<GutterMarker>[] = [];
  for (const hunk of gitHunks(state)) {
    if (hunk.to < from || hunk.from > to) continue;
    const expanded = open.some((o) => o.from === hunk.from);
    if (hunk.kind === "deleted") {
      ranges.push(marker("deleted", expanded).range(doc.lineAt(hunk.from).from));
      continue;
    }
    for (let pos = Math.max(hunk.from, from); pos <= Math.min(hunk.to, to);) {
      const line = doc.lineAt(pos);
      ranges.push(marker(hunk.kind, expanded).range(line.from));
      pos = line.to + 1;
    }
  }
  return RangeSet.of(ranges, true);
}

const hunkGutter = gutter({
  class: "atlas-git-gutter",
  markers: (view) => hunkMarkers(view.state, view.viewport),
  lineMarkerChange: (update) => update.startState.field(gitField) !== update.state.field(gitField),
  domEventHandlers: {
    mousedown(view, line) {
      const ranges = [EditorSelection.range(line.from, line.to)];
      const touched = hunksTouching(view.state, ranges).filter((hunk) =>
        hunk.kind === "deleted" ? view.state.doc.lineAt(hunk.from).from === line.from : true,
      );
      if (touched.length === 0) return false;
      view.dispatch({ effects: setExpanded.of(toggled(view.state.field(gitField), touched)) });
      return true;
    },
  },
});

/** Draws the expanded hunks again once the file's language has loaded, to colour their lines. */
const languageWatch = ViewPlugin.define((view) => ({
  update(update) {
    if (update.startState.facet(language) === update.state.facet(language)) return;
    if (update.state.field(gitField).expanded.length === 0) return;
    queueMicrotask(() => {
      if (view.state.field(gitField, false)) view.dispatch({ effects: redraw.of(null) });
    });
  },
}));

const theme = EditorView.baseTheme({
  ".atlas-git-gutter": { width: "6px", paddingLeft: "2px" },
  ".atlas-git-gutter .cm-gutterElement": { position: "relative", cursor: "pointer" },
  ".atlas-git-marker": { position: "absolute", inset: "0 1px 0 0", borderRadius: "1px" },
  ".atlas-git-added": { background: "var(--atlas-git-added, #3f9d54)" },
  ".atlas-git-modified": { background: "var(--atlas-git-modified, #c9971c)" },
  // A deletion has no line of its own: a notch on the line below where its lines were.
  ".atlas-git-deleted": {
    inset: "-3px -1px auto -1px",
    height: "6px",
    borderRadius: "0 3px 3px 0",
    background: "var(--atlas-git-deleted, #d4524a)",
  },
  ".atlas-git-new-line": {
    backgroundColor: "color-mix(in srgb, var(--atlas-git-added, #3f9d54) 10%, transparent)",
  },
  ".atlas-git-old-lines": { "--atlas-old-text-strength": "12%" },
  ".atlas-git-controls": { position: "relative", height: "0" },
  ".atlas-git-controls-bar": {
    position: "absolute",
    right: "8px",
    top: "2px",
    zIndex: "2",
    display: "flex",
    gap: "2px",
    padding: "2px",
    border: "1px solid var(--atlas-md-border-color, #e4e0d8)",
    borderRadius: "5px",
    background: "var(--atlas-md-menu-bg, #ffffff)",
    color: "var(--atlas-md-menu-color, #1f1d1a)",
    fontFamily: "var(--atlas-md-font-ui, inherit)",
    fontSize: "11px",
    lineHeight: "1.4",
  },
  "&dark .atlas-git-controls-bar": {
    borderColor: "var(--atlas-md-border-color, #33312d)",
    background: "var(--atlas-md-menu-bg, #24221f)",
    color: "var(--atlas-md-menu-color, #ebe8e2)",
  },
  ".atlas-git-control": {
    font: "inherit",
    padding: "0 0.5em",
    border: "none",
    borderRadius: "3px",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  ".atlas-git-control:hover": {
    background: "var(--atlas-md-menu-hover-bg, rgba(127, 127, 127, 0.14))",
  },
});

function bindings(keys: GitChangesOptions["keys"]): KeyBinding[] {
  const bound: KeyBinding[] = [];
  for (const command of Object.keys(COMMANDS) as HunkCommand[]) {
    for (const key of keys?.[command] ?? []) {
      bound.push({ key, run: COMMANDS[command], preventDefault: true });
    }
  }
  return bound;
}

let vimKeysDefined = false;

/** Vim's `]c` and `[c` step to the next and previous hunk, in normal mode, where there are hunks. */
function defineVimKeys() {
  if (vimKeysDefined) return;
  vimKeysDefined = true;
  Vim.defineAction("atlasNextHunk", (cm) => void runHunkCommand(cm.cm6, "next"));
  Vim.defineAction("atlasPreviousHunk", (cm) => void runHunkCommand(cm.cm6, "previous"));
  Vim.mapCommand("]c", "action", "atlasNextHunk", {}, { context: "normal" });
  Vim.mapCommand("[c", "action", "atlasPreviousHunk", {}, { context: "normal" });
}

/**
 * Change markers against a base text set with `setGitBase`, with their commands on `keys`.
 * Escape collapses expanded hunks, below other uses of Escape (closing the find bar).
 */
export function gitChanges(options: GitChangesOptions = {}): Extension {
  defineVimKeys();
  return [
    gitField,
    syncBlocks,
    lineBlocks,
    oldTextStyles,
    hunkGutter,
    newLineTint,
    languageWatch,
    theme,
    keymap.of(bindings(options.keys)),
    Prec.low(keymap.of([{ key: "Escape", run: collapseAllHunks }])),
  ];
}
