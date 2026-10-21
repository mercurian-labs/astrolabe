import {
  deleteCharBackward,
  deleteCharForward,
  indentLess,
  indentMore,
  isolateHistory,
} from "@codemirror/commands";
import { indentUnit, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type StateCommand,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { previewConfig } from "./config.ts";
import { lineMarkers, skipSpaces, type LineMarkers } from "./lineMarkers.ts";
import { cellStarts } from "./table.ts";

// Keyboard rules from section 5. Every command handles each selection range on its own,
// changes nothing in a read-only editor, and never rewrites text the user did not touch.

const SPAN_NODES: Record<string, string> = {
  "**": "StrongEmphasis",
  "*": "Emphasis",
  "`": "InlineCode",
  "~~": "Strikethrough",
  "==": "Highlight",
};

const SPAN_MARKS: Record<string, string> = {
  StrongEmphasis: "EmphasisMark",
  Emphasis: "EmphasisMark",
  InlineCode: "CodeMark",
  Strikethrough: "StrikethroughMark",
  Highlight: "HighlightMark",
};

/** The innermost `name` node containing `[from, to]`, boundaries included. */
function enclosing(state: EditorState, from: number, to: number, name: string) {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(from, side); node; node = node.parent) {
      if (node.name === name && node.from <= from && to <= node.to) return node;
    }
  }
  return null;
}

/** Whether `pos` is inside a code block or strictly inside an inline code span. */
function inCode(state: EditorState, pos: number) {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") return true;
      if (node.name === "InlineCode" && node.from < pos && pos < node.to) return true;
    }
  }
  return false;
}

const rangeInCode = (state: EditorState, range: SelectionRange) =>
  inCode(state, range.from) || (!range.empty && inCode(state, range.to));

function dispatchChange(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  spec: TransactionSpec,
  userEvent: string,
) {
  dispatch(
    state.update(spec, {
      scrollIntoView: true,
      userEvent,
      annotations: isolateHistory.of("full"),
    }),
  );
}

/**
 * Toggles an inline span such as `**`: unwraps an enclosing span, wraps a selection or
 * the word at the caret, or inserts an empty pair. Falls through inside code.
 */
export function toggleSpan(marker: string): StateCommand {
  const nodeName = SPAN_NODES[marker] ?? "";
  const markName = SPAN_MARKS[nodeName] ?? "";
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    let fallThrough = false;
    const spec = state.changeByRange((range) => {
      const span = enclosing(state, range.from, range.to, nodeName);
      const open = span?.firstChild;
      const close = span?.lastChild;
      if (
        span &&
        open &&
        close &&
        open.name === markName &&
        close.name === markName &&
        open.from !== close.from
      ) {
        const changes = state.changes([
          { from: open.from, to: open.to },
          { from: close.from, to: close.to },
        ]);
        return {
          changes,
          range: EditorSelection.range(
            changes.mapPos(range.anchor, -1),
            changes.mapPos(range.head, -1),
          ),
        };
      }
      if (rangeInCode(state, range)) {
        fallThrough = true;
        return { range };
      }
      const size = marker.length;
      if (!range.empty) {
        return {
          changes: [
            { from: range.from, insert: marker },
            { from: range.to, insert: marker },
          ],
          range: EditorSelection.range(range.anchor + size, range.head + size),
        };
      }
      const word = state.wordAt(range.head);
      if (word) {
        return {
          changes: [
            { from: word.from, insert: marker },
            { from: word.to, insert: marker },
          ],
          range: EditorSelection.cursor(word.to + size),
        };
      }
      return {
        changes: { from: range.head, insert: marker + marker },
        range: EditorSelection.cursor(range.head + size),
      };
    });
    if (fallThrough) return false;
    dispatchChange(state, dispatch, spec, "input.format");
    return true;
  };
}

const URL_TEXT = /^(?:https?:\/\/|mailto:|www\.)\S+$/i;

