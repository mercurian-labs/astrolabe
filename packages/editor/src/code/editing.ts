import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  copyLineUp,
  defaultKeymap,
  deleteLine,
  historyKeymap,
  indentLess,
  indentMore,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  redoSelection,
  selectParentSyntax,
  toggleComment,
  undoSelection,
} from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  foldAll,
  foldCode,
  indentOnInput,
  unfoldAll,
  unfoldCode,
} from "@codemirror/language";
import { SearchCursor, highlightSelectionMatches } from "@codemirror/search";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type ChangeSpec,
  type Extension,
  type SelectionRange,
} from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  keymap,
  rectangularSelection,
  type Command,
  type KeyBinding,
} from "@codemirror/view";

import { drawnSelection } from "../drawnSelection.ts";

/**
 * Core editing for a repository file: several selections, column selection with Alt-drag,
 * brackets that close and match, folding, indenting as you type, and the named commands below,
 * each on the keys its host gives it. CodeMirror's default keymap fills in the rest, minus its
 * keys for the named commands, so a command a user moves to other keys leaves its old one free.
 */

/** A selection range's text, or the word at a cursor; `word` says whether it is a whole word. */
function searchedText(state: EditorState, range: SelectionRange) {
  if (!range.empty) {
    const word = state.wordAt(range.from);
    const isWord = word !== null && word.from === range.from && word.to === range.to;
    return { from: range.from, to: range.to, word: isWord };
  }
  const word = state.wordAt(range.head);
  return word ? { from: word.from, to: word.to, word: true } : null;
}

/**
 * The next match of `query` after `after`, wrapping round, that no range in `skip` starts at;
 * matching whole words only when `word` holds.
 */
function nextMatch(
  state: EditorState,
  query: string,
  after: number,
  word: boolean,
  skip: readonly SelectionRange[],
): { from: number; to: number } | null {
  const fits = (from: number, to: number) => {
    if (skip.some((range) => range.from === from)) return false;
    if (!word) return true;
    const found = state.wordAt(from);
    return found !== null && found.from === from && found.to === to;
  };
  for (const [from, to] of [
    [after, state.doc.length],
    [0, after],
  ] as const) {
    const cursor = new SearchCursor(state.doc, query, from, to);
    for (cursor.next(); !cursor.done; cursor.next()) {
      if (fits(cursor.value.from, cursor.value.to)) return cursor.value;
    }
  }
  return null;
}

/**
 * Adds the next occurrence of the selected text as a selection, which becomes the main one so
 * the next press (or a skip) carries on from it. A cursor selects its word first.
 */
const selectNextOccurrence: Command = (view) => {
  const { state } = view;
  const { ranges, main } = state.selection;
  if (ranges.some((range) => range.empty)) {
    const words = ranges.map((range) => {
      const word = range.empty ? state.wordAt(range.head) : null;
      return word ? EditorSelection.range(word.from, word.to) : range;
    });
    if (words.every((range, index) => range.eq(ranges[index]!))) return false;
    view.dispatch({
      selection: EditorSelection.create(words, state.selection.mainIndex),
      userEvent: "select.search",
    });
    return true;
  }
  const query = state.sliceDoc(main.from, main.to);
  if (ranges.some((range) => state.sliceDoc(range.from, range.to) !== query)) return false;
  const found = nextMatch(state, query, main.to, searchedText(state, main)?.word ?? false, ranges);
  if (!found) return false;
  view.dispatch({
    selection: state.selection.addRange(EditorSelection.range(found.from, found.to)),
    effects: EditorView.scrollIntoView(found.to),
    userEvent: "select.search",
  });
  return true;
};

/**
 * Skips this occurrence: the main selection (the one added last) moves on to the next
 * occurrence, and the others stay.
 */
const skipOccurrence: Command = (view) => {
  const { state } = view;
  const { main, mainIndex, ranges } = state.selection;
  const searched = searchedText(state, main);
  if (!searched || main.empty) return false;
  const query = state.sliceDoc(main.from, main.to);
  const others = ranges.filter((_, index) => index !== mainIndex);
  const found = nextMatch(state, query, main.to, searched.word, [...others, main]);
  if (!found) return false;
  view.dispatch({
    selection: EditorSelection.create(
      [...others, EditorSelection.range(found.from, found.to)],
      others.length,
    ),
    effects: EditorView.scrollIntoView(found.to),
    userEvent: "select.search",
  });
  return true;
};

const MAX_OCCURRENCES = 1000;

