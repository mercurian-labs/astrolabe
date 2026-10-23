import type { SyntaxNode } from "@lezer/common";
import { calloutOf } from "../documentIndex.ts";
import { lineMarkers, withSpace } from "../lineMarkers.ts";
import { katexLoaded } from "../math.ts";
import { manuallyUnfolded } from "../unfolded.ts";
import {
  bulletWidget,
  CalloutIconWidget,
  calloutFamily,
  CheckboxWidget,
  CodeLabelWidget,
  quoteWidget,
} from "../widgets.ts";
import { markClass, type Collector } from "./collector.ts";

// Block syntax reveals when a selection shares its line (section 2.1), and is replaced in
// place rather than removed where hiding it would move the line's text (section 2.4).

function hasAncestor(node: SyntaxNode, name: string) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === name) return true;
  }
  return false;
}

/** ATX headings: styled line, `# ` and any closing hashes hidden off-line. */
export function atxHeading(c: Collector, node: SyntaxNode) {
  const level = node.name.slice(-1);
  const line = c.state.doc.lineAt(node.from);
  c.lineClass(line.from, "cm-md-heading", `cm-md-h${level}`);
  c.lineAttributes(line.from, { role: "heading", "aria-level": level });
  const revealed = c.reveal.lines(node.from, node.to);
  let openEnd = node.from;
  for (let mark = node.firstChild; mark; mark = mark.nextSibling) {
    if (mark.name !== "HeaderMark") continue;
    if (mark.from === node.from) {
      openEnd = withSpace(c.state, mark.to, node.to);
      if (revealed) c.dim(mark.from, mark.to, "cm-md-heading-mark");
      else c.hide(mark.from, openEnd);
    } else if (revealed) {
      c.dim(mark.from, mark.to, "cm-md-heading-mark");
    } else {
      // A closing hash run takes the spaces before it along.
      let from = mark.from;
      while (from > openEnd && /[ \t]/.test(c.slice(from - 1, from))) from--;
      c.hide(from, mark.to);
    }
  }
}

/** Setext headings: styled text lines, the `===` / `---` underline hidden off the heading. */
export function setextHeading(c: Collector, node: SyntaxNode) {
  const level = node.name.slice(-1);
  const underline = node.lastChild?.name === "HeaderMark" ? node.lastChild : null;
  const underlineLine = underline ? c.state.doc.lineAt(underline.from) : null;
  const textEnd = underlineLine ? Math.max(node.from, underlineLine.from - 1) : node.to;
  c.eachLine(node.from, textEnd, (lineFrom, first) => {
    c.lineClass(lineFrom, "cm-md-heading", `cm-md-h${level}`);
    if (first) c.lineAttributes(lineFrom, { role: "heading", "aria-level": level });
  });
  if (!underline || !underlineLine) return;
  c.lineClass(underlineLine.from, "cm-md-setext-underline");
  if (c.reveal.lines(node.from, node.to)) c.dimNode(underline);
  else c.hideNode(underline);
}

/** Quote and callout line styling; the `>` marks themselves are handled per line. */
export function blockquote(c: Collector, node: SyntaxNode) {
  const callout = calloutOf(c.state, node);
  if (callout) {
    const family = calloutFamily(callout.type);
    c.eachLine(node.from, node.to, (lineFrom) => {
      c.lineClass(lineFrom, "cm-md-quote", "cm-md-callout");
      c.lineAttributes(lineFrom, { "data-callout": callout.type, "data-callout-family": family });
    });
    const header = c.state.doc.lineAt(callout.header.from);
    c.lineClass(header.from, "cm-md-callout-title");
    const { mark } = callout;
    if (c.reveal.lines(header.from, header.to)) {
      c.dim(mark.from, mark.to);
    } else {
      const end = withSpace(c.state, mark.to, header.to);
      const untitled = c.slice(end, callout.header.to).trim() === "";
      const fallback = untitled
        ? callout.type.charAt(0).toUpperCase() + callout.type.slice(1)
        : null;
      c.replace(mark.from, end, new CalloutIconWidget(callout.type, fallback));
    }
  } else if (!hasAncestor(node, "Blockquote")) {
    c.eachLine(node.from, node.to, (lineFrom) => c.lineClass(lineFrom, "cm-md-quote"));
  }
}

/**
 * One `> `: always drawn as the rail at its own width. There is no literal state; the
 * characters stay in the document, so Backspace still removes them.
 */
