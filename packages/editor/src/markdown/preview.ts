import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, StateField, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { overlapsAny, previewConfig, previewExclusions } from "./config.ts";
import { documentIndex } from "./documentIndex.ts";
import { lineMarkers } from "./lineMarkers.ts";
import { katexLoaded, loadKatex, mathLoaded } from "./math.ts";
import { Reveal, revealActive } from "./reveal.ts";
import { widgetLines } from "./table.ts";
import {
  activeCell,
  activeLocation,
  activeSpot,
  selectedIn,
  TableWidget,
  tableSelection,
} from "./tableCells.ts";
import { manuallyUnfolded } from "./unfolded.ts";
import {
  foldedChevron,
  opensLink,
  MathWidget,
  openExternal,
  PropertiesWidget,
  unfoldedChevron,
} from "./widgets.ts";
import { Collector } from "./decorate/collector.ts";
import * as blocks from "./decorate/blocks.ts";
import * as inline from "./decorate/inline.ts";
import * as links from "./decorate/links.ts";

/** The TeX inside a closed `$$` block; null while the block is unclosed. */
function mathBlockTex(state: EditorState, node: SyntaxNode) {
  const marks = node.getChildren("MathBlockMark");
  const open = marks[0];
  const close = marks.at(-1);
  if (!open || !close || close.from === open.from) return null;
  return state.sliceDoc(open.to, close.from);
}

/**
 * Whether a table or `$$` block is drawn as a widget: while no selection is on its lines,
 * or, for a table, while one of its cells is being edited in place.
 */
function blockWidgetShown(state: EditorState, reveal: Reveal, node: SyntaxNode) {
  if (widgetLines(state, node) === null) return false;
  return !reveal.lines(node.from, node.to) || activeLocation(state)?.table.node.from === node.from;
}

/** Whether the block field draws a `$$` block as a rendered formula in place of its lines. */
function mathWidgetShown(state: EditorState, reveal: Reveal, node: SyntaxNode) {
  return (
    katexLoaded() && mathBlockTex(state, node) !== null && blockWidgetShown(state, reveal, node)
  );
}

/** Applies the decorator for one node; returns whether to descend into its children. */
function visit(c: Collector, ref: SyntaxNodeRef) {
  switch (ref.name) {
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
      blocks.atxHeading(c, ref.node);
      return true;
    case "SetextHeading1":
    case "SetextHeading2":
      blocks.setextHeading(c, ref.node);
      return true;
    case "Blockquote":
      blocks.blockquote(c, ref.node);
      return true;
    case "QuoteMark":
      blocks.quoteMark(c, ref.node);
      return false;
    case "ListMark":
      blocks.listMark(c, ref.node);
      return false;
    case "Task":
      blocks.task(c, ref.node);
      return true;
    case "FencedCode":
    case "CodeBlock":
      blocks.codeBlock(c, ref.node);
      // Only container marks sit inside a code block; the body is the nested language's.
      visitQuoteMarks(c, ref);
      return false;
    case "HorizontalRule":
      blocks.horizontalRule(c, ref.node);
      return false;
    case "LinkReference":
      blocks.linkDefinition(c, ref.node);
      return false;
    case "Frontmatter":
      blocks.frontmatter(c, ref.node);
      return false;
    case "MathBlock":
      if (!mathWidgetShown(c.state, c.reveal, ref.node)) {
        blocks.mathBlock(c, ref.node);
        visitQuoteMarks(c, ref);
      }
      return false;
    case "Table":
      // A table drawn as a widget has nothing of its own to decorate.
      return !blockWidgetShown(c.state, c.reveal, ref.node);
    case "FootnoteDefinition":
      blocks.footnoteDefinition(c, ref.node);
      return true;
    case "TableDelimiter":
      blocks.tableDelimiter(c, ref.node);
      return false;
    case "HTMLBlock":
    case "CommentBlock":
    case "ProcessingInstructionBlock":
      blocks.htmlBlock(c, ref.node);
      visitQuoteMarks(c, ref);
      return false;
    case "Emphasis":
    case "StrongEmphasis":
    case "Strikethrough":
    case "Highlight":
      inline.delimited(c, ref.node);
      return true;
    case "InlineMath":
      inline.inlineMath(c, ref.node);
      return false;
    case "InlineCode":
      inline.inlineCode(c, ref.node);
      return false;
    case "Escape":
      inline.escape(c, ref.node);
      return false;
    case "HardBreak":
      inline.hardBreak(c, ref.node);
      return false;
    case "Tag":
      inline.tag(c, ref.node);
      return false;
    case "FootnoteReference":
      inline.footnoteReference(c, ref.node);
      return false;
    case "NoteComment":
      inline.noteComment(c, ref.node);
      return false;
    case "HTMLTag":
    case "Comment":
    case "ProcessingInstruction":
      inline.inlineHtml(c, ref.node);
      return false;
    case "Link":
      links.link(c, ref.node);
      return true;
    case "Image":
      return !links.image(c, ref.node);
    case "Autolink":
      links.autolink(c, ref.node);
      return false;
    case "URL":
      links.bareUrl(c, ref.node);
      return false;
    case "WikiLink":
      links.wikiLink(c, ref.node);
      return false;
    case "Embed":
      links.embed(c, ref.node);
      return false;
    default:
      return true;
  }
}

