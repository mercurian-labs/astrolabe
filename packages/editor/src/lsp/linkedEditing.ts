import { LSPPlugin } from "@codemirror/lsp-client";
import {
  EditorState,
  type Extension,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { ServerAsk } from "./serverAsk.ts";

/**
 * Astrolabe: ranges a server says are one name (a tag and its closing tag): typing in one writes
 * the others in the same transaction, so it is one undo and collab sees one update.
 */

interface LspRange {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

interface Span {
  readonly from: number;
  readonly to: number;
}

interface Linked {
  readonly spans: readonly Span[];
  /** What the name may be; typing past it (a space in a tag) ends the link. */
  readonly pattern: RegExp;
}

const QUIET_MS = 250;
const NAME = /^[^\s<>"'=/]*$/;

const patternOf = (wordPattern: string | undefined) => {
  if (wordPattern === undefined) return NAME;
  try {
    return new RegExp(`^(?:${wordPattern})$`, "u");
  } catch {
    return NAME;
  }
};

const setLinked = StateEffect.define<Linked | null>();

const linkedField = StateField.define<Linked | null>({
  create: () => null,
  update(linked, tr) {
    for (const effect of tr.effects) if (effect.is(setLinked)) return effect.value;
    if (!linked) return null;
    const spans = tr.docChanged
      ? linked.spans.map(({ from, to }) => ({
          from: tr.changes.mapPos(from, -1),
          to: tr.changes.mapPos(to, 1),
        }))
      : linked.spans;
    const head = tr.state.selection.main.head;
    if (!spans.some(({ from, to }) => from <= head && head <= to)) return null;
    const fits = spans.every(({ from, to }) =>
      linked.pattern.test(tr.newDoc.sliceString(from, to)),
    );
    if (!fits) return null;
    return tr.docChanged ? { ...linked, spans } : linked;
  },
});

/** The span holding every change of `tr`, when one does. */
function editedSpan(tr: Transaction, spans: readonly Span[]): Span | null {
  let edited: Span | null = null;
  let whole = true;
  tr.changes.iterChangedRanges((from, to) => {
    const span = spans.find((candidate) => candidate.from <= from && to <= candidate.to);
    if (!span || (edited && edited !== span)) whole = false;
    else edited = span;
  });
  return whole ? edited : null;
}

const mirror = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(Transaction.remote)) return tr;
  if (!tr.isUserEvent("input") && !tr.isUserEvent("delete")) return tr;
  const linked = tr.startState.field(linkedField, false);
  if (!linked) return tr;
  const edited = editedSpan(tr, linked.spans);
  if (!edited) return tr;
  const before = tr.startState.sliceDoc(edited.from, edited.to);
  const others = linked.spans.filter((span) => span !== edited);
  // Ranges from before someone else's edit may no longer be one name.
  if (others.some(({ from, to }) => tr.startState.sliceDoc(from, to) !== before)) return tr;
  const name = tr.newDoc.sliceString(
    tr.changes.mapPos(edited.from, -1),
    tr.changes.mapPos(edited.to, 1),
  );
  if (!linked.pattern.test(name)) return tr;
  return [
    tr,
    {
      changes: others.map(({ from, to }) => ({
        from: tr.changes.mapPos(from, -1),
        to: tr.changes.mapPos(to, 1),
        insert: name,
      })),
      sequential: true,
    },
  ];
});

class Links {
  private readonly ask: ServerAsk;

  constructor(private readonly view: EditorView) {
    this.ask = new ServerAsk(view);
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged) {
      this.ask.schedule(QUIET_MS, () => this.request());
    }
  }

  private request() {
    const { view } = this;
    const { main, ranges } = view.state.selection;
    if (view.state.readOnly || ranges.length > 1 || !main.empty) return;
    const plugin = LSPPlugin.get(view);
    if (!plugin?.client.serverCapabilities?.linkedEditingRangeProvider) return;
    if (view.state.field(linkedField)) return;
    this.ask.send<{ readonly ranges: readonly LspRange[]; readonly wordPattern?: string } | null>(
      "textDocument/linkedEditingRange",
      (client) => ({
        textDocument: { uri: client.uri },
        position: client.toPosition(main.head),
      }),
      (answer, mapping) => {
        if (!answer || answer.ranges.length < 2) return;
        const spans = answer.ranges.map((range) => ({
          from: mapping.mapPosition(plugin.uri, range.start, -1),
          to: mapping.mapPosition(plugin.uri, range.end, 1),
        }));
        view.dispatch({
          effects: setLinked.of({ spans, pattern: patternOf(answer.wordPattern) }),
        });
      },
    );
  }

  destroy() {
    this.ask.cancel();
  }
}

export function linkedEditing(): Extension {
  return [linkedField, mirror, ViewPlugin.fromClass(Links)];
}
