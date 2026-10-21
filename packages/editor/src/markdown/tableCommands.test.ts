import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { isolatedUndoSteps } from "../editor.tsx";
import { documentIndex } from "./documentIndex.ts";
import { alignments, rowCells, tableRows } from "./table.ts";
import { activeCell, activeLocation, clipSpan, tableSelection } from "./tableCells.ts";
import * as entry from "./livePreview.ts";
import {
  alignColumnCenter,
  alignColumnLeft,
  alignColumnRight,
  cellsToClipboard,
  clearCells,
  deleteCells,
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
  insertTable,
  moveColumnLeft,
  moveColumnRight,
  moveColumnTo,
  moveRowDown,
  moveRowTo,
  moveRowUp,
  parseClipboardCells,
  pasteIntoCells,
  sortRowsAscending,
  sortRowsDescending,
} from "./tableCommands.ts";
import { caret, destroyViews, mount } from "./testSupport.ts";

afterEach(destroyViews);

// Browsers queue `selectionchange` as a task; happy-dom fires it synchronously, inside the
// update of a focused cell editor that just wrote its DOM selection. The tests drive
// selections through transactions, so the event is dropped (as in tableCells.test.ts).
const dispatchEvent = document.dispatchEvent.bind(document);
beforeAll(() => {
  document.dispatchEvent = (event) => event.type === "selectionchange" || dispatchEvent(event);
});
afterAll(() => {
  document.dispatchEvent = dispatchEvent;
});

const widget = (view: EditorView) =>
  view.contentDOM.querySelector<HTMLElement>(".cm-md-table-widget");

function cells(view: EditorView) {
  return [...(widget(view)?.querySelectorAll<HTMLElement>("th, td") ?? [])];
}

function child(view: EditorView) {
  const element = view.contentDOM.querySelector<HTMLElement>(".cm-md-cell-editor");
  return element ? EditorView.findFromDOM(element) : null;
}

function click(element: Element | undefined) {
  element?.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
  );
}

/** Mounts `doc` focused with the caret after it and activates the rendered cell at `index`. */
function withActive(doc: string, index: number) {
  const view = mount(doc, { focused: true, selection: [doc.length] });
  click(cells(view)[index]);
  expect(child(view)).not.toBeNull();
  return view;
}

/** The active cell as `[row, column, its text]`. */
function active(view: EditorView) {
  const location = activeLocation(view.state);
  if (!location) return null;
  const { cell, row, column } = location;
  return [row, column, view.state.sliceDoc(cell.from, cell.to)] as const;
}

const TWO = "| a | b |\n| - | - |\n| c | d |\n\nafter";

/**
 * How the parser reads the note's first table: its column count (from the delimiter row)
 * and each header and body row's cell count, or null when there is no table.
 */
function parsedShape(view: EditorView) {
  const table = documentIndex(view.state).tables[0]?.node;
  if (!table) return null;
  return {
    columns: alignments(view.state, table).length,
    rows: tableRows(table).map((row) => rowCells(view.state, row).length),
  };
}

/** Opens the cell menu with a right-click on `element`. */
function rightClick(element: Element | undefined) {
  element?.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 30 }),
  );
}

const rootMenu = (view: EditorView) =>
  view.dom.querySelector<HTMLElement>(":scope > .cm-md-cell-menu");

/** The entries directly in a menu level, as elements. */
const entries = (level: Element | null | undefined) => [
  ...(level?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]') ?? []),
];

const label = (item: Element) =>
  item.querySelector(":scope > .cm-md-cell-menu-label")?.textContent ?? "";

/** The submenu a parent entry opens. */
const submenuOf = (item: Element | undefined) =>
  item?.querySelector<HTMLElement>(':scope > [role="menu"]');

/** The open menu's labels: its top level, and the Row and Column submenus. */
function menuLabels(view: EditorView) {
  const top = entries(rootMenu(view));
  const sub = (name: string) => entries(submenuOf(top.find((item) => label(item) === name)));
  return {
    top: top.map(label),
    row: sub("Row").map(label),
    column: sub("Column").map(label),
  };
}

/** Chooses the entry labelled `name` anywhere in the open menu. */
function choose(view: EditorView, name: string) {
  const item = [...(rootMenu(view)?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
    (element) => label(element) === name,
  );
  item?.click();
  return item;
}

function key(target: EventTarget | undefined, name: string) {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  target?.dispatchEvent(event);
  return event;
}

const ROW = [
  "Add row above",
  "Add row below",
  "Move row up",
  "Move row down",
  "Duplicate row",
  "Delete row",
];
const COLUMN = [
  "Add column to the left",
  "Add column to the right",
  "Move column left",
  "Move column right",
  "Align left",
  "Align center",
  "Align right",
  "Duplicate column",
  "Delete column",
];
const TOP = ["Row", "Column", "Sort by column (A to Z)", "Sort by column (Z to A)"];
const without = (list: readonly string[], ...drop: string[]) =>
  list.filter((name) => !drop.includes(name));

/** A focused editor with the production undo wiring over a Yjs text holding `doc`. */
function undoable(doc: string) {
  const ydoc = new Y.Doc();
  const text = ydoc.getText("note");
  text.insert(0, doc);
  const undoManager = new Y.UndoManager(text);
  const view = mount(doc, {
    focused: true,
    selection: [doc.length],
    extensions: [
      yCollab(text, new Awareness(ydoc), { undoManager }),
      Prec.high(keymap.of(yUndoManagerKeymap)),
      isolatedUndoSteps(undoManager),
    ],
  });
  return { view, text, undoManager };
}

/** The child editor's caret. */
const childCaret = (view: EditorView) => child(view)?.state.selection.main.head;

const grip = (view: EditorView, kind: "row" | "column", index: number) =>
  widget(view)?.querySelector<HTMLElement>(`.cm-md-table-grip-${kind}[data-index="${index}"]`);

const pointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    isPrimary: true,
    ...init,
  });

/** Presses and releases the primary pointer on a handle without moving it. */
function handleClick(element: Element | null | undefined) {
  element?.dispatchEvent(pointer("pointerdown"));
  document.dispatchEvent(pointer("pointerup"));
}

const selectedTexts = (view: EditorView) =>
  [...(widget(view)?.querySelectorAll(".cm-md-cell-selected") ?? [])].map(
    (cell) => cell.textContent,
  );