/**
 * Mod-k: `[selection](|)`, or `[|](url)` when the selection is a URL; a caret on a word
 * wraps the word; elsewhere `[|]()`.
 */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.some((range) => rangeInCode(state, range))) return false;
  const spec = state.changeByRange((range) => {
    const target = range.empty ? state.wordAt(range.head) : range;
    if (!target) {
      return {
        changes: { from: range.head, insert: "[]()" },
        range: EditorSelection.cursor(range.head + 1),
      };
    }
    const text = state.sliceDoc(target.from, target.to);
    if (URL_TEXT.test(text)) {
      return {
        changes: { from: target.from, to: target.to, insert: `[](${text})` },
        range: EditorSelection.cursor(target.from + 1),
      };
    }
    return {
      changes: [
        { from: target.from, insert: "[" },
        { from: target.to, insert: "]()" },
      ],
      range: EditorSelection.cursor(target.to + 3),
    };
  });
  dispatchChange(state, dispatch, spec, "input.format");
  return true;
};

/**
 * Pasting a URL over a selection within one line makes the selection the link text.
 * Returns whether the paste was handled.
 */
function pasteAsLink(view: EditorView, pasted: string) {
  const { state } = view;
  const { main } = state.selection;
  const url = pasted.trim();
  if (state.readOnly || main.empty || state.selection.ranges.length > 1) return false;
  if (!URL_TEXT.test(url) || rangeInCode(state, main)) return false;
  if (state.doc.lineAt(main.from).number !== state.doc.lineAt(main.to).number) return false;
  const href = /^www\./i.test(url) ? `https://${url}` : url;
  const insert = `](${href})`;
  view.dispatch({
    changes: [
      { from: main.from, insert: "[" },
      { from: main.to, insert },
    ],
    selection: EditorSelection.cursor(main.to + 1 + insert.length),
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  return true;
}

/** The marker that continues an ordered list in the item's own style. */
function nextOrderedMarker(state: EditorState, item: SyntaxNode, mark: string) {
  const match = /^(\d+)([.)])$/.exec(mark);
  if (!match?.[1]) return mark;
  const number = Number(match[1]);
  let previous: SyntaxNode | null = item.prevSibling;
  while (previous && previous.name !== "ListItem") previous = previous.prevSibling;
  const previousMark = previous?.firstChild;
  const previousNumber =
    previousMark?.name === "ListMark"
      ? Number(/^\d+/.exec(state.sliceDoc(previousMark.from, previousMark.to))?.[0])
      : Number.NaN;
  // `1. 1.` lists keep repeating their number; anything else counts up.
  const next = previousNumber === number ? number : number + 1;
  const digits = String(next).padStart(match[1].startsWith("0") ? match[1].length : 0, "0");
  return `${digits}${match[2]}`;
}

/** The text that starts a new item after `markers`' item: indent, marker, spacing, task box. */
function continuation(state: EditorState, markers: LineMarkers) {
  const { line, listMark, item, list, taskMarker } = markers;
  if (!listMark || !item) return null;
  const prefix = state.sliceDoc(line.from, listMark.from);
  const mark = state.sliceDoc(listMark.from, listMark.to);
  const marker = list?.name === "OrderedList" ? nextOrderedMarker(state, item, mark) : mark;
  const spacingEnd = taskMarker ? taskMarker.from : skipSpaces(state, listMark.to, line.to);
  const spacing = state.sliceDoc(listMark.to, spacingEnd) || " ";
  return `${prefix}${marker}${spacing}${taskMarker ? "[ ] " : ""}`;
}

/** The quote prefix of a line: its `>` marks and the space after the last one. */
function quotePrefixEnd(state: EditorState, markers: LineMarkers) {
  const last = markers.quotes.at(-1);
  if (!last) return markers.line.from;
  const next = state.sliceDoc(last.to, last.to + 1);
  return next === " " || next === "\t" ? last.to + 1 : last.to;
}

type RangeResult = { changes: ChangeSpec; range: SelectionRange } | null;

function enterInCode(state: EditorState, pos: number, markers: LineMarkers): RangeResult {
  const tree = syntaxTree(state);
  let code: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (code && code.name !== "FencedCode") code = code.parent;
  if (!code) return null;
  const close = code.lastChild;
  if (close?.name === "CodeMark" && close.from > state.doc.lineAt(code.from).to && pos >= close.to)
    return null;
  const start = quotePrefixEnd(state, markers);
  const indent = state.sliceDoc(markers.line.from, skipSpaces(state, start, markers.line.to));
  const insert = `\n${indent}`;
  return { changes: { from: pos, insert }, range: EditorSelection.cursor(pos + insert.length) };
}

function enterInList(state: EditorState, pos: number, markers: LineMarkers): RangeResult {
  const { line, listMark, item } = markers;
  if (!listMark || !item || pos < listMark.to) return null;
  const empty = state.sliceDoc(markers.textStart, line.to).trim() === "";
  if (empty) {
    // An empty item ends the list at this level, in one step and without a blank line.
    let parent: SyntaxNode | null = item.parent;
    while (parent && parent.name !== "ListItem") parent = parent.parent;
    const parentMark = parent?.firstChild;
    if (parent && parentMark?.name === "ListMark") {
      const parentMarkers = lineMarkers(state, parentMark.from);
      const text = continuation(state, parentMarkers);
      if (text !== null) {
        const quote = state.sliceDoc(line.from, quotePrefixEnd(state, markers));
        const parentQuote = state.sliceDoc(
          parentMarkers.line.from,
          quotePrefixEnd(state, parentMarkers),
        );
        const insert = quote + text.slice(parentQuote.length);
        return {
          changes: { from: line.from, to: line.to, insert },
          range: EditorSelection.cursor(line.from + insert.length),
        };
      }
    }
    const from = quotePrefixEnd(state, markers);
    return { changes: { from, to: line.to }, range: EditorSelection.cursor(from) };
  }
  const text = continuation(state, markers);
  if (text === null) return null;
  const insert = `\n${text}`;
  return { changes: { from: pos, insert }, range: EditorSelection.cursor(pos + insert.length) };
}

function enterInQuote(state: EditorState, pos: number, markers: LineMarkers): RangeResult {
  const last = markers.quotes.at(-1);
  if (!last) return null;
  const prefixEnd = quotePrefixEnd(state, markers);
  if (pos < prefixEnd) return null;
  if (state.sliceDoc(prefixEnd, markers.line.to).trim() === "") {
    // An empty quote line leaves one level of quote.
    return {
      changes: { from: last.from, to: markers.line.to },
      range: EditorSelection.cursor(last.from),
    };
  }
  const insert = `\n${state.sliceDoc(markers.line.from, prefixEnd)}`;
  return { changes: { from: pos, insert }, range: EditorSelection.cursor(pos + insert.length) };
}

/** Enter: continues lists, tasks, and quotes; exits them from an empty line; indents code. */
export const continueMarkup: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  let handled = false;
  const spec = state.changeByRange((range) => {
    const markers = range.empty ? lineMarkers(state, range.head) : null;
    const result = markers
      ? (enterInCode(state, range.head, markers) ??
        enterInList(state, range.head, markers) ??
        enterInQuote(state, range.head, markers))
      : null;
    if (!result) {
      return {
        changes: { from: range.from, to: range.to, insert: "\n" },
        range: EditorSelection.cursor(range.from + 1),
      };
    }
    handled = true;
    return result;
  });
  if (!handled) return false;
  dispatch(state.update(spec, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/** The innermost list item holding a line: its marker line or any continuation line. */
function itemOnLine(state: EditorState, lineFrom: number) {
  const markers = lineMarkers(state, lineFrom);
  if (markers.item) return markers.item;
  const pos = skipSpaces(state, markers.textStart, markers.line.to);
  if (pos >= markers.line.to) return null;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "ListItem") return node;
  }
  return null;
}

/**
 * The list items a selection touches, on any of their lines, excluding items nested in
 * another. A range ending at column 0 does not touch that line.
 */
function itemsInRanges(state: EditorState) {
  const items: SyntaxNode[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const end = state.doc.lineAt(range.to);
    const last = !range.empty && range.to === end.from ? end.number - 1 : end.number;
    for (let n = first; n <= last; n++) {
      const item = itemOnLine(state, state.doc.line(n).from);
      if (!item) continue;
      if (items.some((other) => other.from <= item.from && item.to <= other.to)) continue;
      items.push(item);
    }
  }
  return items;
}

/** The number of `>` levels around `node`. */
function quoteDepth(node: SyntaxNode) {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "Blockquote") depth++;
  }
  return depth;
}

