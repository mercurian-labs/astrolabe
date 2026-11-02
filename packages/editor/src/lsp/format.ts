import { getIndentUnit, indentUnit } from "@codemirror/language";
import { formatDocument, LSPPlugin } from "@codemirror/lsp-client";
import type { EditorState, Extension } from "@codemirror/state";
import { type Command, keymap } from "@codemirror/view";

/**
 * Astrolabe: Format Document runs in the editor, through lsp-client, so its edit is in the file's
 * own undo; the gateway refuses it when it would touch text the editor hasn't received. Format on
 * save runs in the environment instead (`documents.save` with `format`).
 */

/** The editor's indentation, as LSP formatting options. */
export function formattingOptions(state: EditorState) {
  return {
    tabSize: Math.max(1, getIndentUnit(state)),
    insertSpaces: !state.facet(indentUnit).includes("\t"),
  };
}

/** Whether the editor's language server formats documents. */
export function canFormat(state: EditorState, plugin: LSPPlugin | null): boolean {
  return !state.readOnly && Boolean(plugin?.client.serverCapabilities?.documentFormattingProvider);
}

export const formatCode: Command = (view) =>
  canFormat(view.state, LSPPlugin.get(view)) && formatDocument(view);

export function environmentFormat(options: { readonly keys: readonly string[] }): Extension {
  return keymap.of(options.keys.map((key) => ({ key, run: formatCode, preventDefault: true })));
}