/** Selects every occurrence of the main selection's text, or of the word at the cursor. */
const selectAllOccurrences: Command = (view) => {
  const { state } = view;
  const searched = searchedText(state, state.selection.main);
  if (!searched) return false;
  const query = state.sliceDoc(searched.from, searched.to);
  const found: SelectionRange[] = [];
  let mainIndex = 0;
  for (let cursor = new SearchCursor(state.doc, query); !cursor.next().done;) {
    const { from, to } = cursor.value;
    if (searched.word) {
      const word = state.wordAt(from);
      if (!word || word.from !== from || word.to !== to) continue;
    }
    if (found.length >= MAX_OCCURRENCES) return false;
    if (from === searched.from) mainIndex = found.length;
    found.push(EditorSelection.range(from, to));
  }
  if (found.length === 0) return false;
  view.dispatch({
    selection: EditorSelection.create(found, mainIndex),
    userEvent: "select.search.matches",
  });
  return true;
};

/**
 * The lines the selection covers, as runs of line numbers with shared lines merged. A range that
 * ends at the start of a line leaves that line out, as selecting whole lines does.
 */
function selectedLineRuns(state: EditorState): Array<{ first: number; last: number }> {
  const runs: Array<{ first: number; last: number }> = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const end = state.doc.lineAt(range.to);
    const last =
      !range.empty && range.to === end.from && end.number > first ? end.number - 1 : end.number;
    const previous = runs.at(-1);
    if (previous && first <= previous.last) previous.last = Math.max(previous.last, last);
    else runs.push({ first, last });
  }
  return runs;
}

/**
 * Joins each selection's lines into one, or a cursor's line with the next: each line break and
 * the next line's indentation become one space (none before an empty line).
 */
const joinLines: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  const changes: ChangeSpec[] = [];
  for (const { first, last } of selectedLineRuns(state)) {
    const end = Math.min(last === first ? first + 1 : last, state.doc.lines);
    for (let number = first; number < end; number += 1) {
      const line = state.doc.line(number);
      const next = state.doc.line(number + 1);
      const trailing = line.text.length - line.text.trimEnd().length;
      const indent = next.text.length - next.text.trimStart().length;
      // An empty line goes without a space, unless it sits between two that join.
      const blank = (text: string) => text.trim() === "";
      const insert = blank(next.text) || (blank(line.text) && number === first) ? "" : " ";
      changes.push({ from: line.to - trailing, to: next.from + indent, insert });
    }
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input.join" });
  return true;
};

/** Sorts the lines each selection covers, by their text, case sensitive. */
const sortLines: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  const changes: ChangeSpec[] = [];
  for (const { first, last } of selectedLineRuns(state)) {
    if (last === first) continue;
    const from = state.doc.line(first).from;
    const to = state.doc.line(last).to;
    const lines = state.sliceDoc(from, to).split(state.lineBreak);
    const sorted = lines.toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const insert = sorted.join(state.lineBreak);
    if (insert !== state.sliceDoc(from, to)) changes.push({ from, to, insert });
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: "input.sort" });
  return true;
};

/** Converts each selection's text, or the word at each cursor, keeping it selected. */
function convertCase(convert: (text: string) => string): Command {
  return (view) => {
    const { state } = view;
    if (state.readOnly) return false;
    let changed = false;
    const transaction = state.changeByRange((range) => {
      const target = range.empty ? state.wordAt(range.head) : range;
      if (!target) return { range };
      const text = state.sliceDoc(target.from, target.to);
      const insert = convert(text);
      if (insert === text) return { range };
      changed = true;
      const end = target.from + insert.length;
      return {
        changes: { from: target.from, to: target.to, insert },
        range: range.empty
          ? EditorSelection.cursor(Math.min(range.head, end))
          : EditorSelection.range(target.from, end),
      };
    });
    if (!changed) return false;
    view.dispatch(transaction, { userEvent: "input.case" });
    return true;
  };
}

/**
 * Duplicates each selection's text right after it, keeping the original selected; with only
 * cursors, duplicates their lines below.
 */
const duplicateSelection: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.every((range) => range.empty)) return copyLineDown(view);
  const changes = state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => ({ from: range.to, insert: state.sliceDoc(range.from, range.to) }));
  view.dispatch({
    changes,
    // Each copy goes in right after its range; mapped backwards, the selection stays on the
    // original text.
    selection: state.selection.map(state.changes(changes), -1),
    scrollIntoView: true,
    userEvent: "input.duplicate",
  });
  return true;
};

const softWrapCompartment = new Compartment();

/** Whether `state`'s editor wraps long lines (see `setSoftWrap`). */
export function softWrapOn(state: EditorState): boolean {
  const current = softWrapCompartment.get(state);
  return Array.isArray(current) ? current.length > 0 : current !== undefined;
}

