import { highlightingFor, language as languageFacet } from "@codemirror/language";
import {
  LSPPlugin,
  nextSignature,
  prevSignature,
  showSignatureHelp,
  signatureHelp,
} from "@codemirror/lsp-client";
import {
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  type Command,
  EditorView,
  hoverTooltip,
  keymap,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";
import { highlightCode } from "@lezer/highlight";

import { lspVimKeys } from "./vimKeys.ts";

/**
 * Astrolabe: the language server's hover and signature help. Hover is lsp-client's source, copied
 * because its tooltip closes on any change to the document: an agent writing elsewhere in the file
 * would close yours. Here only your own edits close it.
 */

// The LSP shapes this file reads.
type MarkedString = string | { readonly language: string; readonly value: string };
type HoverContents =
  | MarkedString
  | readonly MarkedString[]
  | { readonly kind: "markdown" | "plaintext"; readonly value: string };
interface Hover {
  readonly contents: HoverContents;
  readonly range?: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function renderCode(plugin: LSPPlugin, code: MarkedString): string {
  if (typeof code === "string") return plugin.docToHTML(code, "markdown");
  const viewLanguage = plugin.view.state.facet(languageFacet);
  const lang =
    viewLanguage && (!code.language || viewLanguage.name === code.language) ? viewLanguage : null;
  if (!lang) return escape(code.value);
  let html = "";
  highlightCode(
    code.value,
    lang.parser.parse(code.value),
    { style: (tags) => highlightingFor(plugin.view.state, tags) },
    (text, cls) => {
      html += cls ? `<span class="${cls}">${escape(text)}</span>` : escape(text);
    },
    () => {
      html += "<br>";
    },
  );
  return html;
}

function renderHover(plugin: LSPPlugin, contents: HoverContents): string {
  if (Array.isArray(contents)) {
    return (contents as readonly MarkedString[])
      .map((part) => renderCode(plugin, part))
      .join("<br>");
  }
  if (typeof contents === "string" || "language" in (contents as object)) {
    return renderCode(plugin, contents as MarkedString);
  }
  return plugin.docToHTML(contents as { kind: "markdown" | "plaintext"; value: string });
}

const isEmpty = (contents: HoverContents | undefined | null): boolean => {
  if (contents == null) return true;
  if (typeof contents === "string") return contents.trim() === "";
  if (Array.isArray(contents)) return (contents as readonly MarkedString[]).every(isEmpty);
  return (contents as { value: string }).value.trim() === "";
};

const offsetOf = (state: EditorState, position: { line: number; character: number }) => {
  const line = state.doc.line(Math.max(1, Math.min(position.line + 1, state.doc.lines)));
  return Math.min(line.from + position.character, line.to);
};

/** Asks the server about `pos`; null when it has nothing to say there. */
async function hoverAt(view: EditorView, pos: number): Promise<Tooltip | null> {
  const plugin = LSPPlugin.get(view);
  const capabilities = plugin?.client.serverCapabilities;
  if (!plugin || (capabilities && !capabilities.hoverProvider)) return null;
  plugin.client.sync();
  const result = await plugin.client.request<object, Hover | null>("textDocument/hover", {
    position: plugin.toPosition(pos),
    textDocument: { uri: plugin.uri },
  });
  if (!result || isEmpty(result.contents)) return null;
  return {
    pos: result.range ? offsetOf(view.state, result.range.start) : pos,
    end: result.range ? offsetOf(view.state, result.range.end) : pos,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-lsp-hover-tooltip cm-lsp-documentation";
      dom.innerHTML = renderHover(plugin, result.contents);
      return { dom };
    },
  };
}

/** Your own edit, not the environment's: only that closes a hover. */
const localEdit = (tr: Transaction) => tr.docChanged && !tr.annotation(Transaction.remote);

const setKeyboardHover = StateEffect.define<Tooltip | null>();

/** The hover asked for from the keyboard, at the cursor, until the cursor moves or you edit. */
const keyboardHover = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, tr) {
    for (const effect of tr.effects) if (effect.is(setKeyboardHover)) return effect.value;
    if (!tooltip) return tooltip;
    if (localEdit(tr) || tr.selection) return null;
    if (!tr.docChanged) return tooltip;
    return {
      ...tooltip,
      pos: tr.changes.mapPos(tooltip.pos),
      ...(tooltip.end === undefined ? {} : { end: tr.changes.mapPos(tooltip.end) }),
    };
  },
  provide: (field) => showTooltip.from(field),
});

/** Shows the language server's hover for the symbol at the cursor. */
export const showHover: Command = (view) => {
  if (!LSPPlugin.get(view)) return false;
  const at = view.state.selection.main.head;
  const doc = view.state.doc;
  void hoverAt(view, at).then(
    (tooltip) => {
      // Positions are the request's: show it only on the text it was asked about.
      if (view.state.doc !== doc || view.state.selection.main.head !== at) return;
      view.dispatch({ effects: setKeyboardHover.of(tooltip) });
    },
    () => undefined,
  );
  return true;
};

// Ahead of Vim's handler, so Escape closes the hover before Vim sees it.
const closeKeys = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.key !== "Escape" || !view.state.field(keyboardHover, false)) return false;
      view.dispatch({ effects: setKeyboardHover.of(null) });
      event.preventDefault();
      return true;
    },
  }),
);

const theme = EditorView.baseTheme({
  ".cm-tooltip .cm-lsp-hover-tooltip": {
    maxWidth: "40em",
    maxHeight: "20em",
    overflow: "auto",
    padding: "2px 8px",
  },
  ".cm-lsp-hover-tooltip pre, .cm-lsp-hover-tooltip code": { whiteSpace: "pre-wrap" },
});

export interface HoverKeys {
  readonly hover: readonly string[];
  readonly signatureHelp: readonly string[];
}

/** Hover and signature help; signature help also opens as you type a call's `(` and `,`. */
export function environmentHover(options: { readonly keys: HoverKeys }): Extension {
  return [
    hoverTooltip(hoverAt, { hideOn: localEdit }),
    lspVimKeys({ hover: showHover }),
    keyboardHover,
    closeKeys,
    signatureHelp({ keymap: false }),
    keymap.of([
      ...options.keys.hover.map((key) => ({ key, run: showHover })),
      ...options.keys.signatureHelp.map((key) => ({ key, run: showSignatureHelp })),
      // lsp-client's keys for a call with several signatures.
      { key: "Mod-Shift-ArrowUp", run: prevSignature },
      { key: "Mod-Shift-ArrowDown", run: nextSignature },
    ]),
    theme,
  ];
}

export { showSignatureHelp };