export function quoteMark(c: Collector, node: SyntaxNode) {
  const line = c.state.doc.lineAt(node.from);
  const end = withSpace(c.state, node.to, line.to);
  const quotes = lineMarkers(c.state, line.from).quotes;
  if (quotes[0]?.from !== line.from) {
    // A quote after other text on its line (inside a list item, say) keeps an inline slot.
    c.replace(node.from, end, quoteWidget(c.slice(node.from, end), null));
    return;
  }
  // Its level is the number of `>` marks before it on the line; the line's depth, which
  // sets its hanging indent, is the level of its last mark plus one.
  const level = Math.max(
    0,
    quotes.findIndex((mark) => mark.from === node.from),
  );
  c.replace(node.from, end, quoteWidget(c.slice(node.from, end), level));
  c.lineAttributes(line.from, { style: `--atlas-md-quote-depth: ${level + 1}` });
}

const GUIDE = markClass("cm-md-list-guide");

/** A faint vertical guide under each ancestor item's marker, on a nested item's first line. */
function listGuides(c: Collector, item: SyntaxNode, markFrom: number) {
  const line = c.state.doc.lineAt(markFrom);
  for (let parent = item.parent; parent; parent = parent.parent) {
    if (parent.name !== "ListItem") continue;
    const mark = parent.firstChild;
    if (mark?.name !== "ListMark") continue;
    const column = mark.from - c.state.doc.lineAt(mark.from).from;
    const pos = line.from + column;
    if (pos < markFrom && /[ \t]/.test(c.slice(pos, pos + 1))) {
      c.mark(pos, pos + 1, GUIDE);
      c.lineClass(line.from, "cm-md-list-line");
    }
  }
}

const NUMBER = markClass("cm-md-list-number");

/** Bullets are drawn in the marker's place; ordered numbers always show as typed. */
export function listMark(c: Collector, node: SyntaxNode) {
  const item = node.parent;
  if (!item) return;
  listGuides(c, item, node.from);
  if (item.parent?.name === "OrderedList") {
    c.mark(node.from, node.to, NUMBER);
    return;
  }
  const line = c.state.doc.lineAt(node.from);
  const taskMarker = item.getChild("Task")?.firstChild;
  if (taskMarker?.name === "TaskMarker" && taskMarker.from <= line.to) {
    // A task's checkbox takes the marker's slot, except while the caret is in the prefix.
    if (taskPrefixRevealed(c, taskMarker)) {
      c.dim(node.from, node.to, "cm-md-list-mark");
      return;
    }
    const status = c.slice(taskMarker.from + 1, taskMarker.from + 2);
    c.replace(node.from, node.to, new CheckboxWidget(c.slice(node.from, node.to), status));
    return;
  }
  // The literal marker shows only while the caret is within `[line start, marker end]`.
  if (c.reveal.prefix(line.from, node.to)) c.dim(node.from, node.to, "cm-md-list-mark");
  else c.replace(node.from, node.to, bulletWidget(c.slice(node.from, node.to)));
}

/** Whether a caret sits in a task's prefix, from the line start through the `]`. */
function taskPrefixRevealed(c: Collector, taskMarker: SyntaxNode) {
  return c.reveal.prefix(c.state.doc.lineAt(taskMarker.from).from, taskMarker.to);
}

const TASK_DONE = markClass("cm-md-task-done");
const TASK_CANCELLED = markClass("cm-md-task-done cm-md-task-cancelled");

/**
 * The `[ ]` of a task collapses to zero width, with its following space, since the
 * checkbox sits in the list marker's slot; within the prefix it shows dimmed instead.
 * Done and cancelled text is struck and muted.
 */
export function task(c: Collector, node: SyntaxNode) {
  const marker = node.firstChild;
  if (marker?.name !== "TaskMarker") return;
  const status = c.slice(marker.from + 1, marker.from + 2);
  if (taskPrefixRevealed(c, marker)) c.dim(marker.from, marker.to, "cm-md-list-mark");
  else c.hide(marker.from, withSpace(c.state, marker.to, node.to));
  if (status === "x" || status === "X") c.mark(marker.to, node.to, TASK_DONE);
  else if (status === "-") c.mark(marker.to, node.to, TASK_CANCELLED);
}

