import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  search,
  searchPanelOpen,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { EditorState, Facet, type Extension } from "@codemirror/state";
import { EditorView, keymap, type Command, type KeyBinding } from "@codemirror/view";

/**
 * In-file search: a find bar above the text. Its open keys (Mod-f by default) open it with the
 * selection as the query; Enter, Shift-Enter, Mod-g and Shift-Mod-g step through matches; Alt-Enter
 * selects them all; Mod-Alt-c, w and x switch case, whole words and regex; Mod-Enter in the replace
 * field replaces all; Escape closes it. Vim keeps `/`, `?`, `n` and `N` in normal mode.
 */

export interface InFileSearchOptions {
  /** The keys that open the bar, in CodeMirror's notation; Mod-f when not given. */
  readonly keys?: readonly string[];
}

const installed = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/** Whether `state`'s editor has in-file search, so `openInFileSearch` can open its bar. */
export function hasInFileSearch(state: EditorState): boolean {
  return state.facet(installed);
}

/** Opens the find bar of an editor with in-file search and puts focus in it; false without. */
export function openInFileSearch(view: EditorView): boolean {
  return hasInFileSearch(view.state) && openSearchPanel(view);
}

type QueryOption = "caseSensitive" | "wholeWord" | "regexp";

/** Switches one of the query's options while the bar is open. */
function toggle(option: QueryOption): Command {
  return (view) => {
    if (!searchPanelOpen(view.state)) return false;
    const query = getSearchQuery(view.state);
    const next = new SearchQuery({
      search: query.search,
      caseSensitive: query.caseSensitive,
      literal: query.literal,
      regexp: query.regexp,
      replace: query.replace,
      wholeWord: query.wholeWord,
      [option]: !query[option],
    });
    view.dispatch({ effects: setSearchQuery.of(next) });
    return true;
  };
}

const allowsSelections = (state: EditorState) => state.facet(EditorState.allowMultipleSelections);

/**
 * Every match becomes a selection, and focus goes to the text so typing edits them all; only in
 * an editor that allows several selections.
 */
const selectAllMatches: Command = (view) => {
  if (!allowsSelections(view.state) || !selectMatches(view)) return false;
  view.focus();
  return true;
};

// Where only one selection is allowed, the bar's Select all would select just the first match.
const oneSelection = EditorView.editorAttributes.compute(
  [EditorState.allowMultipleSelections],
  (state): Record<string, string> => (allowsSelections(state) ? {} : { "data-one-selection": "" }),
);

/** Mod-Enter in the replace field (and only there) replaces every match. */
const replaceAllFromField: Command = (view) => {
  const active = view.root.activeElement;
  const inReplace =
    active instanceof HTMLInputElement && active.name === "replace" && view.dom.contains(active);
  return inReplace && replaceAll(view);
};

const PANEL_KEYS = "editor search-panel";

function bindings(openKeys: readonly string[]): KeyBinding[] {
  return [
    ...openKeys.map((key) => ({ key, run: openSearchPanel, scope: PANEL_KEYS })),
    { key: "Mod-g", run: findNext, shift: findPrevious, scope: PANEL_KEYS, preventDefault: true },
    { key: "F3", run: findNext, shift: findPrevious, scope: PANEL_KEYS, preventDefault: true },
    { key: "Escape", run: closeSearchPanel, scope: PANEL_KEYS },
    { key: "Alt-Enter", run: selectAllMatches, scope: "search-panel" },
    { key: "Mod-Enter", run: replaceAllFromField, scope: "search-panel" },
    { key: "Mod-Alt-c", run: toggle("caseSensitive"), scope: PANEL_KEYS },
    { key: "Mod-Alt-w", run: toggle("wholeWord"), scope: PANEL_KEYS },
    { key: "Mod-Alt-x", run: toggle("regexp"), scope: PANEL_KEYS },
  ];
}

// The bar's words in the app's sentence case.
const PHRASES = {
  Find: "Find",
  Replace: "Replace",
  next: "Next",
  previous: "Previous",
  all: "Select all",
  "match case": "Match case",
  regexp: "Regex",
  "by word": "Whole word",
  replace: "Replace",
  "replace all": "Replace all",
  close: "Close",
};

// A view that cannot be typed into cannot take focus either, so its keys would never reach it.
const focusableWhenReadOnly = EditorView.contentAttributes.compute(
  [EditorView.editable],
  (state): Record<string, string> => (state.facet(EditorView.editable) ? {} : { tabindex: "0" }),
);

const controls = {
  font: "inherit",
  fontSize: "100%",
  color: "inherit",
  backgroundColor: "transparent",
  backgroundImage: "none",
  border: "1px solid var(--atlas-md-border-color, #d4d0c8)",
  borderRadius: "4px",
};

const theme = EditorView.baseTheme({
  ".cm-panel.cm-search": {
    padding: "4px 28px 4px 8px",
    fontSize: "12px",
    lineHeight: "1.5",
  },
  "&light .cm-panels-top, &dark .cm-panels-top": {
    borderBottom: "1px solid var(--atlas-md-border-color, #d4d0c8)",
  },
  "&light .cm-search .cm-textfield, &dark .cm-search .cm-textfield": {
    ...controls,
    padding: "2px 6px",
    minWidth: "12em",
  },
  "& .cm-search .cm-textfield:focus": {
    outline: "1px solid var(--atlas-md-focus-ring, currentColor)",
    outlineOffset: "-1px",
  },
  "&light .cm-search .cm-button, &dark .cm-search .cm-button": {
    ...controls,
    padding: "2px 8px",
    cursor: "pointer",
  },
  "& .cm-search .cm-button:hover": {
    backgroundColor: "var(--atlas-md-menu-hover-bg, rgba(127, 127, 127, 0.14))",
  },
  "& .cm-search label": {
    fontSize: "100%",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  "&[data-one-selection] .cm-search [name=select]": { display: "none" },
  "& .cm-search [name=close]": {
    top: "4px",
    right: "8px",
    fontSize: "14px",
    cursor: "pointer",
    color: "inherit",
  },
});

/**
 * In-file search for an editor (see above). Read-only editors take focus so their keys reach it,
 * and their bar has no replace row.
 */
export function inFileSearch({ keys = ["Mod-f"] }: InFileSearchOptions = {}): Extension {
  return [
    installed.of(true),
    search({ top: true }),
    keymap.of(bindings(keys)),
    EditorState.phrases.of(PHRASES),
    focusableWhenReadOnly,
    oneSelection,
    theme,
  ];
}
