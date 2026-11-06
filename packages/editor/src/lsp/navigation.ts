import { LSPPlugin, type WorkspaceMapping } from "@codemirror/lsp-client";
import { EditorSelection, type Extension, Facet } from "@codemirror/state";
import { type Command, EditorView, keymap } from "@codemirror/view";

import { lspVimKeys } from "./vimKeys.ts";

/**
 * Astrolabe: go to a symbol's definition, declaration, type or implementation, and find its
 * references. One place in this file is selected; one in another file opens there through the
 * host; places close together in this file are all selected; anything else is a list to pick from.
 * No definition falls back to the references, as the spec has it.
 */

interface LspRange {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

/** A place an answer names. Lines and columns count from 1. */
export interface NavigationLocation {
  readonly uri: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  /** The line's text, when known. */
  readonly preview: string;
  /** In this editor's file: the place's range in its text when the answer came. */
  readonly here: { readonly from: number; readonly to: number } | null;
}

export interface NavigationHost {
  /** Shows a place in another file. */
  readonly open: (location: NavigationLocation) => void;
  /** Shows several places, to pick from or to read together (see `goToLocation`). */
  readonly pick: (
    view: EditorView,
    title: string,
    locations: readonly NavigationLocation[],
    kind: PlacesKind,
  ) => void;
  /** Says a call hierarchy found nothing, which `title` names. */
  readonly nothing: (title: string) => void;
  /** The cursor is about to jump within this file. */
  readonly jumping: () => void;
}

const navigationHost = Facet.define<NavigationHost, NavigationHost | null>({
  combine: (values) => values[0] ?? null,
});

export type GoToKind = "definition" | "declaration" | "typeDefinition" | "implementation";

export type CallDirection = "incoming" | "outgoing";

/** What a list of places is. */
export type PlacesKind = GoToKind | "references" | CallDirection;

const REQUESTS: Readonly<
  Record<
    GoToKind | "references",
    { readonly method: string; readonly capability: string; readonly label: string }
  >
> = {
  definition: {
    method: "textDocument/definition",
    capability: "definitionProvider",
    label: "Definitions",
  },
  declaration: {
    method: "textDocument/declaration",
    capability: "declarationProvider",
    label: "Declarations",
  },
  typeDefinition: {
    method: "textDocument/typeDefinition",
    capability: "typeDefinitionProvider",
    label: "Type definitions",
  },
  implementation: {
    method: "textDocument/implementation",
    capability: "implementationProvider",
    label: "Implementations",
  },
  references: {
    method: "textDocument/references",
    capability: "referencesProvider",
    label: "References",
  },
};

/** Places within this many lines of each other are selected together rather than listed. */
const CLOSE_LINES = 4;

type LspAnswer = ReadonlyArray<Record<string, unknown>> | Record<string, unknown> | null;

function placesOf(
  answer: LspAnswer,
  plugin: LSPPlugin,
  mapping: WorkspaceMapping,
): NavigationLocation[] {
  const all = Array.isArray(answer) ? answer : answer ? [answer] : [];
  const places: NavigationLocation[] = [];
  for (const raw of all as ReadonlyArray<Record<string, any>>) {
    const uri: unknown = raw.targetUri ?? raw.uri;
    const range: LspRange | undefined = raw.targetSelectionRange ?? raw.targetRange ?? raw.range;
    if (typeof uri !== "string" || !range) continue;
    let here: NavigationLocation["here"] = null;
    let preview = typeof raw["astrolabe/preview"] === "string" ? raw["astrolabe/preview"] : "";
    if (uri === plugin.uri) {
      // The answer is in the text as it was asked; the mapping carries it to the text now.
      const from = mapping.mapPosition(uri, range.start, 1);
      const to = Math.max(from, mapping.mapPosition(uri, range.end, -1));
      here = { from, to };
      preview = plugin.view.state.doc.lineAt(from).text.trim();
    }
    places.push({
      uri,
      line: range.start.line + 1,
      column: range.start.character + 1,
      endLine: range.end.line + 1,
      endColumn: range.end.character + 1,
      preview,
      here,
    });
  }
  return places;
}

/** Puts the cursor on a place: selected in this editor, else opened by the host. */
export function goToLocation(view: EditorView, location: NavigationLocation) {
  if (location.here) {
    const { from, to } = location.here;
    view.state.facet(navigationHost)?.jumping();
    view.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: "center" }),
      userEvent: "select.definition",
    });
    view.focus();
    return;
  }
  view.state.facet(navigationHost)?.open(location);
}

function show(
  view: EditorView,
  kind: GoToKind | "references",
  title: string,
  places: readonly NavigationLocation[],
) {
  if (places.length === 1) return goToLocation(view, places[0]!);
  const here = places.flatMap((place) => (place.here ? [place.here] : []));
  const lines = here.map((range) => view.state.doc.lineAt(range.from).number);
  if (here.length === places.length && Math.max(...lines) - Math.min(...lines) <= CLOSE_LINES) {
    view.state.facet(navigationHost)?.jumping();
    view.dispatch({
      selection: EditorSelection.create(
        here.map((range) => EditorSelection.range(range.from, range.to)),
      ),
      effects: EditorView.scrollIntoView(here[0]!.from, { y: "center" }),
      userEvent: "select.definition",
    });
    return;
  }
  view.state.facet(navigationHost)?.pick(view, title, places, kind);
}

