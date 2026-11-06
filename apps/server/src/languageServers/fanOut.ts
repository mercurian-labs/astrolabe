import type { LanguageServerId } from "@t3tools/contracts";

/**
 * How one editor's session spreads over the servers on a file: which of them each request goes
 * to, and how their answers read as one server's. See docs/internals/language-servers.md.
 */

// LSP messages are untyped JSON; each use checks the shape it reads.
type Json = any;

export interface Route {
  /** The capability a server needs to hear the request. */
  readonly capability: string;
  /**
   * `first` asks the first that has it, `hover` moves on when it answers nothing, `all` asks
   * every one and merges.
   */
  readonly fan: "first" | "hover" | "all";
}

const first = (capability: string): Route => ({ capability, fan: "first" });

export const ROUTES: ReadonlyMap<string, Route> = new Map([
  ["textDocument/hover", { capability: "hoverProvider", fan: "hover" }],
  ["textDocument/definition", first("definitionProvider")],
  ["textDocument/declaration", first("declarationProvider")],
  ["textDocument/typeDefinition", first("typeDefinitionProvider")],
  ["textDocument/implementation", first("implementationProvider")],
  ["textDocument/references", first("referencesProvider")],
  ["textDocument/rename", first("renameProvider")],
  ["textDocument/prepareRename", first("renameProvider")],
  ["textDocument/signatureHelp", first("signatureHelpProvider")],
  ["textDocument/formatting", first("documentFormattingProvider")],
  ["textDocument/rangeFormatting", first("documentRangeFormattingProvider")],
  ["textDocument/completion", { capability: "completionProvider", fan: "all" }],
  ["textDocument/codeAction", { capability: "codeActionProvider", fan: "all" }],
]);

export const FORMATTING_METHODS = new Set([
  "textDocument/formatting",
  "textDocument/rangeFormatting",
]);

const union = (lists: ReadonlyArray<unknown>) => [
  ...new Set(lists.flatMap((list) => (Array.isArray(list) ? list : []))),
];

/** What the servers can do together; first wins where one provider's options can't merge. */
export const mergeCapabilities = (all: ReadonlyArray<Json>): Json => {
  const merged: Json = {};
  for (const capabilities of all) {
    for (const [name, value] of Object.entries(capabilities ?? {})) {
      if (value !== false && value != null) merged[name] ??= value;
    }
  }
  const providers = (name: string): Array<Json> =>
    all.flatMap((capabilities) => capabilities?.[name] ?? []);
  const completion = providers("completionProvider");
  if (completion.length > 0) {
    merged.completionProvider = {
      ...completion[0],
      triggerCharacters: union(completion.map((provider) => provider.triggerCharacters)),
      resolveProvider: completion.some((provider) => provider.resolveProvider === true),
    };
  }
  const signature = providers("signatureHelpProvider");
  if (signature.length > 0) {
    merged.signatureHelpProvider = {
      ...signature[0],
      triggerCharacters: union(signature.map((provider) => provider.triggerCharacters)),
      retriggerCharacters: union(signature.map((provider) => provider.retriggerCharacters)),
    };
  }
  return merged;
};

/** Whether a server hears this completion: a trigger character is only for those that named it. */
export const hearsCompletion = (capabilities: Json, params: Json) =>
  params?.context?.triggerKind !== 2 ||
  capabilities?.completionProvider?.triggerCharacters?.includes(params.context.triggerCharacter) ===
    true;

const ORIGIN = "astrolabe/origin";

export interface CompletionOrigin {
  readonly server: LanguageServerId;
  readonly path: string;
}

/** Marks each item with who made it, for `completionItem/resolve`, which names neither. */
export const tagCompletions = (list: Json, origin: CompletionOrigin): Json => {
  const shared = list?.itemDefaults?.data;
  for (const item of list?.items ?? []) {
    item.data = { [ORIGIN]: origin, data: item.data ?? shared };
  }
  return list;
};

/** The item as its server gave it, and who that was; null for an item no list here made. */
export const originOf = (
  item: Json,
): { readonly origin: CompletionOrigin; readonly item: Json } | null => {
  const origin = item?.data?.[ORIGIN];
  if (typeof origin?.server !== "string" || typeof origin?.path !== "string") return null;
  return { origin, item: { ...item, data: item.data.data } };
};

/** Items with their list's defaults written out, for a list that keeps no defaults of its own. */
const expanded = (list: Json): Array<Json> => {
  const defaults = list.itemDefaults;
  if (defaults === undefined) return list.items;
  return list.items.map((item: Json) => {
    const newText = item.textEditText ?? item.label;
    const range = defaults.editRange;
    return {
      ...(defaults.commitCharacters ? { commitCharacters: defaults.commitCharacters } : {}),
      ...(defaults.insertTextFormat === undefined
        ? {}
        : { insertTextFormat: defaults.insertTextFormat }),
      ...(range === undefined
        ? {}
        : { textEdit: "insert" in range ? { ...range, newText } : { range, newText } }),
      ...item,
    };
  });
};

export const mergeCompletions = (lists: ReadonlyArray<Json>): Json =>
  lists.length === 1
    ? lists[0]
    : {
        isIncomplete: lists.some((list) => list.isIncomplete === true),
        items: lists.flatMap(expanded),
      };

/** Whether a merged answer has anything in it: an empty one isn't worth ending a wait for. */
export const hasContent = (result: Json) =>
  Array.isArray(result) ? result.length > 0 : (result?.items?.length ?? 0) > 0;
