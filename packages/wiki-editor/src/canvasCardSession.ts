import { EditorView } from "@codemirror/view";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import type { WikiNoteSession } from "./noteBuffer";

/** A card's text as the editor takes it: one document of its own, for as long as it's open. */
export function canvasCardSession(
  initial: string,
  onChange: (text: string) => void,
): WikiNoteSession & { readonly dispose: () => void } {
  const doc = new Y.Doc();
  const text = doc.getText("text");
  text.insert(0, initial);
  const awareness = new Awareness(doc);
  const observe = () => onChange(text.toString());
  text.observe(observe);
  return {
    doc,
    text,
    awareness,
    dispose: () => {
      text.unobserve(observe);
      awareness.destroy();
      doc.destroy();
    },
  };
}

/** Puts the caret at the end of the editor inside `frame`, ready to type. */
export function focusCardEditor(frame: Element | null) {
  const content = frame?.querySelector<HTMLElement>(".cm-content");
  if (content === undefined || content === null) return;
  const view = EditorView.findFromDOM(content);
  if (view === null) return;
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  view.focus();
}
