import { syntaxTree } from "@codemirror/language";
import type { EditorState, Line } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** The block syntax that opens a line, read from the syntax tree. */
export interface LineMarkers {
  line: Line;
  /** `>` marks on this line, outermost first. */
  quotes: SyntaxNode[];
  /** The innermost list marker on this line, with its item and list. */
  listMark: SyntaxNode | null;
  item: SyntaxNode | null;
  list: SyntaxNode | null;
  taskMarker: SyntaxNode | null;
  /** An ATX heading's opening `#` run. */
  headingMark: SyntaxNode | null;
  calloutMark: SyntaxNode | null;
  /** Where the line's text starts, after every block marker and the spaces that follow it. */
  textStart: number;
  /** Where the markers a live preview hides end; ordered-list numbers are never hidden. */
  hiddenEnd: number;
}

/** First position at or after `pos` that is not a space or tab, bounded by `end`. */
export function skipSpaces(state: EditorState, pos: number, end: number) {
  while (pos < end) {
    const ch = state.doc.sliceString(pos, pos + 1);
    if (ch !== " " && ch !== "\t") break;
    pos++;
  }
  return pos;
}

/** `to`, plus one following space when there is one: the separator that goes with a marker. */
export function withSpace(state: EditorState, to: number, end: number) {
  if (to >= end) return to;
  const ch = state.doc.sliceString(to, to + 1);
  return ch === " " || ch === "\t" ? to + 1 : to;
}

export function lineMarkers(state: EditorState, pos: number): LineMarkers {
  const line = state.doc.lineAt(pos);
  const result: LineMarkers = {
    line,
    quotes: [],
    listMark: null,
    item: null,
    list: null,
    taskMarker: null,
    headingMark: null,
    calloutMark: null,
    textStart: line.from,
    hiddenEnd: line.from,
  };
  const onLine = (node: { from: number; to: number }) =>
    node.from >= line.from && node.to <= line.to;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(ref) {
      if (ref.to < line.from) return false;
      switch (ref.name) {
        case "QuoteMark":
          if (onLine(ref)) result.quotes.push(ref.node);
          return false;
        case "ListMark":
          if (onLine(ref)) {
            result.listMark = ref.node;
            result.item = ref.node.parent;
            result.list = result.item?.parent ?? null;
          }
          return false;
        case "TaskMarker":
          if (onLine(ref)) result.taskMarker = ref.node;
          return false;
        case "HeaderMark": {
          const heading = ref.node.parent;
          if (onLine(ref) && heading?.name.startsWith("ATXHeading") && ref.from === heading.from)
            result.headingMark = ref.node;
          return false;
        }
        case "CalloutMark":
          if (onLine(ref)) result.calloutMark = ref.node;
          return false;
        case "FencedCode":
        case "CodeBlock":
        case "HTMLBlock":
        case "Frontmatter":
        case "MathBlock":
          // Lezer stores the `>` marks of a quoted leaf block's later lines inside the block;
          // nothing else in its body is a block marker.
          for (const mark of ref.node.getChildren("QuoteMark")) {
            if (onLine(mark)) result.quotes.push(mark);
          }
          return false;
        default:
          return true;
      }
    },
  });
  let text = line.from;
  let hidden = line.from;
  const lastQuote = result.quotes.at(-1);
  if (lastQuote) text = hidden = withSpace(state, lastQuote.to, line.to);
  if (result.listMark) {
    text = skipSpaces(state, result.listMark.to, line.to);
    if (result.list?.name === "BulletList") hidden = text;
  }
  if (result.taskMarker) text = hidden = skipSpaces(state, result.taskMarker.to, line.to);
  if (result.headingMark) text = hidden = withSpace(state, result.headingMark.to, line.to);
  if (result.calloutMark) text = hidden = withSpace(state, result.calloutMark.to, line.to);
  result.textStart = text;
  result.hiddenEnd = hidden;
  return result;
}
