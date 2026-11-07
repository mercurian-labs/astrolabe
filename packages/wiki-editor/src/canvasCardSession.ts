import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useRef, useState } from "react";
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

/**
 * The session a card's editor runs on. It's made in an effect, not in state: React can run an
 * effect's cleanup and run it again on a live component, and a session disposed that way would
 * stop reporting what's typed. Each run starts from the text the last one reached.
 */
export function useCanvasCardSession(editor: {
  readonly initialText: string;
  readonly onChange: (text: string) => void;
}) {
  const [session, setSession] = useState<ReturnType<typeof canvasCardSession> | null>(null);
  const latest = useRef(editor.initialText);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the document is an external resource this editor owns while it's open
  useLayoutEffect(() => {
    const next = canvasCardSession(latest.current, (text) => {
      latest.current = text;
      editor.onChange(text);
    });
    setSession(next);
    return next.dispose;
  }, [editor]);
  return session;
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
