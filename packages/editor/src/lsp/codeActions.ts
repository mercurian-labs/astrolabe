import { LSPPlugin } from "@codemirror/lsp-client";
import {
  type Extension,
  Facet,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  type Command,
  EditorView,
  gutter,
  GutterMarker,
  keymap,
  showTooltip,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { serverDiagnosticsAt } from "./environmentLsp.ts";

/**
 * Astrolabe: the language server's code actions (quick fixes, refactors) for the selection: a
 * light bulb beside its line once the cursor rests, and a menu (`Mod-.`). The environment keeps
 * the actions it offered and applies the one picked, as it does a rename, so the host can undo it.
 */

/** An offered action, as the gateway names it. */
export interface CodeActionSummary {
  readonly index: number;
  readonly title: string;
  readonly kind?: string;
  readonly isPreferred?: boolean;
  /** Why it can't run now; shown, not run. */
  readonly disabled?: string;
}

export interface AppliedCodeAction {
  readonly title: string;
  readonly id: string;
  readonly files: readonly string[];
  readonly edits: number;
}

export interface CodeActionHost {
  readonly applied: (view: EditorView, action: AppliedCodeAction) => void;
}

const codeActionHost = Facet.define<CodeActionHost, CodeActionHost | null>({
  combine: (values) => values[0] ?? null,
});

/** The cursor rests this long before the light bulb asks. */
const SETTLE_MS = 250;

interface Offer {
  /** Where they were asked for: the selection's head, mapped through edits since. */
  readonly pos: number;
  readonly actions: readonly CodeActionSummary[];
}

interface Menu {
  readonly pos: number;
  readonly actions: readonly CodeActionSummary[];
  readonly selected: number;
}

const setOffer = StateEffect.define<Offer | null>();
const setMenu = StateEffect.define<Menu | null>();

const offerField = StateField.define<Offer | null>({
  create: () => null,
  update(offer, tr) {
    for (const effect of tr.effects) if (effect.is(setOffer)) return effect.value;
    if (!offer) return offer;
    // Your own edit or a moved cursor makes the offer stale; the next rest asks again.
    if (tr.selection || (tr.docChanged && !tr.annotation(Transaction.remote))) return null;
    return tr.docChanged ? { ...offer, pos: tr.changes.mapPos(offer.pos) } : offer;
  },
});

const menuField = StateField.define<Menu | null>({
  create: () => null,
  update(menu, tr) {
    for (const effect of tr.effects) if (effect.is(setMenu)) return effect.value;
    if (!menu) return menu;
    if (tr.selection || (tr.docChanged && !tr.annotation(Transaction.remote))) return null;
    return tr.docChanged ? { ...menu, pos: tr.changes.mapPos(menu.pos) } : menu;
  },
  provide: (field) =>
    showTooltip.from(field, (menu): Tooltip | null =>
      menu
        ? {
            pos: menu.pos,
            above: false,
            create: (view) => ({ dom: drawMenu(view, menu) }),
          }
        : null,
    ),
});

function drawMenu(view: EditorView, menu: Menu): HTMLElement {
  const dom = document.createElement("ul");
  dom.className = "atlas-code-actions";
  dom.setAttribute("role", "listbox");
  dom.setAttribute("aria-label", "Code actions");
  for (const [at, action] of menu.actions.entries()) {
    const row = document.createElement("li");
    row.className = "atlas-code-action";
    row.setAttribute("role", "option");
    if (at === menu.selected) row.setAttribute("aria-selected", "true");
    if (action.disabled) row.setAttribute("aria-disabled", "true");
    row.textContent = action.disabled ? `${action.title} (${action.disabled})` : action.title;
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      apply(view, action);
    });
    dom.append(row);
  }
  return dom;
}

/** Asks for the selection's actions; null when the server has none or can't be asked. */
async function ask(view: EditorView): Promise<readonly CodeActionSummary[] | null> {
  const plugin = LSPPlugin.get(view);
  const capabilities = plugin?.client.serverCapabilities;
  if (!plugin || !capabilities?.codeActionProvider) return null;
  plugin.client.sync();
  const { from, to } = view.state.selection.main;
  const diagnostics = serverDiagnosticsAt(view.state, from, to).map((entry) => entry.diagnostic);
  const answer = await plugin.client.request<object, readonly CodeActionSummary[] | null>(
    "textDocument/codeAction",
    {
      textDocument: { uri: plugin.uri },
      range: { start: plugin.toPosition(from), end: plugin.toPosition(to) },
      context: { diagnostics, triggerKind: 2 },
    },
  );
  return answer && answer.length > 0 ? answer : null;
}

function apply(view: EditorView, action: CodeActionSummary) {
  const plugin = LSPPlugin.get(view);
  view.dispatch({ effects: setMenu.of(null) });
  if (!plugin || action.disabled) return;
  plugin.client
    .request<object, { readonly applied?: Omit<AppliedCodeAction, "title"> | null } | null>(
      "astrolabe/applyCodeAction",
      { index: action.index },
    )
    .then(
      (answer) => {
        if (!answer?.applied) return;
        view.state.facet(codeActionHost)?.applied(view, { ...answer.applied, title: action.title });
      },
      (error) => plugin.reportError("Code action failed", error),
    );
  view.focus();
}

