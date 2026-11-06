import { LSPPlugin } from "@codemirror/lsp-client";
import { type Extension, Facet, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import { askAgain } from "./environmentLsp.ts";
import { ServerAsk } from "./serverAsk.ts";

/**
 * Astrolabe: inlay hints for the part of the file on screen, kept in place through edits and asked
 * for again once they settle. A hint with text edits writes them when clicked.
 */

export interface InlayHintOptions {
  readonly types: boolean;
  readonly parameters: boolean;
}

interface LspPosition {
  readonly line: number;
  readonly character: number;
}

interface ServerHint {
  readonly position: LspPosition;
  readonly label: string | ReadonlyArray<{ readonly value: string }>;
  readonly kind?: 1 | 2;
  readonly tooltip?: string | { readonly value: string };
  readonly paddingLeft?: boolean;
  readonly paddingRight?: boolean;
  readonly textEdits?: ReadonlyArray<{
    readonly range: { readonly start: LspPosition; readonly end: LspPosition };
    readonly newText: string;
  }>;
}

/** Relative to the hint, which moves with the text where offsets would not. */
interface HintEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

const options = Facet.define<InlayHintOptions, InlayHintOptions>({
  combine: (values) => values[0] ?? { types: true, parameters: true },
});

const QUIET_MS = 400;
/** Lines asked for past the viewport, so a short scroll has its hints waiting. */
const MARGIN_LINES = 30;

class HintWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly title: string,
    readonly left: boolean,
    readonly right: boolean,
    readonly edits: readonly HintEdit[],
  ) {
    super();
  }

  override eq(other: HintWidget) {
    return (
      other.label === this.label &&
      other.title === this.title &&
      other.left === this.left &&
      other.right === this.right &&
      JSON.stringify(other.edits) === JSON.stringify(this.edits)
    );
  }

  override toDOM(view: EditorView) {
    const dom = document.createElement("span");
    dom.className = "atlas-inlay-hint";
    dom.textContent = this.label;
    if (this.title) dom.title = this.title;
    if (this.left) dom.classList.add("atlas-inlay-hint-left");
    if (this.right) dom.classList.add("atlas-inlay-hint-right");
    if (this.edits.length > 0 && !view.state.readOnly) {
      dom.classList.add("atlas-inlay-hint-accepts");
      dom.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const at = view.posAtDOM(dom);
        view.dispatch({
          changes: this.edits.map(({ from, to, insert }) => ({
            from: at + from,
            to: at + to,
            insert,
          })),
          userEvent: "input.complete",
        });
      });
    }
    return dom;
  }

  override ignoreEvent() {
    return true;
  }
}

const setHints = StateEffect.define<DecorationSet>();

const hintsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(hints, tr) {
    for (const effect of tr.effects) if (effect.is(setHints)) return effect.value;
    return tr.docChanged ? hints.map(tr.changes) : hints;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const labelOf = (hint: ServerHint) =>
  typeof hint.label === "string" ? hint.label : hint.label.map((part) => part.value).join("");

const shows = ({ kind }: ServerHint, { types, parameters }: InlayHintOptions) =>
  kind === 1 ? types : kind === 2 ? parameters : types || parameters;

class Hints {
  private readonly ask: ServerAsk;
  /** The doc lines the last answer covers, to tell a short scroll from a new place. */
  private covered: { readonly from: number; readonly to: number } | null = null;

  constructor(private readonly view: EditorView) {
    this.ask = new ServerAsk(view);
    this.schedule();
  }

  update(update: ViewUpdate) {
    const changed = update.startState.facet(options) !== update.state.facet(options);
    if (update.docChanged || changed || askAgain(update, "inlayHints")) {
      this.covered = null;
      this.schedule();
    } else if (update.viewportChanged) {
      const { from, to } = this.view.viewport;
      if (this.covered === null || from < this.covered.from || to > this.covered.to) {
        this.schedule();
      }
    }
  }

  private schedule() {
    this.ask.schedule(QUIET_MS, () => this.request());
  }

  private request() {
    const { view } = this;
    if (!LSPPlugin.get(view)?.client.serverCapabilities?.inlayHintProvider) return;
    const { doc } = view.state;
    const first = Math.max(1, doc.lineAt(view.viewport.from).number - MARGIN_LINES);
    const last = Math.min(doc.lines, doc.lineAt(view.viewport.to).number + MARGIN_LINES);
    const covered = { from: doc.line(first).from, to: doc.line(last).to };
    this.ask.send<readonly ServerHint[] | null>(
      "textDocument/inlayHint",
      (plugin) => ({
        textDocument: { uri: plugin.uri },
        range: { start: plugin.toPosition(covered.from), end: plugin.toPosition(covered.to) },
      }),
      (answer, mapping, plugin) => {
        const shown = view.state.facet(options);
        const ranges = (answer ?? []).flatMap((hint) => {
          if (!shows(hint, shown)) return [];
          const pos = mapping.mapPosition(plugin.uri, hint.position, 1);
          if (pos > view.state.doc.length) return [];
          const edits = (hint.textEdits ?? []).map((edit) => {
            const from = mapping.mapPosition(plugin.uri, edit.range.start, 1);
            const to = Math.max(from, mapping.mapPosition(plugin.uri, edit.range.end, -1));
            return { from: from - pos, to: to - pos, insert: edit.newText };
          });
          const tooltip = hint.tooltip;
          const widget = new HintWidget(
            labelOf(hint),
            typeof tooltip === "object" ? tooltip.value : (tooltip ?? ""),
            hint.paddingLeft === true,
            hint.paddingRight === true,
            edits,
          );
          // Beside the text it names: a parameter's before its argument, a type after its name.
          return [Decoration.widget({ widget, side: hint.kind === 2 ? -1 : 1 }).range(pos)];
        });
        this.covered = covered;
        view.dispatch({ effects: setHints.of(Decoration.set(ranges, true)) });
      },
    );
  }

  destroy() {
    this.ask.cancel();
  }
}

const hintsPlugin = ViewPlugin.fromClass(Hints);

const theme = EditorView.baseTheme({
  ".atlas-inlay-hint": {
    borderRadius: "3px",
    padding: "0 3px",
    fontFamily: "var(--atlas-md-font-ui, inherit)",
    fontSize: "0.85em",
    color: "var(--atlas-md-syntax-color, #888)",
    backgroundColor: "var(--atlas-md-code-bg, transparent)",
  },
  ".atlas-inlay-hint-left": { marginLeft: "0.4em" },
  ".atlas-inlay-hint-right": { marginRight: "0.4em" },
  ".atlas-inlay-hint-accepts": { cursor: "pointer" },
});

/** Hints of the kinds in `shown`; leave the extension out for none. */
export function inlayHints(shown: InlayHintOptions): Extension {
  return [options.of(shown), hintsField, hintsPlugin, theme];
}