/** Code block lines; fenced blocks hide their fences off-block and show a language label. */
export function codeBlock(c: Collector, node: SyntaxNode) {
  const { doc } = c.state;
  const first = doc.lineAt(node.from);
  const fenced = node.name === "FencedCode";
  c.eachLine(node.from, node.to, (lineFrom, isFirst, isLast) => {
    c.lineClass(lineFrom, "cm-md-code");
    if (!fenced) c.lineClass(lineFrom, "cm-md-code-indented");
    if (isFirst) c.lineClass(lineFrom, "cm-md-code-first");
    if (isLast) c.lineClass(lineFrom, "cm-md-code-last");
  });
  if (!fenced) return;
  const open = node.firstChild?.name === "CodeMark" ? node.firstChild : null;
  const last = node.lastChild;
  // An unclosed fence has only its opening mark; the block then runs to the document end.
  const close = last?.name === "CodeMark" && last.from > first.to ? last : null;
  if (!open) return;
  if (c.reveal.lines(node.from, node.to)) {
    c.dim(open.from, first.to);
    c.dimNode(close);
    return;
  }
  const info = node.getChild("CodeInfo");
  const language = info ? (c.slice(info.from, info.to).split(/\s/)[0] ?? "") : "";
  c.hide(open.from, first.to);
  c.widget(first.to, new CodeLabelWidget(language), 1);
  if (close) c.hide(close.from, doc.lineAt(close.from).to);
}

/** Thematic breaks: drawn as a rule off-line, dimmed source on-line. */
export function horizontalRule(c: Collector, node: SyntaxNode) {
  const line = c.state.doc.lineAt(node.from);
  if (c.reveal.lines(node.from, node.to)) {
    c.dim(node.from, node.to);
  } else {
    c.hide(node.from, node.to);
    c.lineClass(line.from, "cm-md-hr");
  }
}

/** A single-line `[label]: url` definition: hidden off-line, dimmed on-line. */
export function linkDefinition(c: Collector, node: SyntaxNode) {
  const { doc } = c.state;
  if (doc.lineAt(node.from).number !== doc.lineAt(node.to).number) return;
  if (c.reveal.lines(node.from, node.to)) c.dim(node.from, node.to);
  else c.hide(node.from, node.to);
}

/** Unfolded frontmatter reads as code with dimmed fences; folding is the block field's job. */
export function frontmatter(c: Collector, node: SyntaxNode) {
  const unfolded = c.state.field(manuallyUnfolded, false)?.includes(node.from) ?? false;
  if (!unfolded && !c.reveal.lines(node.from, node.to)) return;
  c.eachLine(node.from, node.to, (lineFrom, isFirst, isLast) => {
    c.lineClass(lineFrom, "cm-md-code", "cm-md-frontmatter");
    if (isFirst) c.lineClass(lineFrom, "cm-md-code-first");
    if (isLast) c.lineClass(lineFrom, "cm-md-code-last");
  });
  for (let mark = node.firstChild; mark; mark = mark.nextSibling) {
    if (mark.name === "FrontmatterMark") c.dimNode(mark);
  }
}

/**
 * `$$ … $$` blocks drawn as source: math-styled lines, the `$$` fences hidden off-block
 * and dimmed on it. Rendered formulas are the block field's job once KaTeX has loaded.
 */
export function mathBlock(c: Collector, node: SyntaxNode) {
  if (!katexLoaded()) c.wantsMath = true;
  c.eachLine(node.from, node.to, (lineFrom) => c.lineClass(lineFrom, "cm-md-math-block"));
  const revealed = c.reveal.lines(node.from, node.to);
  for (let mark = node.firstChild; mark; mark = mark.nextSibling) {
    if (mark.name !== "MathBlockMark") continue;
    if (revealed) c.dimNode(mark);
    else c.hideNode(mark);
  }
}

const FOOTNOTE_LABEL = markClass("cm-md-footnote-label");

/** `[^1]: text` keeps its label visible and styled. */
export function footnoteDefinition(c: Collector, node: SyntaxNode) {
  const marks = node.getChildren("FootnoteMark");
  const open = marks[0];
  const close = marks[1];
  if (open && close) c.mark(open.from, close.to, FOOTNOTE_LABEL);
}

const TABLE_DELIMITER = markClass("cm-md-syntax cm-md-table-delimiter");

/** Table source, shown while the table is touched: `|` and the alignment row dimmed. */
export function tableDelimiter(c: Collector, node: SyntaxNode) {
  c.mark(node.from, node.to, TABLE_DELIMITER);
}

const htmlLabel = new CodeLabelWidget("html", false);

/**
 * HTML blocks are never rendered (section 4.12): they read as a code block, with an
 * `html` label on the first line and no copy button, and keep the markdown package's HTML
 * highlighting. Nothing is hidden and nothing reveals.
 */
export function htmlBlock(c: Collector, node: SyntaxNode) {
  c.eachLine(node.from, node.to, (lineFrom, isFirst, isLast) => {
    c.lineClass(lineFrom, "cm-md-code", "cm-md-html");
    if (isFirst) c.lineClass(lineFrom, "cm-md-code-first");
    if (isLast) c.lineClass(lineFrom, "cm-md-code-last");
  });
  c.widget(c.state.doc.lineAt(node.from).to, htmlLabel, 1);
}
