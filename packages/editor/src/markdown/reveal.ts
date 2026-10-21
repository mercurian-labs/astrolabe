import { StateEffect, StateField, type EditorState, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const focusedOnce = StateEffect.define<null>();

/**
 * Whether the editor has ever been focused. Until it has, nothing reveals, wherever the
 * initial selection sits; afterwards reveal follows the selection, through blurs too.
 */
// Annotated because the field's `provide` refers back to the field itself.
export const revealActive: StateField<boolean> = StateField.define<boolean>({
  create: () => false,
  update: (active, tr) => active || tr.effects.some((effect) => effect.is(focusedOnce)),
  provide: () =>
    EditorView.focusChangeEffect.of((state, focusing) =>
      focusing && !state.field(revealActive) ? focusedOnce.of(null) : null,
    ),
});

/** The effect the first focus dispatches; hosts and tests can dispatch it directly. */
export const markFocused = () => focusedOnce.of(null);

/** Line number of `pos`, where a range ending at column 0 belongs to the line before. */
function lastLineOf(doc: Text, from: number, to: number) {
  const line = doc.lineAt(to);
  return to > from && to === line.from ? line.number - 1 : line.number;
}

/**
 * Answers "is this element touched?" for one editor state. Inline elements are touched
 * when a selection range overlaps or abuts their range; block elements when a selection
 * range shares one of their lines.
 */
export class Reveal {
  private readonly lineSpans: readonly (readonly [number, number])[];
  private readonly ranges: readonly { from: number; to: number }[];

  constructor(private readonly state: EditorState) {
    const active = state.field(revealActive, false) ?? false;
    this.ranges = active ? state.selection.ranges : [];
    this.lineSpans = this.ranges.map((range) => [
      state.doc.lineAt(range.from).number,
      lastLineOf(state.doc, range.from, range.to),
    ]);
  }

  /** An inline element `[from, to)` is touched by a range `[a, b]` when `a <= to && b >= from`. */
  inline(from: number, to: number) {
    return this.ranges.some((range) => range.from <= to && range.to >= from);
  }

  /**
   * A list or task marker prefix `[lineStart, markerEnd]` is touched like an inline range:
   * only a selection within or at the edges of the prefix shows the literal marker.
   */
  prefix(from: number, to: number) {
    return this.inline(from, to);
  }

  /** A block element is touched when a range's line span meets the element's line span. */
  lines(from: number, to: number) {
    if (this.lineSpans.length === 0) return false;
    const first = this.state.doc.lineAt(from).number;
    const last = lastLineOf(this.state.doc, from, to);
    return this.lineSpans.some(([a, b]) => a <= last && b >= first);
  }
}