describe("table structure commands", () => {
  it("A91. add row below and above around a body cell; above the header adds a new header, below it goes after the delimiter", () => {
    const below = withActive(TWO, 2);
    expect(insertRowBelow(below)).toBe(true);
    const grown = "| a | b |\n| - | - |\n| c | d |\n|   |   |\n\nafter";
    expect(below.state.doc.toString()).toBe(grown);
    expect(active(below)).toEqual([2, 0, ""]);
    expect(caret(below)).toBe(grown.indexOf("|   |") + 2);
    expect(child(below)?.state.selection.main.head).toBe(0);
    expect(widget(below)).not.toBeNull();

    const above = withActive(TWO, 2);
    expect(insertRowAbove(above)).toBe(true);
    expect(above.state.doc.toString()).toBe("| a | b |\n| - | - |\n|   |   |\n| c | d |\n\nafter");
    expect(active(above)).toEqual([1, 0, ""]);

    // The grid model: above the header, the new row is the header and the old one row 1.
    const header = withActive(TWO, 1);
    expect(insertRowAbove(header)).toBe(true);
    expect(header.state.doc.toString()).toBe("|   |   |\n| - | - |\n| a | b |\n| c | d |\n\nafter");
    expect(active(header)).toEqual([0, 1, ""]);

    const headerBelow = withActive(TWO, 0);
    expect(insertRowBelow(headerBelow)).toBe(true);
    expect(headerBelow.state.doc.toString()).toBe(
      "| a | b |\n| - | - |\n|   |   |\n| c | d |\n\nafter",
    );
    expect(active(headerBelow)).toEqual([1, 0, ""]);
  });

  it("A92. delete row removes the line and activates the same column below, else above; the only body row leaves a table; the header promotes the first body row, and a lone header stays", () => {
    const doc = "| a | b |\n| - | - |\n| c | d |\n| e | f |\n\nafter";
    const middle = withActive(doc, 3);
    expect(deleteRow(middle)).toBe(true);
    expect(middle.state.doc.toString()).toBe("| a | b |\n| - | - |\n| e | f |\n\nafter");
    expect(active(middle)).toEqual([1, 1, "f"]);
    expect(childCaret(middle)).toBe(0);

    const last = withActive(doc, 5);
    expect(deleteRow(last)).toBe(true);
    expect(last.state.doc.toString()).toBe("| a | b |\n| - | - |\n| c | d |\n\nafter");
    expect(active(last)).toEqual([1, 1, "d"]);

    const only = withActive(TWO, 2);
    expect(deleteRow(only)).toBe(true);
    expect(only.state.doc.toString()).toBe("| a | b |\n| - | - |\n\nafter");
    expect(widget(only)).not.toBeNull();
    expect(active(only)).toEqual([0, 0, "a"]);

    // A table ending the note loses the line break before its last row instead.
    const ending = "before\n\n| a | b |\n| - | - |\n| c | d |";
    const end = mount(ending, { focused: true, selection: [0] });
    click(cells(end)[2]);
    expect(deleteRow(end)).toBe(true);
    expect(end.state.doc.toString()).toBe("before\n\n| a | b |\n| - | - |");

    const header = withActive(TWO, 1);
    expect(deleteRow(header)).toBe(true);
    expect(header.state.doc.toString()).toBe("| c | d |\n| - | - |\n\nafter");
    expect(active(header)).toEqual([0, 1, "d"]);

    const lone = "| a | b |\n| - | - |\n\nafter";
    const alone = withActive(lone, 0);
    expect(deleteRow(alone)).toBe(false);
    expect(alone.state.doc.toString()).toBe(lone);
  });

  it("A93. insert column right and left keep the other columns' alignments and padding; a short row is padded first", () => {
    const doc = "| a | b |\n| :-- | --: |\n| c | d |\n\nafter";
    const right = withActive(doc, 2);
    expect(insertColumnRight(right)).toBe(true);
    expect(right.state.doc.toString()).toBe(
      "| a |   | b |\n| :-- | --- | --: |\n| c |   | d |\n\nafter",
    );
    expect(active(right)).toEqual([1, 1, ""]);
    expect(cells(right)).toHaveLength(6);

    const left = withActive(doc, 2);
    expect(insertColumnLeft(left)).toBe(true);
    expect(left.state.doc.toString()).toBe(
      "|   | a | b |\n| --- | :-- | --: |\n|   | c | d |\n\nafter",
    );
    expect(active(left)).toEqual([1, 0, ""]);

    const short = "| a | b |\n| - | - |\n| c |\n\nafter";
    const padded = withActive(short, 0);
    expect(insertColumnRight(padded)).toBe(true);
    expect(padded.state.doc.toString()).toBe(
      "| a |   | b |\n| - | --- | - |\n| c |   |  |\n\nafter",
    );
    expect(active(padded)).toEqual([0, 1, ""]);
    const paddedLeft = withActive(short, 0);
    expect(insertColumnLeft(paddedLeft)).toBe(true);
    expect(paddedLeft.state.doc.toString()).toBe(
      "|   | a | b |\n| --- | - | - |\n|   | c |  |\n\nafter",
    );
  });

  it("A94. delete column removes the slot and closing pipe from every row, keeps the other alignments, and activates the same index, else the previous one; a one-column table is refused", () => {
    const doc = "| a | b | c |\n| :-- | :-: | --: |\n| d | e | f |\n\nafter";
    const middle = withActive(doc, 4);
    expect(deleteColumn(middle)).toBe(true);
    expect(middle.state.doc.toString()).toBe("| a | c |\n| :-- | --: |\n| d | f |\n\nafter");
    expect(active(middle)).toEqual([1, 1, "f"]);

    const last = withActive(doc, 5);
    expect(deleteColumn(last)).toBe(true);
    expect(last.state.doc.toString()).toBe("| a | b |\n| :-- | :-: |\n| d | e |\n\nafter");
    expect(active(last)).toEqual([1, 1, "e"]);
    expect(childCaret(last)).toBe(0);

    // A fresh activation starts at the caret the command names, even where the deleted
    // cell's editor stood: `cc` had its caret at 2, `dd` starts at 0.
    const first = withActive("| a | b |\n| - | - |\n| cc | dd |\n\nafter", 2);
    expect(childCaret(first)).toBe(2);
    expect(deleteColumn(first)).toBe(true);
    expect(first.state.doc.toString()).toBe("| b |\n| - |\n| dd |\n\nafter");
    expect(active(first)).toEqual([1, 0, "dd"]);
    expect(childCaret(first)).toBe(0);

    const single = "| a |\n| - |\n| b |\n\nafter";
    const one = withActive(single, 1);
    expect(deleteColumn(one)).toBe(false);
    expect(one.state.doc.toString()).toBe(single);
  });

  it("A95. with no active cell, each command acts on the caret's cell in the source rows; outside every table each returns false", () => {
    const commands: [Command, string][] = [
      [insertRowAbove, "| a | b |\n| - | - |\n|   |   |\n| c | d |\n\nafter"],
      [insertRowBelow, "| a | b |\n| - | - |\n| c | d |\n|   |   |\n\nafter"],
      [deleteRow, "| a | b |\n| - | - |\n\nafter"],
      [insertColumnLeft, "| a |   | b |\n| - | --- | - |\n| c |   | d |\n\nafter"],
      [insertColumnRight, "| a | b |   |\n| - | - | --- |\n| c | d |   |\n\nafter"],
      [deleteColumn, "| a |\n| - |\n| c |\n\nafter"],
    ];
    for (const [command, expected] of commands) {
      // The caret on `d`: the second body cell, while the source rows show.
      const view = mount(TWO, { focused: true, selection: [TWO.indexOf("d")] });
      expect(widget(view)).toBeNull();
      expect(command(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(expected);
      expect(view.state.field(activeCell)).not.toBeNull();

      const outside = mount(TWO, { focused: true, selection: [TWO.length] });
      expect(command(outside)).toBe(false);
      expect(outside.state.doc.toString()).toBe(TWO);
    }
  });

  it("A96. each command is one undo step with the editor's own undo wiring: two commands take two undos, and text typed before them survives both", () => {
    const ydoc = new Y.Doc();
    const text = ydoc.getText("note");
    const doc = "| a | b |\n| :-- | --: |\n| c | d |\n\nafter";
    text.insert(0, doc);
    const undoManager = new Y.UndoManager(text);
    const view = mount(doc, {
      focused: true,
      selection: [doc.length],
      // As AtlasEditor composes them.
      extensions: [
        yCollab(text, new Awareness(ydoc), { undoManager }),
        Prec.high(keymap.of(yUndoManagerKeymap)),
        isolatedUndoSteps(undoManager),
      ],
    });
    click(cells(view)[2]);
    const editor = child(view);
    editor?.dispatch({ ...editor.state.replaceSelection("x"), userEvent: "input.type" });
    const typed = doc.replace("| c |", "| cx |");
    expect(text.toString()).toBe(typed);

    expect(insertColumnRight(view)).toBe(true);
    const widened = "| a |   | b |\n| :-- | --- | --: |\n| cx |   | d |\n\nafter";
    expect(text.toString()).toBe(widened);
    expect(insertRowBelow(view)).toBe(true);
    expect(text.toString()).toBe(widened.replace("| d |", "| d |\n|   |   |   |"));

    child(view)?.focus();
    undoManager.undo();
    expect(text.toString()).toBe(widened);
    expect(widget(view)).not.toBeNull();
    undoManager.undo();
    expect(text.toString()).toBe(typed);
    expect(view.state.doc.toString()).toBe(typed);
    expect(widget(view)).not.toBeNull();
  });

  it("returns to the cell that was active before the command when an inserted column is undone, with focus", () => {
    const ydoc = new Y.Doc();
    const text = ydoc.getText("note");
    const doc = "| a | b |\n| :-- | --: |\n| c | d |\n\nafter";
    text.insert(0, doc);
    const undoManager = new Y.UndoManager(text);
    const view = mount(doc, {
      focused: true,
      selection: [doc.length],
      extensions: yCollab(text, new Awareness(ydoc), { undoManager }),
    });
    click(cells(view)[2]);
    expect(insertColumnRight(view)).toBe(true);
    child(view)?.focus();
    undoManager.undo();
    expect(view.state.doc.toString()).toBe(doc);
    expect(active(view)).toEqual([1, 0, "c"]);
    expect(child(view)?.state.doc.toString()).toBe("c");
    expect(child(view)?.hasFocus).toBe(true);
  });

  it("A97. the cell menu opens inside the editor, runs a choice with focus in the new cell, and closes on Escape or a click elsewhere", () => {
    const view = mount(TWO, { focused: true, selection: [TWO.length] });
    rightClick(cells(view)[0]);
    expect(rootMenu(view)?.getAttribute("role")).toBe("menu");
    expect(menuLabels(view).top).toEqual(TOP);

    // Escape closes it without effect.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(rootMenu(view)).toBeNull();
    expect(view.state.doc.toString()).toBe(TWO);

    // A mousedown outside closes it too; only one menu is open at a time.
    rightClick(cells(view)[2]);
    rightClick(cells(view)[3]);
    expect(view.dom.querySelectorAll(":scope > .cm-md-cell-menu")).toHaveLength(1);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(rootMenu(view)).toBeNull();
    expect(view.state.doc.toString()).toBe(TWO);

    // From inside the active cell's editor, choosing Add row below runs it on that cell.
    click(cells(view)[2]);
    const editor = child(view);
    editor?.focus();
    rightClick(editor?.contentDOM);
    choose(view, "Add row below");
    expect(rootMenu(view)).toBeNull();
    expect(view.state.doc.toString()).toBe("| a | b |\n| - | - |\n| c | d |\n|   |   |\n\nafter");
    expect(active(view)).toEqual([2, 0, ""]);
    expect(child(view)?.hasFocus).toBe(true);
  });

  it("gives every row exactly one new cell on a column insert, with and without outer pipes", () => {
    const tables = ["| a | b |\n| - | - |\n| c | d |\n\nafter", "a | b\n--- | ---\nc | d\n\nafter"];
    for (const doc of tables) {
      for (const [name, command] of [
        ["left", insertColumnLeft],
        ["right", insertColumnRight],
      ] as const) {
        for (const index of [2, 3]) {
          const view = withActive(doc, index);
          expect(command(view), `${name} of cell ${index} in ${doc}`).toBe(true);
          expect(parsedShape(view), `${name} of cell ${index} in ${doc}`).toEqual({
            columns: 3,
            rows: [3, 3],
          });
          expect(active(view)?.[2]).toBe("");
        }
      }
    }
    const left = withActive("a | b\n--- | ---\nc | d\n\nafter", 2);
    insertColumnLeft(left);
    expect(left.state.doc.toString()).toBe("|   |a | b\n| --- |--- | ---\n|   |c | d\n\nafter");
  });

  it("keeps a pipe in every row when deleting a column of a table without outer pipes", () => {
    const doc = "a | b\n--- | ---\nc | d\n\nafter";
    const first = withActive(doc, 2);
    expect(deleteColumn(first)).toBe(true);
    expect(first.state.doc.toString()).toBe("| b\n| --- |\n| d\n\nafter");
    expect(parsedShape(first)).toEqual({ columns: 1, rows: [1, 1] });
    expect(active(first)).toEqual([1, 0, "d"]);

    const second = withActive(doc, 3);
    expect(deleteColumn(second)).toBe(true);
    expect(second.state.doc.toString()).toBe("a |\n--- |\nc |\n\nafter");
    expect(parsedShape(second)).toEqual({ columns: 1, rows: [1, 1] });
    expect(active(second)).toEqual([1, 0, "c"]);
  });

  it("deleting a column from a padded cell of a short row activates a cell with source", () => {
    const doc = "| a | b | c |\n| - | - | - |\n| d |\n\nafter";
    const view = mount(doc, { focused: true, selection: [doc.length] });
    cells(view)[5]?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    const item = [...view.dom.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (entry) => entry.textContent === "Delete column",
    );
    item?.click();
    expect(view.state.doc.toString()).toBe("| a | b |\n| - | - |\n| d |\n\nafter");
    expect(active(view)).toEqual([0, 1, "b"]);
  });

  it("disables every menu entry in a read-only editor, and a click changes nothing", () => {
    const view = mount(TWO, {
      focused: true,
      selection: [TWO.length],
      extensions: EditorState.readOnly.of(true),
    });
    rightClick(cells(view)[2]);
    const items = [...(rootMenu(view)?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    expect(items.length).toBeGreaterThan(4);
    expect(items.every((item) => item.getAttribute("aria-disabled") === "true")).toBe(true);
    for (const item of items) item.click();
    expect(view.state.doc.toString()).toBe(TWO);
  });

  it("closes the menu and drops its document listeners when the editor is destroyed", () => {
    const view = mount(TWO, { focused: true, selection: [TWO.length] });
    cells(view)[2]?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    expect(view.dom.querySelector(".cm-md-cell-menu")).not.toBeNull();
    view.destroy();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(document.querySelector(".cm-md-cell-menu")).toBeNull();
  });

  it("A102. the menu has Row and Column submenus and the two sorts, omitting what the grid forbids at each edge", () => {
    const doc = "| a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n\nafter";
    const labels = (index: number, source = doc) => {
      const view = mount(source, { focused: true, selection: [source.length] });
      rightClick(cells(view)[index]);
      return menuLabels(view);
    };
    expect(labels(4)).toEqual({ top: TOP, row: ROW, column: COLUMN });
    expect(labels(1).row).toEqual(without(ROW, "Move row up"));
    expect(labels(7).row).toEqual(without(ROW, "Move row down"));
    expect(labels(3).column).toEqual(without(COLUMN, "Move column left"));
    expect(labels(5).column).toEqual(without(COLUMN, "Move column right"));
    expect(labels(1, "| a |\n| - |\n| b |\n| c |\n\nafter").column).toEqual(
      without(COLUMN, "Move column left", "Move column right", "Delete column"),
    );
    // An empty cell gets the same menu as a populated one in its place.
    const empty = doc.replace("| d | e | f |", "| d |   | f |");
    expect(labels(4, empty)).toEqual(labels(4));
  });

  it("walks the menu from the keyboard while the cell editor keeps focus", () => {
    const view = withActive(TWO, 2);
    const editor = child(view);
    editor?.focus();
    const head = editor?.state.selection.main.head;
    rightClick(editor?.contentDOM);
    const focused = () =>
      [...(rootMenu(view)?.querySelectorAll(".cm-md-cell-menu-focused") ?? [])].map(label);

    // Each key is taken by the menu, not the cell editor under it.
    expect(key(editor?.contentDOM, "ArrowDown").defaultPrevented).toBe(true);
    expect(focused()).toEqual(["Row"]);
    key(editor?.contentDOM, "ArrowRight");
    expect(focused()).toEqual(["Row", "Add row above"]);
    key(editor?.contentDOM, "ArrowLeft");
    expect(focused()).toEqual(["Row"]);
    key(editor?.contentDOM, "ArrowUp");
    expect(focused()).toEqual(["Sort by column (Z to A)"]);
    key(editor?.contentDOM, "ArrowDown");
    key(editor?.contentDOM, "ArrowRight");
    key(editor?.contentDOM, "ArrowDown");
    expect(focused()).toEqual(["Row", "Add row below"]);
    expect(editor?.state.selection.main.head).toBe(head);
    expect(editor?.hasFocus).toBe(true);
    key(editor?.contentDOM, "Enter");
    expect(rootMenu(view)).toBeNull();
    expect(view.state.doc.toString()).toBe("| a | b |\n| - | - |\n| c | d |\n|   |   |\n\nafter");
    expect(active(view)).toEqual([2, 0, ""]);
    expect(child(view)?.hasFocus).toBe(true);
  });

  it("opens a submenu on hover and on a click of its parent", () => {
    const view = mount(TWO, { focused: true, selection: [TWO.length] });
    rightClick(cells(view)[2]);
    const [row, column] = entries(rootMenu(view));
    expect(submenuOf(row)?.hidden).toBe(true);
    row?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(submenuOf(row)?.hidden).toBe(false);
    column?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(submenuOf(row)?.hidden).toBe(true);
    expect(submenuOf(column)?.hidden).toBe(false);
    rightClick(cells(view)[2]);
    const [again] = entries(rootMenu(view));
    again?.click();
    expect(submenuOf(again)?.hidden).toBe(false);
    expect(again?.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("A103. deleting the header promotes the first body row; moving the first body row up, or the header down, swaps them around the delimiter", () => {
    const doc = "| a | b |\n| - | - |\n| c | d |\n| e | f |\n\nafter";
    const promoted = withActive(doc, 0);
    expect(deleteRow(promoted)).toBe(true);
    expect(promoted.state.doc.toString()).toBe("| c | d |\n| - | - |\n| e | f |\n\nafter");
    expect(active(promoted)).toEqual([0, 0, "c"]);

    const swapped = "| c | d |\n| - | - |\n| a | b |\n| e | f |\n\nafter";
    const up = withActive(doc, 2);
    expect(moveRowUp(up)).toBe(true);
    expect(up.state.doc.toString()).toBe(swapped);
    expect(active(up)).toEqual([0, 0, "c"]);

    const down = withActive(doc, 0);
    expect(moveRowDown(down)).toBe(true);
    expect(down.state.doc.toString()).toBe(swapped);
    expect(active(down)).toEqual([1, 0, "a"]);

    expect(moveRowUp(withActive(doc, 0))).toBe(false);
    expect(moveRowDown(withActive(doc, 4))).toBe(false);
  });

  it("A104. move row swaps lines byte for byte; move column swaps slots in every row, delimiter included, and the moved cell stays active", () => {
    const doc = "| a | b |\n| - | - |\n|  c\\|x |   d |\n| e | f |\n\nafter";
    const row = withActive(doc, 2);
    expect(moveRowDown(row)).toBe(true);
    expect(row.state.doc.toString()).toBe(
      "| a | b |\n| - | - |\n| e | f |\n|  c\\|x |   d |\n\nafter",
    );
    expect(active(row)).toEqual([2, 0, "c\\|x"]);

    const column = withActive("| a | b |\n| :-- | --: |\n| c | d |\n\nafter", 2);
    expect(moveColumnRight(column)).toBe(true);
    expect(column.state.doc.toString()).toBe("| b | a |\n| --: | :-- |\n| d | c |\n\nafter");
    expect(active(column)).toEqual([1, 1, "c"]);
    expect(moveColumnLeft(column)).toBe(true);
    expect(column.state.doc.toString()).toBe("| a | b |\n| :-- | --: |\n| c | d |\n\nafter");
    expect(active(column)).toEqual([1, 0, "c"]);

    // An escaped pipe travels inside its slot; a short row lacking a column is left alone.
    const short = "| a | b | c |\n| - | :-: | - |\n| x\\|y | z |\n| p |\n\nafter";
    const escaped = withActive(short, 3);
    expect(moveColumnRight(escaped)).toBe(true);
    expect(escaped.state.doc.toString()).toBe(
      "| b | a | c |\n| :-: | - | - |\n| z | x\\|y |\n| p |\n\nafter",
    );
    expect(active(escaped)).toEqual([1, 1, "x\\|y"]);
  });

  it("A105. duplicate row copies the line below itself and duplicate column copies the slot after itself; the original stays active", () => {
    const row = withActive(TWO, 2);
    expect(duplicateRow(row)).toBe(true);
    expect(row.state.doc.toString()).toBe("| a | b |\n| - | - |\n| c | d |\n| c | d |\n\nafter");
    expect(active(row)).toEqual([1, 0, "c"]);

    // The header's copy becomes the first body row.
    const header = withActive(TWO, 0);
    expect(duplicateRow(header)).toBe(true);
    expect(header.state.doc.toString()).toBe("| a | b |\n| - | - |\n| a | b |\n| c | d |\n\nafter");
    expect(active(header)).toEqual([0, 0, "a"]);

    const column = withActive("| a | b |\n| :-- | --: |\n| c | d |\n\nafter", 2);
    expect(duplicateColumn(column)).toBe(true);
    expect(column.state.doc.toString()).toBe(
      "| a | a | b |\n| :-- | :-- | --: |\n| c | c | d |\n\nafter",
    );
    expect(active(column)).toEqual([1, 0, "c"]);
    expect(parsedShape(column)).toEqual({ columns: 3, rows: [3, 3] });
  });

  it("A106. align rewrites only the target delimiter cell at its own width; the current alignment changes nothing", () => {
    const center = withActive("| a | b |\n| :---- | --: |\n\nafter", 0);
    expect(alignColumnCenter(center)).toBe(true);
    expect(center.state.doc.toString()).toBe("| a | b |\n| :---: | --: |\n\nafter");
    expect(active(center)).toEqual([0, 0, "a"]);

    const already = "| a | b |\n| :---- | --: |\n| c | d |\n\nafter";
    const left = withActive(already, 2);
    expect(alignColumnLeft(left)).toBe(false);
    expect(left.state.doc.toString()).toBe(already);

    // Width kept: `---` gives `:-:`, `:--`, `--:`; a five-dash cell stays five wide.
    const three = "| a | b |\n| --- | ----- |\n| c | d |\n\nafter";
    for (const [command, rule] of [
      [alignColumnCenter, ":-:"],
      [alignColumnLeft, ":--"],
      [alignColumnRight, "--:"],
    ] as const) {
      const view = withActive(three, 2);
      expect(command(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(three.replace("| --- |", `| ${rule} |`));
      expect(active(view)).toEqual([1, 0, "c"]);
    }
    const five = withActive(three, 3);
    expect(alignColumnRight(five)).toBe(true);
    expect(five.state.doc.toString()).toBe(three.replace("-----", "----:"));

    // A cell too narrow for its colons grows to the shortest valid form.
    const narrow = "| a | b |\n| - | - |\n| c | d |\n\nafter";
    for (const [command, rule] of [
      [alignColumnCenter, ":-:"],
      [alignColumnLeft, ":-"],
      [alignColumnRight, "-:"],
    ] as const) {
      const view = withActive(narrow, 2);
      expect(command(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(narrow.replace("| - | - |", `| ${rule} | - |`));
    }
  });

  it("A107. sort reorders body rows as whole lines, naturally and stably, keeping the current cell active", () => {
    const fixture = [
      "| Name | Note | Count |",
      "| --- | --- | --: |",
      "| alpha | **bold** note | 1 |",
      "| beta |  | 22 |",
      "| gamma | `x` | 3 |",
    ];
    const doc = `${fixture.join("\n")}\n\nafter`;
    const byName = withActive(doc, 3);
    expect(sortRowsDescending(byName)).toBe(true);
    const [header, delimiter, alpha, beta, gamma] = fixture;
    expect(byName.state.doc.toString()).toBe(
      `${[header, delimiter, gamma, beta, alpha].join("\n")}\n\nafter`,
    );
    expect(active(byName)).toEqual([3, 0, "alpha"]);
    expect(sortRowsAscending(byName)).toBe(true);
    expect(byName.state.doc.toString()).toBe(doc);
    expect(active(byName)).toEqual([1, 0, "alpha"]);
    expect(sortRowsAscending(byName)).toBe(false);

    const byCount = withActive(doc, 5);
    expect(sortRowsAscending(byCount)).toBe(true);
    expect(byCount.state.doc.toString()).toBe(
      `${[header, delimiter, alpha, gamma, beta].join("\n")}\n\nafter`,
    );

    // Natural, case-insensitive, stable: 2 before 10, `a` before `B`, equal keys in order.
    const mixed =
      "| n | k |\n| - | - |\n| 10 | 1 |\n| B | 2 |\n| x | 3 |\n| 2 | 4 |\n| X | 5 |\n| a | 6 |\n\nafter";
    const natural = withActive(mixed, 2);
    expect(sortRowsAscending(natural)).toBe(true);
    expect(natural.state.doc.toString()).toBe(
      "| n | k |\n| - | - |\n| 2 | 4 |\n| 10 | 1 |\n| a | 6 |\n| B | 2 |\n| x | 3 |\n| X | 5 |\n\nafter",
    );
    const reversed = withActive(mixed, 2);
    expect(sortRowsDescending(reversed)).toBe(true);
    expect(reversed.state.doc.toString()).toBe(
      "| n | k |\n| - | - |\n| x | 3 |\n| X | 5 |\n| B | 2 |\n| a | 6 |\n| 10 | 1 |\n| 2 | 4 |\n\nafter",
    );
  });

  it("A108. insert table after the caret's paragraph writes a blank line and the three-line table and activates its first header cell with focus", () => {
    const view = mount("para\n\nnext", { focused: true, selection: [4] });
    expect(insertTable(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "para\n\n|     |     |\n| --- | --- |\n|     |     |\n\nnext",
    );
    expect(active(view)).toEqual([0, 0, ""]);
    expect(child(view)?.hasFocus).toBe(true);

    // A line straight after the paragraph keeps a blank line from the table.
    const heading = mount("para\n# next", { focused: true, selection: [2] });
    expect(insertTable(heading)).toBe(true);
    expect(heading.state.doc.toString()).toBe(
      "para\n\n|     |     |\n| --- | --- |\n|     |     |\n\n# next",
    );

    const inside = mount(TWO, { focused: true, selection: [TWO.indexOf("c")] });
    expect(insertTable(inside)).toBe(false);
    expect(inside.state.doc.toString()).toBe(TWO);
  });

  it("A115. every command is exported from the ./markdown entry, and is one undo step; each cell command returns false with no current cell (insert table needs none, and returns false only inside a table or a literal block)", () => {
    const commands: Record<string, Command> = {
      insertRowAbove,
      insertRowBelow,
      moveRowUp,
      moveRowDown,
      duplicateRow,
      deleteRow,
      insertColumnLeft,
      insertColumnRight,
      moveColumnLeft,
      moveColumnRight,
      alignColumnLeft,
      alignColumnCenter,
      alignColumnRight,
      duplicateColumn,
      deleteColumn,
      sortRowsAscending,
      sortRowsDescending,
    };
    const exported: Record<string, unknown> = { ...entry };
    for (const [name, command] of Object.entries({
      ...commands,
      insertTable,
      clearCells,
      deleteCells,
    }))
      expect(exported[name], name).toBe(command);

    // Unsorted, so both sorts have work to do from a middle cell of the middle row.
    const doc =
      "| a | b | c |\n| - | - | - |\n| g | h | i |\n| d | e | f |\n| j | k | l |\n\nafter";
    for (const [name, command] of Object.entries(commands)) {
      const outside = mount(doc, { focused: true, selection: [doc.length] });
      expect(command(outside), name).toBe(false);
      expect(outside.state.doc.toString()).toBe(doc);

      const ydoc = new Y.Doc();
      const text = ydoc.getText("note");
      text.insert(0, doc);
      const undoManager = new Y.UndoManager(text);
      const view = mount(doc, {
        focused: true,
        selection: [doc.length],
        extensions: [
          yCollab(text, new Awareness(ydoc), { undoManager }),
          Prec.high(keymap.of(yUndoManagerKeymap)),
          isolatedUndoSteps(undoManager),
        ],
      });
      click(cells(view)[7]);
      expect(command(view), name).toBe(true);
      expect(text.toString(), name).not.toBe(doc);
      undoManager.undo();
      expect(text.toString(), name).toBe(doc);
    }

    // The cell commands act on a selection: none, no current cell for them (their undo
    // steps are in A113).
    for (const command of [clearCells, deleteCells])
      expect(command(withActive(doc, 7))).toBe(false);

    // Insert table, from the caret in the paragraph after the table, is one step too.
    const { view, text, undoManager } = undoable(doc);
    expect(insertTable(view)).toBe(true);
    expect(text.toString()).toBe(`${doc}\n\n|     |     |\n| --- | --- |\n|     |     |`);
    undoManager.undo();
    expect(text.toString()).toBe(doc);
  });

  it("acts on a padded cell of a short row as the current cell, writing it and keeping it active", () => {
    const doc = "| a | b | c |\n| - | - | - |\n| p | q | r |\n| x |\n\nafter";
    const cases: [string, string][] = [
      ["Move column right", "| a | c | b |\n| - | - | - |\n| p | r | q |\n| x |  |\n\nafter"],
      [
        "Duplicate column",
        "| a | b | b | c |\n| - | - | - | - |\n| p | q | q | r |\n| x |  |\n\nafter",
      ],
      ["Align center", "| a | b | c |\n| - | :-: | - |\n| p | q | r |\n| x |  |\n\nafter"],
      ["Duplicate row", "| a | b | c |\n| - | - | - |\n| p | q | r |\n| x |  |\n| x |\n\nafter"],
    ];
    for (const [name, expected] of cases) {
      const view = mount(doc, { focused: true, selection: [doc.length] });
      rightClick(cells(view)[7]);
      expect(choose(view, name), name).toBeTruthy();
      expect(view.state.doc.toString(), name).toBe(expected);
      expect(active(view), name).toEqual([2, 1, ""]);
    }
  });

  it("moves and sorts a row whose padded cell is current, writing that cell into the moved line", () => {
    const last = "| a | b | c |\n| - | - | - |\n| p | q | r |\n| x |";
    const first = "| a | b | c |\n| - | - | - |\n| x |\n| p | q | r |";
    const xFirst = "| a | b | c |\n| - | - | - |\n| x |  |\n| p | q | r |";
    const xLast = "| a | b | c |\n| - | - | - |\n| p | q | r |\n| x |  |";
    const cases: [string, string, number, string, readonly [number, number, string]][] = [
      [last, "Move row up", 7, xFirst, [1, 1, ""]],
      [first, "Move row down", 4, xLast, [2, 1, ""]],
      [last, "Sort by column (A to Z)", 7, xFirst, [1, 1, ""]],
      [first, "Sort by column (Z to A)", 4, xLast, [2, 1, ""]],
    ];
    // With prose after the table, and with the table ending the note.
    for (const [before, after] of [
      ["", "\n\nafter"],
      ["before\n\n", ""],
    ]) {
      for (const [table, name, index, expected, where] of cases) {
        const doc = `${before}${table}${after}`;
        const view = mount(doc, { focused: true, selection: [0] });
        if (before === "") view.dispatch({ selection: { anchor: doc.length } });
        rightClick(cells(view)[index]);
        expect(choose(view, name), name).toBeTruthy();
        expect(view.state.doc.toString(), `${name}${after}`).toBe(`${before}${expected}${after}`);
        expect(active(view), `${name}${after}`).toEqual(where);
      }
    }
  });

  it("inserts no table from inside code, HTML, math, or frontmatter, closed or not, and inserts after a quote", () => {
    for (const [doc, caretAt] of [
      ["```\ncode", 8],
      ["```\ncode\n```\n\nafter", 5],
      ["    indented\n\nafter", 6],
      ["<div>\nhtml\n</div>\n\nafter", 7],
      ["$$\nx\n$$\n\nafter", 3],
      ["---\ntitle: x\n---\n\nafter", 6],
    ] as const) {
      const view = mount(doc, { focused: true, selection: [caretAt] });
      expect(insertTable(view), doc).toBe(false);
      expect(view.state.doc.toString()).toBe(doc);
    }

    // After a quote, as a top-level paragraph with a blank line between.
    const quote = mount("> quoted\n\nafter", { focused: true, selection: [4] });
    expect(insertTable(quote)).toBe(true);
    expect(quote.state.doc.toString()).toBe(
      "> quoted\n\n|     |     |\n| --- | --- |\n|     |     |\n\nafter",
    );
    expect(active(quote)).toEqual([0, 0, ""]);
  });

  it("keeps a cell active with focus through undoing add row above on the header, and an earlier edit after it", () => {
    const { view, undoManager } = undoable(TWO);
    click(cells(view)[1]);
    const editor = child(view);
    editor?.focus();
    editor?.dispatch({ ...editor.state.replaceSelection("x"), userEvent: "input.type" });
    const typed = TWO.replace("| b |", "| bx |");
    expect(insertRowAbove(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      `|   |   |\n| - | - |\n${typed.replace("| - | - |\n", "")}`,
    );
    undoManager.undo();
    expect(view.state.doc.toString()).toBe(typed);
    expect(active(view)).toEqual([0, 1, "bx"]);
    expect(child(view)?.hasFocus).toBe(true);
    undoManager.undo();
    expect(view.state.doc.toString()).toBe(TWO);
    expect(active(view)).toEqual([0, 1, "b"]);
    expect(child(view)?.hasFocus).toBe(true);
  });

  it("keeps the moved cell active with focus through undo and redo of move row down", () => {
    const doc = "| a | b |\n| - | - |\n| c | d |\n| e | f |\n\nafter";
    const moved = "| a | b |\n| - | - |\n| e | f |\n| c | d |\n\nafter";
    const { view, undoManager } = undoable(doc);
    click(cells(view)[2]);
    child(view)?.focus();
    expect(moveRowDown(view)).toBe(true);
    expect(active(view)).toEqual([2, 0, "c"]);
    undoManager.undo();
    expect(view.state.doc.toString()).toBe(doc);
    expect(active(view)).toEqual([1, 0, "c"]);
    expect(child(view)?.hasFocus).toBe(true);
    undoManager.redo();
    expect(view.state.doc.toString()).toBe(moved);
    expect(active(view)).toEqual([2, 0, "c"]);
    expect(child(view)?.hasFocus).toBe(true);
  });

  it("returns to the original cell with focus when move column or sort is undone", () => {
    const doc = "| a | b |\n| :-- | --: |\n| c | d |\n| e | f |\n\nafter";
    const column = undoable(doc);
    click(cells(column.view)[2]);
    child(column.view)?.focus();
    expect(moveColumnRight(column.view)).toBe(true);
    expect(active(column.view)).toEqual([1, 1, "c"]);
    column.undoManager.undo();
    expect(column.view.state.doc.toString()).toBe(doc);
    expect(active(column.view)).toEqual([1, 0, "c"]);
    expect(child(column.view)?.hasFocus).toBe(true);

    const sort = undoable(doc);
    click(cells(sort.view)[2]);
    child(sort.view)?.focus();
    expect(sortRowsDescending(sort.view)).toBe(true);
    expect(active(sort.view)).toEqual([2, 0, "c"]);
    sort.undoManager.undo();
    expect(sort.view.state.doc.toString()).toBe(doc);
    expect(active(sort.view)).toEqual([1, 0, "c"]);
    expect(child(sort.view)?.hasFocus).toBe(true);
  });

  it("keeps the active cell on a browser selection read at the widget's start, and follows a caret an undo restores", () => {
    const doc = "a | b\n--- | ---\nc | d\n\nafter";
    const view = withActive(doc, 2);
    expect(active(view)).toEqual([1, 0, "c"]);
    // The DOM observer's reads carry a `select` event; the widget starts on `a`'s slot.
    view.dispatch({ selection: { anchor: 0 }, userEvent: "select" });
    expect(active(view)).toEqual([1, 0, "c"]);
    // A selection set with no user event (the Yjs undo manager's restore) moves it.
    view.dispatch({ selection: { anchor: doc.indexOf("d") } });
    expect(active(view)).toEqual([1, 1, "d"]);
  });

  it("clears the active cell with its table, and keeps it when a peer writes above the table", () => {
    const doc = "| a | b |\n| - | - |\n| c | d |\n\n| e | f |\n| - | - |\n| g | h |\n\nafter";
    const view = withActive(doc, 3);
    expect(active(view)).toEqual([1, 1, "d"]);
    const second = doc.indexOf("| e |");
    view.dispatch({ changes: { from: 0, to: second } });
    expect(view.state.doc.toString()).toBe("| e | f |\n| - | - |\n| g | h |\n\nafter");
    expect(view.state.field(activeCell)).toBeNull();
    expect(child(view)).toBeNull();

    const { view: shared, text } = undoable(doc);
    click(cells(shared)[3]);
    text.insert(0, "para\n\n");
    expect(shared.state.doc.toString()).toBe(`para\n\n${doc}`);
    expect(active(shared)).toEqual([1, 1, "d"]);
    expect(child(shared)?.state.doc.toString()).toBe("d");
  });

  it("returns an undone menu command to the right-clicked cell when no cell was active before", () => {
    const seed = "| Column | Other |\n| ------ | ----- |\n| cell | **bold** cell |\n\nafter";
    const sorted = "| Column | Other |\n| ------ | ----- |\n| cell | x |\n| zeta | y |\n\nafter";
    const cases: [string, number, string, readonly [number, number, string]][] = [
      [seed, 2, "Move row up", [1, 0, "cell"]],
      [seed, 3, "Move column left", [1, 1, "**bold** cell"]],
      [sorted, 2, "Sort by column (Z to A)", [1, 0, "cell"]],
    ];
    for (const [doc, index, name, where] of cases) {
      const { view, undoManager } = undoable(doc);
      expect(view.state.field(activeCell), name).toBeNull();
      rightClick(cells(view)[index]);
      expect(choose(view, name), name).toBeTruthy();
      expect(view.state.doc.toString(), name).not.toBe(doc);
      undoManager.undo();
      expect(view.state.doc.toString(), name).toBe(doc);
      expect(active(view), name).toEqual(where);
      expect(child(view)?.hasFocus, name).toBe(true);
    }
  });

  it("A109. the bottom add bar adds a row and the right one a column, activating the new cell, each one undo step; a right-click on a bar does nothing", () => {
    const seed = "| Column | Other |\n| ------ | ----- |\n| cell | **bold** cell |\n\nafter";
    const bar = (view: EditorView, kind: "row" | "column") =>
      widget(view)?.querySelector<HTMLElement>(`.cm-md-table-add-${kind}`);
    const press = (element: Element | null | undefined) =>
      element?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );

    const labels = mount(seed);
    for (const [kind, label] of [
      ["row", "Add row below"],
      ["column", "Add column to the right"],
    ] as const) {
      const element = bar(labels, kind);
      expect(element?.getAttribute("role")).toBe("button");
      expect(element?.getAttribute("aria-label")).toBe(label);
      expect(element?.title).toBe(label);
    }
    // There is no top or left bar.
    expect(widget(labels)?.querySelectorAll(".cm-md-table-add")).toHaveLength(2);

    const row = undoable(seed);
    press(bar(row.view, "row"));
    expect(row.text.toString()).toBe(seed.replace("cell |\n", "cell |\n|   |   |\n"));
    expect(active(row.view)).toEqual([2, 0, ""]);
    expect(child(row.view)?.hasFocus).toBe(true);
    row.undoManager.undo();
    expect(row.text.toString()).toBe(seed);

    const column = undoable(seed);
    press(bar(column.view, "column"));
    expect(column.text.toString()).toBe(
      "| Column | Other |   |\n| ------ | ----- | --- |\n| cell | **bold** cell |   |\n\nafter",
    );
    expect(active(column.view)).toEqual([0, 2, ""]);
    expect(child(column.view)?.hasFocus).toBe(true);
    column.undoManager.undo();
    expect(column.text.toString()).toBe(seed);

    // A right-click on a bar is not a table target.
    const right = mount(seed, { focused: true, selection: [seed.length] });
    for (const kind of ["row", "column"] as const) {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      bar(right, kind)?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(rootMenu(right)).toBeNull();
    }
    expect(right.state.doc.toString()).toBe(seed);

    // A read-only editor draws no bars.
    const readOnly = mount(seed, { extensions: EditorState.readOnly.of(true) });
    expect(widget(readOnly)?.querySelector(".cm-md-table-add")).toBeNull();

    // The bars survive the widget's in-place redraw while a cell is typed in.
    const typing = withActive(seed, 2);
    const before = bar(typing, "row");
    const editor = child(typing);
    editor?.dispatch({ ...editor.state.replaceSelection("s"), userEvent: "input.type" });
    expect(typing.state.doc.toString()).toBe(seed.replace("| cell |", "| cells |"));
    expect(bar(typing, "row")).toBe(before);
    expect(bar(typing, "column")).not.toBeNull();
  });

  it("keeps the add bars outside the table's scroller, and draws them only while the editor is editable", () => {
    const seed = "| Column | Other |\n| ------ | ----- |\n| cell | **bold** cell |\n\nafter";
    const readOnly = new Compartment();
    const view = mount(seed, { extensions: readOnly.of(EditorState.readOnly.of(false)) });
    const children = () => [...(widget(view)?.children ?? [])].map((child) => child.className);
    // The scroller holds the table; the bars, grips, and selection outline are its
    // siblings, at the wrapper's edges, each bar its own hover target.
    expect(children()).toEqual([
      "cm-md-table-scroll",
      "cm-md-table-add cm-md-table-add-row",
      "cm-md-table-add cm-md-table-add-column",
      "cm-md-table-grip cm-md-table-grip-row",
      "cm-md-table-grip cm-md-table-grip-row",
      "cm-md-table-grip cm-md-table-grip-column",
      "cm-md-table-grip cm-md-table-grip-column",
      "cm-md-table-selection",
    ]);
    expect(widget(view)?.querySelector(".cm-md-table-scroll > table")).not.toBeNull();
    expect(widget(view)?.querySelector(".cm-md-table-scroll .cm-md-table-add")).toBeNull();
    expect(widget(view)?.classList.contains("cm-md-table-with-bars")).toBe(true);

    view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(true)) });
    expect(widget(view)?.querySelector(".cm-md-table-add, .cm-md-table-grip")).toBeNull();
    expect(widget(view)?.classList.contains("cm-md-table-with-bars")).toBe(false);

    view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(false)) });
    expect(widget(view)?.querySelectorAll(".cm-md-table-add")).toHaveLength(2);
    expect(widget(view)?.querySelectorAll(".cm-md-table-grip")).toHaveLength(4);
    expect(widget(view)?.classList.contains("cm-md-table-with-bars")).toBe(true);
  });

  it.todo(
    "A110. resting the pointer in the strip below the table shows only the bottom bar, in the strip to its right only the right bar, on the cells neither; moving away hides them; no bar at the top or left (browser)",
  );

  it("A111. a handle click selects its row or column and activates its first cell; its right-click menu is flat; Escape, a click elsewhere, or typing collapses the selection", async () => {
    const doc = "| a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n\nafter";

    const row = mount(doc, { focused: true, selection: [doc.length] });
    expect(grip(row, "row", 1)?.getAttribute("aria-label")).toBe("Row handle");
    handleClick(grip(row, "row", 1));
    expect(selectedTexts(row)).toEqual(["d", "e", "f"]);
    expect(active(row)).toEqual([1, 0, "d"]);
    expect(child(row)?.hasFocus).toBe(true);
    // The caret lands after the cell's text, as a click past the text puts it.
    expect(childCaret(row)).toBe(1);
    expect(widget(row)?.dataset.selected).toBe("row:1");

    const column = mount(doc, { focused: true, selection: [doc.length] });
    handleClick(grip(column, "column", 1));
    expect(selectedTexts(column)).toEqual(["b", "e", "h"]);
    expect(active(column)).toEqual([0, 1, "b"]);

    // Right-click on a row handle: the six row commands, flat, with the omissions.
    rightClick(grip(row, "row", 2) ?? undefined);
    expect(entries(rootMenu(row)).map(label)).toEqual(without(ROW, "Move row down"));
    expect(selectedTexts(row)).toEqual(["g", "h", "i"]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // On a column handle: the sorts, then the column commands.
    rightClick(grip(row, "column", 0) ?? undefined);
    expect(entries(rootMenu(row)).map(label)).toEqual([
      "Sort by column (A to Z)",
      "Sort by column (Z to A)",
      ...without(COLUMN, "Move column left"),
    ]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(selectedTexts(row)).toEqual(["a", "d", "g"]);

    // Escape collapses the selection to the active cell, which stays.
    const cellEditor = child(row);
    if (cellEditor)
      runScopeHandlers(
        cellEditor,
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        "editor",
      );
    await Promise.resolve();
    expect(selectedTexts(row)).toEqual([]);
    expect(active(row)).toEqual([0, 0, "a"]);

    // A click on another cell collapses it.
    handleClick(grip(row, "row", 1));
    click(cells(row)[8]);
    expect(selectedTexts(row)).toEqual([]);
    expect(active(row)).toEqual([2, 2, "i"]);

    // Typing collapses it.
    handleClick(grip(row, "row", 1));
    const editor = child(row);
    editor?.dispatch({ ...editor.state.replaceSelection("x"), userEvent: "input.type" });
    expect(selectedTexts(row)).toEqual([]);
    expect(active(row)).toEqual([1, 0, "dx"]);

    // The header row has a grip too; a read-only editor has none.
    expect(grip(row, "row", 0)).not.toBeNull();
    const readOnly = mount(doc, { extensions: EditorState.readOnly.of(true) });
    expect(widget(readOnly)?.querySelector(".cm-md-table-grip")).toBeNull();
  });

  it("a command from a handle's menu keeps the row or column selected where the active cell lands", () => {
    const doc = "| a | b | c |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n\nafter";

    const column = mount(doc, { focused: true, selection: [doc.length] });
    rightClick(grip(column, "column", 1) ?? undefined);
    choose(column, "Move column left");
    expect(column.state.doc.toString()).toBe(
      "| b | a | c |\n| - | - | - |\n| e | d | f |\n| h | g | i |\n\nafter",
    );
    expect(widget(column)?.dataset.selected).toBe("column:0");
    expect(selectedTexts(column)).toEqual(["b", "e", "h"]);
    expect(active(column)).toEqual([0, 0, "b"]);

    const deleted = mount(doc, { focused: true, selection: [doc.length] });
    rightClick(grip(deleted, "row", 1) ?? undefined);
    choose(deleted, "Delete row");
    expect(deleted.state.doc.toString()).toBe(
      "| a | b | c |\n| - | - | - |\n| g | h | i |\n\nafter",
    );
    expect(selectedTexts(deleted)).toEqual(["g", "h", "i"]);
    expect(active(deleted)).toEqual([1, 0, "g"]);

    const duplicated = mount(doc, { focused: true, selection: [doc.length] });
    rightClick(grip(duplicated, "row", 1) ?? undefined);
    choose(duplicated, "Duplicate row");
    expect(duplicated.state.doc.toString()).toBe(
      "| a | b | c |\n| - | - | - |\n| d | e | f |\n| d | e | f |\n| g | h | i |\n\nafter",
    );
    expect(widget(duplicated)?.dataset.selected).toBe("row:1");
    expect(active(duplicated)).toEqual([1, 0, "d"]);
  });

  it("a grip drag leaves no listeners behind when its widget goes away, and a secondary button starts none", () => {
    const doc = "| a | b |\n| - | - |\n| c | d |\n| e | f |\n\nafter";
    const view = mount(doc, { focused: true, selection: [doc.length] });
    // The pointer, key, and blur listeners added from here on, less those removed.
    const live = new Set<string>();
    const track = (target: Document | Window) => {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      target.addEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        live.add(type);
        add(type, listener, options);
      };
      target.removeEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) => {
        live.delete(type);
        remove(type, listener, options);
      };
      return () => {
        target.addEventListener = add;
        target.removeEventListener = remove;
      };
    };
    const restore = [track(document), track(window)];
    try {
      grip(view, "row", 2)?.dispatchEvent(pointer("pointerdown", { button: 2 }));
      expect([...live]).toEqual([]);

      grip(view, "row", 2)?.dispatchEvent(pointer("pointerdown"));
      document.dispatchEvent(pointer("pointermove", { clientY: -40 }));
      const indicator = widget(view)?.querySelector(".cm-md-table-drop");
      expect(indicator).not.toBeNull();
      expect([...live].sort()).toEqual([
        "blur",
        "keydown",
        "pointercancel",
        "pointermove",
        "pointerup",
      ]);

      view.destroy();
      expect([...live]).toEqual([]);
      expect(indicator?.parentNode).toBeNull();
      document.dispatchEvent(pointer("pointerup"));
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      for (const undo of restore) undo();
    }
  });

  it("clips a column's grip and outline to the scroller's visible part", () => {
    // Wholly visible, partly visible on either side, wider than the view, and out of view.
    expect(clipSpan(10, 60, 0, 100)).toEqual({ left: 10, width: 50 });
    expect(clipSpan(80, 160, 0, 100)).toEqual({ left: 80, width: 20 });
    expect(clipSpan(-30, 40, 0, 100)).toEqual({ left: 0, width: 40 });
    expect(clipSpan(-50, 400, 0, 100)).toEqual({ left: 0, width: 100 });
    expect(clipSpan(120, 200, 0, 100)).toBeNull();
    expect(clipSpan(98, 200, 0, 100)).toBeNull();
  });

  it.todo(
    "A112. resting the pointer in the left gutter beside a row shows that row's grip only, in the top gutter that column's; dragging a body row's grip shows a drop indicator between body rows, never above the header, and releasing moves the row in one undo step; Escape cancels; a column grip drags with a vertical indicator (browser)",
  );

  it("moves a row to a position by cutting and inserting its line, bytes unchanged, in one undo step", () => {
    const doc = "| h | k |\n| - | - |\n| a  | 1 |\n| b | 2 |\n| c | 3 |\n| d\\|x | 4 |\n\nafter";
    const down = undoable(doc);
    click(cells(down.view)[2]);
    expect(moveRowTo(3)(down.view)).toBe(true);
    expect(down.text.toString()).toBe(
      "| h | k |\n| - | - |\n| b | 2 |\n| c | 3 |\n| a  | 1 |\n| d\\|x | 4 |\n\nafter",
    );
    expect(active(down.view)).toEqual([3, 0, "a"]);
    down.undoManager.undo();
    expect(down.text.toString()).toBe(doc);

    const up = undoable(doc);
    click(cells(up.view)[6]);
    expect(moveRowTo(1)(up.view)).toBe(true);
    expect(up.text.toString()).toBe(
      "| h | k |\n| - | - |\n| c | 3 |\n| a  | 1 |\n| b | 2 |\n| d\\|x | 4 |\n\nafter",
    );
    expect(active(up.view)).toEqual([1, 0, "c"]);

    const last = withActive(doc, 8);
    expect(moveRowTo(1)(last)).toBe(true);
    expect(last.state.doc.toString()).toBe(
      "| h | k |\n| - | - |\n| d\\|x | 4 |\n| a  | 1 |\n| b | 2 |\n| c | 3 |\n\nafter",
    );

    // The moved row, or the row it lands after, is the note's last line.
    const end = "before\n\n| h |\n| - |\n| a |\n| b |";
    const atEnd = (index: number) => {
      const view = mount(end, { focused: true, selection: [0] });
      click(cells(view)[index]);
      return view;
    };
    const fromEnd = atEnd(2);
    expect(moveRowTo(1)(fromEnd)).toBe(true);
    expect(fromEnd.state.doc.toString()).toBe("before\n\n| h |\n| - |\n| b |\n| a |");
    expect(active(fromEnd)).toEqual([1, 0, "b"]);
    const toEnd = atEnd(1);
    expect(moveRowTo(2)(toEnd)).toBe(true);
    expect(toEnd.state.doc.toString()).toBe("before\n\n| h |\n| - |\n| b |\n| a |");
    expect(active(toEnd)).toEqual([2, 0, "a"]);

    const header = withActive(doc, 0);
    expect(moveRowTo(2)(header)).toBe(false);
    expect(header.state.doc.toString()).toBe(doc);
    expect(moveRowTo(0)(withActive(doc, 2))).toBe(false);
  });

  it("moves a column to a position in every row that has it, alignment and escapes travelling, in one undo step", () => {
    const doc = "| a | b | c |\n| :-- | :-: | --: |\n| x\\|y | 2 | 3 |\n| s |\n\nafter";
    const view = undoable(doc);
    click(cells(view.view)[3]);
    expect(moveColumnTo(2)(view.view)).toBe(true);
    expect(view.text.toString()).toBe(
      "| b | c | a |\n| :-: | --: | :-- |\n| 2 | 3 | x\\|y |\n|  |  | s |\n\nafter",
    );
    expect(active(view.view)).toEqual([1, 2, "x\\|y"]);
    view.undoManager.undo();
    expect(view.text.toString()).toBe(doc);

    // Back the other way; a row without the moved column is left alone.
    const back = withActive(doc, 5);
    expect(moveColumnTo(0)(back)).toBe(true);
    expect(back.state.doc.toString()).toBe(
      "| c | a | b |\n| --: | :-- | :-: |\n| 3 | x\\|y | 2 |\n| s |\n\nafter",
    );
    expect(active(back)).toEqual([1, 0, "3"]);
    expect(moveColumnTo(0)(withActive(doc, 3))).toBe(false);
  });

  it("a command that keeps its cell active keeps the child caret; one that activates a new cell starts at 0", () => {
    const doc = "| h | k |\n| - | - |\n| cell | x |\n| more | y |\n\nafter";
    const typeAt2 = (command: Command) => {
      const view = withActive(doc, 2);
      child(view)?.dispatch({ selection: { anchor: 2 } });
      expect(command(view)).toBe(true);
      expect(childCaret(view)).toBe(2);
      const editor = child(view);
      editor?.dispatch({ ...editor.state.replaceSelection("Z"), userEvent: "input.type" });
      return active(view);
    };
    expect(typeAt2(moveRowDown)).toEqual([2, 0, "ceZll"]);
    expect(typeAt2(alignColumnCenter)).toEqual([1, 0, "ceZll"]);
    expect(typeAt2(moveRowTo(2))).toEqual([2, 0, "ceZll"]);

    const added = withActive(doc, 2);
    child(added)?.dispatch({ selection: { anchor: 2 } });
    expect(insertRowBelow(added)).toBe(true);
    expect(active(added)).toEqual([2, 0, ""]);
    expect(childCaret(added)).toBe(0);
  });

  it("a blank cell moved to an open end of a row without outer pipes gains the pipe that keeps it a cell", () => {
    const open = "a | | c\n--|--|--\n1 | | 3\n\nafter";
    const first = withActive(open, 1);
    expect(moveColumnTo(0)(first)).toBe(true);
    expect(first.state.doc.toString()).toBe("| |a | c\n--|--|--\n| |1 | 3\n\nafter");
    expect(parsedShape(first)).toEqual({ columns: 3, rows: [3, 3] });
    expect(active(first)).toEqual([0, 0, ""]);

    const last = withActive(open, 1);
    expect(moveColumnTo(2)(last)).toBe(true);
    expect(last.state.doc.toString()).toBe("a | c| |\n--|--|--\n1 | 3| |\n\nafter");
    expect(parsedShape(last)).toEqual({ columns: 3, rows: [3, 3] });
    expect(active(last)).toEqual([0, 2, ""]);

    // Closed rows already have their pipes and gain none.
    const closed = "| a | | c |\n| - | - | - |\n| 1 | | 3 |\n\nafter";
    const control = withActive(closed, 1);
    expect(moveColumnTo(0)(control)).toBe(true);
    expect(control.state.doc.toString()).toBe("| | a | c |\n| - | - | - |\n| | 1 | 3 |\n\nafter");
    expect(parsedShape(control)).toEqual({ columns: 3, rows: [3, 3] });
  });

  describe("rectangle selection", () => {
    const FIXTURE = [
      "| Name | Note | Count |",
      "| --- | --- | --: |",
      "| alpha | **bold** note | 1 |",
      "| beta |  | 22 |",
      "| gamma | `x` | 3 |",
    ];
    const [HEADER, DELIMITER, ALPHA, BETA, GAMMA] = FIXTURE;
    const DOC = `${FIXTURE.join("\n")}\n\nafter`;
    const table = (...lines: (string | undefined)[]) => `${lines.join("\n")}\n\nafter`;

    /** Presses the button in rendered cell `from`, crosses into cell `to`, and releases. */
    function drag(view: EditorView, from: number, to: number) {
      cells(view)[from]?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      cells(view)[to]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    }

    /** Presses a key in the active cell's editor and lets its deferred outer update land. */
    async function press(view: EditorView, name: string, init: KeyboardEventInit = {}) {
      const editor = child(view);
      if (editor)
        runScopeHandlers(
          editor,
          new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }),
          "editor",
        );
      await Promise.resolve();
    }

    const rectMenu = (view: EditorView, index: number) => {
      rightClick(cells(view)[index]);
      const labels = entries(rootMenu(view)).map(label);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return labels;
    };

    const RECT_MENU = [
      "Cut",
      "Copy",
      "Paste",
      "Align left",
      "Align center",
      "Align right",
      "Clear cells",
      "Delete cells",
    ];

    it("A113. a drag from alpha to 22 selects the six cells; Backspace deletes those rows, or clears a rectangle narrower than the table; Clear cells empties it; Delete cells only for a full-width or full-height rectangle", async () => {
      const rows = undoable(DOC);
      drag(rows.view, 3, 8);
      expect(selectedTexts(rows.view)).toEqual(["alpha", "bold note", "1", "beta", "", "22"]);
      expect(widget(rows.view)?.dataset.selected).toBe("cells:1:0:2:2");
      // The anchor is active with the caret after its text.
      expect(active(rows.view)).toEqual([1, 0, "alpha"]);
      expect(childCaret(rows.view)).toBe(5);
      await press(rows.view, "Backspace");
      expect(rows.text.toString()).toBe(table(HEADER, DELIMITER, GAMMA));
      expect(active(rows.view)).toEqual([1, 0, "gamma"]);
      expect(selectedTexts(rows.view)).toEqual([]);
      rows.undoManager.undo();
      expect(rows.text.toString()).toBe(DOC);

      // Two cells of one column: Backspace clears them and keeps the rows and the rectangle.
      const column = undoable(DOC);
      drag(column.view, 4, 7);
      expect(selectedTexts(column.view)).toEqual(["bold note", ""]);
      await press(column.view, "Delete");
      expect(column.text.toString()).toBe(
        table(HEADER, DELIMITER, "| alpha |  | 1 |", BETA, GAMMA),
      );
      expect(active(column.view)).toEqual([1, 1, ""]);
      expect(widget(column.view)?.dataset.selected).toBe("cells:1:1:2:1");
      column.undoManager.undo();
      expect(column.text.toString()).toBe(DOC);

      // Clear cells from the command and from the menu.
      const clear = undoable(DOC);
      drag(clear.view, 3, 4);
      expect(clearCells(clear.view)).toBe(true);
      expect(clear.text.toString()).toBe(table(HEADER, DELIMITER, "|  |  | 1 |", BETA, GAMMA));
      expect(active(clear.view)).toEqual([1, 0, ""]);
      expect(selectedTexts(clear.view)).toEqual(["", ""]);
      clear.undoManager.undo();
      expect(clear.text.toString()).toBe(DOC);
      drag(clear.view, 9, 10);
      rightClick(cells(clear.view)[10]);
      choose(clear.view, "Clear cells");
      expect(clear.text.toString()).toBe(table(HEADER, DELIMITER, ALPHA, BETA, "|  |  | 3 |"));

      // Delete cells: offered for a full-width or full-height rectangle only.
      expect(rectMenu(rows.view, 0)).not.toContain("Delete cells");
      drag(rows.view, 3, 8);
      expect(rectMenu(rows.view, 5)).toEqual(RECT_MENU);
      drag(rows.view, 4, 7);
      expect(rectMenu(rows.view, 4)).toEqual(without(RECT_MENU, "Delete cells"));
      expect(deleteCells(rows.view)).toBe(false);
      expect(rows.text.toString()).toBe(DOC);

      // Every row, header included, deletes the columns; the cell now in the anchor's place is active.
      const columns = undoable(DOC);
      drag(columns.view, 1, 10);
      expect(rectMenu(columns.view, 4)).toEqual(RECT_MENU);
      expect(deleteCells(columns.view)).toBe(true);
      expect(columns.text.toString()).toBe(
        table(
          "| Name | Count |",
          "| --- | --: |",
          "| alpha | 1 |",
          "| beta | 22 |",
          "| gamma | 3 |",
        ),
      );
      expect(active(columns.view)).toEqual([0, 1, "Count"]);
      columns.undoManager.undo();
      expect(columns.text.toString()).toBe(DOC);

      // Full-width rows with the header: the first row left becomes the header.
      const top = withActive(DOC, 0);
      drag(top, 0, 5);
      expect(deleteCells(top)).toBe(true);
      expect(top.state.doc.toString()).toBe(table(BETA, DELIMITER, GAMMA));
      expect(active(top)).toEqual([0, 0, "beta"]);
    });

    it("A114. the rectangle's menu, and its cells on the clipboard as text and as Markdown", () => {
      const view = mount(DOC, { focused: true, selection: [DOC.length] });
      drag(view, 3, 8);
      expect(rectMenu(view, 4)).toEqual(RECT_MENU);

      // Copy from the menu writes both types in a `copy` event. happy-dom has no
      // `execCommand`: the stand-in fires the event as the browser does.
      const written: [string, string][] = [];
      const record = (event: Event) => {
        const data = (event as ClipboardEvent).clipboardData;
        if (!data) return;
        const set = data.setData.bind(data);
        data.setData = (type: string, value: string) => {
          written.push([type, value]);
          set(type, value);
        };
      };
      const execCommand = document.execCommand;
      document.execCommand = (command: string) =>
        command === "copy" &&
        !document.dispatchEvent(
          new ClipboardEvent("copy", {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer(),
          }),
        );
      window.addEventListener("copy", record, true);
      try {
        rightClick(cells(view)[4]);
        choose(view, "Copy");
      } finally {
        window.removeEventListener("copy", record, true);
        document.execCommand = execCommand;
      }
      expect(written).toEqual([
        ["text/plain", "alpha\t**bold** note\t1\nbeta\t\t22"],
        ["text/markdown", `${ALPHA}\n${BETA}`],
      ]);
      expect(view.state.doc.toString()).toBe(DOC);
      expect(widget(view)?.dataset.selected).toBe("cells:1:0:2:2");

      const selection = view.state.field(tableSelection);
      expect(selection?.kind).toBe("cells");
      const tableFrom = selection?.tableFrom ?? -1;
      expect(
        cellsToClipboard(view.state, tableFrom, { top: 1, left: 0, bottom: 2, right: 2 }),
      ).toEqual({
        text: "alpha\t**bold** note\t1\nbeta\t\t22",
        markdown: `${ALPHA}\n${BETA}`,
      });
      // With the header, the fragment is a table of its own: a delimiter row follows it.
      expect(
        cellsToClipboard(view.state, tableFrom, { top: 0, left: 1, bottom: 1, right: 2 }),
      ).toEqual({
        text: "Note\tCount\n**bold** note\t1",
        markdown: "| Note | Count |\n| --- | --: |\n| **bold** note | 1 |",
      });
    });

    it("parses clipboard text as tab-separated rows, else as Markdown table rows, else a cell per line", () => {
      expect(parseClipboardCells("a\tb\nc\td\n")).toEqual([
        ["a", "b"],
        ["c", "d"],
      ]);
      expect(parseClipboardCells("a\t\t22")).toEqual([["a", "", "22"]]);
      expect(parseClipboardCells("| x | y\\|z |\n| --- | :-: |\n| 1 | 2 |")).toEqual([
        ["x", "y\\|z"],
        ["1", "2"],
      ]);
      expect(parseClipboardCells("p | q\r\nr | s")).toEqual([
        ["p", "q"],
        ["r", "s"],
      ]);
      expect(parseClipboardCells("one\ntwo")).toEqual([["one"], ["two"]]);
      // A pipe after two backslashes is a pipe: the backslashes escape each other.
      expect(parseClipboardCells("a \\\\| b")).toEqual([["a \\\\", "b"]]);
      expect(parseClipboardCells("a \\| b")).toEqual([["a \\| b"]]);
    });

    it("pastes over a rectangle row by row, escaping pipes, dropping extra values and keeping cells past them, in one undo step", () => {
      const { view, text, undoManager } = undoable(DOC);
      drag(view, 3, 7);
      const spec = pasteIntoCells(view.state, [["p", "q|r", "dropped"], ["s"], ["dropped"]]);
      expect(spec).not.toBeNull();
      if (spec) view.dispatch(spec);
      expect(text.toString()).toBe(
        table(HEADER, DELIMITER, "| p | q\\|r | 1 |", "| s |  | 22 |", GAMMA),
      );
      expect(active(view)).toEqual([1, 0, "p"]);
      expect(widget(view)?.dataset.selected).toBe("cells:1:0:2:1");
      undoManager.undo();
      expect(text.toString()).toBe(DOC);
      // Nothing selected, nothing pasted.
      const plain = withActive(DOC, 3);
      expect(pasteIntoCells(plain.state, [["x"]])).toBeNull();
    });

    it("a cell emptied at an open end of a row without outer pipes keeps its pipe, cleared or pasted", () => {
      const open = "A | B\n--- | ---\nx | y\n\nafter";
      const firsts = "| | B\n--- | ---\n| | y\n\nafter";
      const cleared = mount(open, { focused: true, selection: [open.length] });
      drag(cleared, 0, 2);
      expect(clearCells(cleared)).toBe(true);
      expect(cleared.state.doc.toString()).toBe(firsts);
      expect(parsedShape(cleared)).toEqual({ columns: 2, rows: [2, 2] });
      expect(cells(cleared)[3]?.textContent).toBe("y");
      expect(active(cleared)).toEqual([0, 0, ""]);

      const pasted = mount(open, { focused: true, selection: [open.length] });
      drag(pasted, 0, 2);
      const spec = pasteIntoCells(pasted.state, [[""], [""]]);
      if (spec) pasted.dispatch(spec);
      expect(pasted.state.doc.toString()).toBe(firsts);

      const lasts = mount(open, { focused: true, selection: [open.length] });
      drag(lasts, 1, 3);
      expect(clearCells(lasts)).toBe(true);
      expect(lasts.state.doc.toString()).toBe("A | |\n--- | ---\nx | |\n\nafter");
      expect(parsedShape(lasts)).toEqual({ columns: 2, rows: [2, 2] });
      expect(cells(lasts)[2]?.textContent).toBe("x");
    });

    it("pasting into a short row's absent cells writes them", () => {
      const short = "| a | b | c |\n| - | - | - |\n| x |\n| z | w | v |\n\nafter";
      const view = mount(short, { focused: true, selection: [short.length] });
      drag(view, 3, 5);
      const spec = pasteIntoCells(view.state, [["p", "q", "r"]]);
      if (spec) view.dispatch(spec);
      expect(view.state.doc.toString()).toBe(
        "| a | b | c |\n| - | - | - |\n| p | q | r |\n| z | w | v |\n\nafter",
      );
      // Only the second absent cell gets text: the first is written empty before it.
      const gap = mount(short, { focused: true, selection: [short.length] });
      drag(gap, 3, 5);
      const second = pasteIntoCells(gap.state, [["x", "", "r"]]);
      if (second) gap.dispatch(second);
      expect(gap.state.doc.toString()).toBe(
        "| a | b | c |\n| - | - | - |\n| x |  | r |\n| z | w | v |\n\nafter",
      );
    });

    it("a drag that starts in the active cell's editor ends that editor's own mouse selection", () => {
      const view = mount(DOC, { focused: true, selection: [DOC.length] });
      click(cells(view)[3]);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      const editor = child(view);
      if (!editor) throw new Error("no cell editor");
      const gesture = () =>
        (editor as unknown as { inputState: { mouseSelection: unknown } }).inputState
          .mouseSelection;
      editor.contentDOM.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 }),
      );
      expect(gesture()).not.toBeNull();
      cells(view)[8]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(gesture()).toBeNull();
      expect(widget(view)?.dataset.selected).toBe("cells:1:0:2:2");
      const caret = () => {
        const { main } = editor.state.selection;
        return [main.anchor, main.head];
      };
      expect(caret()).toEqual([5, 5]);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      // After the release, moving over other cells changes nothing.
      cells(view)[10]?.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: 5, clientY: 5 }),
      );
      cells(view)[10]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(caret()).toEqual([5, 5]);
      expect(widget(view)?.dataset.selected).toBe("cells:1:0:2:2");
      expect(view.state.doc.toString()).toBe(DOC);
    });

    it("aligns every column of a rectangle in one undo step, keeping it selected", () => {
      const { view, text, undoManager } = undoable(DOC);
      drag(view, 3, 7);
      expect(alignColumnCenter(view)).toBe(true);
      expect(text.toString()).toBe(table(HEADER, "| :-: | :-: | --: |", ALPHA, BETA, GAMMA));
      expect(widget(view)?.dataset.selected).toBe("cells:1:0:2:1");
      expect(active(view)).toEqual([1, 0, "alpha"]);
      undoManager.undo();
      expect(text.toString()).toBe(DOC);
      // From the menu too.
      drag(view, 3, 7);
      rightClick(cells(view)[4]);
      choose(view, "Align right");
      expect(text.toString()).toBe(table(HEADER, "| --: | --: | --: |", ALPHA, BETA, GAMMA));
    });

    it("typing goes to the anchor and collapses the rectangle; Escape collapses it; Cmd-A stays in the cell; a press that never leaves its cell is a click", async () => {
      const view = mount(DOC, { focused: true, selection: [DOC.length] });
      drag(view, 3, 8);
      const editor = child(view);
      editor?.dispatch({ ...editor.state.replaceSelection("x"), userEvent: "input.type" });
      expect(view.state.doc.toString()).toBe(DOC.replace("| alpha |", "| alphax |"));
      expect(selectedTexts(view)).toEqual([]);

      drag(view, 3, 8);
      await press(view, "Escape");
      expect(selectedTexts(view)).toEqual([]);
      expect(active(view)).toEqual([1, 0, "alphax"]);

      drag(view, 3, 8);
      const mac = /Mac/.test(navigator.platform);
      await press(view, "a", { metaKey: mac, ctrlKey: !mac });
      const selected = child(view)?.state.selection.main;
      expect([selected?.from, selected?.to]).toEqual([0, 6]);
      expect(view.state.selection.main.empty).toBe(true);

      // No crossing: a click, no rectangle.
      drag(view, 9, 9);
      expect(selectedTexts(view)).toEqual([]);
      expect(active(view)).toEqual([3, 0, "gamma"]);
    });
  });

  it.todo(
    "A98. the menu appears at the pointer, stays within the viewport near the window's edges, and is readable in both colour schemes (browser)",
  );
});
