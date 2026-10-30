import {
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";

import { type ExcerptBounds, mapBounds } from "./excerpts.ts";

/**
 * Astrolabe: an editor that holds a whole file but shows one excerpt of it, for a multi-file view
 * of stacked editors. The lines outside the excerpt are folded into a bar that expands it; the
 * caret, selections and typed edits stay inside, and the arrow keys hand over to the excerpt above
 * or below at its edges. Edits from elsewhere land anywhere and move the excerpt with them.
 */

export type ExcerptEdge = "up" | "down";

/** What an excerpt's editor asks of the view it is stacked in. */
export interface ExcerptControls {
  /** Grows this excerpt by `up` lines above and `down` below (0 for the default amount). */
  readonly expand: (up: number, down: number) => void;
  /** The caret left this excerpt past an edge, at `column` on its line. */
  readonly leave: (edge: ExcerptEdge, column: number) => void;
  /** Opens this file in its own tab at the caret's line. */
  readonly open: (line: number) => void;
  /** Moves to the first excerpt of the next or previous file. */
  readonly jumpFile: (direction: 1 | -1) => void;
}

/** A range the excerpt is about (a match, a problem), marked in the text. */
export interface ExcerptMark {
  readonly from: number;
  readonly to: number;
  readonly className?: string;
}

interface ExcerptValue {
  readonly bounds: ExcerptBounds;
  readonly marks: readonly ExcerptMark[];
}

/** Marks an excerpt's editor, for the `multibufferFocus` keybinding condition. */
export const EXCERPT_ATTRIBUTE = "data-excerpt";

export const setExcerptBounds = StateEffect.define<ExcerptBounds>();
export const setExcerptMarks = StateEffect.define<readonly ExcerptMark[]>();

const controlsFacet = Facet.define<ExcerptControls, ExcerptControls | null>({
  combine: (values) => values[0] ?? null,
});

function clampBounds(bounds: ExcerptBounds, state: EditorState): ExcerptBounds {
  const doc = state.doc;
  const from = doc.lineAt(Math.min(Math.max(bounds.from, 0), doc.length)).from;
  const to = doc.lineAt(Math.min(Math.max(bounds.to, from), doc.length)).to;
  return from === bounds.from && to === bounds.to ? bounds : { from, to };
}

function nextValue(value: ExcerptValue, tr: Transaction): ExcerptValue {
  let { bounds, marks } = value;
  if (tr.docChanged) {
    bounds = mapBounds(bounds, tr.changes, tr.state.doc);
    marks = marks.flatMap((mark) => {
      const from = tr.changes.mapPos(mark.from, 1);
      const to = tr.changes.mapPos(mark.to, -1);
      return to < from ? [] : [{ ...mark, from, to }];
    });
  }
  for (const effect of tr.effects) {
    if (effect.is(setExcerptBounds)) bounds = clampBounds(effect.value, tr.state);
    if (effect.is(setExcerptMarks)) marks = effect.value;
  }
  return bounds === value.bounds && marks === value.marks ? value : { bounds, marks };
}

const excerptField = StateField.define<ExcerptValue>({
  create: () => ({ bounds: { from: 0, to: 0 }, marks: [] }),
  update: nextValue,
});

/** The lines this editor shows, as positions. */
export function excerptBounds(state: EditorState): ExcerptBounds {
  return state.field(excerptField).bounds;
}

/** Whether this editor shows an excerpt. */
export function isExcerpt(state: EditorState): boolean {
  return state.field(excerptField, false) !== undefined;
}

export function excerptControls(state: EditorState): ExcerptControls | null {
  return state.facet(controlsFacet);
}

class HiddenLines extends WidgetType {
  constructor(
    readonly edge: ExcerptEdge,
    readonly lines: number,
  ) {
    super();
  }

  override eq(other: HiddenLines) {
    return other.edge === this.edge && other.lines === this.lines;
  }

  override toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = `atlas-excerpt-hidden atlas-excerpt-hidden-${this.edge}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "atlas-excerpt-expand";
    const arrow = this.edge === "up" ? "↑" : "↓";
    button.textContent = `${arrow} ${this.lines} more line${this.lines === 1 ? "" : "s"}`;
    button.title = this.edge === "up" ? "Show lines above" : "Show lines below";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const controls = view.state.facet(controlsFacet);
      if (this.edge === "up") controls?.expand(1, 0);
      else controls?.expand(0, 1);
    });
    dom.append(button);
    return dom;
  }

  override get estimatedHeight() {
    return 18;
  }

  override ignoreEvent() {
    return true;
  }
}

/** The runs outside the excerpt: [from, to) pairs, each covering whole lines. */
function hiddenRuns(state: EditorState): Array<{ from: number; to: number; edge: ExcerptEdge }> {
  const { from, to } = state.field(excerptField).bounds;
  const doc = state.doc;
  const runs: Array<{ from: number; to: number; edge: ExcerptEdge }> = [];
  if (from > 0) runs.push({ from: 0, to: from - 1, edge: "up" });
  if (to < doc.length) runs.push({ from: to + 1, to: doc.length, edge: "down" });
  return runs;
}

const hiddenDecorations = EditorView.decorations.compute([excerptField, "doc"], (state) => {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  for (const run of hiddenRuns(state)) {
    const lines = doc.lineAt(run.to).number - doc.lineAt(run.from).number + 1;
    builder.add(
      run.from,
      run.to,
      Decoration.replace({ widget: new HiddenLines(run.edge, lines), block: true }),
    );
  }
  return builder.finish();
});

const markDecorations = EditorView.decorations.compute([excerptField], (state): DecorationSet => {
  const marks = state.field(excerptField).marks;
  if (marks.length === 0) return Decoration.none;
  return Decoration.set(
    marks
      .filter((mark) => mark.to > mark.from)
      .map((mark) =>
        Decoration.mark({ class: mark.className ?? "atlas-excerpt-mark" }).range(
          mark.from,
          mark.to,
        ),
      ),
    true,
  );
});

const atomicHidden = EditorView.atomicRanges.of((view) => {
  const builder = new RangeSetBuilder<Decoration>();
  for (const run of hiddenRuns(view.state)) builder.add(run.from, run.to, Decoration.mark({}));
  return builder.finish();
});

// Typed edits never reach hidden lines, nor the line breaks that bound the excerpt.
const keepEditsInside = EditorState.changeFilter.of((tr) => {
  const { from, to } = tr.startState.field(excerptField).bounds;
  const length = tr.startState.doc.length;
  const blocked: number[] = [];
  if (from > 0) blocked.push(0, from);
  if (to < length) blocked.push(to, length);
  return blocked.length === 0 ? true : blocked;
});

// Selections stay on the excerpt's lines, whoever sets them (Vim, find, select all).
const keepSelectionInside = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;
  let value = tr.startState.field(excerptField);
  value = nextValue(value, tr);
  const { from, to } = value.bounds;
  const clamp = (pos: number) => Math.min(Math.max(pos, from), to);
  const selection = tr.selection;
  if (selection.ranges.every((range) => range.from >= from && range.to <= to)) return tr;
  const clamped = EditorSelection.create(
    selection.ranges.map((range) => EditorSelection.range(clamp(range.anchor), clamp(range.head))),
    selection.mainIndex,
  );
  return [tr, { selection: clamped, sequential: true }];
});

function crossEdge(edge: ExcerptEdge, byLine: boolean) {
  return (view: EditorView): boolean => {
    const state = view.state;
    const controls = state.facet(controlsFacet);
    const main = state.selection.main;
    if (controls === null || !main.empty || state.selection.ranges.length > 1) return false;
    const { from, to } = state.field(excerptField).bounds;
    const line = state.doc.lineAt(main.head);
    const atEdge = byLine
      ? edge === "up"
        ? line.from <= from
        : line.to >= to
      : edge === "up"
        ? main.head <= from
        : main.head >= to;
    if (!atEdge) return false;
    controls.leave(edge, byLine ? main.head - line.from : edge === "up" ? Infinity : 0);
    return true;
  };
}

const edgeKeys = Prec.high(
  keymap.of([
    { key: "ArrowUp", run: crossEdge("up", true) },
    { key: "ArrowDown", run: crossEdge("down", true) },
    { key: "ArrowLeft", run: crossEdge("up", false) },
    { key: "ArrowRight", run: crossEdge("down", false) },
  ]),
);

const theme = EditorView.baseTheme({
  ".atlas-excerpt-hidden": { display: "flex", height: "18px", alignItems: "center" },
  ".atlas-excerpt-expand": {
    font: "inherit",
    fontSize: "11px",
    padding: "0 6px",
    border: "none",
    background: "transparent",
    color: "var(--atlas-md-syntax-color, #888)",
    cursor: "pointer",
  },
  ".atlas-excerpt-expand:hover": { color: "inherit", textDecoration: "underline" },
  ".atlas-excerpt-mark": {
    backgroundColor: "var(--atlas-excerpt-mark, color-mix(in oklab, #e0b400 35%, transparent))",
    borderRadius: "2px",
  },
});

/** The keys an excerpt adds, in CodeMirror's notation. */
export interface ExcerptKeys {
  readonly expand: readonly string[];
  readonly open: readonly string[];
  readonly nextFile: readonly string[];
  readonly previousFile: readonly string[];
}

/** Keys for the excerpt's own commands: put in a compartment so they can be rebound. */
export function excerptKeys(keys: ExcerptKeys): Extension {
  const withControls = (run: (controls: ExcerptControls, view: EditorView) => void) => {
    return (view: EditorView) => {
      const controls = view.state.facet(controlsFacet);
      if (controls === null) return false;
      run(controls, view);
      return true;
    };
  };
  return Prec.high(
    keymap.of([
      ...keys.expand.map((key) => ({ key, run: withControls((c) => c.expand(0, 0)) })),
      ...keys.open.map((key) => ({
        key,
        run: withControls((c, view) =>
          c.open(view.state.doc.lineAt(view.state.selection.main.head).number),
        ),
      })),
      ...keys.nextFile.map((key) => ({ key, run: withControls((c) => c.jumpFile(1)) })),
      ...keys.previousFile.map((key) => ({ key, run: withControls((c) => c.jumpFile(-1)) })),
    ]),
  );
}

/** The excerpt itself: the lines it shows and what it marks, and how it reaches its neighbours. */
export function excerpt(options: {
  readonly bounds: ExcerptBounds;
  readonly marks?: readonly ExcerptMark[];
  readonly controls: ExcerptControls;
}): Extension {
  return [
    excerptField.init((state) => ({
      bounds: clampBounds(options.bounds, state),
      marks: options.marks ?? [],
    })),
    controlsFacet.of(options.controls),
    hiddenDecorations,
    markDecorations,
    atomicHidden,
    keepEditsInside,
    keepSelectionInside,
    edgeKeys,
    theme,
    EditorView.editorAttributes.of({ [EXCERPT_ATTRIBUTE]: "" }),
  ];
}

/** Places the caret on the excerpt's first or last line, at `column` (clamped to the line). */
export function enterExcerpt(state: EditorState, line: "first" | "last", column: number) {
  const { from, to } = state.field(excerptField).bounds;
  const target = state.doc.lineAt(line === "first" ? from : to);
  const head = target.from + Math.min(Math.max(column, 0), target.length);
  return { selection: { anchor: head }, scrollIntoView: true };
}
