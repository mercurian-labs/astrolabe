import { LSPPlugin } from "@codemirror/lsp-client";
import { type Extension, StateEffect, StateField, Transaction } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { ServerAsk } from "./serverAsk.ts";

/**
 * Astrolabe: the symbol at the cursor, marked wherever the file reads or writes it. A selection
 * keeps the editor's own marks for its text; so does a file with no server to ask.
 */

interface ServerHighlight {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  /** 1 text, 2 read, 3 write. */
  readonly kind?: 1 | 2 | 3;
}

/** The cursor rests this long first, so typing asks nothing. */
const QUIET_MS = 250;

const read = Decoration.mark({ class: "atlas-symbol-read" });
const write = Decoration.mark({ class: "atlas-symbol-write" });

const setHighlights = StateEffect.define<DecorationSet>();

const touches = (marks: DecorationSet, pos: number) => {
  let found = false;
  marks.between(pos, pos, () => {
    found = true;
    return false;
  });
  return found;
};

const highlightsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const effect of tr.effects) if (effect.is(setHighlights)) return effect.value;
    if (marks.size === 0) return marks;
    if (tr.docChanged && !tr.annotation(Transaction.remote)) return Decoration.none;
    const moved = tr.docChanged ? marks.map(tr.changes) : marks;
    const { main } = tr.state.selection;
    // Off the symbol nothing is left to mark; the next rest says what the cursor is on.
    return tr.selection && (!main.empty || !touches(moved, main.head)) ? Decoration.none : moved;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class Highlights {
  private readonly ask: ServerAsk;

  constructor(private readonly view: EditorView) {
    this.ask = new ServerAsk(view);
  }

  update(update: ViewUpdate) {
    const typed = update.transactions.some(
      (tr) => tr.docChanged && !tr.annotation(Transaction.remote),
    );
    if (typed) this.ask.cancel();
    if (typed || update.selectionSet) {
      this.ask.schedule(QUIET_MS, () => this.request());
    }
  }

  private request() {
    const { view } = this;
    const { main, ranges } = view.state.selection;
    if (!view.hasFocus || ranges.length > 1 || !main.empty) return;
    if (!LSPPlugin.get(view)?.client.serverCapabilities?.documentHighlightProvider) return;
    this.ask.send<readonly ServerHighlight[] | null>(
      "textDocument/documentHighlight",
      (plugin) => ({
        textDocument: { uri: plugin.uri },
        position: plugin.toPosition(main.head),
      }),
      (answer, mapping, plugin) => {
        const marks = (answer ?? []).flatMap(({ range, kind }) => {
          const from = mapping.mapPosition(plugin.uri, range.start, 1);
          const to = mapping.mapPosition(plugin.uri, range.end, -1);
          return from < to ? [(kind === 3 ? write : read).range(from, to)] : [];
        });
        view.dispatch({ effects: setHighlights.of(Decoration.set(marks, true)) });
      },
    );
  }

  destroy() {
    this.ask.cancel();
  }
}

const theme = EditorView.baseTheme({
  ".atlas-symbol-read": { backgroundColor: "var(--atlas-md-code-bg, rgba(127, 127, 127, 0.15))" },
  ".atlas-symbol-write": {
    backgroundColor: "color-mix(in oklab, var(--atlas-md-focus-ring, #0077ee) 22%, transparent)",
  },
});

export function symbolHighlights(): Extension {
  return [highlightsField, ViewPlugin.fromClass(Highlights), theme];
}
