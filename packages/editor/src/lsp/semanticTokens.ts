import { highlightingFor } from "@codemirror/language";
import { LSPPlugin } from "@codemirror/lsp-client";
import {
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { type Tag, tags } from "@lezer/highlight";

import { askAgain } from "./environmentLsp.ts";
import { ServerAsk } from "./serverAsk.ts";

/**
 * Astrolabe: a language server's colours over the parser's, in the same token classes. Edits move
 * what is drawn; the server is asked again only once they stop, and not for a large file.
 */

interface Legend {
  readonly tokenTypes: readonly string[];
  readonly tokenModifiers: readonly string[];
}

interface Provider {
  readonly legend: Legend;
  readonly full?: boolean | { readonly delta?: boolean };
}

interface TokensAnswer {
  readonly resultId?: string;
  readonly data?: readonly number[];
  readonly edits?: ReadonlyArray<{
    readonly start: number;
    readonly deleteCount: number;
    readonly data?: readonly number[];
  }>;
}

const QUIET_MS = 1000;
/** Characters; past this the parser's colours stand alone. */
const LARGEST_FILE = 500_000;

const TOKEN_TAGS: Readonly<Record<string, Tag>> = {
  namespace: tags.namespace,
  type: tags.typeName,
  class: tags.className,
  enum: tags.typeName,
  interface: tags.typeName,
  struct: tags.typeName,
  typeParameter: tags.typeName,
  parameter: tags.local(tags.variableName),
  variable: tags.variableName,
  property: tags.propertyName,
  enumMember: tags.special(tags.variableName),
  event: tags.propertyName,
  function: tags.function(tags.variableName),
  method: tags.function(tags.propertyName),
  member: tags.function(tags.propertyName),
  macro: tags.macroName,
  keyword: tags.keyword,
  modifier: tags.modifier,
  comment: tags.comment,
  string: tags.string,
  number: tags.number,
  regexp: tags.regexp,
  operator: tags.operator,
  decorator: tags.meta,
};

/** The class of a token type with its modifiers, in this editor's highlight style. */
function tokenClass(state: EditorState, legend: Legend, type: number, modifiers: number) {
  const base = TOKEN_TAGS[legend.tokenTypes[type] ?? ""];
  if (!base) return null;
  const named = (name: string) => {
    const at = legend.tokenModifiers.indexOf(name);
    return at >= 0 && (modifiers & (1 << at)) !== 0;
  };
  const tag = named("declaration") || named("definition") ? tags.definition(base) : base;
  return highlightingFor(state, [named("defaultLibrary") ? tags.standard(tag) : tag]);
}

/** Marks for LSP's five numbers per token, each relative to the one before, in `doc`. */
export function tokenMarks(
  state: EditorState,
  doc: Text,
  legend: Legend,
  data: readonly number[],
  moved: (offset: number) => number,
): DecorationSet {
  const marks = new Map<string, Decoration | null>();
  const ranges = [];
  let lineNumber = 1;
  let line = doc.line(1);
  let start = 0;
  for (let at = 0; at + 4 < data.length; at += 5) {
    const lines = data[at]!;
    const column = data[at + 1]!;
    const length = data[at + 2]!;
    const type = data[at + 3]!;
    const modifiers = data[at + 4]!;
    start = lines === 0 ? start + column : column;
    if (lines > 0) {
      lineNumber += lines;
      if (lineNumber > doc.lines) break;
      line = doc.line(lineNumber);
    }
    const key = `${type}:${modifiers}`;
    let mark = marks.get(key);
    if (mark === undefined) {
      const className = tokenClass(state, legend, type, modifiers);
      mark = className ? Decoration.mark({ class: className }) : null;
      marks.set(key, mark);
    }
    if (mark === null) continue;
    const from = moved(line.from + Math.min(start, line.length));
    const to = moved(line.from + Math.min(start + length, line.length));
    if (from < to) ranges.push(mark.range(from, to));
  }
  return Decoration.set(ranges, true);
}

/** `data` with `edits` made; copied, since a delta can be too long to spread into a call. */
function withEdits(data: readonly number[], edits: NonNullable<TokensAnswer["edits"]>) {
  const next: number[] = [];
  let at = 0;
  for (const edit of edits.toSorted((a, b) => a.start - b.start)) {
    for (; at < edit.start; at++) next.push(data[at]!);
    for (const value of edit.data ?? []) next.push(value);
    at = edit.start + edit.deleteCount;
  }
  for (; at < data.length; at++) next.push(data[at]!);
  return next;
}

const setTokens = StateEffect.define<DecorationSet>();

const tokensField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(tokens, tr) {
    for (const effect of tr.effects) if (effect.is(setTokens)) return effect.value;
    return tr.docChanged ? tokens.map(tr.changes) : tokens;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class Tokens {
  private readonly ask: ServerAsk;
  private last: { readonly resultId: string; readonly data: readonly number[] } | null = null;

  constructor(private readonly view: EditorView) {
    this.ask = new ServerAsk(view);
    this.schedule();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || askAgain(update, "semanticTokens")) this.schedule();
  }

  private schedule() {
    this.ask.schedule(QUIET_MS, () => this.request());
  }

  private request() {
    const { view } = this;
    const provider = LSPPlugin.get(view)?.client.serverCapabilities?.semanticTokensProvider as
      | Provider
      | undefined;
    if (!provider || !provider.full) return;
    if (view.state.doc.length > LARGEST_FILE) {
      this.last = null;
      view.dispatch({ effects: setTokens.of(Decoration.none) });
      return;
    }
    const delta =
      typeof provider.full === "object" && provider.full.delta === true && this.last !== null;
    const previous = delta ? this.last!.resultId : null;
    const asked = view.state.doc;
    this.ask.send<TokensAnswer | null>(
      previous === null
        ? "textDocument/semanticTokens/full"
        : "textDocument/semanticTokens/full/delta",
      (plugin) => ({
        textDocument: { uri: plugin.uri },
        ...(previous === null ? {} : { previousResultId: previous }),
      }),
      (answer, mapping, plugin) => {
        const data = this.dataOf(answer);
        if (data === null) {
          if (previous !== null) this.request();
          return;
        }
        const changes = mapping.getMapping(plugin.uri);
        const marks = tokenMarks(view.state, asked, provider.legend, data, (offset) =>
          changes ? changes.mapPos(offset, 1) : offset,
        );
        view.dispatch({ effects: setTokens.of(marks) });
      },
      () => {
        // With nothing left to build on, this asks for the whole file, and once only.
        this.last = null;
        if (previous !== null) this.request();
      },
    );
  }

  /** The tokens as a whole, from an answer that may only say what changed. */
  private dataOf(answer: TokensAnswer | null): readonly number[] | null {
    if (!answer) {
      this.last = null;
      return null;
    }
    let data: readonly number[];
    if (answer.edits && this.last) {
      data = withEdits(this.last.data, answer.edits);
    } else if (answer.data) {
      data = answer.data;
    } else {
      this.last = null;
      return null;
    }
    this.last = answer.resultId ? { resultId: answer.resultId, data } : null;
    return data;
  }

  destroy() {
    this.ask.cancel();
  }
}

const tokensPlugin = ViewPlugin.fromClass(Tokens);

export function semanticTokens(): Extension {
  // Above the parser's marks, which draws these inside them, so their colour is the one that shows.
  return [Prec.highest(tokensField), tokensPlugin];
}
