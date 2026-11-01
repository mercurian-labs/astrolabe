import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

export interface Definition {
  url: string;
  title: string | null;
}

/** A `> [!type]- Title` callout whose body folds away while the caret is elsewhere. */
export interface FoldableCallout {
  from: number;
  headerEnd: number;
  to: number;
}

/** A table, with what its cells' rendering depends on beyond the table's own text. */
export interface IndexedTable {
  node: SyntaxNode;
  /** A cell holds inline math, so KaTeX must load and its arrival changes the table. */
  math: boolean;
  /** A cell holds a link or image, which may resolve through the document's definitions. */
  references: boolean;
}

/** Facts about the whole document that decorations need, gathered once per syntax tree. */
export interface DocumentIndex {
  definitions: ReadonlyMap<string, Definition>;
  footnotes: ReadonlySet<string>;
  frontmatter: { from: number; to: number } | null;
  foldableCallouts: readonly FoldableCallout[];
  /** Tables and `$$` blocks, which render as block widgets replacing their lines. */
  tables: readonly IndexedTable[];
  mathBlocks: readonly SyntaxNode[];
  /** Fenced code blocks outside lists and quotes, which a host may draw itself. */
  fencedCode: readonly SyntaxNode[];
  /** Every definition as one string: equal strings mean links resolve the same way. */
  definitionsKey: string;
}

/** CommonMark label matching: trim, collapse inner whitespace, case-fold. */
export function normalizeLabel(label: string) {
  return label.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);
const CALLOUT_MARK = /^\[!([\w-]+)\]([+-]?)$/;

/** The callout a blockquote opens with, if its first block is a callout header. */
export function calloutOf(state: EditorState, quote: SyntaxNode) {
  let child = quote.firstChild;
  while (child?.name === "QuoteMark") child = child.nextSibling;
  if (child?.name !== "CalloutHeader") return null;
  const mark = child.firstChild;
  if (mark?.name !== "CalloutMark") return null;
  const match = CALLOUT_MARK.exec(state.sliceDoc(mark.from, mark.to));
  if (!match) return null;
  return {
    type: (match[1] ?? "note").toLowerCase(),
    fold: match[2] ?? "",
    header: child,
    mark,
  };
}

const indexes = new WeakMap<Tree, DocumentIndex>();
let builds = 0;

/** How many indexes have been built; tests use it to prove selection changes reuse the cache. */
export const documentIndexBuilds = () => builds;

/** The index for the state's current syntax tree, built on first use and cached on the tree. */
export function documentIndex(state: EditorState): DocumentIndex {
  const tree = syntaxTree(state);
  const cached = indexes.get(tree);
  if (cached) return cached;
  builds++;
  const definitions = new Map<string, Definition>();
  const footnotes = new Set<string>();
  const foldableCallouts: FoldableCallout[] = [];
  const tables: IndexedTable[] = [];
  const mathBlocks: SyntaxNode[] = [];
  const fencedCode: SyntaxNode[] = [];
  let frontmatter: DocumentIndex["frontmatter"] = null;
  tree.iterate({
    enter(ref) {
      switch (ref.name) {
        case "LinkReference": {
          const node = ref.node;
          const label = node.getChild("LinkLabel");
          const url = node.getChild("URL");
          if (!label || !url) return false;
          const key = normalizeLabel(state.sliceDoc(label.from + 1, label.to - 1));
          const title = node.getChild("LinkTitle");
          // The first definition of a label wins.
          if (key && !definitions.has(key)) {
            definitions.set(key, {
              url: state.sliceDoc(url.from, url.to),
              title: title ? state.sliceDoc(title.from + 1, title.to - 1) : null,
            });
          }
          return false;
        }
        case "FootnoteDefinition": {
          const label = ref.node.getChild("FootnoteLabel");
          if (label) footnotes.add(normalizeLabel(state.sliceDoc(label.from, label.to)));
          return false;
        }
        case "Frontmatter":
          frontmatter = { from: ref.from, to: ref.to };
          return false;
        case "Table": {
          const table = { node: ref.node, math: false, references: false };
          tree.iterate({
            from: ref.from,
            to: ref.to,
            enter(inner) {
              if (inner.name === "InlineMath") table.math = true;
              else if (inner.name === "Link" || inner.name === "Image") table.references = true;
            },
          });
          tables.push(table);
          return false;
        }
        case "MathBlock":
          mathBlocks.push(ref.node);
          return false;
        case "FencedCode":
          fencedCode.push(ref.node);
          return false;
        case "Blockquote": {
          const callout = calloutOf(state, ref.node);
          if (callout?.fold === "-") {
            const headerEnd = state.doc.lineAt(callout.header.from).to;
            if (ref.to > headerEnd)
              foldableCallouts.push({ from: ref.from, headerEnd, to: ref.to });
          }
          return true;
        }
        default:
          return CONTAINERS.has(ref.name);
      }
    },
  });
  const definitionsKey = [...definitions]
    .map(([label, { url, title }]) => `${label}\t${url}\t${title ?? ""}`)
    .sort()
    .join("\n");
  const index = {
    definitions,
    footnotes,
    frontmatter,
    foldableCallouts,
    tables,
    mathBlocks,
    fencedCode,
    definitionsKey,
  };
  indexes.set(tree, index);
  return index;
}

/** The start of the foldable block (frontmatter or `[!type]-` callout) holding `pos`. */
export function foldableBlockAt(state: EditorState, pos: number) {
  const { frontmatter, foldableCallouts } = documentIndex(state);
  if (frontmatter && frontmatter.from <= pos && pos <= frontmatter.to) return frontmatter.from;
  const callout = foldableCallouts.find((block) => block.from <= pos && pos <= block.to);
  return callout ? callout.from : null;
}
