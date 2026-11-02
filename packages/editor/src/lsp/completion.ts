import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  completionStatus,
  insertCompletionText,
  moveCompletionSelection,
  snippet,
  startCompletion,
} from "@codemirror/autocomplete";
import { LSPPlugin, type WorkspaceMapping } from "@codemirror/lsp-client";
import {
  type ChangeSpec,
  type EditorState,
  type Extension,
  MapMode,
  Prec,
} from "@codemirror/state";
import { type Command, EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { rankCompletions } from "./ranking.ts";

/**
 * Astrolabe: completion from the language server through the environment's gateway. Our own source
 * over lsp-client's requests, for the spec's ranking (`ranking.ts`, autocomplete's filtering off)
 * and for resolving the selected item, which brings its documentation and an auto-import's edit.
 */

// The LSP items' shape, as far as this file reads it.
interface Range {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}
interface TextEdit {
  readonly range: Range;
  readonly newText: string;
}
interface LspItem {
  readonly label: string;
  readonly kind?: number;
  readonly detail?: string;
  readonly documentation?:
    | string
    | { readonly kind: "markdown" | "plaintext"; readonly value: string };
  readonly sortText?: string;
  readonly filterText?: string;
  readonly insertText?: string;
  readonly insertTextFormat?: number;
  readonly textEditText?: string;
  readonly textEdit?: { readonly newText: string; readonly range?: Range; readonly insert?: Range };
  readonly additionalTextEdits?: readonly TextEdit[];
  readonly commitCharacters?: readonly string[];
  readonly data?: unknown;
}
interface LspList {
  readonly isIncomplete?: boolean;
  readonly items: LspItem[];
  readonly itemDefaults?: {
    readonly commitCharacters?: readonly string[];
    readonly editRange?: Range | { readonly insert: Range; readonly replace: Range };
    readonly insertTextFormat?: number;
    readonly data?: unknown;
  };
}

const KIND_TYPES: Readonly<Record<number, string>> = {
  1: "text",
  2: "method",
  3: "function",
  4: "class",
  5: "property",
  6: "variable",
  7: "class",
  8: "interface",
  9: "namespace",
  10: "property",
  11: "keyword",
  12: "constant",
  13: "constant",
  14: "keyword",
  16: "constant",
  20: "constant",
  21: "constant",
  22: "class",
  25: "type",
};

const RequestCancelled = -32800;

/** LSP snippets in autocomplete's syntax: `$1` is `${1}`, and only `$}\` take backslashes. */
const toSnippet = (text: string) =>
  text.replace(/\\([$}\\])|\$(\d+)/g, (_match, escaped, field) => escaped || `\${${field}}`);

const offsetOf = (state: EditorState, position: Range["start"]) => {
  if (position.line < 0 || position.line >= state.doc.lines) return null;
  const line = state.doc.line(position.line + 1);
  if (position.character < 0 || position.character > line.length) return null;
  return line.from + position.character;
};

/** One item's resolve, asked once, and the mapping its answer's edits are read through. */
interface Resolution {
  readonly done: Promise<LspItem>;
  readonly mapping: WorkspaceMapping;
  value: LspItem | null;
}

/** The open menu's resolves; cleared when it closes. */
class MenuItems {
  readonly resolutions = new Map<LspItem, Resolution>();

  clear() {
    for (const resolution of this.resolutions.values()) resolution.mapping.destroy();
    this.resolutions.clear();
  }
}

const menus = new WeakMap<EditorView, MenuItems>();
const menuOf = (view: EditorView) => {
  let menu = menus.get(view);
  if (!menu) menus.set(view, (menu = new MenuItems()));
  return menu;
};

function resolveItem(view: EditorView, item: LspItem): Resolution | null {
  const plugin = LSPPlugin.get(view);
  const provider = plugin?.client.serverCapabilities?.completionProvider;
  if (!plugin || !provider?.resolveProvider) return null;
  const menu = menuOf(view);
  const known = menu.resolutions.get(item);
  if (known) return known;
  plugin.client.sync();
  const mapping = plugin.client.workspaceMapping();
  const resolution: Resolution = {
    mapping,
    value: null,
    done: plugin.client
      .request<LspItem, LspItem>("completionItem/resolve", item)
      .then((resolved) => (resolution.value = resolved ?? item))
      .catch(() => (resolution.value = item)),
  };
  menu.resolutions.set(item, resolution);
  return resolution;
}

/**
 * An item's extra edits (an import) in the editor's current text, leaving out any that overlap the
 * main edit at `from`-`to` or whose text was deleted since the answer.
 */
