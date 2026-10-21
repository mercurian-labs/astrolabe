import { type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { DocumentIndex } from "../documentIndex.ts";
import {
  overlapsAny,
  previewExclusions,
  type PreviewRange,
  type ResolvedConfig,
} from "../config.ts";
import type { Reveal } from "../reveal.ts";

// One decoration value per look, shared across rebuilds, so unchanged ranges compare equal
// and CodeMirror leaves their DOM alone.
const hidden = Decoration.replace({});
const markCache = new Map<string, Decoration>();
const lineCache = new Map<string, Decoration>();

/** The shared mark decoration for a class list. */
export function markClass(className: string) {
  let deco = markCache.get(className);
  if (!deco) {
    deco = Decoration.mark({ class: className });
    markCache.set(className, deco);
  }
  return deco;
}

const SYNTAX = "cm-md-syntax";

type Attributes = Record<string, string>;

/**
 * Gathers the decorations for one rebuild. Hidden syntax and replacing widgets go into the
 * atomic set as well, since only syntax is ever atomic.
 */
export class Collector {
  private readonly ranges: Range<Decoration>[] = [];
  private readonly atomicRanges: Range<Decoration>[] = [];
  private readonly lines = new Map<number, { classes: Set<string>; attributes: Attributes }>();
  /** Set when math showed as source because KaTeX has not loaded; the view then loads it. */
  wantsMath = false;
  /** Host-drawn ranges (`previewExclusions`): nothing here hides, replaces, or widgets them. */
  readonly excluded: readonly PreviewRange[];

  constructor(
    readonly state: EditorState,
    readonly reveal: Reveal,
    readonly index: DocumentIndex,
    readonly config: ResolvedConfig,
    /** The rendered viewport; per-line work stays inside it. */
    readonly from: number,
    readonly to: number,
  ) {
    this.excluded = state.facet(previewExclusions);
  }

  /** Whether `[from, to)` lies wholly inside a host-drawn range. */
  insideExcluded(from: number, to: number) {
    return this.excluded.some((range) => range.from <= from && to <= range.to);
  }

  slice(from: number, to: number) {
    return this.state.sliceDoc(from, to);
  }

  /**
   * Hides `[from, to)`. A view plugin may not hide a line break, so a range that crosses
   * lines is hidden one line segment at a time and its line breaks stay.
   */
  hide(from: number, to: number) {
    if (to <= from) return;
    for (const range of this.excluded) {
      if (range.from < to && from < range.to) {
        this.hide(from, range.from);
        this.hide(range.to, to);
        return;
      }
    }
    const { doc } = this.state;
    for (let pos = from; pos < to;) {
      const line = doc.lineAt(pos);
      const end = Math.min(to, line.to);
      if (end > pos) {
        const range = hidden.range(pos, end);
        this.ranges.push(range);
        this.atomicRanges.push(range);
      }
      pos = line.to + 1;
    }
  }

  /** Whether `[from, to)` stays within one line, so a widget may replace it. */
  singleLine(from: number, to: number) {
    return this.state.doc.lineAt(from).to >= to;
  }

  /**
   * Replaces `[from, to)` with a widget. Returns false, and replaces nothing, when the
   * range crosses a line break, which a view plugin may not replace, or overlaps a
   * host-drawn range.
   */
  replace(from: number, to: number, widget: WidgetType) {
    if (to <= from || !this.singleLine(from, to) || overlapsAny(this.excluded, from, to))
      return false;
    const range = Decoration.replace({ widget }).range(from, to);
    this.ranges.push(range);
    this.atomicRanges.push(range);
    return true;
  }

  widget(pos: number, widget: WidgetType, side: number) {
    if (overlapsAny(this.excluded, pos, pos)) return;
    this.ranges.push(Decoration.widget({ widget, side }).range(pos));
  }

  mark(from: number, to: number, deco: Decoration) {
    if (to > from) this.ranges.push(deco.range(from, to));
  }

  /** Revealed syntax: dimmed, at normal weight and style. */
  dim(from: number, to: number, extra = "") {
    this.mark(from, to, markClass(extra ? `${SYNTAX} ${extra}` : SYNTAX));
  }

  hideNode(node: SyntaxNode | null) {
    if (node) this.hide(node.from, node.to);
  }

  dimNode(node: SyntaxNode | null) {
    if (node) this.dim(node.from, node.to);
  }

  lineClass(pos: number, ...classes: string[]) {
    const entry = this.lineEntry(pos);
    for (const name of classes) entry.classes.add(name);
  }

  lineAttributes(pos: number, attributes: Attributes) {
    Object.assign(this.lineEntry(pos).attributes, attributes);
  }

  /** Calls `f` with each line start in `[from, to]` that falls inside the viewport. */
  eachLine(from: number, to: number, f: (lineFrom: number, first: boolean, last: boolean) => void) {
    const { doc } = this.state;
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    const start = Math.max(first, doc.lineAt(Math.max(this.from, from)).number);
    const end = Math.min(last, doc.lineAt(Math.min(this.to, to)).number);
    for (let n = start; n <= end; n++) f(doc.line(n).from, n === first, n === last);
  }

  finish(): { decorations: DecorationSet; atomic: DecorationSet } {
    for (const [pos, { classes, attributes }] of this.lines) {
      const className = [...classes].sort().join(" ");
      const key = `${className}|${JSON.stringify(attributes)}`;
      let deco = lineCache.get(key);
      if (!deco) {
        deco = Decoration.line({ class: className, attributes });
        lineCache.set(key, deco);
      }
      this.ranges.push(deco.range(pos));
    }
    return {
      decorations: Decoration.set(this.ranges, true),
      atomic: Decoration.set(this.atomicRanges, true),
    };
  }

  private lineEntry(pos: number) {
    let entry = this.lines.get(pos);
    if (!entry) {
      entry = { classes: new Set(), attributes: {} };
      this.lines.set(pos, entry);
    }
    return entry;
  }
}