function ask(
  view: EditorView,
  kind: GoToKind | "references",
  head = view.state.selection.main.head,
): boolean {
  const plugin = LSPPlugin.get(view);
  const request = REQUESTS[kind];
  const capabilities = plugin?.client.serverCapabilities;
  if (!plugin || (capabilities && !(capabilities as Record<string, unknown>)[request.capability])) {
    return false;
  }
  plugin.client.sync();
  const word = view.state.wordAt(head);
  const name = word ? view.state.sliceDoc(word.from, word.to) : "";
  void plugin.client.withMapping((mapping) =>
    plugin.client
      .request<object, LspAnswer>(request.method, {
        textDocument: { uri: plugin.uri },
        position: plugin.toPosition(head),
        ...(kind === "references" ? { context: { includeDeclaration: true } } : {}),
      })
      .then(
        (answer) => {
          const now = mapping.mapPos(plugin.uri, head);
          // A place under the cursor is where you already are.
          const places = placesOf(answer, plugin, mapping).filter(
            (place) =>
              kind === "references" ||
              !place.here ||
              !(place.here.from <= now && now <= place.here.to),
          );
          if (places.length === 0) {
            if (kind === "definition") ask(view, "references");
            return;
          }
          show(view, kind, name ? `${request.label} of ${name}` : request.label, places);
        },
        (error) => plugin.reportError(`${request.label} failed`, error),
      ),
  );
  return true;
}

interface CallItem {
  readonly name: string;
}

/** One level of calls to or from the symbol at the cursor, always as a list under a heading. */
function calls(view: EditorView, direction: CallDirection): boolean {
  const plugin = LSPPlugin.get(view);
  const capabilities = plugin?.client.serverCapabilities;
  if (!plugin || (capabilities && !capabilities.callHierarchyProvider)) return false;
  plugin.client.sync();
  const head = view.state.selection.main.head;
  const host = view.state.facet(navigationHost);
  const label = direction === "incoming" ? "Incoming calls" : "Outgoing calls";
  void plugin.client.withMapping(async (mapping) => {
    try {
      const items = await plugin.client.request<object, readonly CallItem[] | null>(
        "textDocument/prepareCallHierarchy",
        { textDocument: { uri: plugin.uri }, position: plugin.toPosition(head) },
      );
      const item = items?.[0];
      const word = view.state.wordAt(head);
      const name = item?.name ?? (word ? view.state.sliceDoc(word.from, word.to) : "");
      const title = name ? `${label} of ${name}` : label;
      const answer = item
        ? await plugin.client.request<object, LspAnswer>(`callHierarchy/${direction}Calls`, {
            item,
          })
        : null;
      const places = placesOf(answer, plugin, mapping);
      if (places.length === 0) host?.nothing(title);
      else host?.pick(view, title, places, direction);
    } catch (error) {
      plugin.reportError(`${label} failed`, error);
    }
  });
  return true;
}

export const showIncomingCalls: Command = (view) => calls(view, "incoming");
export const showOutgoingCalls: Command = (view) => calls(view, "outgoing");

/** The references or implementations of the symbol at `pos`, the cursor staying where it is. */
export function lookUpAt(view: EditorView, kind: "references" | "implementation", pos: number) {
  return ask(view, kind, pos);
}

export const goToDefinition: Command = (view) => ask(view, "definition");
export const goToDeclaration: Command = (view) => ask(view, "declaration");
export const goToTypeDefinition: Command = (view) => ask(view, "typeDefinition");
export const goToImplementation: Command = (view) => ask(view, "implementation");
export const findReferences: Command = (view) => ask(view, "references");

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Mod-click on a name goes to its definition; elsewhere Mod-click still adds a cursor. */
const modClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (
      event.button !== 0 ||
      !(mac ? event.metaKey : event.ctrlKey) ||
      event.altKey ||
      event.shiftKey
    ) {
      return false;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null || !view.state.wordAt(pos)) return false;
    event.preventDefault();
    view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
    return goToDefinition(view);
  },
});

export interface NavigationKeys {
  readonly definition: readonly string[];
  readonly declaration: readonly string[];
  readonly typeDefinition: readonly string[];
  readonly implementation: readonly string[];
  readonly references: readonly string[];
  readonly incomingCalls: readonly string[];
  readonly outgoingCalls: readonly string[];
}

const COMMANDS: Readonly<Record<keyof NavigationKeys, Command>> = {
  definition: goToDefinition,
  declaration: goToDeclaration,
  typeDefinition: goToTypeDefinition,
  implementation: goToImplementation,
  references: findReferences,
  incomingCalls: showIncomingCalls,
  outgoingCalls: showOutgoingCalls,
};

/** Navigation by key, Mod-click and Vim's `gd` `gD` `gy` `gI` `gr` `gh` `gH`, through `host`. */
export function environmentNavigation(options: {
  readonly keys: NavigationKeys;
  readonly host: NavigationHost;
}): Extension {
  return [
    navigationHost.of(options.host),
    modClick,
    keymap.of(
      (Object.entries(options.keys) as Array<[keyof NavigationKeys, readonly string[]]>).flatMap(
        ([command, keys]) =>
          keys.map((key) => ({
            key,
            run: COMMANDS[command],
            preventDefault: true,
          })),
      ),
    ),
    lspVimKeys(COMMANDS),
  ];
}
