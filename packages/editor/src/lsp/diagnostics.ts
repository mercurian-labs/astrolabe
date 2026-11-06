import { type EditorState, type Extension, Facet } from "@codemirror/state";
import {
  type Diagnostic,
  forEachDiagnostic,
  lintGutter,
  nextDiagnostic,
  previousDiagnostic,
  setDiagnosticsEffect,
} from "@codemirror/lint";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import { lineBlocks, setLineBlocks } from "../blocks/lineBlocks.ts";

/**
 * Astrolabe: a code file's diagnostics, as `@codemirror/lint` draws them (underlines, a gutter, a
 * tooltip on hover), plus keys to step through them and the messages of the cursor's line written
 * out below it, so they read without a mouse.
 */

export interface DiagnosticKeys {
  readonly next: readonly string[];
  readonly previous: readonly string[];
}

const OWNER = "diagnostics";

/** Marks an editor that shows diagnostics. */
const shown = Facet.define<boolean>();

interface LineMessage {
  readonly severity: Diagnostic["severity"];
  readonly message: string;
}

class MessagesWidget extends WidgetType {
  constructor(readonly messages: readonly LineMessage[]) {
    super();
  }

  override eq(other: MessagesWidget) {
    return (
      other.messages.length === this.messages.length &&
      other.messages.every(
        (item, index) =>
          item.message === this.messages[index]!.message &&
          item.severity === this.messages[index]!.severity,
      )
    );
  }

  override toDOM() {
    const dom = document.createElement("div");
    dom.className = "atlas-diagnostic-messages";
    for (const item of this.messages) {
      const row = document.createElement("div");
      row.className = `atlas-diagnostic-message atlas-diagnostic-${item.severity}`;
      row.textContent = item.message;
      dom.append(row);
    }
    return dom;
  }

  override ignoreEvent() {
    return false;
  }
}

/** The diagnostics touching the cursor's line, as a key that changes only when they do. */
function cursorLine(view: EditorView) {
  const state = view.state;
  const line = state.doc.lineAt(state.selection.main.head);
  const messages: LineMessage[] = [];
  forEachDiagnostic(state, (diagnostic, from, to) => {
    if (to < line.from || from > line.to) return;
    if (state.doc.lineAt(from).number !== line.number) return;
    messages.push({ severity: diagnostic.severity, message: diagnostic.message });
  });
  const key =
    messages.length === 0
      ? ""
      : `${line.number}\0${messages.map((m) => `${m.severity}:${m.message}`).join("\0")}`;
  return { key, line, messages };
}

// Blocks are set by a transaction, which an update must not dispatch itself: the next microtask does.
const cursorMessages = ViewPlugin.fromClass(
  class {
    private shown = "";
    private scheduled = false;
    private destroyed = false;

    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      const diagnosed = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(setDiagnosticsEffect)),
      );
      if (update.docChanged || update.selectionSet || diagnosed) this.schedule();
    }

    private schedule() {
      if (this.scheduled) return;
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        if (this.destroyed) return;
        const { key, line, messages } = cursorLine(this.view);
        if (key === this.shown) return;
        this.shown = key;
        this.view.dispatch({
          effects: setLineBlocks(
            OWNER,
            messages.length === 0
              ? []
              : [
                  {
                    id: "cursor",
                    placement: "below",
                    from: line.to,
                    widget: new MessagesWidget(messages),
                    rows: messages.length,
                  },
                ],
          ),
        });
      });
    }

    destroy() {
      this.destroyed = true;
    }
  },
);

const SEVERITY_RANK: Readonly<Record<Diagnostic["severity"], number>> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

class LineEndMessage extends WidgetType {
  constructor(
    readonly severity: Diagnostic["severity"],
    readonly message: string,
    readonly more: number,
  ) {
    super();
  }

  override eq(other: LineEndMessage) {
    return (
      other.severity === this.severity &&
      other.message === this.message &&
      other.more === this.more
    );
  }

