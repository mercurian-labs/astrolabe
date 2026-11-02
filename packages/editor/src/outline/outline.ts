import { ensureSyntaxTree, language, syntaxTree } from "@codemirror/language";
import { Facet, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { Tree } from "@lezer/common";

import { OUTLINE_SPECS, type OutlineItem, type OutlineSpec } from "./specs.ts";

export type { OutlineItem, OutlineKind } from "./specs.ts";

/**
 * A file's outline from the editor's own syntax tree: Markdown headings, and the declarations of
 * JavaScript, TypeScript, Python, Rust and CSS (`specs.ts`). The full outline is read when asked
 * for (the picker) and cached per tree; the path of items around the cursor (breadcrumbs) walks
 * up from the cursor instead, so typing never re-reads the whole file.
 */

export interface DocumentOutline {
  readonly items: readonly OutlineItem[];
  /** False when the parser had not reached the end of a large file in time. */
  readonly complete: boolean;
}

const outlines = new WeakMap<Tree, OutlineItem[]>();

function specOf(state: EditorState): OutlineSpec | null {
  const name = state.facet(language)?.name;
  return name ? (OUTLINE_SPECS[name] ?? null) : null;
}

function outlineOfTree(spec: OutlineSpec, tree: Tree, state: EditorState) {
  let items = outlines.get(tree);
  if (!items) {
    items = spec.extract(tree, state.doc);
    outlines.set(tree, items);
  }
  return items;
}

/**
 * Every item of the file in source order. The parser gets `budgetMs` to reach the end of the file;
 * past that, the outline covers what it parsed.
 */
export function documentOutline(state: EditorState, budgetMs = 100): DocumentOutline {
  const spec = specOf(state);
  if (!spec) return { items: [], complete: true };
  const tree = ensureSyntaxTree(state, state.doc.length, budgetMs) ?? syntaxTree(state);
  return { items: outlineOfTree(spec, tree, state), complete: tree.length >= state.doc.length };
}

/** The items enclosing `pos` (the main cursor by default), outermost first. */
export function outlinePath(
  state: EditorState,
  pos: number = state.selection.main.head,
): OutlineItem[] {
  const spec = specOf(state);
  if (!spec) return [];
  const tree = syntaxTree(state);
  if (spec.pathAt) return spec.pathAt(tree, state.doc, pos);
  const end = state.doc.length;
  return outlineOfTree(spec, tree, state).filter(
    (item) => item.from <= pos && (pos < item.to || item.to === end),
  );
}

/** The innermost item enclosing `pos` in `items`, as the picker starts on. */
export function deepestItemAt(items: readonly OutlineItem[], pos: number): OutlineItem | null {
  let deepest: OutlineItem | null = null;
  for (const item of items) {
    if (item.from > pos) break;
    if (pos < item.to && (!deepest || item.depth > deepest.depth)) deepest = item;
  }
  return deepest;
}

/** Puts the cursor on the item's name, in the middle of the view, and focuses the editor. */
export function revealOutlineItem(view: EditorView, item: Pick<OutlineItem, "nameFrom">) {
  const at = Math.min(item.nameFrom, view.state.doc.length);
  view.dispatch({
    selection: { anchor: at },
    effects: EditorView.scrollIntoView(at, { y: "center" }),
    userEvent: "select",
  });
  view.focus();
}

const outlineMarker = Facet.define<boolean, boolean>({
  combine: (values) => values.length > 0,
});

/** Whether the editor offers its outline (`outline()`), whatever its language. */
export const hasOutline = (state: EditorState) => state.facet(outlineMarker);

/** The attribute that marks an editor with an outline (the app's `outlineFocus` reads it). */
export const OUTLINE_ATTRIBUTE = "data-outline";

export interface OutlineOptions {
  /**
   * Called with the items around the cursor whenever their kinds or names change, not on every
   * keystroke: a position in the path can go stale, so act on `outlinePath` of the state then.
   */
  readonly onPath?: (path: readonly OutlineItem[], view: EditorView) => void;
}

const pathKey = (path: readonly OutlineItem[]) =>
  path.map((item) => `${item.kind}\0${item.name}`).join("\n");

function pathReporter(onPath: NonNullable<OutlineOptions["onPath"]>) {
  return ViewPlugin.define((view) => {
    let key: string | null = null;
    const report = (state: EditorState) => {
      const path = outlinePath(state);
      const next = pathKey(path);
      if (next === key) return;
      key = next;
      onPath(path, view);
    };
    report(view.state);
    return {
      update(update) {
        if (
          update.docChanged ||
          update.selectionSet ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          report(update.state);
        }
      },
    };
  });
}

/** Marks the editor as one with an outline, and reports the path around the cursor if asked. */
export function outline(options: OutlineOptions = {}): Extension {
  return [
    outlineMarker.of(true),
    EditorView.editorAttributes.of({ [OUTLINE_ATTRIBUTE]: "" }),
    options.onPath ? pathReporter(options.onPath) : [],
  ];
}
