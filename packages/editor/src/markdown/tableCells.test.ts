import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { documentIndex } from "./documentIndex.ts";
import { rowCells, tableRows } from "./table.ts";
import { activeCell, activeLocation } from "./tableCells.ts";
import { caret, destroyViews, mount, select, sourceText, texts } from "./testSupport.ts";

afterEach(destroyViews);

// Browsers queue `selectionchange` as a task. happy-dom fires it synchronously, inside the
// update of whichever editor just wrote a DOM selection, which a focused child editor
// does; that editor would then re-enter its own update. These tests drive selections
// through transactions, so the event is dropped here.
const dispatchEvent = document.dispatchEvent.bind(document);
beforeAll(() => {
  document.dispatchEvent = (event) => event.type === "selectionchange" || dispatchEvent(event);
});
afterAll(() => {
  document.dispatchEvent = dispatchEvent;
});

/** The outer editor's own lines, not those of a nested cell editor. */
const lines = (view: EditorView) => [
  ...view.contentDOM.querySelectorAll<HTMLElement>(":scope > .cm-line"),
];

const mac = /Mac/.test(navigator.platform);

const widget = (view: EditorView) =>
  view.contentDOM.querySelector<HTMLElement>(".cm-md-table-widget");

/** The active cell's child editor, if any. */
function child(view: EditorView) {
  const element = view.contentDOM.querySelector<HTMLElement>(".cm-md-cell-editor");
  return element ? EditorView.findFromDOM(element) : null;
}

const childText = (view: EditorView) => child(view)?.state.doc.toString() ?? null;

function cells(view: EditorView) {
  return [...(widget(view)?.querySelectorAll<HTMLElement>("th, td") ?? [])];
}

function click(element: Element | undefined) {
  element?.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
  );
}

/** Presses a key such as `Shift-Tab` or `Mod-z` through a view's keymaps. */
function press(view: EditorView, binding: string) {
  const parts = binding.split("-");
  const key = parts.pop() ?? "";
  const mod = parts.includes("Mod");
  const event = new KeyboardEvent("keydown", {
    key,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
    shiftKey: parts.includes("Shift"),
    metaKey: mod && mac,
    ctrlKey: mod && !mac,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, "editor");
}

/**
 * Presses a key in the active cell's editor. Cell navigation dispatches to the outer editor
 * once the key handler has returned, so the press settles after a microtask.
 */
async function key(view: EditorView, binding: string) {
  const editor = child(view);
  if (!editor) throw new Error(`no active cell for ${binding}`);
  press(editor, binding);
  await Promise.resolve();
}

/** Moves the outer caret without a user event, as a programmatic jump would. */
function jump(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos } });
}

/** Types into a child editor as the keyboard would. */
function type(view: EditorView | null, text: string) {
  view?.dispatch({ ...view.state.replaceSelection(text), userEvent: "input.type" });
}

const TABLE = "| Name | Note |\n| --- | --- |\n| cell | x |";

/** A focused editor bound to a Yjs text, with a remote peer's text to edit it through. */
function collaborative(doc: string) {
  const REMOTE = Symbol("remote");
  const local = new Y.Doc();
  const remote = new Y.Doc();
  local.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(remote, update, REMOTE);
  });
  remote.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(local, update, REMOTE);
  });
  const text = local.getText("note");
  text.insert(0, doc);
  const view = mount(doc, {
    focused: true,
    selection: [doc.length],
    extensions: yCollab(text, new Awareness(local)),
  });
  return { view, peer: remote.getText("note") };
}

/** The source text of each cell of the table's `row`th row, as the parser splits them. */
function rowSource(view: EditorView, row: number) {
  const table = documentIndex(view.state).tables[0]?.node;
  const node = table ? tableRows(table)[row] : undefined;
  return node
    ? rowCells(view.state, node).map((cell) => view.state.sliceDoc(cell.from, cell.to))
    : [];
}

