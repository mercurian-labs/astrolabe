import { type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/**
 * Astrolabe: what a multi-file view marks in its excerpts. Search results mark every match of the
 * query in the lines on screen, as the text is now, so matches typed or edited away show at once;
 * a problems view marks each problem and writes its message below its line.
 */

const matchMark = Decoration.mark({ class: "atlas-excerpt-match" });

/**
 * Marks matches of `regexp` (global) in the visible lines; `accept` can turn one down (a whole-word
 * search's partial matches).
 */
export function matchHighlight(
  regexp: RegExp,
  accept?: (line: string, start: number, end: number) => boolean,
): Extension {
  const decorator = new MatchDecorator({
    regexp,
    decorate: (add, from, to, _match, view) => {
      if (to <= from) return;
      if (accept !== undefined) {
        const line = view.state.doc.lineAt(from);
        if (!accept(line.text, from - line.from, to - line.from)) return;
      }
      add(from, to, matchMark);
    },
  });
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorator.createDeco(view);
        }
        update(update: ViewUpdate) {
          this.decorations = decorator.updateDeco(update, this.decorations);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    highlightTheme,
  ];
}

export type ProblemSeverity = "error" | "warning" | "info" | "hint";

/** A problem in a file: 1-based lines and columns, as the environment lists them. */
export interface ExcerptProblem {
  readonly severity: ProblemSeverity;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly message: string;
  readonly source?: string | undefined;
}

class ProblemMessages extends WidgetType {
  constructor(readonly problems: readonly ExcerptProblem[]) {
    super();
  }

  override eq(other: ProblemMessages) {
    return (
      other.problems.length === this.problems.length &&
      other.problems.every(
        (problem, index) =>
          problem.message === this.problems[index]!.message &&
          problem.severity === this.problems[index]!.severity,
      )
    );
  }

  override toDOM() {
    const dom = document.createElement("div");
    dom.className = "atlas-excerpt-problems";
    for (const problem of this.problems) {
      const row = document.createElement("div");
      row.className = `atlas-excerpt-problem atlas-excerpt-problem-${problem.severity}`;
      row.textContent = problem.source ? `${problem.message} (${problem.source})` : problem.message;
      dom.append(row);
    }
    return dom;
  }

  override ignoreEvent() {
    return false;
  }
}

/**
 * Underlines each problem and writes the messages of each line below it. The problems are as the
 * environment last reported them; positions are clamped to the text as it is now.
 */
export function problemMarks(problems: readonly ExcerptProblem[]): Extension {
  if (problems.length === 0) return [];
  return [
    EditorView.decorations.compute(["doc"], (state) => {
      const doc = state.doc;
      const ranges: Range<Decoration>[] = [];
      const byLine = new Map<number, ExcerptProblem[]>();
      for (const problem of problems) {
        if (problem.line < 1 || problem.line > doc.lines) continue;
        const start = doc.line(problem.line);
        const end = doc.line(Math.min(Math.max(problem.endLine, problem.line), doc.lines));
        const from = start.from + Math.min(Math.max(problem.column - 1, 0), start.length);
        let to = end.from + Math.min(Math.max(problem.endColumn - 1, 0), end.length);
        if (to <= from) to = Math.min(from + 1, start.to);
        if (to > from) {
          ranges.push(
            Decoration.mark({ class: `atlas-excerpt-underline-${problem.severity}` }).range(
              from,
              to,
            ),
          );
        }
        const list = byLine.get(start.number) ?? [];
        list.push(problem);
        byLine.set(start.number, list);
      }
      for (const [line, list] of byLine) {
        ranges.push(
          Decoration.widget({ widget: new ProblemMessages(list), block: true, side: 1 }).range(
            doc.line(line).to,
          ),
        );
      }
      return Decoration.set(ranges, true);
    }),
    highlightTheme,
  ];
}

const highlightTheme = EditorView.baseTheme({
  ".atlas-excerpt-match": {
    backgroundColor: "var(--atlas-excerpt-match, color-mix(in oklab, #e0b400 35%, transparent))",
    borderRadius: "2px",
  },
  ".atlas-excerpt-problems": {
    padding: "1px 0 3px",
    fontFamily: "var(--atlas-md-font-ui, inherit)",
    fontSize: "12px",
  },
  ".atlas-excerpt-problem": { paddingLeft: "6px", borderLeft: "2px solid currentColor" },
  ".atlas-excerpt-problem-error": { color: "var(--atlas-diagnostic-error, #d4524a)" },
  ".atlas-excerpt-problem-warning": { color: "var(--atlas-diagnostic-warning, #c9971c)" },
  ".atlas-excerpt-problem-info, .atlas-excerpt-problem-hint": {
    color: "var(--atlas-diagnostic-info, #6b7a99)",
  },
  ".atlas-excerpt-underline-error": {
    textDecoration: "underline wavy var(--atlas-diagnostic-error, #d4524a)",
    textUnderlineOffset: "3px",
  },
  ".atlas-excerpt-underline-warning": {
    textDecoration: "underline wavy var(--atlas-diagnostic-warning, #c9971c)",
    textUnderlineOffset: "3px",
  },
  ".atlas-excerpt-underline-info, .atlas-excerpt-underline-hint": {
    textDecoration: "underline dotted var(--atlas-diagnostic-info, #6b7a99)",
    textUnderlineOffset: "3px",
  },
});