function extraEdits(
  view: EditorView,
  uri: string,
  edits: readonly TextEdit[],
  mapping: WorkspaceMapping | null,
  from: number,
  to: number,
): ChangeSpec[] {
  const specs: ChangeSpec[] = [];
  for (const edit of edits) {
    const start = mapping
      ? mapping.mapPosition(uri, edit.range.start, 1, MapMode.TrackDel)
      : offsetOf(view.state, edit.range.start);
    const end = mapping
      ? mapping.mapPosition(uri, edit.range.end, -1, MapMode.TrackDel)
      : offsetOf(view.state, edit.range.end);
    if (start === null || end === null || end < start) continue;
    if (start < to && end > from) continue;
    specs.push({ from: start, to: end, insert: edit.newText });
  }
  return specs;
}

function documentation(plugin: LSPPlugin, item: LspItem): Node | null {
  if (!item.documentation && !item.detail) return null;
  const dom = document.createElement("div");
  dom.className = "cm-lsp-documentation cm-lsp-completion-documentation";
  const parts: string[] = [];
  if (item.detail)
    parts.push(plugin.docToHTML({ kind: "markdown", value: "```\n" + item.detail + "\n```" }));
  if (item.documentation) parts.push(plugin.docToHTML(item.documentation));
  dom.innerHTML = parts.join("");
  return dom;
}

/** The option for one item: inserts its text, then the edits its resolve brings. */
function option(view: EditorView, list: LspList, item: LspItem, uri: string): Completion {
  const text = item.textEdit?.newText || item.textEditText || item.insertText || item.label;
  const format = item.insertTextFormat ?? list.itemDefaults?.insertTextFormat;
  const completion: Completion = {
    label: item.filterText || item.label,
    displayLabel: item.label,
    ...(item.kind !== undefined && KIND_TYPES[item.kind] ? { type: KIND_TYPES[item.kind] } : {}),
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.commitCharacters ? { commitCharacters: item.commitCharacters } : {}),
    info: () => {
      const plugin = LSPPlugin.get(view);
      const resolution = resolveItem(view, item);
      if (!plugin) return null;
      if (!resolution) return documentation(plugin, item);
      return resolution.done.then((resolved) => documentation(plugin, resolved));
    },
    apply: (target, _completion, from, to) => {
      const insert = format === 2 ? null : insertCompletionText(target.state, text, from, to);
      if (format === 2) snippet(toSnippet(text))(target, completion, from, to);
      const resolution = resolveItem(target, item);
      const known = resolution?.value ?? (resolution ? null : item);
      if (known) {
        const edits = extraEdits(
          target,
          uri,
          known.additionalTextEdits ?? [],
          resolution?.mapping ?? null,
          from,
          to,
        );
        if (insert) target.dispatch(insert, { changes: edits });
        else if (edits.length > 0) target.dispatch({ changes: edits, userEvent: "input.complete" });
        return;
      }
      if (insert) target.dispatch(insert);
      // Not resolved yet: its import follows when the answer comes, through what changed since.
      void resolution!.done.then((resolved) => {
        const edits = extraEdits(
          target,
          uri,
          resolved.additionalTextEdits ?? [],
          resolution!.mapping,
          -1,
          -1,
        );
        if (edits.length > 0) target.dispatch({ changes: edits, userEvent: "input.complete" });
      });
    },
  };
  return completion;
}

function triggerFor(plugin: LSPPlugin, character: string) {
  const triggers = plugin.client.serverCapabilities?.completionProvider?.triggerCharacters;
  if (triggers?.includes(character)) return { triggerKind: 2, triggerCharacter: character };
  if (/[\w$]/.test(character)) return { triggerKind: 1 };
  return null;
}

/** The word being completed: the server's edit range when it gives one, else the word before. */
function rangeOf(context: CompletionContext, list: LspList) {
  const defaults = list.itemDefaults?.editRange;
  const first = list.items[0]?.textEdit;
  const range = defaults
    ? "insert" in defaults
      ? defaults.insert
      : defaults
    : first
      ? (first.range ?? first.insert ?? null)
      : null;
  const line = context.state.doc.lineAt(context.pos);
  if (range && range.start.line === line.number - 1) {
    return { from: Math.min(line.from + range.start.character, context.pos) };
  }
  const word = context.matchBefore(/[\w$]*/);
  return { from: word ? word.from : context.pos };
}

/** The menu for `query`, which re-ranks itself while the word grows from the same start. */
function result(
  list: LspList,
  options: ReadonlyArray<{ readonly item: LspItem; readonly completion: Completion }>,
  from: number,
  query: string,
): CompletionResult {
  const itemOf = new Map(options.map((entry) => [entry.completion, entry.item]));
  const ranked = rankCompletions(
    options.map((entry) => ({
      entry,
      filterText: entry.item.filterText || entry.item.label,
      label: entry.item.label,
      sortText: entry.item.sortText,
      kind: entry.item.kind,
    })),
    query,
  );
  const matched = new Map(ranked.map((rank) => [rank.item.entry.completion, rank.matched]));
  return {
    from,
    options: ranked.map((rank) => rank.item.entry.completion),
    filter: false,
    ...(list.itemDefaults?.commitCharacters
      ? { commitCharacters: list.itemDefaults.commitCharacters }
      : {}),
    getMatch: (completion) => {
      const offsets = matched.get(completion) ?? [];
      // The label shown can differ from the text matched; highlight only when they agree.
      const item = itemOf.get(completion);
      if (item && item.filterText && item.filterText !== item.label) return [];
      return offsets.flatMap((at) => [at, at + 1]);
    },
    update: (_current, newFrom, to, context) => {
      if (list.isIncomplete || newFrom !== from) return null;
      const typed = context.state.sliceDoc(from, to);
      if (!/^[\w$]+$/.test(typed) || !typed.startsWith(query)) return null;
      return result(list, options, from, typed);
    },
  };
}

