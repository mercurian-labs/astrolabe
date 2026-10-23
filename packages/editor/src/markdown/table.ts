import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { katexLoaded, fillMath } from "./math.ts";
import { autolinkHref } from "./url.ts";
import {
  isExternal,
  rawTarget,
  resolveTarget,
  wikiParts,
  type LinkSource,
} from "./decorate/links.ts";
import { externalLinkWidget } from "./widgets.ts";

// GFM table geometry and static cell rendering, read from the Lezer `Table` node, whose
// cells the parser has already parsed as inline Markdown. The widget, cell editing, and
// Tab navigation in the source all read the same cells.

export interface Cell {
  /** Where the cell's text starts; for an empty cell, just inside its pipes. */
  from: number;
  /** Where its text ends: `from` for an empty cell. */
  to: number;
  /** The cell's whole slot between its pipes, which a position inside the cell falls in. */
  start: number;
  end: number;
  node: SyntaxNode | null;
}

/**
 * The whole lines a table's or `$$` block's widget replaces, or null when the block shares
 * its first line with a quote or list marker, where it stays source.
 */
export function widgetLines(state: EditorState, node: SyntaxNode) {
  const first = state.doc.lineAt(node.from);
  if (state.sliceDoc(first.from, node.from).trim() !== "") return null;
  return { from: first.from, to: state.doc.lineAt(node.to).to };
}

/**
 * The cells of a header or body row by column. The parser leaves out empty cells, so
 * columns are counted by the pipes between them; a leading pipe opens no column.
 */
export function rowCells(state: EditorState, row: SyntaxNode) {
  const cells: Cell[] = [];
  let segmentFrom = row.from;
  let cell: SyntaxNode | null = null;
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableCell") {
      cell = child;
    } else if (child.name === "TableDelimiter") {
      if (child.from !== row.from) {
        const inside =
          segmentFrom < child.from && state.sliceDoc(segmentFrom, segmentFrom + 1) === " ";
        const from = cell ? cell.from : segmentFrom + (inside ? 1 : 0);
        const to = cell ? cell.to : from;
        cells.push({ from, to, start: segmentFrom, end: child.from, node: cell });
      }
      segmentFrom = child.to;
      cell = null;
    }
  }
  if (cell)
    cells.push({ from: cell.from, to: cell.to, start: segmentFrom, end: row.to, node: cell });
  return cells;
}

/** The header and body rows of a table, in document order. */
export function tableRows(table: SyntaxNode) {
  const rows: SyntaxNode[] = [];
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableHeader" || child.name === "TableRow") rows.push(child);
  }
  return rows;
}

/** Where each cell's text starts, row by row: the stops Tab and Shift-Tab move between. */
export function cellStarts(state: EditorState, table: SyntaxNode) {
  return tableRows(table).flatMap((row) => rowCells(state, row).map((cell) => cell.from));
}

type Alignment = "left" | "center" | "right" | null;

/** Column alignments from the delimiter row's `:` markers; one per column. */
export function alignments(state: EditorState, table: SyntaxNode): Alignment[] {
  const row = table.getChildren("TableDelimiter")[0];
  if (!row) return [];
  const text = state.sliceDoc(row.from, row.to).trim().replace(/^\|/, "").replace(/\|$/, "");
  return text.split("|").map((segment) => {
    const spec = segment.trim();
    const left = spec.startsWith(":");
    const right = spec.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

function span(className: string, text?: string) {
  const element = document.createElement("span");
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const STYLES: Record<string, string> = {
  Emphasis: "cm-md-em",
  StrongEmphasis: "cm-md-strong",
  Strikethrough: "cm-md-strike",
  Highlight: "cm-md-highlight",
};

/** Appends `[from, to)` of `node`'s text, rendering the child nodes inside that range. */
function appendRange(parent: Element, node: SyntaxNode, from: number, to: number, c: LinkSource) {
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from < from || child.to > to) continue;
    if (child.from > pos) parent.append(c.slice(pos, child.from));
    appendNode(parent, child, c);
    pos = child.to;
  }
  if (to > pos) parent.append(c.slice(pos, to));
}

/** A link-styled span carrying its target, as the live preview marks links. */
function linkSpan(href: string | null) {
  if (href === null) return span("cm-md-link-unsafe");
  const link = span("cm-md-link");
  if (href !== "") {
    link.dataset.href = href;
    link.title = href;
  }
  return link;
}

function appendLink(parent: Element, link: Element, href: string | null) {
  parent.append(link);
  if (isExternal(href)) parent.append(externalLinkWidget.toDOM());
}

/**
 * Renders one inline node with the classes the live preview uses at rest. Anything it
 * does not render (images, embeds, HTML, unresolved references) shows as typed.
 */
function appendNode(parent: Element, node: SyntaxNode, c: LinkSource) {
  const open = node.firstChild;
  const close = node.lastChild;
  const style = STYLES[node.name];
  if (style && open && close && open.from !== close.from) {
    const element = span(style);
    appendRange(element, node, open.to, close.from, c);
    parent.append(element);
    return;
  }
  switch (node.name) {
    case "InlineCode":
      if (open && close && open.from !== close.from) {
        parent.append(span("cm-md-inline-code", c.slice(open.to, close.from)));
        return;
      }
      break;
    case "InlineMath":
      if (open && close && open.from !== close.from) {
        const tex = c.slice(open.to, close.from);
        if (katexLoaded()) {
          const element = span("cm-md-math-widget");
          fillMath(element, tex, open.to - open.from === 2);
          parent.append(element);
        } else {
          parent.append(span("cm-md-math", tex));
        }
        return;
      }
      break;
    case "Escape":
      parent.append(c.slice(node.from + 1, node.to));
      return;
    case "Link": {
      const target = resolveTarget(c, node, "link");
      if (!target) break;
      const link = linkSpan(target.href);
      appendRange(link, node, target.parts.open.to, target.parts.close.from, c);
      appendLink(parent, link, target.href);
      return;
    }
    case "Autolink":
    case "URL": {
      const url = node.name === "URL" ? node : node.getChild("URL");
      if (!url) break;
      const text = c.slice(url.from, url.to);
      const href = c.config.urlPolicy(autolinkHref(text), "link");
      const link = linkSpan(href);
      link.textContent = text;
      appendLink(parent, link, href);
      return;
    }
    case "WikiLink": {
      const parts = wikiParts(node);
      if (!parts) break;
      const link = span("cm-md-wikilink");
      const target = rawTarget(c, parts);
      link.dataset.wikilink = target;
      link.title = target;
      const { alias, fragment } = parts;
      if (alias) {
        link.textContent = c.slice(alias.from, alias.to);
      } else {
        const path = parts.target ? c.slice(parts.target.from, parts.target.to) : "";
        const heading = fragment ? c.slice(fragment.from + 1, fragment.to) : "";
        link.textContent = path && heading ? `${path} > ${heading}` : path || heading;
      }
      parent.append(link);
      return;
    }
    case "Tag":
      parent.append(span("cm-md-tag", c.slice(node.from, node.to)));
      return;
    case "FootnoteReference":
      parent.append(span("cm-md-footnote-ref", c.slice(node.from, node.to)));
      return;
    case "NoteComment":
      parent.append(span("cm-md-comment", c.slice(node.from, node.to)));
      return;
  }
  appendRange(parent, node, node.from, node.to, c);
}

/** Renders a cell's inline Markdown into `parent` with the live preview's classes. */
export function renderCell(parent: Element, cell: SyntaxNode, c: LinkSource) {
  appendRange(parent, cell, cell.from, cell.to, c);
}