  override toDOM() {
    const outer = document.createElement("span");
    outer.className = `atlas-inline-diagnostic atlas-diagnostic-${this.severity}`;
    outer.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = this.more > 0 ? `${this.message} (+${this.more})` : this.message;
    outer.append(text);
    return outer;
  }

  override ignoreEvent() {
    return false;
  }
}

/** Each visible line's worst diagnostic, as a message after its text. */
function lineEndMessages(view: EditorView): DecorationSet {
  const { state } = view;
  const lines = new Map<number, { worst: Diagnostic; count: number }>();
  forEachDiagnostic(state, (diagnostic, from, to) => {
    if (!view.visibleRanges.some((range) => range.from <= to && range.to >= from)) return;
    const { number } = state.doc.lineAt(from);
    const line = lines.get(number);
    if (!line) lines.set(number, { worst: diagnostic, count: 1 });
    else {
      line.count += 1;
      if (SEVERITY_RANK[diagnostic.severity] < SEVERITY_RANK[line.worst.severity]) {
        line.worst = diagnostic;
      }
    }
  });
  const ranges = [...lines].map(([number, { worst, count }]) =>
    Decoration.widget({
      widget: new LineEndMessage(worst.severity, worst.message.split("\n", 1)[0]!, count - 1),
      side: 1,
    }).range(state.doc.line(number).to),
  );
  const marks = [...lines.keys()].map((number) =>
    Decoration.line({ class: "atlas-inline-diagnostic-line" }).range(state.doc.line(number).from),
  );
  return Decoration.set([...ranges, ...marks], true);
}

const inlineMessages = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = lineEndMessages(view);
    }

    update(update: ViewUpdate) {
      const diagnosed = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(setDiagnosticsEffect)),
      );
      if (update.docChanged || update.viewportChanged || diagnosed) {
        this.decorations = lineEndMessages(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.baseTheme({
  // The message takes no width and its line clips it, so it never moves or wraps the text.
  ".atlas-inline-diagnostic-line": { overflow: "clip" },
  ".atlas-inline-diagnostic": {
    display: "inline-block",
    width: "0",
    whiteSpace: "pre",
    verticalAlign: "baseline",
    fontFamily: "var(--atlas-md-font-ui, inherit)",
    fontSize: "0.85em",
    pointerEvents: "none",
  },
  ".atlas-inline-diagnostic > span": { marginLeft: "2em", opacity: "0.8" },
  ".atlas-diagnostic-messages": {
    padding: "1px 0 3px",
    fontFamily: "var(--atlas-md-font-ui, inherit)",
    fontSize: "12px",
  },
  ".atlas-diagnostic-message": { paddingLeft: "6px", borderLeft: "2px solid currentColor" },
  ".atlas-diagnostic-error": { color: "var(--atlas-diagnostic-error, #d4524a)" },
  ".atlas-diagnostic-warning": { color: "var(--atlas-diagnostic-warning, #c9971c)" },
  ".atlas-diagnostic-info, .atlas-diagnostic-hint": {
    color: "var(--atlas-diagnostic-info, #6b7a99)",
  },
});

export function diagnosticsUi(options: {
  readonly keys: DiagnosticKeys;
  /** Each line's worst message after its text. */
  readonly inline?: boolean;
}): Extension {
  return [
    shown.of(true),
    lineBlocks,
    lintGutter(),
    cursorMessages,
    options.inline ? inlineMessages : [],
    theme,
    keymap.of([
      ...options.keys.next.map((key) => ({ key, run: nextDiagnostic })),
      ...options.keys.previous.map((key) => ({ key, run: previousDiagnostic })),
    ]),
  ];
}

/** Whether the editor shows diagnostics, for menus that step through them. */
export function hasDiagnosticsUi(state: EditorState): boolean {
  return state.facet(shown).length > 0;
}

export { nextDiagnostic, previousDiagnostic };