async function serverSource(context: CompletionContext): Promise<CompletionResult | null> {
  const view = context.view;
  const plugin = view && LSPPlugin.get(view);
  const capabilities = plugin?.client.serverCapabilities;
  if (!view || !plugin || (capabilities && !capabilities.completionProvider)) return null;
  const trigger = context.explicit
    ? { triggerKind: 1 }
    : triggerFor(plugin, context.state.sliceDoc(context.pos - 1, context.pos));
  if (!trigger) return null;
  menuOf(view).clear();
  plugin.client.sync();
  const params = {
    position: plugin.toPosition(context.pos),
    textDocument: { uri: plugin.uri },
    context: trigger,
  };
  context.addEventListener("abort", () => plugin.client.cancelRequest(params));
  let answer: LspList | LspItem[] | null;
  try {
    answer = await plugin.client.request<typeof params, LspList | LspItem[] | null>(
      "textDocument/completion",
      params,
    );
  } catch (error) {
    if ((error as { code?: number }).code === RequestCancelled) return null;
    throw error;
  }
  if (!answer || context.aborted) return null;
  const list: LspList = Array.isArray(answer) ? { items: answer } : answer;
  const defaultData = list.itemDefaults?.data;
  const options = list.items.map((raw) => {
    const item =
      raw.data === undefined && defaultData !== undefined ? { ...raw, data: defaultData } : raw;
    return { item, completion: option(view, list, item, plugin.uri) };
  });
  const { from } = rangeOf(context, list);
  return result(list, options, from, context.state.sliceDoc(from, context.pos));
}

// Resolves hold a mapping each, kept until the menu that asked for them closes.
const releaseResolves = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (completionStatus(update.startState) !== null && completionStatus(update.state) === null) {
        // An apply waiting on a resolve still holds its own promise and mapping until then.
        const menu = menus.get(this.view);
        if (menu) {
          const pending = [...menu.resolutions.values()].filter((entry) => entry.value === null);
          for (const entry of menu.resolutions.values()) {
            if (entry.value !== null) entry.mapping.destroy();
          }
          menu.resolutions.clear();
          for (const entry of pending) void entry.done.finally(() => entry.mapping.destroy());
        }
      }
    }
    destroy() {
      menus.get(this.view)?.clear();
    }
  },
);

export interface CompletionKeys {
  /** Opens the menu where it is closed. */
  readonly complete: readonly string[];
}

/** What the open menu's keys do; plain keys only. */
const MENU_KEYS: Readonly<Record<string, Command>> = {
  Tab: acceptCompletion,
  Enter: acceptCompletion,
  Escape: closeCompletion,
  ArrowDown: moveCompletionSelection(true),
  ArrowUp: moveCompletionSelection(false),
  PageDown: moveCompletionSelection(true, "page"),
  PageUp: moveCompletionSelection(false, "page"),
};
const CTRL_MENU_KEYS: Readonly<Record<string, Command>> = {
  n: moveCompletionSelection(true),
  p: moveCompletionSelection(false),
};

/**
 * While the menu shows, its keys come first, ahead of Vim's handler as well as keymaps: Tab
 * accepts like Enter (snippet fields and indenting get it otherwise), Ctrl-n and Ctrl-p move, and
 * Escape closes only the menu, so in insert mode the first Escape doesn't leave insert mode too.
 */
const menuKeys = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      if (completionStatus(view.state) !== "active" || event.altKey || event.metaKey) return false;
      const command = event.ctrlKey
        ? event.shiftKey
          ? undefined
          : CTRL_MENU_KEYS[event.key]
        : event.shiftKey
          ? undefined
          : MENU_KEYS[event.key];
      if (!command || !command(view)) return false;
      event.preventDefault();
      return true;
    },
  }),
);

export interface CompletionKeys {
  /** Opens the menu where it is closed. */
  readonly complete: readonly string[];
}

/** The editor's completion: the language server's items, ranked as the spec says. */
export function environmentCompletion(options: { readonly keys: CompletionKeys }): Extension {
  return [
    menuKeys,
    keymap.of(options.keys.complete.map((key) => ({ key, run: startCompletion }))),
    autocompletion({
      override: [serverSource],
      // Our keys above; Enter, arrows and the page keys stay the package's.
      defaultKeymap: true,
      closeOnBlur: true,
    }),
    releaseResolves,
  ];
}

export { startCompletion };
