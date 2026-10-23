import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { normalizeLabel } from "../documentIndex.ts";
import { katexLoaded } from "../math.ts";
import { hardBreakWidget, MathWidget } from "../widgets.ts";
import { markClass, type Collector } from "./collector.ts";

// Inline syntax reveals only while a selection touches the element's own range
// (section 2.1): markers are hidden at zero width and dimmed when revealed.

const DELIMITED: Record<string, { mark: string; style: string }> = {
  Emphasis: { mark: "EmphasisMark", style: "cm-md-em" },
  StrongEmphasis: { mark: "EmphasisMark", style: "cm-md-strong" },
  Strikethrough: { mark: "StrikethroughMark", style: "cm-md-strike" },
  Highlight: { mark: "HighlightMark", style: "cm-md-highlight" },
  InlineMath: { mark: "InlineMathMark", style: "cm-md-math" },
};

const NESTING = new Set(["Emphasis", "StrongEmphasis", "Strikethrough", "Highlight"]);

/**
 * A delimited span reveals when the selection touches it or any emphasis span around it:
 * touching `**a *b* c**` anywhere shows the inner `*` as well.
 */
function delimitedTouched(c: Collector, node: SyntaxNode) {
  for (let span: SyntaxNode | null = node; span; span = span.parent) {
    if (span !== node && !NESTING.has(span.name)) break;
    if (c.reveal.inline(span.from, span.to)) return true;
  }
  return false;
}

/** `*x*`, `**x**`, `~~x~~`, `==x==`, `$x$`: the style covers the text between the markers. */
export function delimited(c: Collector, node: SyntaxNode) {
  const spec = DELIMITED[node.name];
  const open = node.firstChild;
  const close = node.lastChild;
  if (!spec || !open || !close || open.from === close.from) return;
  if (open.name !== spec.mark || close.name !== spec.mark) return;
  c.mark(open.to, close.from, markClass(spec.style));
  if (delimitedTouched(c, node)) {
    c.dimNode(open);
    c.dimNode(close);
  } else {
    c.hideNode(open);
    c.hideNode(close);
  }
}

/**
 * `$x$` (or `$$x$$` inside a paragraph): the rendered formula at rest, replacing the whole
 * source; touched, the source with dimmed dollars. Until KaTeX loads, the source at rest.
 */
export function inlineMath(c: Collector, node: SyntaxNode) {
  if (!katexLoaded()) {
    c.wantsMath = true;
    delimited(c, node);
    return;
  }
  const open = node.firstChild;
  const close = node.lastChild;
  if (open && close && open.from !== close.from && !c.reveal.inline(node.from, node.to)) {
    const display = open.to - open.from === 2;
    const widget = new MathWidget(c.slice(open.to, close.from), display, "inline");
    // A formula that spans lines stays source: a view plugin may not replace a line break.
    if (c.replace(node.from, node.to, widget)) return;
  }
  delimited(c, node);
}

const INLINE_CODE = markClass("cm-md-inline-code");

/** Code spans keep their background over revealed backticks, so the span reads as one. */
export function inlineCode(c: Collector, node: SyntaxNode) {
  const open = node.firstChild;
  const close = node.lastChild;
  c.mark(node.from, node.to, INLINE_CODE);
  if (!open || !close || open.from === close.from) return;
  if (c.reveal.inline(node.from, node.to)) {
    c.dimNode(open);
    c.dimNode(close);
  } else {
    c.hideNode(open);
    c.hideNode(close);
  }
}

/** `\*`: escapes are line-scoped; the backslash hides while the caret is off the line. */
export function escape(c: Collector, node: SyntaxNode) {
  if (c.reveal.lines(node.from, node.to)) c.dim(node.from, node.from + 1);
  else c.hide(node.from, node.from + 1);
}

/** Two trailing spaces or a trailing backslash: a return glyph off-range. */
export function hardBreak(c: Collector, node: SyntaxNode) {
  const end = c.slice(node.to - 1, node.to) === "\n" ? node.to - 1 : node.to;
  if (!c.reveal.inline(node.from, end)) c.replace(node.from, end, hardBreakWidget);
}

/** `#tag` and `#nested/tag`: a chip, never hidden. */
export function tag(c: Collector, node: SyntaxNode) {
  c.mark(
    node.from,
    node.to,
    Decoration.mark({
      class: "cm-md-tag",
      attributes: { "data-tag": c.slice(node.from + 1, node.to) },
    }),
  );
}

const FOOTNOTE_REF = markClass("cm-md-footnote-ref");
const FOOTNOTE_MISSING = markClass("cm-md-footnote-ref cm-md-footnote-missing");

/** `[^1]`: a superscript badge around the whole reference; nothing is hidden. */
export function footnoteReference(c: Collector, node: SyntaxNode) {
  const label = node.getChild("FootnoteLabel");
  if (!label) return;
  const known = c.index.footnotes.has(normalizeLabel(c.slice(label.from, label.to)));
  c.mark(node.from, node.to, known ? FOOTNOTE_REF : FOOTNOTE_MISSING);
}

const COMMENT = markClass("cm-md-comment");

/** `%%text%%` is editor-only: dimmed off-range, plain while being edited. */
export function noteComment(c: Collector, node: SyntaxNode) {
  if (!c.reveal.inline(node.from, node.to)) c.mark(node.from, node.to, COMMENT);
}

// Inline HTML reads as an inline code span with its HTML highlighting (section 4.12).
const HTML = markClass("cm-md-inline-code cm-md-html");

/**
 * An HTML tag, comment, or processing instruction inside a paragraph: its own inline code
 * span, every character kept, nothing revealed. Markdown between two tags stays Markdown,
 * as CommonMark reads it.
 */
export function inlineHtml(c: Collector, node: SyntaxNode) {
  c.mark(node.from, node.to, HTML);
}