/** Where the indentation of a line inside `depth` quotes starts. */
function indentStart(text: string, depth: number) {
  let pos = 0;
  for (let i = 0; i < depth; i++) {
    const match = /^[ \t]{0,3}>[ \t]?/.exec(text.slice(pos));
    if (!match) break;
    pos += match[0].length;
  }
  return pos;
}

function columnOf(state: EditorState, pos: number) {
  return pos - state.doc.lineAt(pos).from;
}

/** Shifts every line of each touched list item, children included, by one level. */
function shiftItems(state: EditorState, items: readonly SyntaxNode[], direction: 1 | -1) {
  const changes: ChangeSpec[] = [];
  const unit = state.facet(indentUnit);
  for (const item of items) {
    const mark = item.firstChild;
    if (!mark) continue;
    const depth = quoteDepth(item);
    let amount: string | number;
    if (direction === 1) {
      // Nest under the previous item: indent to where its text starts.
      let previous: SyntaxNode | null = item.prevSibling;
      while (previous && previous.name !== "ListItem") previous = previous.prevSibling;
      const previousMark = previous?.firstChild;
      if (previousMark?.name === "ListMark") {
        const previousText = skipSpaces(
          state,
          previousMark.to,
          state.doc.lineAt(previousMark.to).to,
        );
        amount = " ".repeat(
          Math.max(1, columnOf(state, previousText) - columnOf(state, mark.from)),
        );
      } else {
        amount = unit;
      }
    } else {
      let parent: SyntaxNode | null = item.parent;
      while (parent && parent.name !== "ListItem") parent = parent.parent;
      const parentMark = parent?.firstChild;
      amount =
        parentMark?.name === "ListMark"
          ? columnOf(state, mark.from) - columnOf(state, parentMark.from)
          : unit.length;
    }
    const first = state.doc.lineAt(item.from).number;
    const last = state.doc.lineAt(item.to).number;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      const start = line.from + indentStart(line.text, depth);
      if (typeof amount === "string") {
        if (line.length > 0) changes.push({ from: start, insert: amount });
        continue;
      }
      let end = start;
      while (end < line.to && end - start < amount && /[ \t]/.test(state.sliceDoc(end, end + 1)))
        end++;
      if (end > start) changes.push({ from: start, to: end });
    }
  }
  return changes;
}