/** Wraps long lines in a code-editing editor, or stops; false in any other editor. */
export function setSoftWrap(view: EditorView, on: boolean): boolean {
  if (softWrapCompartment.get(view.state) === undefined) return false;
  if (softWrapOn(view.state) !== on) {
    view.dispatch({ effects: softWrapCompartment.reconfigure(on ? EditorView.lineWrapping : []) });
  }
  return true;
}

const toggleSoftWrap: Command = (view) => setSoftWrap(view, !softWrapOn(view.state));

/** The named commands a host binds keys to (and runs from a menu through `runCodeEditing`). */
export const CODE_EDITING_COMMANDS = {
  selectNextOccurrence,
  skipOccurrence,
  selectAllOccurrences,
  addCursorAbove,
  addCursorBelow,
  expandSelection: selectParentSyntax,
  toggleComment,
  indentLess,
  indentMore,
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  deleteLine,
  joinLines,
  sortLines,
  upperCase: convertCase((text) => text.toUpperCase()),
  lowerCase: convertCase((text) => text.toLowerCase()),
  duplicateSelection,
  fold: foldCode,
  unfold: unfoldCode,
  foldAll,
  unfoldAll,
  toggleSoftWrap,
} satisfies Record<string, Command>;

export type CodeEditingCommand = keyof typeof CODE_EDITING_COMMANDS;

/** Each named command's keys, in CodeMirror's notation; a command left out has none. */
export type CodeEditingKeys = Partial<Record<CodeEditingCommand, readonly string[]>>;

export interface CodeEditingOptions {
  readonly keys?: CodeEditingKeys;
  /** Whether long lines wrap at first (see `setSoftWrap`). */
  readonly softWrap?: boolean;
}

const named = new Set<Command>(Object.values(CODE_EDITING_COMMANDS));

// The default keymap without the keys of the commands named above: their keys come from the host.
const otherDefaultKeys = defaultKeymap.filter(
  (binding) =>
    !(binding.run && named.has(binding.run)) && !(binding.shift && named.has(binding.shift)),
);

// Undo and redo, without selection undo: its mod+u stays the app's (Usage).
const historyKeys = historyKeymap.filter(
  (binding) => binding.run !== undoSelection && binding.run !== redoSelection,
);

/** The attribute that marks a code-editing editor (the app's `codeEditorFocus` reads it). */
export const CODE_EDITING_ATTRIBUTE = "data-code-editing";

const marker = EditorView.editorAttributes.of({ [CODE_EDITING_ATTRIBUTE]: "" });

/** Whether `state`'s editor has code editing, so `runCodeEditing` can act on it. */
export function hasCodeEditing(state: EditorState): boolean {
  return softWrapCompartment.get(state) !== undefined;
}

/** Runs a named command in a code-editing editor; false where it has no effect or no place. */
export function runCodeEditing(view: EditorView, command: CodeEditingCommand): boolean {
  return hasCodeEditing(view.state) && CODE_EDITING_COMMANDS[command](view);
}

function namedBindings(keys: CodeEditingKeys): KeyBinding[] {
  return Object.entries(keys).flatMap(([command, commandKeys]) =>
    (commandKeys ?? []).map((key) => ({
      key,
      run: CODE_EDITING_COMMANDS[command as CodeEditingCommand],
      preventDefault: true,
    })),
  );
}

const theme = EditorView.theme({
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklab, var(--atlas-selection, #d7d4f0) 55%, transparent)",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "transparent",
    outline: "1px solid var(--atlas-md-syntax-color, currentColor)",
    outlineOffset: "-1px",
  },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "transparent",
    textDecoration: "underline wavy var(--destructive, #c0392b)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "1px solid var(--atlas-md-border-color, #d4d0c8)",
    color: "var(--atlas-md-syntax-color, inherit)",
    padding: "0 4px",
    margin: "0 2px",
    borderRadius: "3px",
  },
});

/**
 * Core editing for a code editor (see above). Every command it names takes its keys from `keys`;
 * a host lists this ahead of other keymaps whose keys should give way to these.
 */
export function codeEditing({ keys = {}, softWrap = false }: CodeEditingOptions = {}): Extension {
  return [
    marker,
    EditorState.allowMultipleSelections.of(true),
    drawnSelection,
    rectangularSelection(),
    crosshairCursor(),
    closeBrackets(),
    bracketMatching(),
    codeFolding(),
    indentOnInput(),
    highlightSelectionMatches(),
    softWrapCompartment.of(softWrap ? EditorView.lineWrapping : []),
    keymap.of([
      ...namedBindings(keys),
      ...closeBracketsKeymap,
      ...otherDefaultKeys,
      ...historyKeys,
      indentWithTab,
    ]),
    theme,
  ];
}
