import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Astrolabe: the import line a local graph's hovered node names, lit in every open view of the
 * file that writes it. One at a time, held outside React: the graph sets it, the file views follow.
 */

interface LitLine {
  /** The file, as `importLineKey` names it. */
  readonly file: string;
  readonly line: number;
}

/** A file of a checkout, as the highlight names it. */
export const importLineKey = (file: {
  readonly environmentId: string;
  readonly cwd: string;
  readonly path: string;
}) => `${file.environmentId}\0${file.cwd}\0${file.path}`;

let lit: LitLine | null = null;
const listeners = new Set<() => void>();

export const importLineHighlight = {
  get: () => lit,
  set(next: LitLine | null) {
    if (lit?.file === next?.file && lit?.line === next?.line) return;
    lit = next;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

const setLitLine = StateEffect.define<number | null>();
const LIT = Decoration.line({ class: "cm-import-line" });

const litLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lines, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setLitLine)) continue;
      const line = effect.value;
      return line === null || line > transaction.state.doc.lines
        ? Decoration.none
        : Decoration.set([LIT.range(transaction.state.doc.line(line).from)]);
    }
    return lines.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** What an editor needs to show the lit line. */
export const importLineExtension: Extension = litLineField;

/**
 * Keeps `view`, an editor of `file` (an `importLineKey`), lighting the line the highlight names for
 * it, scrolled into sight; returns the way to stop.
 */
export function followImportLine(view: EditorView, file: string): () => void {
  let shown: number | null = null;
  const apply = () => {
    const current = importLineHighlight.get();
    const line = current?.file === file ? current.line : null;
    if (line === shown) return;
    shown = line;
    const inside = line !== null && line <= view.state.doc.lines;
    view.dispatch({
      effects: [
        setLitLine.of(line),
        ...(inside
          ? [EditorView.scrollIntoView(view.state.doc.line(line).from, { y: "nearest" })]
          : []),
      ],
    });
  };
  apply();
  return importLineHighlight.subscribe(apply);
}