function openMenu(view: EditorView, actions: readonly CodeActionSummary[]) {
  const preferred = actions.findIndex((action) => action.isPreferred && !action.disabled);
  view.dispatch({
    effects: setMenu.of({
      pos: view.state.selection.main.head,
      actions,
      selected: Math.max(0, preferred),
    }),
  });
}

/** Opens the menu of the selection's code actions, or closes it when it is open. */
export const showCodeActions: Command = (view) => {
  if (!LSPPlugin.get(view)) return false;
  if (view.state.field(menuField, false)) {
    view.dispatch({ effects: setMenu.of(null) });
    return true;
  }
  const offer = view.state.field(offerField, false);
  if (offer) {
    openMenu(view, offer.actions);
    return true;
  }
  const doc = view.state.doc;
  const selection = view.state.selection;
  void ask(view).then(
    (actions) => {
      if (!actions || view.state.doc !== doc || !view.state.selection.eq(selection)) return;
      view.dispatch({ effects: setOffer.of({ pos: selection.main.head, actions }) });
      openMenu(view, actions);
    },
    () => undefined,
  );
  return true;
};

/** Asks once the cursor has rested, so the light bulb shows where actions exist. */
const settle = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      const local = update.transactions.some(
        (tr) => tr.selection || (tr.docChanged && !tr.annotation(Transaction.remote)),
      );
      if (local) this.schedule();
    }

    private schedule() {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        const view = this.view;
        const doc = view.state.doc;
        const selection = view.state.selection;
        void ask(view).then(
          (actions) => {
            if (view.state.doc !== doc || !view.state.selection.eq(selection)) return;
            view.dispatch({
              effects: setOffer.of(actions ? { pos: selection.main.head, actions } : null),
            });
          },
          () => undefined,
        );
      }, SETTLE_MS);
    }

    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);

class Bulb extends GutterMarker {
  override toDOM() {
    const dom = document.createElement("span");
    dom.className = "atlas-lightbulb";
    dom.title = "Code actions (mod+.)";
    dom.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
    return dom;
  }
}

const bulb = new Bulb();
// An empty marker the gutter measures its width by, so it never shifts the text.
const spacer = new (class extends GutterMarker {
  override toDOM() {
    const dom = document.createElement("span");
    dom.className = "atlas-lightbulb";
    return dom;
  }
})();

const bulbGutter = gutter({
  class: "atlas-lightbulb-gutter",
  markers: (view) => {
    const offer = view.state.field(offerField, false);
    if (!offer) return RangeSet.empty;
    return RangeSet.of([bulb.range(view.state.doc.lineAt(offer.pos).from)]);
  },
  initialSpacer: () => spacer,
  domEventHandlers: {
    mousedown(view, line) {
      const offer = view.state.field(offerField, false);
      if (!offer || view.state.doc.lineAt(offer.pos).from !== line.from) return false;
      openMenu(view, offer.actions);
      return true;
    },
  },
});

function moveSelection(view: EditorView, by: number): boolean {
  const menu = view.state.field(menuField, false);
  if (!menu) return false;
  const selected = (menu.selected + by + menu.actions.length) % menu.actions.length;
  view.dispatch({ effects: setMenu.of({ ...menu, selected }) });
  return true;
}

// Ahead of Vim's handler and the editor's keymaps while the menu shows.
const menuKeys = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      const menu = view.state.field(menuField, false);
      if (!menu || event.altKey || event.metaKey || event.shiftKey) return false;
      const key = event.ctrlKey ? `Ctrl-${event.key}` : event.key;
      let handled = true;
      if (key === "ArrowDown" || key === "Ctrl-n") moveSelection(view, 1);
      else if (key === "ArrowUp" || key === "Ctrl-p") moveSelection(view, -1);
      else if (key === "Enter" || key === "Tab") apply(view, menu.actions[menu.selected]!);
      else if (key === "Escape") view.dispatch({ effects: setMenu.of(null) });
      else handled = false;
      if (handled) event.preventDefault();
      return handled;
    },
  }),
);

const theme = EditorView.baseTheme({
  ".atlas-lightbulb-gutter .cm-gutterElement": { padding: "0 2px", cursor: "pointer" },
  ".atlas-lightbulb": {
    display: "inline-block",
    width: "12px",
    color: "var(--atlas-diagnostic-warning, #c9971c)",
  },
  ".atlas-code-actions": {
    listStyle: "none",
    margin: "0",
    padding: "3px 0",
    minWidth: "14em",
    maxWidth: "34em",
    maxHeight: "16em",
    overflowY: "auto",
    fontFamily: "var(--atlas-md-font-ui, inherit)",
    fontSize: "12px",
  },
  ".atlas-code-action": { padding: "2px 10px", cursor: "pointer", whiteSpace: "nowrap" },
  ".atlas-code-action[aria-selected]": {
    backgroundColor: "color-mix(in oklab, var(--atlas-md-focus-ring, #0077ee) 25%, transparent)",
  },
  ".atlas-code-action[aria-disabled]": { opacity: "0.55", cursor: "default" },
});

export function environmentCodeActions(options: {
  readonly keys: readonly string[];
  readonly host: CodeActionHost;
}): Extension {
  return [
    codeActionHost.of(options.host),
    offerField,
    menuField,
    settle,
    bulbGutter,
    menuKeys,
    keymap.of(options.keys.map((key) => ({ key, run: showCodeActions, preventDefault: true }))),
    theme,
  ];
}