/** Quote marks inside a leaf block that spans quoted lines, such as a quoted code block. */
function visitQuoteMarks(c: Collector, ref: SyntaxNodeRef) {
  for (const mark of ref.node.getChildren("QuoteMark")) blocks.quoteMark(c, mark);
}

/** Builds the preview decorations for the visible ranges of the view. */
function buildDecorations(view: EditorView) {
  const { state } = view;
  const index = documentIndex(state);
  const c = new Collector(
    state,
    new Reveal(state),
    index,
    state.facet(previewConfig),
    view.viewport.from,
    view.viewport.to,
  );
  const tree = syntaxTree(state);
  // A node that crosses from one visible range into the next is decorated once.
  const seen = new Set<string>();
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(ref) {
        if (ref.from < from || ref.to > to) {
          const key = `${ref.type.id}:${ref.from}:${ref.to}`;
          if (seen.has(key)) return true;
          seen.add(key);
        }
        // Syntax inside a host-drawn range is the host's to show.
        if (ref.to > ref.from && c.insideExcluded(ref.from, ref.to)) return false;
        return visit(c, ref);
      },
    });
  }
  // Math in a table drawn as a widget is never visited above, so the index answers for it.
  const wantsMath =
    c.wantsMath || index.mathBlocks.length > 0 || index.tables.some((table) => table.math);
  return { ...c.finish(), wantsMath };
}

const mathArrived = (update: ViewUpdate) =>
  update.transactions.some((tr) => tr.effects.some((effect) => effect.is(mathLoaded)));

const isComposing = (update: ViewUpdate) =>
  update.view.composing || update.transactions.some((tr) => tr.isUserEvent("input.type.compose"));

class PreviewView {
  decorations: DecorationSet = Decoration.none;
  atomic: DecorationSet = Decoration.none;
  private stale = false;
  private mathRequested = false;
  private destroyed = false;

  constructor(view: EditorView) {
    this.build(view);
  }

  private build(view: EditorView) {
    const built = buildDecorations(view);
    this.decorations = built.decorations;
    this.atomic = built.atomic;
    if (built.wantsMath && !this.mathRequested && !katexLoaded()) {
      // The first math node loads KaTeX; its arrival rebuilds this view and the block field.
      this.mathRequested = true;
      loadKatex().then(
        () => {
          if (!this.destroyed) view.dispatch({ effects: mathLoaded.of(null) });
        },
        () => {
          // Math stays styled source; the next view to meet math tries again.
        },
      );
    }
  }

  destroy() {
    this.destroyed = true;
  }

  update(update: ViewUpdate) {
    if (isComposing(update)) {
      // Rebuilding mid-composition would disturb the IME; map the old set through the
      // inserted text instead, so no hidden range covers new characters.
      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        this.atomic = this.atomic.map(update.changes);
      }
      this.stale = true;
      return;
    }
    if (
      this.stale ||
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      mathArrived(update) ||
      update.state.field(activeCell, false) !== update.startState.field(activeCell, false) ||
      update.state.field(revealActive) !== update.startState.field(revealActive) ||
      update.state.field(manuallyUnfolded) !== update.startState.field(manuallyUnfolded) ||
      update.state.facet(previewExclusions) !== update.startState.facet(previewExclusions) ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      this.stale = false;
      this.build(update.view);
    }
  }
}