describe("in-place cell editing", () => {
  it("A79. clicking a body cell activates it in place; typing edits the outer cell text and the table stays rendered", () => {
    const doc = `${TABLE}\n\nafter`;
    const view = mount(doc, { focused: true, selection: [doc.length] });
    click(cells(view)[2]);
    expect(widget(view)).not.toBeNull();
    expect(childText(view)).toBe("cell");
    expect(view.state.selection.ranges).toHaveLength(1);
    expect(view.state.selection.main.empty).toBe(true);
    expect(caret(view)).toBe(doc.indexOf("cell"));

    const editor = child(view);
    type(editor, "s");
    expect(view.state.doc.toString()).toBe(doc.replace("| cell |", "| cells |"));
    expect(widget(view)).not.toBeNull();
    expect(child(view)).toBe(editor);
    expect(childText(view)).toBe("cells");
    expect(lines(view).map((element) => sourceText(element))).toEqual(["", "after"]);
  });

  it("A80. in the active cell `**bold** cell`, a caret inside `bold` reveals `**`; the neighbouring cell stays static", () => {
    const doc = "| a | b |\n| - | - |\n| **bold** cell | x |\n\nafter";
    const view = mount(doc, { focused: true, selection: [doc.length] });
    click(cells(view)[2]);
    const editor = child(view);
    expect(editor?.state.doc.toString()).toBe("**bold** cell");
    editor?.dispatch({ selection: { anchor: 4 } });
    expect(editor ? texts(editor, ".cm-md-syntax") : []).toEqual(["**", "**"]);
    editor?.dispatch({ selection: { anchor: 13 } });
    expect(editor ? texts(editor, ".cm-md-syntax") : []).toEqual([]);
    const neighbour = cells(view)[3];
    expect(neighbour?.querySelector(".cm-editor")).toBeNull();
    expect(neighbour?.textContent).toBe("x");
  });

  it("A81. Tab, Shift-Tab, and Enter move between cells; Enter in the last row appends a row and enters it", async () => {
    const doc = "| h1 | h2 |\n| - | - |\n| a | b |\n| c | d |\n\nafter";
    const view = mount(doc, { focused: true, selection: [doc.length] });
    click(cells(view)[0]);
    expect(childText(view)).toBe("h1");
    await key(view, "Tab");
    expect(childText(view)).toBe("h2");
    await key(view, "Tab");
    expect(childText(view)).toBe("a");
    await key(view, "Shift-Tab");
    expect(childText(view)).toBe("h2");
    await key(view, "Tab");
    await key(view, "Enter");
    expect(childText(view)).toBe("c");
    expect(widget(view)?.querySelector(".cm-md-cell-active")).toBe(cells(view)[4]);

    await key(view, "Enter");
    expect(view.state.doc.toString()).toBe(doc.replace("| c | d |", "| c | d |\n|   |   |"));
    expect(childText(view)).toBe("");
    expect(widget(view)?.querySelector(".cm-md-cell-active")).toBe(cells(view)[6]);
    type(child(view), "e");
    expect(view.state.doc.toString()).toBe(doc.replace("| c | d |", "| c | d |\n| e  |   |"));
  });

  it("A82. Escape destroys the child editor, puts the outer caret after the table, and the table stays rendered", async () => {
    const doc = `${TABLE}\n\nafter`;
    const view = mount(doc, { focused: true, selection: [doc.length] });
    click(cells(view)[2]);
    await key(view, "Escape");
    expect(child(view)).toBeNull();
    expect(view.state.field(activeCell)).toBeNull();
    expect(caret(view)).toBe(TABLE.length + 1);
    expect(widget(view)).not.toBeNull();
    expect(cells(view)[2]?.textContent).toBe("cell");
  });

  it("A83. arrows enter the table from above and below, move across cells, and leave at its edges", async () => {
    const doc = `above\n\n${TABLE}\n\nbelow`;
    const tableFrom = doc.indexOf("|");
    const tableTo = tableFrom + TABLE.length;
    const view = mount(doc, { focused: true, selection: [6] });
    // ArrowDown from the line above lands on the widget's edge (CodeMirror's vertical motion).
    view.dispatch({ selection: { anchor: tableFrom }, userEvent: "select" });
    expect(childText(view)).toBe("Name");
    expect(caret(view)).toBe(doc.indexOf("Name"));

    // ArrowUp from a first-row cell leaves to the line above.
    await key(view, "ArrowUp");
    expect(child(view)).toBeNull();
    expect(caret(view)).toBe(6);

    // ArrowUp from the line below lands on the widget's end: the last cell.
    jump(view, tableTo + 1);
    view.dispatch({ selection: { anchor: tableTo }, userEvent: "select" });
    expect(childText(view)).toBe("x");

    // ArrowLeft at the start of `x` goes to the previous cell, at its end.
    child(view)?.dispatch({ selection: { anchor: 0 } });
    await key(view, "ArrowLeft");
    expect(childText(view)).toBe("cell");
    expect(child(view)?.state.selection.main.head).toBe(4);
    // ArrowRight at the end of `cell` goes to the next cell, at its start.
    await key(view, "ArrowRight");
    expect(childText(view)).toBe("x");
    expect(child(view)?.state.selection.main.head).toBe(0);

    // ArrowDown from a last-row cell leaves to the line below.
    await key(view, "ArrowDown");
    expect(child(view)).toBeNull();
    expect(caret(view)).toBe(tableTo + 1);

    // ArrowRight at the end of the line above, and ArrowLeft at the start of the line below.
    jump(view, 6);
    press(view, "ArrowRight");
    expect(childText(view)).toBe("Name");
    await key(view, "Escape");
    jump(view, tableTo + 1);
    press(view, "ArrowLeft");
    expect(childText(view)).toBe("x");
    expect(widget(view)).not.toBeNull();
  });

  it("A84. typing `|` in a cell inserts `\\|` in the source and the rendered cell shows `|`", async () => {
    const doc = `${TABLE}\n\nafter`;
    const view = mount(doc, { focused: true, selection: [doc.length] });
    click(cells(view)[2]);
    type(child(view), "|");
    expect(view.state.doc.toString()).toBe(doc.replace("| cell |", "| cell\\| |"));
    expect(childText(view)).toBe("cell\\|");
    await key(view, "Escape");
    expect(cells(view)[2]?.textContent).toBe("cell|");
    expect(cells(view)).toHaveLength(4);
  });

  it("A85. a remote insertion at the cell's start reaches the child with its caret on the same character; one elsewhere does not touch it", () => {
    const REMOTE = Symbol("remote");
    const local = new Y.Doc();
    const remote = new Y.Doc();
    local.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(remote, update, REMOTE);
    });
    remote.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(local, update, REMOTE);
    });
    const text = local.getText("note");
    const doc = "| a | b |\n| - | - |\n| c | d |\n\nafter";
    text.insert(0, doc);
    const view = mount(doc, {
      focused: true,
      selection: [doc.length],
      extensions: yCollab(text, new Awareness(local)),
    });
    click(view.contentDOM.querySelectorAll("td")[0]);
    const editor = child(view);
    editor?.focus();
    expect(editor?.state.doc.toString()).toBe("c");
    expect(editor?.state.selection.main.head).toBe(1);

    remote.getText("note").insert(doc.indexOf("c"), "x");
    expect(view.state.doc.toString()).toBe(doc.replace("| c |", "| xc |"));
    expect(child(view)).toBe(editor);
    expect(editor?.state.doc.toString()).toBe("xc");
    expect(editor?.state.selection.main.head).toBe(2);
    expect(editor?.hasFocus).toBe(true);

    const before = editor?.state;
    remote.getText("note").insert(remote.getText("note").length, "!");
    expect(view.state.doc.toString().endsWith("after!")).toBe(true);
    expect(child(view)).toBe(editor);
    expect(editor?.state).toBe(before);
  });

  it("A86. Mod-A in a cell selects the cell's text only, and again does not extend to the note", async () => {
    const doc = `${TABLE}\n\nafter`;
    const view = mount(doc, { focused: true, selection: [doc.length] });
    click(cells(view)[2]);
    const outer = view.state.selection;
    for (let i = 0; i < 2; i++) {
      await key(view, "Mod-a");
      const range = child(view)?.state.selection.main;
      expect([range?.from, range?.to]).toEqual([0, 4]);
      expect(view.state.selection.eq(outer)).toBe(true);
      expect(childText(view)).toBe("cell");
    }
  });

  it("A87. an outer selection covering the table shows the source rows; collapsing it restores the widget with no active cell", () => {
    const doc = `before\n\n${TABLE}\n\nafter`;
    const view = mount(doc, { focused: true, selection: [0] });
    click(cells(view)[2]);
    expect(child(view)).not.toBeNull();
    view.dispatch({ selection: { anchor: 0, head: doc.length }, userEvent: "select" });
    expect(widget(view)).toBeNull();
    expect(view.state.field(activeCell)).toBeNull();
    expect(lines(view).map((element) => sourceText(element))).toContain("| cell | x |");
    select(view, 0);
    expect(widget(view)).not.toBeNull();
    expect(child(view)).toBeNull();
    expect(view.state.field(activeCell)).toBeNull();
  });

  it("A88. only the active cell holds a nested editor; activating another moves it; leaving removes it", async () => {
    const doc = `${TABLE}\n\nafter`;
    const view = mount(doc, { focused: true, selection: [doc.length] });
    const editors = () => [...(widget(view)?.querySelectorAll(".cm-editor") ?? [])];
    expect(editors()).toHaveLength(0);
    click(cells(view)[2]);
    expect(editors()).toHaveLength(1);
    expect(cells(view)[2]?.contains(editors()[0] ?? null)).toBe(true);
    click(cells(view)[1]);
    expect(editors()).toHaveLength(1);
    expect(cells(view)[1]?.contains(editors()[0] ?? null)).toBe(true);
    expect(cells(view)[2]?.textContent).toBe("cell");
    await key(view, "Escape");
    expect(editors()).toHaveLength(0);
  });

  it("A89. the outer editor's undo reverts a cell edit; the table stays rendered and the child shows the reverted text", async () => {
    const ydoc = new Y.Doc();
    const text = ydoc.getText("note");
    const doc = `${TABLE}\n\nafter`;
    text.insert(0, doc);
    const undoManager = new Y.UndoManager(text);
    const view = mount(doc, {
      focused: true,
      selection: [doc.length],
      extensions: [
        yCollab(text, new Awareness(ydoc), { undoManager }),
        keymap.of(yUndoManagerKeymap),
      ],
    });
    click(cells(view)[2]);
    type(child(view), "s");
    expect(text.toString()).toBe(doc.replace("| cell |", "| cells |"));
    await key(view, "Mod-z");
    expect(text.toString()).toBe(doc);
    expect(view.state.doc.toString()).toBe(doc);
    expect(widget(view)).not.toBeNull();
    expect(childText(view)).toBe("cell");
  });

  it("keeps the active cell's caret and focus when a peer's new row redraws the table", () => {
    const REMOTE = Symbol("remote");
    const local = new Y.Doc();
    const remote = new Y.Doc();
    local.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(remote, update, REMOTE);
    });
    remote.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(local, update, REMOTE);
    });
    const text = local.getText("note");
    const doc = `${TABLE}\n\nafter`;
    text.insert(0, doc);
    const view = mount(doc, {
      focused: true,
      selection: [doc.length],
      extensions: yCollab(text, new Awareness(local)),
    });
    click(cells(view)[2]);
    child(view)?.dispatch({ selection: { anchor: 2 } });
    remote.getText("note").insert(TABLE.length, "\n| y | z |");
    expect(cells(view)).toHaveLength(6);
    expect(childText(view)).toBe("cell");
    expect(child(view)?.state.selection.main.head).toBe(2);
    expect(child(view)?.hasFocus).toBe(true);
  });

  it("keeps the same logical cell active, with its caret and focus, when a peer inserts a row above it", () => {
    const { view, peer } = collaborative(`${TABLE}\n\nafter`);
    click(cells(view)[2]);
    const editor = child(view);
    editor?.dispatch({ selection: { anchor: 2 } });
    editor?.focus();
    peer.insert(TABLE.indexOf("| cell"), "| y | z |\n");
    expect(cells(view)).toHaveLength(6);
    expect(widget(view)?.querySelector(".cm-md-cell-active")).toBe(cells(view)[4]);
    expect(childText(view)).toBe("cell");
    expect(child(view)?.state.selection.main.head).toBe(2);
    expect(child(view)?.hasFocus).toBe(true);
  });

  it("leaves a collapsed caret after `\\|` typed over a select-all, and after multi-line text pasted over a selection", () => {
    const doc = `${TABLE}\n\nafter`;
    const view = mount(doc, { focused: true, selection: [doc.length] });
    click(cells(view)[2]);
    press(child(view) ?? view, "Mod-a");
    type(child(view), "|");
    expect(childText(view)).toBe("\\|");
    expect(child(view)?.state.selection.ranges.map((range) => [range.from, range.to])).toEqual([
      [2, 2],
    ]);
    type(child(view), "x");
    expect(childText(view)).toBe("\\|x");

    press(child(view) ?? view, "Mod-a");
    const editor = child(view);
    editor?.dispatch({ ...editor.state.replaceSelection("a\nb|c"), userEvent: "input.paste" });
    expect(childText(view)).toBe("a b\\|c");
    expect(child(view)?.state.selection.ranges.map((range) => [range.from, range.to])).toEqual([
      [6, 6],
    ]);
    expect(view.state.doc.toString()).toBe(doc.replace("| cell |", "| a b\\|c |"));
  });

  it("escapes a typed pipe unless an odd run of backslashes already escapes it", () => {
    for (const count of [0, 1, 2, 3, 4]) {
      const doc = `${TABLE}\n\nafter`;
      const view = mount(doc, { focused: true, selection: [doc.length] });
      click(cells(view)[2]);
      for (let i = 0; i < count; i++) type(child(view), "\\");
      type(child(view), "|");
      const expected = `cell${"\\".repeat(count)}${count % 2 === 0 ? "\\|" : "|"}`;
      expect(childText(view), `${count} backslashes`).toBe(expected);
      expect(rowSource(view, 1), `${count} backslashes`).toEqual([expected, "x"]);
    }
  });

  it("keeps the child to its own cell when a peer turns the cell's text into two cells", () => {
    const { view, peer } = collaborative(`${TABLE}\n\nafter`);
    click(cells(view)[2]);
    const from = TABLE.indexOf("cell");
    peer.delete(from, 4);
    peer.insert(from, "a | b");
    expect(rowSource(view, 1)).toEqual(["a", "b", "x"]);
    expect(childText(view)).toBe("a");
    type(child(view), "z");
    expect(rowSource(view, 1)).toEqual(["az", "b", "x"]);
    expect(view.state.doc.toString()).toContain("| az | b | x |");
  });

  it("Escape without a line after the table goes to the line before it, or adds a line when the table is the note", async () => {
    const before = mount(`before\n\n${TABLE}`, { focused: true, selection: [0] });
    click(cells(before)[2]);
    await key(before, "Escape");
    expect(child(before)).toBeNull();
    expect(before.state.field(activeCell)).toBeNull();
    expect(caret(before)).toBe("before\n".length);
    expect(before.hasFocus).toBe(true);
    expect(widget(before)).not.toBeNull();

    // Every caret of a note that is only a table sits on the table, so start unfocused.
    const alone = mount(TABLE);
    click(cells(alone)[2]);
    await key(alone, "Escape");
    expect(child(alone)).toBeNull();
    expect(alone.state.doc.toString()).toBe(`${TABLE}\n`);
    expect(caret(alone)).toBe(TABLE.length + 1);
    expect(alone.hasFocus).toBe(true);
    expect(widget(alone)).not.toBeNull();
  });

  it("enters a cell a short row leaves out by writing it, from a click or from Tab", async () => {
    const doc = "| a | b |\n| - | - |\n| c |\n\nafter";
    const clicked = mount(doc, { focused: true, selection: [doc.length] });
    expect(cells(clicked)).toHaveLength(4);
    click(cells(clicked)[3]);
    expect(childText(clicked)).toBe("");
    type(child(clicked), "x");
    expect(clicked.state.doc.toString()).toBe(doc.replace("| c |", "| c | x |"));

    const tabbed = mount(doc, { focused: true, selection: [doc.length] });
    click(cells(tabbed)[2]);
    expect(childText(tabbed)).toBe("c");
    await key(tabbed, "Tab");
    expect(widget(tabbed)?.querySelector(".cm-md-cell-active")).toBe(cells(tabbed)[3]);
    type(child(tabbed), "x");
    expect(tabbed.state.doc.toString()).toBe(doc.replace("| c |", "| c | x |"));
  });

  it("replays the walk: Enter in the last row, type `new`, Escape leaves the table rendered and the cell inactive", async () => {
    const table = "| Column | Other |\n| ------ | ----- |\n| cell | **bold** cell |";
    const doc = `${table}\n\n$$\nx\n$$\n`;
    const view = mount(doc, { focused: true, selection: [doc.length] });
    click(cells(view)[2]);
    await key(view, "Enter");
    expect(activeLocation(view.state)).not.toBeNull();
    expect(childText(view)).toBe("");
    for (const char of "new") type(child(view), char);
    expect(activeLocation(view.state)).not.toBeNull();
    expect(childText(view)).toBe("new");
    await key(view, "Escape");
    const grown = `${table}\n| new  |   |`;
    expect(view.state.doc.toString()).toBe(doc.replace(table, grown));
    expect(view.state.field(activeCell)).toBeNull();
    expect(widget(view)?.querySelectorAll(".cm-editor")).toHaveLength(0);
    expect(cells(view)[4]?.textContent).toBe("new");
    expect(caret(view)).toBe(grown.length + 1);
    expect(view.hasFocus).toBe(true);
  });

  // Needs a browser, so not tested here: A90. the caret is visible inside the active cell and a
  // click on a character positions it there
});
