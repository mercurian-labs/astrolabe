import { defaultKeymap } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { LivePreviewOptions } from "./config.ts";
import { livePreview } from "./livePreview.ts";
import { markFocused } from "./reveal.ts";

// Shared by the acceptance tests: a real EditorView in happy-dom, composed as the host does.

interface MountOptions {
  /** Whether the editor has been focused once, which turns reveal on. */
  focused?: boolean;
  /** Collapsed carets, or `[anchor, head]` ranges. */
  selection?: readonly (number | readonly [number, number])[];
  options?: LivePreviewOptions;
  extensions?: Extension;
}

const views: EditorView[] = [];

export function mount(doc: string, { focused, selection, options, extensions }: MountOptions = {}) {
  const ranges = (selection ?? [0]).map((range) =>
    typeof range === "number"
      ? EditorSelection.cursor(range)
      : EditorSelection.range(range[0], range[1]),
  );
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(ranges),
      extensions: [
        livePreview(options),
        EditorState.allowMultipleSelections.of(true),
        keymap.of(defaultKeymap),
        extensions ?? [],
      ],
    }),
  });
  // The language parses within a 20 ms budget and finishes in the background; under a
  // loaded test run that budget can run out, so parse the whole document up front.
  finishParse(view);
  if (focused) view.dispatch({ effects: markFocused() });
  views.push(view);
  return view;
}

/**
 * Parses the whole document now, so decorations and commands see the complete syntax
 * tree. Call it after an edit whose result a test reads straight away.
 */
export function finishParse(view: EditorView) {
  if (!forceParsing(view, view.state.doc.length, 5000))
    throw new Error("the document did not finish parsing");
}

export function destroyViews() {
  for (const view of views.splice(0)) view.destroy();
}

/** Moves every caret, as a keyboard or pointer selection would. */
export function select(view: EditorView, ...carets: (number | readonly [number, number])[]) {
  view.dispatch({
    selection: EditorSelection.create(
      carets.map((range) =>
        typeof range === "number"
          ? EditorSelection.cursor(range)
          : EditorSelection.range(range[0], range[1]),
      ),
    ),
    userEvent: "select",
  });
}

export function lines(view: EditorView) {
  return [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")];
}

export function line(view: EditorView, number: number) {
  const element = lines(view)[number - 1];
  if (!element) throw new Error(`line ${number} is not rendered`);
  return element;
}

/**
 * The source characters a line shows: hidden syntax and widgets excluded. Widgets are the
 * elements CodeMirror marks non-editable.
 */
export function sourceText(element: Element) {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return "";
  for (const widget of copy.querySelectorAll('[contenteditable="false"], .cm-widgetBuffer')) {
    widget.remove();
  }
  return copy.textContent ?? "";
}

export function texts(view: EditorView, selector: string) {
  return [...view.contentDOM.querySelectorAll(selector)].map(
    (element) => element.textContent ?? "",
  );
}

export function caret(view: EditorView) {
  return view.state.selection.main.head;
}