/** The live-preview decorations: styling, hidden syntax, and widgets for the viewport. */
export const previewDecorations = ViewPlugin.fromClass(PreviewView, {
  decorations: (plugin) => plugin.decorations,
  provide: (plugin) =>
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
});

const FRONTMATTER_KEY = /^[^\s#-][^:]*:/;

interface Folds {
  decorations: DecorationSet;
  /** The folded ranges alone, which cursor motion treats as units. */
  atomic: DecorationSet;
  /** Set while an IME composition runs; the next other transaction rebuilds. */
  stale: boolean;
}

/**
 * Replacements that hide line breaks, which a view plugin may not provide. Frontmatter
 * collapses to a "Properties" line and `[!type]-` callout bodies fold under their header,
 * while no selection is in them and the user has not unfolded them by clicking; a
 * clicked-open block shows an open chevron on its first line that folds it again. Tables
 * and, once KaTeX has loaded, closed `$$` blocks are drawn as block widgets while no
 * selection is on their lines; a `$$` block being edited keeps its rendered formula as a
 * preview below its closing fence.
 */
function buildFolds(state: EditorState): Folds {
  const index = documentIndex(state);
  const reveal = new Reveal(state);
  const unfolded = state.field(manuallyUnfolded, false) ?? [];
  const excluded = state.facet(previewExclusions);
  const folds: Range<Decoration>[] = [];
  const widgets: Range<Decoration>[] = [];
  const openToggle = (from: number) =>
    widgets.push(
      Decoration.widget({ widget: unfoldedChevron, side: 1 }).range(state.doc.lineAt(from).to),
    );
  const { frontmatter } = index;
  if (frontmatter && unfolded.includes(frontmatter.from)) {
    openToggle(frontmatter.from);
  } else if (frontmatter && !reveal.lines(frontmatter.from, frontmatter.to)) {
    const first = state.doc.lineAt(frontmatter.from).number;
    const last = state.doc.lineAt(frontmatter.to).number;
    let keys = 0;
    for (let n = first + 1; n < last; n++) {
      if (FRONTMATTER_KEY.test(state.doc.line(n).text)) keys++;
    }
    folds.push(
      Decoration.replace({ widget: new PropertiesWidget(keys) }).range(
        frontmatter.from,
        frontmatter.to,
      ),
    );
  }
  for (const callout of index.foldableCallouts) {
    if (unfolded.includes(callout.from)) openToggle(callout.from);
    else if (!reveal.lines(callout.from, callout.to))
      folds.push(
        Decoration.replace({ widget: foldedChevron }).range(callout.headerEnd, callout.to),
      );
  }
  for (const table of index.tables) {
    const { node } = table;
    const lines = widgetLines(state, node);
    const active = activeSpot(state, table);
    if (lines && (active || !reveal.lines(node.from, node.to))) {
      const widget = new TableWidget(
        state,
        table,
        lines.from,
        lines.to,
        active,
        selectedIn(state, table),
      );
      folds.push(Decoration.replace({ widget, block: true }).range(lines.from, lines.to));
    }
  }
  for (const block of katexLoaded() ? index.mathBlocks : []) {
    const tex = mathBlockTex(state, block);
    const lines = widgetLines(state, block);
    if (tex === null || !lines) continue;
    if (reveal.lines(block.from, block.to)) {
      const widget = new MathWidget(tex, true, "preview");
      widgets.push(Decoration.widget({ widget, block: true, side: 1 }).range(lines.to));
    } else {
      const widget = new MathWidget(tex, true, "block");
      folds.push(Decoration.replace({ widget, block: true }).range(lines.from, lines.to));
    }
  }
  // A block that holds a host-drawn range stays source, so the host's drawing shows.
  const kept = excluded.length
    ? folds.filter((fold) => !overlapsAny(excluded, fold.from, fold.to))
    : folds;
  const atomic = Decoration.set(kept, true);
  return {
    decorations: widgets.length > 0 ? Decoration.set([...kept, ...widgets], true) : atomic,
    atomic,
    stale: false,
  };
}

export const previewFolds = StateField.define<Folds>({
  create: buildFolds,
  update(folds, tr) {
    if (tr.isUserEvent("input.type.compose")) {
      // Never introduce or remove a multi-line replacement under an IME composition.
      return tr.docChanged
        ? {
            decorations: folds.decorations.map(tr.changes),
            atomic: folds.atomic.map(tr.changes),
            stale: true,
          }
        : { ...folds, stale: true };
    }
    if (
      folds.stale ||
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((effect) => effect.is(mathLoaded)) ||
      // A reconfiguration (the editor turning read-only, say) changes what widgets draw.
      tr.reconfigured ||
      tr.state.field(activeCell, false) !== tr.startState.field(activeCell, false) ||
      tr.state.field(tableSelection, false) !== tr.startState.field(tableSelection, false) ||
      tr.state.field(revealActive) !== tr.startState.field(revealActive) ||
      tr.state.field(manuallyUnfolded) !== tr.startState.field(manuallyUnfolded) ||
      tr.state.facet(previewExclusions) !== tr.startState.facet(previewExclusions) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildFolds(tr.state);
    }
    return folds;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (folds) => folds.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

/**
 * Keyboard motion that lands a caret on a line at or inside its hidden block markers
 * (the `# ` of a heading, a bullet, a `>`) moves it to the first text character.
 */
export const snapPastHiddenMarkers = EditorState.transactionFilter.of((tr) => {
  if (
    !tr.selection ||
    tr.docChanged ||
    !tr.isUserEvent("select") ||
    tr.isUserEvent("select.pointer")
  )
    return tr;
  const before = tr.startState;
  if (!before.field(revealActive, false)) return tr;
  const oldReveal = new Reveal(before);
  let changed = false;
  const ranges = tr.selection.ranges.map((range, i) => {
    if (!range.empty) return range;
    const old = before.selection.ranges[i] ?? before.selection.main;
    const line = tr.state.doc.lineAt(range.head);
    if (line.number === before.doc.lineAt(old.head).number) return range;
    if (oldReveal.lines(line.from, line.from)) return range;
    const { hiddenEnd } = lineMarkers(tr.state, line.from);
    if (range.head >= hiddenEnd) return range;
    changed = true;
    return EditorSelection.cursor(hiddenEnd);
  });
  if (!changed) return tr;
  return [
    tr,
    { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true },
  ];
});

/**
 * Mod-click opens a link (or reports a wikilink to the host) without adding a cursor; a
 * plain click only places the caret. Hovering a code block shows its copy button.
 */
export const previewInteractions = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || !opensLink(view, event) || !(event.target instanceof Element))
      return false;
    const link = event.target.closest<HTMLElement>("[data-href], [data-wikilink]");
    if (!link || !view.contentDOM.contains(link)) return false;
    const { href, wikilink } = link.dataset;
    if (href) {
      event.preventDefault();
      openExternal(view, href);
      return true;
    }
    const open = view.state.facet(previewConfig).openWikilink;
    if (wikilink !== undefined && open) {
      event.preventDefault();
      open(wikilink);
      return true;
    }
    return false;
  },
  mouseover(event, view) {
    if (!(event.target instanceof Element)) return false;
    let line = event.target.closest(".cm-line");
    while (
      line &&
      line.classList.contains("cm-md-code") &&
      !line.classList.contains("cm-md-code-first")
    )
      line = line.previousElementSibling;
    const copy = line?.classList.contains("cm-md-code-first")
      ? line.querySelector(".cm-md-copy")
      : null;
    for (const shown of view.contentDOM.querySelectorAll(".cm-md-copy[data-shown]")) {
      if (shown !== copy) shown.removeAttribute("data-shown");
    }
    copy?.setAttribute("data-shown", "");
    return false;
  },
  mouseleave(_event, view) {
    for (const shown of view.contentDOM.querySelectorAll(".cm-md-copy[data-shown]"))
      shown.removeAttribute("data-shown");
    return false;
  },
});
