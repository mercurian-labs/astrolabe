import type { Extension } from "@codemirror/state";
import {
  type Diagnostic,
  forEachDiagnostic,
  lintGutter,
  nextDiagnostic,
  previousDiagnostic,
  setDiagnosticsEffect,
} from "@codemirror/lint";
import { EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

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

const theme = EditorView.baseTheme({
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

export function diagnosticsUi(options: { readonly keys: DiagnosticKeys }): Extension {
  return [
    lineBlocks,
    lintGutter(),
    cursorMessages,
    theme,
    keymap.of([
      ...options.keys.next.map((key) => ({ key, run: nextDiagnostic })),
      ...options.keys.previous.map((key) => ({ key, run: previousDiagnostic })),
    ]),
  ];
}

/** Whether the editor shows diagnostics, for menus that step through them. */
export function hasDiagnosticsUi(view: EditorView): boolean {
  return view.plugin(cursorMessages) !== null;
}

export { nextDiagnostic, previousDiagnostic };
