import { LSPPlugin } from "@codemirror/lsp-client";
import { EditorSelection } from "@codemirror/state";
import { type Command, EditorView } from "@codemirror/view";

import { showCodeActions } from "./codeActions.ts";
import { hasLanguageServer } from "./environmentLsp.ts";
import { canFormat, formatCode } from "./format.ts";
import {
  findReferences,
  goToDefinition,
  goToImplementation,
  goToTypeDefinition,
  showIncomingCalls,
  showOutgoingCalls,
} from "./navigation.ts";
import { renameSymbol } from "./rename.ts";

/**
 * Astrolabe: a code file's right-click menu. The language server's features (faint until the
 * server is ready, or where it lacks one), the clipboard, then the file's own entries. The host
 * draws the menu, natively on desktop.
 */

export interface ContextMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
}

export interface CodeContextMenuHost {
  /** Shows `entries` at the pointer; resolves with the chosen entry's id, or null. */
  readonly show: (
    entries: readonly ContextMenuEntry[],
    at: { readonly x: number; readonly y: number },
  ) => Promise<string | null>;
  readonly readClipboard: () => Promise<string>;
  readonly writeClipboard: (text: string) => Promise<void>;
  /** The file's entries, after the editor's. */
  readonly fileEntries: readonly { readonly label: string; readonly run: () => void }[];
}

interface Item {
  readonly label: string;
  readonly separatorBefore?: boolean;
  readonly enabled: (view: EditorView) => boolean;
  readonly run: (view: EditorView, host: CodeContextMenuHost) => void;
}

function serves(view: EditorView, capability: string): boolean {
  const capabilities = LSPPlugin.get(view)?.client.serverCapabilities as
    | Record<string, unknown>
    | null
    | undefined;
  return Boolean(capabilities?.[capability]);
}

const ask = (label: string, capability: string, command: Command, edits = false): Item => ({
  label,
  enabled: (view) => serves(view, capability) && !(edits && view.state.readOnly),
  run: (view) => void command(view),
});

const LANGUAGE: readonly Item[] = [
  ask("Go to Definition", "definitionProvider", goToDefinition),
  ask("Go to Type Definition", "typeDefinitionProvider", goToTypeDefinition),
  ask("Go to Implementation", "implementationProvider", goToImplementation),
  ask("Find All References", "referencesProvider", findReferences),
  ask("Show Incoming Calls", "callHierarchyProvider", showIncomingCalls),
  ask("Show Outgoing Calls", "callHierarchyProvider", showOutgoingCalls),
  { ...ask("Rename Symbol…", "renameProvider", renameSymbol, true), separatorBefore: true },
  ask("Code Actions…", "codeActionProvider", showCodeActions, true),
  {
    label: "Format Document",
    enabled: (view) => canFormat(view.state, LSPPlugin.get(view)),
    run: (view) => void formatCode(view),
  },
];

// A clipboard the page may not use (no permission) leaves the text as it was.
const ignore = () => undefined;

function selectedText(view: EditorView): string {
  return view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => view.state.sliceDoc(range.from, range.to))
    .join(view.state.lineBreak);
}

const CLIPBOARD: readonly Item[] = [
  {
    label: "Cut",
    separatorBefore: true,
    enabled: (view) => !view.state.readOnly && !view.state.selection.ranges.every((r) => r.empty),
    run: (view, host) => {
      const doc = view.state.doc;
      void host.writeClipboard(selectedText(view)).then(() => {
        // The text you cut is the text you copied, or nothing goes.
        if (view.state.doc !== doc) return;
        view.dispatch(
          view.state.changeByRange((range) => ({
            changes: { from: range.from, to: range.to },
            range: EditorSelection.cursor(range.from),
          })),
          { scrollIntoView: true, userEvent: "delete.cut" },
        );
      }, ignore);
    },
  },
  {
    label: "Copy",
    enabled: (view) => !view.state.selection.ranges.every((range) => range.empty),
    run: (view, host) => void host.writeClipboard(selectedText(view)).catch(ignore),
  },
  {
    label: "Paste",
    enabled: (view) => !view.state.readOnly,
    run: (view, host) =>
      void host.readClipboard().then((text) => {
        if (!text || view.state.readOnly) return;
        view.dispatch(view.state.replaceSelection(text), {
          scrollIntoView: true,
          userEvent: "input.paste",
        });
      }, ignore),
  },
];

/** The menu's entries for `view` as it is now, and what each one runs. */
function contextMenuItems(view: EditorView, host: CodeContextMenuHost) {
  const items: Item[] = [...(hasLanguageServer(view.state) ? LANGUAGE : []), ...CLIPBOARD];
  host.fileEntries.forEach((entry, index) =>
    items.push({
      label: entry.label,
      separatorBefore: index === 0,
      enabled: () => true,
      run: entry.run,
    }),
  );
  return items.map((item, index) => ({
    entry: {
      id: String(index),
      label: item.label,
      // The first entry starts the menu; no line above it.
      ...(item.separatorBefore && index > 0 ? { separatorBefore: true } : {}),
      ...(item.enabled(view) ? {} : { disabled: true }),
    } satisfies ContextMenuEntry,
    run: () => item.run(view, host),
  }));
}

/** Right-click shows the menu, first moving the cursor to the click unless it is in a selection. */
export function codeContextMenu(host: CodeContextMenuHost) {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const { ranges } = view.state.selection;
      if (pos !== null && !ranges.some((range) => range.from <= pos && pos <= range.to)) {
        view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
      }
      event.preventDefault();
      const items = contextMenuItems(view, host);
      void host
        .show(
          items.map((item) => item.entry),
          { x: event.clientX, y: event.clientY },
        )
        .then((id) => {
          const chosen = items.find((item) => item.entry.id === id && !item.entry.disabled);
          if (!chosen) return;
          view.focus();
          chosen.run();
        });
      return true;
    },
  });
}