/**
 * Tab / Shift-Tab: list items move with their children; elsewhere an indent is inserted,
 * unless the host turned `tabIndentsProse` off and the range is outside code.
 */
function indentCommand(direction: 1 | -1): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const items = itemsInRanges(state);
    if (items.length === 0) {
      // A host that keeps Tab for focus order lets it through outside code.
      if (
        !state.facet(previewConfig).tabIndentsProse &&
        !state.selection.ranges.some((range) => rangeInCode(state, range))
      )
        return false;
      if (direction === -1) return indentLess({ state, dispatch });
      if (state.selection.ranges.some((range) => !range.empty))
        return indentMore({ state, dispatch });
      const unit = state.facet(indentUnit);
      dispatch(
        state.update(state.replaceSelection(unit), {
          scrollIntoView: true,
          userEvent: "input.indent",
        }),
      );
      return true;
    }
    const changes = shiftItems(state, items, direction);
    if (changes.length > 0) {
      dispatch(
        state.update({
          changes,
          scrollIntoView: true,
          userEvent: direction === 1 ? "input.indent" : "delete.dedent",
        }),
      );
    }
    return true;
  };
}

export const indentListItem = indentCommand(1);
export const outdentListItem = indentCommand(-1);

/** The start of the cell after, or before, the cell holding `pos`; undefined at either end. */
function adjacentCell(
  state: EditorState,
  starts: readonly number[],
  pos: number,
  direction: 1 | -1,
) {
  if (direction === 1) return starts.find((start) => start > pos);
  const index = starts.findLastIndex((start) => start <= pos);
  if (index < 0) return undefined;
  // A caret before a row's first cell (on its leading pipe) is in no cell of that row.
  const inCell = state.doc.lineAt(starts[index] ?? pos).number === state.doc.lineAt(pos).number;
  return starts[inCell ? index - 1 : index];
}

/**
 * Tab / Shift-Tab. Each range is handled on its own: a caret in a table's source moves to
 * the start of the next or previous cell's text, across rows, staying put at either end;
 * every other range gets the list behaviour (indent the items it touches, else insert or
 * remove an indent). Both parts land in one transaction. With no caret in a table this is
 * exactly the list command.
 */
function tabCommand(direction: 1 | -1): StateCommand {
  const list = indentCommand(direction);
  return ({ state, dispatch }) => {
    const { ranges } = state.selection;
    const tables = ranges.map((range) => enclosing(state, range.head, range.head, "Table"));
    if (tables.every((table) => table === null)) return list({ state, dispatch });
    // The list part runs on the non-table ranges alone, then its changes carry the rest.
    const others = ranges.filter((_, i) => tables[i] === null);
    const listed: Transaction[] = [];
    if (others.length > 0) {
      const sub = state.update({ selection: EditorSelection.create(others) }).state;
      list({ state: sub, dispatch: (tr) => listed.push(tr) });
    }
    const listTr = listed[0];
    const changes = listTr?.changes ?? state.changes();
    let next = 0;
    const moved = ranges.map((range, i) => {
      const table = tables[i];
      if (!table) {
        const listRange = listTr?.newSelection.ranges[next++];
        return listRange ?? range.map(changes);
      }
      const target = adjacentCell(state, cellStarts(state, table), range.head, direction);
      return target === undefined
        ? range.map(changes)
        : EditorSelection.cursor(changes.mapPos(target));
    });
    const selection = EditorSelection.create(moved, state.selection.mainIndex);
    if (changes.empty && selection.eq(state.selection)) return true;
    dispatch(
      state.update({
        changes,
        selection,
        scrollIntoView: true,
        userEvent: listTr?.annotation(Transaction.userEvent) ?? "select",
      }),
    );
    return true;
  };
}

/**
 * Backspace at the start of an item's text removes its marker (a task's box first); at the
 * start of an empty quote line it removes the `>`. Otherwise, one character or one hidden
 * atomic range.
 */
export const deleteMarkupBackward: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  let handled = false;
  const spec = state.changeByRange((range) => {
    if (!range.empty) {
      return {
        changes: { from: range.from, to: range.to },
        range: EditorSelection.cursor(range.from),
      };
    }
    const markers = lineMarkers(state, range.head);
    if (markers.listMark && range.head === markers.textStart) {
      handled = true;
      const from = markers.taskMarker ? markers.taskMarker.from : markers.listMark.from;
      return { changes: { from, to: range.head }, range: EditorSelection.cursor(from) };
    }
    const lastQuote = markers.quotes.at(-1);
    if (
      lastQuote &&
      !markers.listMark &&
      range.head === markers.textStart &&
      state.sliceDoc(range.head, markers.line.to).trim() === ""
    ) {
      handled = true;
      return {
        changes: { from: lastQuote.from, to: markers.line.to },
        range: EditorSelection.cursor(lastQuote.from),
      };
    }
    // Another cursor is doing markup work; this one deletes a character.
    const from = Math.max(0, range.head - 1);
    return { changes: { from, to: range.head }, range: EditorSelection.cursor(from) };
  });
  if (!handled) return false;
  dispatch(state.update(spec, { scrollIntoView: true, userEvent: "delete.backward" }));
  return true;
};

/** The live preview's key bindings; install them above the host's default keymap. */
export const markdownBindings: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleSpan("**") },
  { key: "Mod-i", run: toggleSpan("*") },
  { key: "Mod-e", run: toggleSpan("`") },
  { key: "Mod-Shift-x", run: toggleSpan("~~") },
  { key: "Mod-Shift-h", run: toggleSpan("==") },
  { key: "Mod-k", run: insertLink },
  { key: "Enter", run: continueMarkup },
  // Inside a table, Tab moves between cells instead of indenting a list item.
  { key: "Tab", run: tabCommand(1), shift: tabCommand(-1) },
  { key: "Backspace", run: (view) => deleteMarkupBackward(view) || deleteCharBackward(view) },
  { key: "Delete", run: deleteCharForward },
];

/** Turns a pasted URL over a selected word into a link. */
export const pasteLinkHandler = EditorView.domEventHandlers({
  paste(event, view) {
    const text = event.clipboardData?.getData("text/plain");
    if (!text || !pasteAsLink(view, text)) return false;
    event.preventDefault();
    return true;
  },
});
