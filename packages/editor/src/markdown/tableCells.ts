import { defaultKeymap } from "@codemirror/commands";
import {
  Annotation,
  ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  Facet,
  MapMode,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type ChangeSpec,
  type Extension,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  runScopeHandlers,
  ViewPlugin,
  WidgetType,
  type KeyBinding,
  type ViewUpdate,
} from "@codemirror/view";
import { previewConfig } from "./config.ts";
import { documentIndex, type IndexedTable } from "./documentIndex.ts";
import { katexLoaded } from "./math.ts";
import { markFocused } from "./reveal.ts";
import { alignments, renderCell, rowCells, tableRows, widgetLines, type Cell } from "./table.ts";
import type { LinkSource } from "./decorate/links.ts";
import { openExternal, opensLink } from "./widgets.ts";

// In-place table editing (section 4.11). The table stays a widget while it is edited: the
// active cell hosts a child editor whose document is that cell's source text. Child edits
// replace the cell's range in the outer document, and outer edits inside the range (a
// remote peer, an undo) are mirrored into the child, so Yjs and undo see ordinary edits.

interface ActiveCell {
  /** Where the active cell's text starts in the outer document. */
  cellFrom: number;
  /** Where the child editor's caret starts when it is created. */
  caret: number;
  /**
   * Fresh for every activation, so a cell activated anew is told apart from the same cell
   * redrawn (whose editor keeps its caret and focus), even at the same position.
   */
  token: number;
  /**
   * The cell's place in the grid, kept current; when an edit replaces the cell's whole
   * line (an undone row move, say), the cell is found again by these.
   */
  row: number;
  column: number;
  /** Where the cell's table's widget starts, so another table never takes the cell over. */
  tableFrom: number;
}

/** The effect that makes a cell the active one; create it with `activateCellAt`. */
export const activateCell = StateEffect.define<ActiveCell>({
  map: (value, mapping) => ({ ...value, cellFrom: mapping.mapPos(value.cellFrom, -1) }),
});

let activations = 0;

/** Activates the cell whose text starts at `cellFrom`, with the child caret at `caret`. */
export const activateCellAt = (cellFrom: number, caret: number) =>
  activateCell.of({
    cellFrom,
    caret,
    token: ++activations,
    row: -1,
    column: -1,
    tableFrom: -1,
  });

/** Leaves the active cell; its child editor is destroyed and the cell renders statically. */
export const deactivateCell = StateEffect.define<null>();

/** Tags an outer transaction that applies an edit made in the active cell's editor. */
const fromCell = Annotation.define<true>();

/** Tags a child transaction that mirrors an outer change. */
const fromOuter = Annotation.define<true>();

/** A cell of the table grid. A short row's missing cells are padded in as virtual cells. */
export interface GridCell extends Cell {
  /** For a cell the row leaves out: where its ` |` segments are written when it is entered. */
  missing: { rowTo: number; closed: boolean; index: number } | null;
}

interface Grid {
  table: IndexedTable;
  /** The lines the table's widget replaces. */
  lines: { from: number; to: number };
  /** Every row has the table's column count: cells past it are dropped, missing ones padded. */
  rows: GridCell[][];
}

/** The cells of a table drawn as a widget, by row and column. */
function tableGrid(state: EditorState, table: IndexedTable): Grid | null {
  const lines = widgetLines(state, table.node);
  if (!lines) return null;
  const columns = alignments(state, table.node).length;
  const rows = tableRows(table.node).map((row) => {
    const cells: GridCell[] = rowCells(state, row)
      .slice(0, columns)
      .map((cell) => ({ ...cell, missing: null }));
    const last = row.lastChild;
    const closed = last?.name === "TableDelimiter";
    const rowTo = closed && last ? last.to : row.to;
    for (let index = 0; cells.length < columns; index++) {
      cells.push({
        from: rowTo,
        to: rowTo,
        start: rowTo,
        end: rowTo,
        node: null,
        missing: { rowTo, closed, index },
      });
    }
    return cells;
  });
  return { table, lines, rows };
}

export interface CellLocation extends Grid {
  row: number;
  column: number;
  cell: GridCell;
}

/** The cell, in a table drawn as a widget, whose slot between pipes holds `pos`. */
export function locateCell(state: EditorState, pos: number): CellLocation | null {
  const table = documentIndex(state).tables.find(({ node }) => node.from <= pos && pos <= node.to);
  const grid = table ? tableGrid(state, table) : null;
  if (!grid) return null;
  for (const [row, cells] of grid.rows.entries()) {
    for (const [column, cell] of cells.entries()) {
      if (!cell.missing && cell.start <= pos && pos <= cell.end)
        return { ...grid, row, column, cell };
    }
  }
  return null;
}

/** Whether the table `location` found is another table than the one starting at `own`. */
function replaced(tr: Transaction, own: number, location: CellLocation) {
  const before = tr.startState;
  return documentIndex(before).tables.some(({ node }) => {
    const start = widgetLines(before, node)?.from;
    return (
      start !== undefined && start !== own && tr.changes.mapPos(start, 1) === location.lines.from
    );
  });
}

/**
 * The active cell, mapped through changes. It is cleared when its table is deleted or
 * reparsed away, and when a selection other than a caret inside its table is made in the
 * outer editor, so a click elsewhere or a select-all leaves the cell.
 */
/** The cell at `row` and `column` of the table whose widget starts at `start`. */
export function cellAt(state: EditorState, start: number, row: number, column: number) {
  const table = documentIndex(state).tables.find(
    ({ node }) => widgetLines(state, node)?.from === start,
  );
  const grid = table ? tableGrid(state, table) : null;
  const cell = grid?.rows[row]?.[column];
  return grid && cell ? { ...grid, row, column, cell } : null;
}

/**
 * Finds the active cell again by its grid place after an edit replaced its line: in the
 * table holding `pos`, the row whose line holds `pos` (else the stored row), and the
 * stored column, each clamped to what the table has.
 */
function relocate(state: EditorState, pos: number, value: ActiveCell): CellLocation | null {
  const table = documentIndex(state).tables.find(({ node }) => {
    const lines = widgetLines(state, node);
    return lines !== null && lines.from <= pos && pos <= lines.to;
  });
  const grid = table ? tableGrid(state, table) : null;
  if (!table || !grid || grid.rows.length === 0) return null;
  const rowNodes = tableRows(table.node);
  let row = rowNodes.findIndex((node) => {
    const line = state.doc.lineAt(node.from);
    return line.from <= pos && pos <= line.to;
  });
  if (row < 0) row = Math.min(Math.max(value.row, 0), grid.rows.length - 1);
  const cells = (grid.rows[row] ?? []).filter((cell) => !cell.missing);
  const column = Math.min(Math.max(value.column, 0), cells.length - 1);
  const cell = cells[column];
  return cell ? { ...grid, row, column, cell } : null;
}

/**
 * The active cell, mapped through changes. Cleared when its table goes or when the outer editor gets
 * any selection but a caret inside the table (a click elsewhere, select-all). A caret set in another
 * cell with no user event (an undo restoring selection) moves it; the browser's own selection reads
 * carry a `select` event and never do.
 */
export const activeCell = StateField.define<ActiveCell | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    // Set when the edit deleted the text around the cell's start (an undone row or column,
    // a replaced line): the cell is then found again by its grid place.
    let lost = false;
    if (value && tr.docChanged) {
      // The table's start moves with the table: an insertion right at it goes before it.
      const tableFrom = tr.changes.mapPos(value.tableFrom, 1);
      const kept = tr.changes.mapPos(value.cellFrom, -1, MapMode.TrackDel);
      lost = kept === null;
      next = { ...value, tableFrom, cellFrom: kept ?? tr.changes.mapPos(value.cellFrom, -1) };
    }
    let activated = false;
    let effects = false;
    for (const effect of tr.effects) {
      if (effect.is(activateCell)) {
        next = effect.value;
        activated = true;
        effects = true;
      } else if (effect.is(deactivateCell)) {
        next = null;
        effects = true;
      }
    }
    if (!next || (!tr.docChanged && !activated && !tr.selection)) return next;
    let location = lost && !activated ? null : locateCell(tr.state, next.cellFrom);
    let moved = false;
    if (!location && !activated) {
      location = relocate(tr.state, next.cellFrom, next);
      moved = true;
    }
    if (!location) return null;
    // Only the active cell's own table keeps it: when the table found now is another table
    // moved into the place (its own table deleted), the cell is gone.
    if (value && tr.docChanged && !activated && replaced(tr, value.tableFrom, location))
      return null;
    if (tr.selection && !activated) {
      const { node } = location.table;
      const { ranges, main } = tr.selection;
      const parked = ranges.every(
        (range) => range.empty && node.from <= range.head && range.head <= node.to,
      );
      if (ranges.length > 1 || !parked) return null;
      const quiet =
        !tr.docChanged && !effects && tr.annotation(Transaction.userEvent) === undefined;
      const there = quiet ? locateCell(tr.state, main.head) : null;
      if (
        there &&
        there.table.node.from === node.from &&
        there.cell.start < main.head &&
        main.head < there.cell.end &&
        there.cell.from !== location.cell.from
      ) {
        location = there;
        moved = true;
      }
    }
    const { row, column, cell, lines } = location;
    return {
      ...next,
      cellFrom: moved ? cell.from : next.cellFrom,
      row,
      column,
      tableFrom: lines.from,
    };
  },
});

const locations = new WeakMap<EditorState, CellLocation | null>();

/** Where the active cell sits in the table grid, cached per state. */
export function activeLocation(state: EditorState) {
  const value = state.field(activeCell, false);
  if (!value) return null;
  let location = locations.get(state);
  if (location === undefined) {
    location = locateCell(state, value.cellFrom);
    locations.set(state, location);
  }
  return location;
}

/** The active cell of `table` for its widget, or null when another cell or none is active. */
export function activeSpot(state: EditorState, table: IndexedTable) {
  const value = state.field(activeCell, false);
  const location = activeLocation(state);
  if (!value || location?.table.node.from !== table.node.from) return null;
  const { row, column, cell } = location;
  return {
    row,
    column,
    from: value.cellFrom,
    to: Math.max(value.cellFrom, cell.to),
    caret: value.caret,
    token: value.token,
  };
}

type ActiveSpot = NonNullable<ReturnType<typeof activeSpot>>;

/**
 * Activates a cell, with the outer caret parked at its text start. A cell its short row
 * leaves out is first written, as ` |` segments at the row's end, in the same transaction.
 */
function activation(cell: GridCell, caret: number): TransactionSpec {
  const written = cell.missing ? writeMissing(cell.missing) : null;
  if (!written) {
    return {
      selection: EditorSelection.cursor(cell.from),
      effects: activateCellAt(cell.from, caret),
    };
  }
  const cellFrom = written.from + written.cellOffset;
  return {
    changes: { from: written.from, insert: written.insert },
    selection: EditorSelection.cursor(cellFrom),
    effects: activateCellAt(cellFrom, 0),
    userEvent: "input",
  };
}

/**
 * The text that writes a short row's missing cells up to and including `index`, at the
 * row's end: ` |` to close an unclosed row, then `  |` per cell. `cellOffset` is where the
 * last written cell's text starts within it.
 */
export function writeMissing({ rowTo, closed, index }: NonNullable<GridCell["missing"]>) {
  const insert = `${closed ? "" : " |"}${"  |".repeat(index + 1)}`;
  return { from: rowTo, insert, cellOffset: insert.length - 2 };
}

/**
 * Leaves the active cell for an outer caret at `pos` (after inserting `insert` there, when
 * given) and focuses the outer editor.
 */
function leaveTable(outer: EditorView, pos: number, insert = "") {
  outer.dispatch({
    ...(insert ? { changes: { from: pos, insert } } : {}),
    selection: EditorSelection.cursor(pos + insert.length),
    effects: deactivateCell.of(null),
    scrollIntoView: true,
    userEvent: "select",
  });
  outer.focus();
}

/** The child editor's base extensions, supplied by the live preview that composes this. */
const cellEditorSetup = Facet.define<Extension, Extension>({
  combine: (values) => values[0] ?? [],
});

/**
 * A modal layer (Vim) that cell editors run too, so modes match the outer editor. `idle` (normal
 * mode, nothing pending) says a key keeps its cell meaning: Escape leaves, `j`/`k` at the edge change
 * rows. `start` runs once the child has the layer (`from` is the cell editor it replaces, if any);
 * `stop` runs before the child loses it or closes.
 */
export interface CellModalLayer {
  extension: Extension;
  idle(child: EditorView): boolean;
  start?(child: EditorView, outer: EditorView, from: EditorView | null): void;
  stop?(child: EditorView, outer: EditorView): void;
}

/** Supplied by a modal layer on the outer editor; cell editors take it on as they open. */
export const cellModalLayer = Facet.define<CellModalLayer, CellModalLayer | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * Keys a cell keeps ahead of its modal layer. With a row, column or rectangle selected, Backspace,
 * Delete and Escape run the cell's bindings in any mode. In an idle cell Escape leaves and `j`/`k`
 * change rows; in other modes the layer has them (Escape returns to normal mode).
 */
function modalCellKeys(cell: CellEditor, layer: CellModalLayer): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.ctrlKey || event.metaKey || event.altKey) return false;
        if (
          (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape") &&
          cell.outer.state.field(tableSelection, false) &&
          runScopeHandlers(view, event, "editor")
        ) {
          event.preventDefault();
          return true;
        }
        if (!layer.idle(view)) return false;
        const handled =
          event.key === "Escape"
            ? cell.escape()
            : event.key === "j"
              ? cell.vertical(1, false)
              : event.key === "k"
                ? cell.vertical(-1, false)
                : false;
        if (handled) event.preventDefault();
        return handled;
      },
    }),
  );
}

/** Where a right-clicked cell sits: its table's widget start, row, and column. */
export interface CellTarget {
  start: number;
  row: number;
  column: number;
  /** Set when the right-click was on a row's or column's handle: the menu is then flat. */
  handle?: LineKind;
  /** Set when the right-click was inside a selected rectangle: the rectangle's menu. */
  rect?: boolean;
}

/** Opens the cell menu for a right-click on a rendered cell; supplied by the live preview. */
export const cellMenu = Facet.define<
  (view: EditorView, target: CellTarget, event: MouseEvent) => void,
  ((view: EditorView, target: CellTarget, event: MouseEvent) => void) | null
>({ combine: (values) => values[0] ?? null });

/** Which add bar was clicked: the bottom one (a row) or the right one (a column). */
export type AddBar = "row" | "column";

/** Runs an add bar's command on the table whose widget starts at `start`; supplied by the live preview. */
export const tableAddBar = Facet.define<
  (view: EditorView, start: number, bar: AddBar) => void,
  ((view: EditorView, start: number, bar: AddBar) => void) | null
>({ combine: (values) => values[0] ?? null });

/** A row or a column, as a handle and a selection name them. */
export type LineKind = "row" | "column";

/**
 * Moves a row or column from its handle's drag: `from` to `to` in the table whose widget
 * starts at `start`; supplied by the live preview.
 */
export const tableMove = Facet.define<
  (view: EditorView, start: number, kind: LineKind, from: number, to: number) => void,
  ((view: EditorView, start: number, kind: LineKind, from: number, to: number) => void) | null
>({ combine: (values) => values[0] ?? null });

/**
 * Backspace or Delete with a rectangle selected: deletes its rows when it spans every
 * column, else clears its cells; supplied by the live preview.
 */
export const tableCellsDelete = Facet.define<
  (view: EditorView) => void,
  ((view: EditorView) => void) | null
>({ combine: (values) => values[0] ?? null });

/** A whole row or column selected from its handle, in the table starting at `tableFrom`. */
export interface LineSelection {
  tableFrom: number;
  kind: LineKind;
  index: number;
}

/** A rectangle of cells, by its grid bounds (inclusive), header row allowed. */
export interface CellRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** A rectangle of cells dragged out across a table starting at `tableFrom`. */
export interface CellsSelection extends CellRect {
  tableFrom: number;
  kind: "cells";
}

export type TableSelection = LineSelection | CellsSelection;

/**
 * Selects a row, a column (with its first cell activated alongside), or a rectangle of
 * cells (its anchor active), or clears the selection.
 */
export const selectLine = StateEffect.define<TableSelection | null>({
  map: (value, mapping) => value && { ...value, tableFrom: mapping.mapPos(value.tableFrom, 1) },
});

/**
 * The row, column, or rectangle selected in a table. Any document change (typing
 * included), any other activation, and leaving the cell collapse it to the active cell; a
 * command that keeps it says so with its own `selectLine`.
 */
export const tableSelection = StateField.define<TableSelection | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(selectLine)) return effect.value;
    if (!value || tr.docChanged || !tr.state.field(activeCell, false)) return null;
    const moved = tr.effects.some((effect) => effect.is(activateCell) || effect.is(deactivateCell));
    return moved ? null : value;
  },
});

/** A selection's cells as grid bounds, in a table of `rows` rows and `columns` columns. */
function selectionRect(selection: TableSelection, rows: number, columns: number): CellRect {
  if (selection.kind === "cells") {
    const { top, left, bottom, right } = selection;
    return { top, left, bottom, right };
  }
  return selection.kind === "row"
    ? { top: selection.index, left: 0, bottom: selection.index, right: columns - 1 }
    : { top: 0, left: selection.index, bottom: rows - 1, right: selection.index };
}

/** What a table widget draws for its selection: a key that tells selections apart, and its cells. */
export interface SelectedCells extends CellRect {
  key: string;
}

/** The selected cells of `table`, if the selection is in it. */
export function selectedIn(state: EditorState, table: IndexedTable): SelectedCells | null {
  const selection = state.field(tableSelection, false);
  if (!selection || selection.tableFrom !== widgetLines(state, table.node)?.from) return null;
  const rect = selectionRect(
    selection,
    tableRows(table.node).length,
    alignments(state, table.node).length,
  );
  const key =
    selection.kind === "cells"
      ? `cells:${rect.top}:${rect.left}:${rect.bottom}:${rect.right}`
      : `${selection.kind}:${selection.index}`;
  return { key, ...rect };
}

/**
 * The selected cells and their table's grid, when a row, column, or rectangle is
 * selected: what the cell commands act on.
 */
export function selectedCells(state: EditorState) {
  const selection = state.field(tableSelection, false);
  const grid = selection ? cellAt(state, selection.tableFrom, 0, 0) : null;
  if (!selection || !grid) return null;
  const columns = alignments(state, grid.table.node).length;
  return {
    selection,
    grid,
    rect: selectionRect(selection, grid.rows.length, columns),
    columns,
  };
}

/** The effect that selects rectangle `rect` of the table whose widget starts at `tableFrom`. */
const selectCells = (tableFrom: number, rect: CellRect) =>
  selectLine.of({
    tableFrom,
    kind: "cells",
    top: rect.top,
    left: rect.left,
    bottom: rect.bottom,
    right: rect.right,
  });

/**
 * The transaction that selects row or column `index` of the table whose widget starts at
 * `start` and activates its first cell (the header's, for a column), caret after its text.
 */
function lineSelection(
  state: EditorState,
  start: number,
  kind: LineKind,
  index: number,
): TransactionSpec | null {
  const location = kind === "row" ? cellAt(state, start, index, 0) : cellAt(state, start, 0, index);
  if (!location || location.cell.missing) return null;
  const { cell, lines } = location;
  return {
    selection: EditorSelection.cursor(cell.from),
    effects: [
      activateCellAt(cell.from, cell.to - cell.from),
      selectLine.of({ tableFrom: lines.from, kind, index }),
    ],
  };
}

/**
 * `spec` with the row or column holding the cell it leaves active selected, in the same
 * transaction: a command run from a handle keeps its line selected where the line lands.
 */
export function keepLineSelected(
  state: EditorState,
  spec: TransactionSpec,
  kind: LineKind,
): TransactionSpec {
  const active = state.update(spec).state.field(activeCell, false);
  if (!active) return spec;
  const effects = spec.effects === undefined ? [] : [spec.effects].flat();
  const index = kind === "row" ? active.row : active.column;
  return {
    ...spec,
    effects: [...effects, selectLine.of({ tableFrom: active.tableFrom, kind, index })],
  };
}

const controllers = new WeakMap<EditorView, CellEditor>();

/** The child editor's caret when the cell whose text starts at `cellFrom` is active, else 0. */
export function activeCaret(view: EditorView, cellFrom: number) {
  const editor = controllers.get(view);
  const active = view.state.field(activeCell, false);
  return editor && active?.cellFrom === cellFrom ? editor.child.state.selection.main.head : 0;
}

/**
 * Typed pipes are escaped and line breaks become spaces: a cell is one line of text. A pipe
 * already escaped by an odd run of backslashes before it is left as typed.
 */
const cellInput = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(fromOuter)) return tr;
  let altered = false;
  const changes: ChangeSpec[] = [];
  const difference: ChangeSpec[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    let backslashes = 0;
    while (
      fromA - backslashes > 0 &&
      tr.startState.sliceDoc(fromA - backslashes - 1, fromA - backslashes) === "\\"
    )
      backslashes++;
    let insert = "";
    for (const char of inserted.toString().replace(/\r\n?|\n/g, " ")) {
      if (char === "|" && backslashes % 2 === 0) insert += "\\";
      insert += char;
      backslashes = char === "\\" ? backslashes + 1 : 0;
    }
    if (insert !== inserted.toString()) altered = true;
    changes.push({ from: fromA, to: toA, insert });
    difference.push({ from: fromB, to: toB, insert });
  });
  if (!altered) return tr;
  const userEvent = tr.annotation(Transaction.userEvent);
  return {
    changes: tr.startState.changes(changes),
    // The transaction's own selection, carried from its text into the rewritten text.
    selection: tr.newSelection.map(ChangeSet.of(difference, tr.newDoc.length), 1),
    scrollIntoView: tr.scrollIntoView,
    ...(userEvent === undefined ? {} : { userEvent }),
  };
});

const isUndoKey = (event: KeyboardEvent) =>
  (event.metaKey || event.ctrlKey) && !event.altKey && /^[yz]$/i.test(event.key);

/** The keys a cell handles itself, above the child's default keymap. */
function cellBindings(cell: CellEditor): readonly KeyBinding[] {
  const caret = (view: EditorView) => {
    const { main } = view.state.selection;
    return main.empty ? main.head : -1;
  };
  return [
    { key: "Tab", run: () => cell.step(1, false), shift: () => cell.step(-1, false) },
    { key: "Enter", run: () => cell.vertical(1, true) },
    { key: "Escape", run: () => cell.escape() },
    { key: "Backspace", run: () => cell.deleteCells() },
    { key: "Delete", run: () => cell.deleteCells() },
    {
      key: "ArrowRight",
      run: (view) => caret(view) === view.state.doc.length && cell.step(1, true),
    },
    { key: "ArrowLeft", run: (view) => caret(view) === 0 && cell.step(-1, true) },
    { key: "ArrowUp", run: () => cell.vertical(-1, false) },
    { key: "ArrowDown", run: () => cell.vertical(1, false) },
    {
      key: "Mod-a",
      run: (view) => {
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        return true;
      },
    },
    {
      // Undo belongs to the host's outer keymap (the Yjs undo manager, say).
      any: (_view, event) => {
        if (!isUndoKey(event)) return false;
        runScopeHandlers(cell.outer, event, "editor");
        return true;
      },
    },
  ];
}

/** The child editor of the active cell and its link to the outer document. */
class CellEditor {
  readonly child: EditorView;
  /** Where the cell's text starts in the outer document, kept current by `syncFromOuter`. */
  from: number;
  /** The outer document the child mirrors. */
  private synced: Text;
  /** Set when this editor replaces a focused one, so the outer update focuses it. */
  pendingFocus = false;
  /** The activation this editor belongs to. */
  readonly token: number;
  private destroyed = false;
  /** The outer editor's modal layer as this editor runs it, in its own compartment. */
  private modal: CellModalLayer | null;
  private readonly modalSlot = new Compartment();

  constructor(
    readonly outer: EditorView,
    parent: HTMLElement,
    readonly row: number,
    readonly column: number,
    spot: ActiveSpot,
  ) {
    this.from = spot.from;
    this.synced = outer.state.doc;
    const doc = outer.state.sliceDoc(spot.from, spot.to);
    // A redrawn table (a row added by a peer, an undo that found the cell again) replaces
    // the editor of the same activation; the new one keeps its caret and focus. A fresh
    // activation starts at its own caret.
    const previous = controllers.get(outer);
    const same = previous !== undefined && previous.token === spot.token;
    this.token = spot.token;
    const caret = same ? previous.child.state.selection.main.head : spot.caret;
    this.pendingFocus = same && previous.child.hasFocus;
    this.modal = outer.state.facet(cellModalLayer);
    this.child = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(Math.min(caret, doc.length)),
        extensions: [
          outer.state.facet(cellEditorSetup),
          EditorView.editorAttributes.of({ class: "cm-md-cell-editor" }),
          EditorState.readOnly.of(outer.state.readOnly),
          EditorView.editable.of(outer.state.facet(EditorView.editable)),
          this.modalSlot.of(this.modalExtension(this.modal)),
          Prec.highest(keymap.of(cellBindings(this))),
          keymap.of(defaultKeymap),
          cellInput,
          EditorView.updateListener.of((update) => this.forward(update)),
        ],
      }),
    });
    this.child.dispatch({ effects: markFocused() });
    this.modal?.start?.(this.child, outer, previous && !previous.destroyed ? previous.child : null);
    controllers.set(outer, this);
  }

  focus() {
    this.child.focus();
  }

  private modalExtension(modal: CellModalLayer | null): Extension {
    return modal ? [modalCellKeys(this, modal), Prec.high(modal.extension)] : [];
  }

  /** Follows the outer editor's modal layer when it changes (Vim switched on or off). */
  setModal(modal: CellModalLayer | null) {
    if (modal === this.modal) return;
    this.modal?.stop?.(this.child, this.outer);
    this.modal = modal;
    this.child.dispatch({ effects: this.modalSlot.reconfigure(this.modalExtension(modal)) });
    modal?.start?.(this.child, this.outer, null);
  }

  destroy() {
    this.modal?.stop?.(this.child, this.outer);
    this.destroyed = true;
    if (controllers.get(this.outer) === this) controllers.delete(this.outer);
    this.child.destroy();
  }

  /** Puts the child caret under a click, when the child has been laid out. */
  placeAt(x: number, y: number) {
    const rect = this.child.contentDOM.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    this.child.dispatch({ selection: { anchor: this.child.posAtCoords({ x, y }, false) } });
  }

  /**
   * Runs an outer update after the child's key handler has returned. The update may
   * destroy this editor, which must not happen while one of its handlers is on the stack.
   */
  private later(update: () => void) {
    queueMicrotask(() => {
      if (!this.destroyed) update();
    });
  }

  /** Child → outer: the child's changes, shifted to the cell's range, as one transaction. */
  private forward(update: ViewUpdate) {
    if (!update.docChanged || update.transactions.every((tr) => tr.annotation(fromOuter))) return;
    const changes: ChangeSpec[] = [];
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes.push({ from: this.from + fromA, to: this.from + toA, insert: inserted.toString() });
    });
    const userEvent = update.transactions
      .map((tr) => tr.annotation(Transaction.userEvent))
      .find((event) => event !== undefined);
    this.outer.dispatch({
      changes,
      annotations: fromCell.of(true),
      ...(userEvent === undefined ? {} : { userEvent }),
    });
  }

  /**
   * Outer → child, before the outer view redraws: outer changes inside the cell's range are
   * applied to the child, with its caret mapped so it stays on the same character. The
   * cell's own edits only move the bookkeeping along. A change that alters the table's
   * structure (a pipe typed by a peer) leaves the child holding the located cell only.
   */
  syncFromOuter(update: ViewUpdate) {
    if (this.synced === update.state.doc) return;
    if (this.synced !== update.startState.doc) {
      this.resync(update.state);
      return;
    }
    const start = this.from;
    const end = start + this.child.state.doc.length;
    this.from = update.changes.mapPos(start, -1);
    this.synced = update.state.doc;
    if (update.transactions.some((tr) => tr.annotation(fromCell))) return;
    const changes: ChangeSpec[] = [];
    let straddles = false;
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (fromA >= start && toA <= end)
        changes.push({ from: fromA - start, to: toA - start, insert: inserted.toString() });
      else if (fromA < end && toA > start) straddles = true;
    });
    if (straddles) {
      this.resync(update.state);
      return;
    }
    if (changes.length === 0) return;
    const set = this.child.state.changes(changes);
    this.child.dispatch({
      changes: set,
      selection: this.child.state.selection.map(set, 1),
      annotations: fromOuter.of(true),
    });
    const location = locateCell(update.state, this.from);
    const to = this.from + this.child.state.doc.length;
    if (!location || this.from < location.cell.start || to > location.cell.end)
      this.resync(update.state);
  }

  /** Replaces the child's text with the located cell's source, keeping the caret offset. */
  private resync(state: EditorState) {
    this.synced = state.doc;
    const location = locateCell(state, this.from);
    if (!location) return;
    const { cell } = location;
    this.from = cell.from;
    const text = state.sliceDoc(cell.from, cell.to);
    const current = this.child.state;
    if (current.doc.toString() === text) return;
    this.child.dispatch({
      changes: { from: 0, to: current.doc.length, insert: text },
      selection: EditorSelection.cursor(Math.min(current.selection.main.head, text.length)),
      annotations: fromOuter.of(true),
    });
  }

  private location() {
    return locateCell(this.outer.state, this.from);
  }

  /** Activates another cell, once this editor's key handler has returned. */
  private moveTo(cell: GridCell, caret: number) {
    const spec = activation(cell, caret);
    this.later(() => this.outer.dispatch(spec));
  }

  /**
   * Tab and Shift-Tab (`leaves` false) stop at the table's ends; ArrowRight at a cell's end
   * and ArrowLeft at its start (`leaves` true) leave the table there.
   */
  step(delta: 1 | -1, leaves: boolean) {
    const location = this.location();
    if (!location) return false;
    const cells = location.rows.flat();
    const target = cells[cells.indexOf(location.cell) + delta];
    if (target) this.moveTo(target, delta > 0 && leaves ? 0 : target.to - target.from);
    else if (leaves) this.leave(delta, location);
    return true;
  }

  /** ArrowUp / ArrowDown / Enter: the cell above or below in the same column. */
  vertical(delta: 1 | -1, enter: boolean) {
    const location = this.location();
    if (!location) return false;
    const target = location.rows[location.row + delta]?.[location.column];
    if (target) {
      const head = this.child.state.selection.main.head;
      this.moveTo(target, Math.min(head, target.to - target.from));
    } else if (enter) {
      this.appendRow(location);
    } else {
      this.leave(delta, location);
    }
    return true;
  }

  /** Enter in the last row: a new empty row with the table's column count, first cell active. */
  private appendRow({ table, lines }: CellLocation) {
    const columns = alignments(this.outer.state, table.node).length;
    const cellFrom = lines.to + 3;
    const spec: TransactionSpec = {
      changes: { from: lines.to, insert: `\n|${"   |".repeat(columns)}` },
      selection: EditorSelection.cursor(cellFrom),
      effects: activateCellAt(cellFrom, 0),
      userEvent: "input",
      scrollIntoView: true,
    };
    this.later(() => this.outer.dispatch(spec));
  }

  /** Leaves to the end of the line above or the start of the line below, when there is one. */
  private leave(delta: 1 | -1, { lines }: CellLocation) {
    const { doc } = this.outer.state;
    if (delta < 0 && lines.from > 0) this.later(() => leaveTable(this.outer, lines.from - 1));
    else if (delta > 0 && lines.to < doc.length)
      this.later(() => leaveTable(this.outer, lines.to + 1));
  }

  /** Backspace or Delete with a rectangle selected acts on the rectangle, not the text. */
  deleteCells() {
    const run = this.outer.state.facet(tableCellsDelete);
    if (this.outer.state.field(tableSelection, false)?.kind !== "cells" || !run) return false;
    this.later(() => run(this.outer));
    return true;
  }

  /**
   * Escape: the outer caret goes to the line after the table, else to the end of the line
   * before it; a table that is the whole document gets a trailing line to hold the caret.
   * The table stays rendered.
   */
  escape() {
    // A selected row, column, or rectangle collapses to the active cell first.
    if (this.outer.state.field(tableSelection, false)) {
      this.later(() => this.outer.dispatch({ effects: selectLine.of(null) }));
      return true;
    }
    const location = this.location();
    if (!location) return false;
    const { lines } = location;
    const { doc } = this.outer.state;
    if (lines.to < doc.length) this.later(() => leaveTable(this.outer, lines.to + 1));
    else if (lines.from > 0) this.later(() => leaveTable(this.outer, lines.from - 1));
    else this.later(() => leaveTable(this.outer, doc.length, "\n"));
    return true;
  }
}

/**
 * Keyboard motion that arrives at a table widget from the line above (ArrowDown, or
 * ArrowRight at that line's end) activates the first cell; from the line below (ArrowUp,
 * or ArrowLeft at that line's start), the last cell.
 */
const enterFromOutside = EditorState.transactionFilter.of((tr) => {
  if (
    !tr.selection ||
    tr.docChanged ||
    !tr.isUserEvent("select") ||
    tr.isUserEvent("select.pointer")
  )
    return tr;
  const before = tr.startState;
  const range = tr.selection.main;
  const old = before.selection.main;
  if (before.field(activeCell, false) || tr.selection.ranges.length > 1 || !range.empty) return tr;
  if (before.selection.ranges.length > 1 || !old.empty) return tr;
  const { doc } = before;
  const oldLine = doc.lineAt(old.head).number;
  const { head } = range;
  for (const table of documentIndex(before).tables) {
    const grid = tableGrid(before, table);
    if (!grid) continue;
    const { lines, rows } = grid;
    // Vertical motion lands on the widget's edge or just past it; nothing further counts.
    const first = rows[0]?.[0];
    const last = rows.at(-1)?.at(-1);
    if (
      first &&
      oldLine === doc.lineAt(lines.from).number - 1 &&
      head >= lines.from &&
      head <= lines.to + 1
    )
      return { ...activation(first, 0), scrollIntoView: true };
    if (
      last &&
      oldLine === doc.lineAt(lines.to).number + 1 &&
      head <= lines.to &&
      head >= lines.from - 1
    )
      return { ...activation(last, last.to - last.from), scrollIntoView: true };
  }
  return tr;
});

/** Mirrors outer edits into the child before the outer view redraws its table. */
const cellSync = ViewPlugin.define(() => ({
  update(update: ViewUpdate) {
    if (update.docChanged) controllers.get(update.view)?.syncFromOuter(update);
    const modal = update.state.facet(cellModalLayer);
    if (modal !== update.startState.facet(cellModalLayer)) {
      controllers.get(update.view)?.setModal(modal);
    }
  },
}));

/** After an outer update that activated a cell, or redrew a focused one, focus its editor. */
const cellFocus = EditorView.updateListener.of((update) => {
  const cell = controllers.get(update.view);
  if (!cell) return;
  const activated = update.transactions.some((tr) =>
    tr.effects.some((effect) => effect.is(activateCell)),
  );
  if (activated || cell.pendingFocus) {
    cell.pendingFocus = false;
    cell.focus();
  }
});

/** In-place cell editing for the outer editor; `setup` is the child editors' base. */
export function tableCellEditing(setup: Extension): Extension {
  return [
    activeCell,
    tableSelection,
    enterFromOutside,
    cellSync,
    cellFocus,
    cellEditorSetup.of(setup),
  ];
}

const ADD_BARS: readonly (readonly [AddBar, string, string])[] = [
  ["row", "cm-md-table-add-row", "Add row below"],
  ["column", "cm-md-table-add-column", "Add column to the right"],
];

/**
 * The hover add bars along a table widget's bottom and right edges, in the padding the
 * wrapper reserves for them, so they shift nothing when they show (CSS shows them on
 * hover). A click runs the bar's command; a right-click does nothing.
 */
function syncAddBars(wrapper: HTMLElement, view: EditorView, show: boolean) {
  // The reserved space goes with the bars, so a read-only table keeps its plain geometry.
  wrapper.classList.toggle("cm-md-table-with-bars", show);
  const existing = wrapper.querySelectorAll(":scope > .cm-md-table-add");
  if (show === existing.length > 0) return;
  for (const bar of existing) bar.remove();
  if (!show) return;
  for (const [kind, className, label] of ADD_BARS) {
    const bar = document.createElement("div");
    bar.className = `cm-md-table-add ${className}`;
    bar.setAttribute("role", "button");
    bar.setAttribute("aria-label", label);
    bar.title = label;
    bar.tabIndex = -1;
    bar.addEventListener("mousedown", (event) => {
      // Neither the outer caret nor focus moves; the command activates the new cell.
      event.preventDefault();
      if (event.button === 0) view.state.facet(tableAddBar)?.(view, view.posAtDOM(wrapper), kind);
    });
    bar.addEventListener("contextmenu", (event) => event.preventDefault());
    wrapper.append(bar);
  }
}

/** The handle gutters' per-table state: the observer that re-measures on resize. */
const observers = new WeakMap<HTMLElement, ResizeObserver>();

/** A table's grip or cell drag in progress, by its cancel. */
const drags = new WeakMap<HTMLElement, () => void>();

/** The cells each table widget draws as selected, for its outline. */
const selections = new WeakMap<HTMLElement, CellRect>();

/**
 * The row and column handles: one grip per row in the left gutter and one per column in
 * the top gutter, each always present as its own hit area and drawn only while the
 * pointer rests on it (CSS), plus the outline of a selected row or column and a drop
 * indicator while dragging. Positions come from the table's measured rows and columns.
 */
function syncHandles(
  wrapper: HTMLElement,
  view: EditorView,
  show: boolean,
  rows: number,
  columns: number,
) {
  const existing = wrapper.querySelectorAll(
    ":scope > .cm-md-table-grip, :scope > .cm-md-table-selection",
  );
  const count = (kind: LineKind) =>
    wrapper.querySelectorAll(`:scope > .cm-md-table-grip-${kind}`).length;
  if (show && count("row") === rows && count("column") === columns) {
    layoutHandles(view, wrapper);
    return;
  }
  // A drag's grip is about to go, and its index may name another line now.
  drags.get(wrapper)?.();
  for (const element of existing) element.remove();
  observers.get(wrapper)?.disconnect();
  observers.delete(wrapper);
  if (!show) return;
  for (const [kind, total, label] of [
    ["row", rows, "Row handle"],
    ["column", columns, "Column handle"],
  ] as const) {
    for (let index = 0; index < total; index++) {
      const grip = document.createElement("div");
      grip.className = `cm-md-table-grip cm-md-table-grip-${kind}`;
      grip.dataset.index = String(index);
      grip.setAttribute("role", "button");
      grip.setAttribute("aria-label", label);
      grip.title = label;
      grip.tabIndex = -1;
      grip.addEventListener("mousedown", (event) => {
        // Neither the outer caret nor focus moves; a right-click is the menu's.
        event.preventDefault();
        event.stopPropagation();
      });
      grip.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.stopPropagation();
        startGripDrag(view, wrapper, grip, kind, index, event);
      });
      grip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = view.state.facet(cellMenu);
        const start = view.posAtDOM(wrapper);
        const spec = lineSelection(view.state, start, kind, index);
        if (!open || !spec) return;
        view.dispatch(spec);
        const row = kind === "row" ? index : 0;
        const column = kind === "column" ? index : 0;
        open(view, { start, row, column, handle: kind }, event);
      });
      wrapper.append(grip);
    }
  }
  const outline = document.createElement("div");
  outline.className = "cm-md-table-selection";
  outline.setAttribute("aria-hidden", "true");
  wrapper.append(outline);
  if (typeof ResizeObserver !== "undefined") {
    // The table resizing moves rows and columns; the scroller resizing moves the clip.
    const observer = new ResizeObserver(() => layoutHandles(view, wrapper));
    for (const element of wrapper.querySelectorAll(".cm-md-table-scroll, .cm-md-table"))
      observer.observe(element);
    observers.set(wrapper, observer);
  }
  layoutHandles(view, wrapper);
}

/** Rectangles relative to the wrapper's padding box. */
function relative(rect: DOMRect, base: DOMRect) {
  return {
    left: rect.left - base.left,
    top: rect.top - base.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * The part of the span from `start` to `end` that shows between `from` and `to` (a wide
 * table's scroller), or null when less than a few pixels of it shows.
 */
export function clipSpan(start: number, end: number, from: number, to: number) {
  const left = Math.max(start, from);
  const right = Math.min(end, to);
  return right - left < 4 ? null : { left, width: right - left };
}

/** Positions the grips beside their rows and above their columns, and the selection outline. */
function layoutHandles(view: EditorView, wrapper: HTMLElement) {
  view.requestMeasure({
    key: wrapper,
    read: () => {
      const base = wrapper.getBoundingClientRect();
      const scroller = wrapper.querySelector(".cm-md-table-scroll")?.getBoundingClientRect();
      const rows = [...wrapper.querySelectorAll(".cm-md-table tr")].map((row) =>
        relative(row.getBoundingClientRect(), base),
      );
      const columns = [...wrapper.querySelectorAll(".cm-md-table thead th")].map((cell) =>
        relative(cell.getBoundingClientRect(), base),
      );
      return { rows, columns, scroller: scroller ? relative(scroller, base) : null };
    },
    write: ({ rows, columns, scroller }) => {
      // Horizontally, a grip or an outline shows only over the scroller's visible part.
      const visible = (box: { left: number; width: number }) =>
        scroller
          ? clipSpan(box.left, box.left + box.width, scroller.left, scroller.left + scroller.width)
          : { left: box.left, width: box.width };
      for (const grip of wrapper.querySelectorAll<HTMLElement>(":scope > .cm-md-table-grip-row")) {
        const row = rows[Number(grip.dataset.index)];
        if (!row) continue;
        grip.style.top = `${row.top}px`;
        grip.style.height = `${row.height}px`;
      }
      for (const grip of wrapper.querySelectorAll<HTMLElement>(
        ":scope > .cm-md-table-grip-column",
      )) {
        const column = columns[Number(grip.dataset.index)];
        if (!column) continue;
        const span = visible(column);
        grip.hidden = !span;
        if (!span) continue;
        grip.style.left = `${span.left}px`;
        grip.style.width = `${span.width}px`;
      }
      const outline = wrapper.querySelector<HTMLElement>(":scope > .cm-md-table-selection");
      // The selected cells' bounding box: their rows' extent by their columns' extent.
      const selected = selections.get(wrapper);
      const top = selected && rows[selected.top];
      const bottom = selected && rows[selected.bottom];
      const left = selected && columns[selected.left];
      const right = selected && columns[selected.right];
      const box =
        top && bottom && left && right
          ? {
              top: top.top,
              height: bottom.top + bottom.height - top.top,
              left: left.left,
              width: right.left + right.width - left.left,
            }
          : undefined;
      const span = box && visible(box);
      if (!outline) return;
      outline.hidden = !box || !span;
      if (!box || !span) return;
      outline.style.left = `${span.left}px`;
      outline.style.top = `${box.top}px`;
      outline.style.width = `${span.width}px`;
      outline.style.height = `${box.height}px`;
    },
  });
}

/**
 * A grip pressed: a click selects its row or column; a drag shows a drop indicator between body rows
 * (never above the header) or columns and moves it there in one transaction on release. The grip
 * captures the pointer so a release outside the window still lands; Escape, pointercancel, blur or the
 * widget going away cancel. The header row's grip does not drag.
 */
function startGripDrag(
  view: EditorView,
  wrapper: HTMLElement,
  grip: HTMLElement,
  kind: LineKind,
  index: number,
  down: PointerEvent,
) {
  drags.get(wrapper)?.();
  const draggable = kind === "column" || index > 0;
  const indicator = document.createElement("div");
  indicator.className = `cm-md-table-drop cm-md-table-drop-${kind}`;
  let dragging = false;
  let target = index;
  const place = (event: MouseEvent) => {
    const base = wrapper.getBoundingClientRect();
    const table = wrapper.querySelector(".cm-md-table")?.getBoundingClientRect();
    if (!table) return;
    if (kind === "row") {
      const rows = [...wrapper.querySelectorAll(".cm-md-table tbody tr")].map((row) =>
        row.getBoundingClientRect(),
      );
      // The gap before body row `gap` (1-based), or after the last one.
      let gap = rows.findIndex((row) => event.clientY < row.top + row.height / 2) + 1;
      if (gap === 0) gap = rows.length + 1;
      const edge = rows[gap - 1]?.top ?? rows.at(-1)?.bottom ?? table.bottom;
      indicator.style.top = `${edge - base.top}px`;
      indicator.style.left = `${table.left - base.left}px`;
      indicator.style.width = `${table.width}px`;
      target = gap > index ? gap - 1 : gap;
    } else {
      const columns = [...wrapper.querySelectorAll(".cm-md-table thead th")].map((cell) =>
        cell.getBoundingClientRect(),
      );
      let gap = columns.findIndex((cell) => event.clientX < cell.left + cell.width / 2);
      if (gap < 0) gap = columns.length;
      const edge = columns[gap]?.left ?? columns.at(-1)?.right ?? table.right;
      indicator.style.left = `${edge - base.left}px`;
      indicator.style.top = `${table.top - base.top}px`;
      indicator.style.height = `${table.height}px`;
      target = gap > index ? gap - 1 : gap;
    }
  };
  const onMove = (event: PointerEvent) => {
    if (!draggable || event.pointerId !== down.pointerId) return;
    if (!dragging && Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < 4)
      return;
    dragging = true;
    if (!indicator.isConnected) wrapper.append(indicator);
    place(event);
  };
  const finish = (commit: boolean) => {
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", cancel, true);
    document.removeEventListener("keydown", onKey, true);
    grip.removeEventListener("lostpointercapture", cancel);
    window.removeEventListener("blur", cancel);
    if (drags.get(wrapper) === cancel) drags.delete(wrapper);
    if (grip.hasPointerCapture(down.pointerId)) grip.releasePointerCapture(down.pointerId);
    indicator.remove();
    if (!commit || !wrapper.isConnected) return;
    const start = view.posAtDOM(wrapper);
    if (!dragging) {
      const spec = lineSelection(view.state, start, kind, index);
      if (spec) view.dispatch(spec);
    } else if (target !== index) {
      view.state.facet(tableMove)?.(view, start, kind, index, target);
    }
  };
  const cancel = () => finish(false);
  const onUp = (event: PointerEvent) => {
    if (event.pointerId === down.pointerId) finish(true);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finish(false);
  };
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("keydown", onKey, true);
  grip.addEventListener("lostpointercapture", cancel);
  window.addEventListener("blur", cancel);
  drags.set(wrapper, cancel);
  try {
    grip.setPointerCapture(down.pointerId);
  } catch {
    // A pointer that is no longer active (a synthetic event) cannot be captured.
  }
}

const sameRect = (a: CellRect, b: CellRect) =>
  a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;

/** Whether the cell at `row` and `column` is inside `rect`. */
const within = (rect: CellRect, row: number, column: number) =>
  rect.top <= row && row <= rect.bottom && rect.left <= column && column <= rect.right;

/**
 * A left press in a cell: crossing into another cell of the table while held selects the rectangle
 * from the pressed (anchor, active) cell to the one under the pointer; a press that never leaves stays
 * a click. Crossings come from the cells' own `mouseover`, so the pointer is not captured. `inEditor`
 * says the press began in the active cell's editor, whose own mouse selection the rectangle then ends.
 */
function startCellDrag(
  view: EditorView,
  wrapper: HTMLElement,
  anchor: { row: number; column: number },
  inEditor: boolean,
) {
  drags.get(wrapper)?.();
  let rect: CellRect | null = null;
  // Set while the anchor editor's gesture is ended, whose release is not the drag's.
  let ending = false;
  /** The anchor's editor holds a caret after its text, never a text selection. */
  const collapse = () => {
    const child = controllers.get(view)?.child;
    if (!child) return;
    const end = child.state.doc.length;
    const { main } = child.state.selection;
    if (!main.empty || main.head !== end)
      child.dispatch({ selection: EditorSelection.cursor(end) });
  };
  const onOver = (event: MouseEvent) => {
    const element = event.target instanceof Element ? event.target : null;
    const over = element?.closest(".cm-md-table-widget") === wrapper ? cellTarget(element) : null;
    if (!over) return;
    const next = {
      top: Math.min(anchor.row, over.row),
      left: Math.min(anchor.column, over.column),
      bottom: Math.max(anchor.row, over.row),
      right: Math.max(anchor.column, over.column),
    };
    const single = next.top === next.bottom && next.left === next.right;
    if (rect ? sameRect(rect, next) : single) return;
    const first = rect === null;
    rect = next;
    const start = view.posAtDOM(wrapper);
    const select = selectCells(start, next);
    if (!first) {
      collapse();
      view.dispatch({ effects: select });
      return;
    }
    const location = cellAt(view.state, start, anchor.row, anchor.column);
    if (!location) return;
    const { cell } = location;
    const editor = controllers.get(view);
    if (editor && view.state.field(activeCell, false)?.cellFrom === cell.from) {
      if (inEditor) {
        // The press started the editor's own mouse selection, which follows the pointer
        // until a release: release it now, so the rectangle alone follows the pointer.
        ending = true;
        try {
          editor.child.contentDOM.dispatchEvent(
            new MouseEvent("mouseup", {
              bubbles: true,
              clientX: event.clientX,
              clientY: event.clientY,
            }),
          );
        } finally {
          ending = false;
        }
      }
      // The caret goes after its text, as a fresh activation puts it.
      collapse();
      view.dispatch({ effects: select });
    } else {
      const spec = activation(cell, cell.to - cell.from);
      view.dispatch({ ...spec, effects: [...[spec.effects ?? []].flat(), select] });
    }
  };
  const finish = () => {
    wrapper.removeEventListener("mouseover", onOver);
    document.removeEventListener("mouseup", onUp, true);
    window.removeEventListener("blur", finish);
    if (drags.get(wrapper) === finish) drags.delete(wrapper);
  };
  const onUp = () => {
    if (!ending) finish();
  };
  wrapper.addEventListener("mouseover", onOver);
  document.addEventListener("mouseup", onUp, true);
  window.addEventListener("blur", finish);
  drags.set(wrapper, finish);
}

/** The row and column of the rendered cell holding `element`. */
function cellTarget(element: Element) {
  const cell = element.closest<HTMLElement>("[data-column]");
  if (!cell) return null;
  return { row: Number(cell.dataset.row), column: Number(cell.dataset.column) };
}

interface TableDom {
  /** The `<th>` / `<td>` elements by row and column. */
  cells: HTMLElement[][];
  /** What each static cell last rendered, so unchanged cells are left alone. */
  keys: (string | null)[][];
  editor: CellEditor | null;
}

const tableDoms = new WeakMap<HTMLElement, TableDom>();

/**
 * A GFM table drawn as a real `<table>`, redrawn only when its source, KaTeX loading (math cells),
 * the document's definitions (link or image cells) or the active cell change. A shape-keeping edit
 * patches the DOM so the active cell's child editor survives the keystrokes it forwards. Cells carry
 * their row and column so a click finds its cell however far the table has moved.
 */
export class TableWidget extends WidgetType {
  readonly source: string;
  readonly math: boolean;
  readonly definitions: string;
  /** Whether the add bars show: an editable editor that supplies their commands. */
  readonly bars: boolean;

  constructor(
    private readonly state: EditorState,
    private readonly indexed: IndexedTable,
    start: number,
    end: number,
    readonly active: ActiveSpot | null,
    readonly selected: SelectedCells | null = null,
  ) {
    super();
    this.source = state.sliceDoc(start, end);
    this.math = indexed.math && katexLoaded();
    this.definitions = indexed.references ? documentIndex(state).definitionsKey : "";
    this.bars = !state.readOnly && state.facet(tableAddBar) !== null;
  }

  override eq(other: TableWidget) {
    return (
      other.source === this.source &&
      other.math === this.math &&
      other.definitions === this.definitions &&
      other.bars === this.bars &&
      other.active?.row === this.active?.row &&
      other.active?.column === this.active?.column &&
      other.active?.token === this.active?.token &&
      other.selected?.key === this.selected?.key
    );
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-widget";
    const element = document.createElement("table");
    element.className = "cm-md-table";
    const head = document.createElement("thead");
    const body = document.createElement("tbody");
    const columns = alignments(this.state, this.indexed.node).length;
    const record: TableDom = { cells: [], keys: [], editor: null };
    for (const row of tableRows(this.indexed.node)) {
      const header = row.name === "TableHeader";
      const tr = document.createElement("tr");
      const cells: HTMLElement[] = [];
      for (let column = 0; column < columns; column++) {
        const cell = document.createElement(header ? "th" : "td");
        cells.push(cell);
        tr.append(cell);
      }
      record.cells.push(cells);
      record.keys.push(cells.map(() => null));
      (header ? head : body).append(tr);
    }
    element.append(head);
    if (body.childElementCount > 0) element.append(body);
    // The table scrolls sideways inside its own element, so the add bars, children of the
    // wrapper, stay at the wrapper's visible edges while a wide table scrolls.
    const scroller = document.createElement("div");
    scroller.className = "cm-md-table-scroll";
    scroller.append(element);
    wrapper.append(scroller);
    tableDoms.set(wrapper, record);
    this.fill(view, record);
    syncAddBars(wrapper, view, this.bars);
    syncHandles(wrapper, view, this.bars, record.cells.length, columns);
    scroller.addEventListener("scroll", () => layoutHandles(view, wrapper));
    wrapper.addEventListener("mousedown", (event) => {
      if (!(event.target instanceof Element)) return;
      const pressed = cellTarget(event.target);
      // A press in any cell, the active one's editor included, may drag out a rectangle.
      const inEditor = event.target.closest(".cm-md-cell-editor") !== null;
      if (pressed && event.button === 0 && !opensLink(view, event) && !view.state.readOnly)
        startCellDrag(view, wrapper, pressed, inEditor);
      // The active cell's editor handles its own clicks.
      if (inEditor) return;
      // A right-click on a rendered cell only opens the cell menu: it must not focus the
      // outer editor, whose first focus reveals syntax and can shift (and scroll) the page.
      if (event.button === 2) event.preventDefault();
      if (event.button !== 0) return;
      event.preventDefault();
      if (opensLink(view, event)) {
        const link = event.target.closest<HTMLElement>("[data-href], [data-wikilink]");
        const { href, wikilink } = link?.dataset ?? {};
        if (href) openExternal(view, href);
        else if (wikilink !== undefined) view.state.facet(previewConfig).openWikilink?.(wikilink);
        return;
      }
      const target = cellTarget(event.target);
      const location =
        target && cellAt(view.state, view.posAtDOM(wrapper), target.row, target.column);
      if (!location) return;
      const { cell } = location;
      // The caret starts at the cell's end, then moves under the click once laid out.
      view.dispatch(activation(cell, cell.to - cell.from));
      controllers.get(view)?.placeAt(event.clientX, event.clientY);
    });
    // A right-click on a cell, the active cell's editor included, opens the cell menu.
    // Inside a selected rectangle, it opens the rectangle's menu.
    wrapper.addEventListener("contextmenu", (event) => {
      const open = view.state.facet(cellMenu);
      const target = event.target instanceof Element ? cellTarget(event.target) : null;
      if (!open || !target) return;
      event.preventDefault();
      const start = view.posAtDOM(wrapper);
      const selection = view.state.field(tableSelection, false);
      const rect =
        selection?.kind === "cells" &&
        selection.tableFrom === start &&
        within(selection, target.row, target.column);
      open(view, { start, ...target, ...(rect ? { rect } : {}) }, event);
    });
    return wrapper;
  }

  override updateDOM(dom: HTMLElement, view: EditorView) {
    const record = tableDoms.get(dom);
    const rows = tableRows(this.indexed.node);
    const columns = alignments(this.state, this.indexed.node).length;
    if (
      !record ||
      record.cells.length !== rows.length ||
      record.cells.some((cells) => cells.length !== columns)
    )
      return false;
    this.fill(view, record);
    syncAddBars(dom, view, this.bars);
    syncHandles(dom, view, this.bars, rows.length, columns);
    return true;
  }

  override destroy(dom: HTMLElement) {
    drags.get(dom)?.();
    tableDoms.get(dom)?.editor?.destroy();
    observers.get(dom)?.disconnect();
    observers.delete(dom);
  }

  override ignoreEvent() {
    return true;
  }

  /** Fills each cell: the active one with its child editor, the rest with static content. */
  private fill(view: EditorView, record: TableDom) {
    const { state, active } = this;
    const source: LinkSource = {
      slice: (from, to) => state.sliceDoc(from, to),
      index: documentIndex(state),
      config: state.facet(previewConfig),
    };
    const align = alignments(state, this.indexed.node);
    const rows = tableGrid(state, this.indexed)?.rows ?? [];
    const old = record.editor;
    // The active cell first, while an editor it replaces is still in place, so a redraw of
    // the same activation carries its caret and focus across.
    const home = active ? record.cells[active.row]?.[active.column] : undefined;
    if (!active || !home) {
      record.editor = null;
    } else if (
      !old ||
      old.row !== active.row ||
      old.column !== active.column ||
      old.token !== active.token ||
      old.from !== active.from
    ) {
      if (old?.row !== active.row || old.column !== active.column) home.replaceChildren();
      const keys = record.keys[active.row];
      if (keys) keys[active.column] = null;
      record.editor = new CellEditor(view, home, active.row, active.column, active);
    }
    const { selected } = this;
    const wrapper = record.cells[0]?.[0]?.closest<HTMLElement>(".cm-md-table-widget");
    if (wrapper) {
      if (selected) {
        wrapper.dataset.selected = selected.key;
        selections.set(wrapper, selected);
      } else {
        delete wrapper.dataset.selected;
        selections.delete(wrapper);
      }
    }
    for (const [r, cells] of rows.entries()) {
      for (const [c, element] of (record.cells[r] ?? []).entries()) {
        const cell = cells[c];
        const keys = record.keys[r] ?? [];
        element.style.textAlign = align[c] ?? "";
        element.dataset.row = String(r);
        element.dataset.column = String(c);
        element.classList.toggle(
          "cm-md-cell-selected",
          selected !== null &&
            selected.top <= r &&
            r <= selected.bottom &&
            selected.left <= c &&
            c <= selected.right,
        );
        if (active?.row === r && active.column === c) {
          element.classList.add("cm-md-cell-active");
          continue;
        }
        element.classList.remove("cm-md-cell-active");
        // The cell the replaced editor stood in renders statically again.
        if (old && old !== record.editor && old.row === r && old.column === c) keys[c] = null;
        const text = cell?.node ? state.sliceDoc(cell.node.from, cell.node.to) : "";
        const key = `${text}\u0000${this.math}\u0000${this.definitions}`;
        if (keys[c] === key) continue;
        keys[c] = key;
        element.replaceChildren();
        if (cell?.node) renderCell(element, cell.node, source);
      }
    }
    if (old && old !== record.editor) old.destroy();
  }
}
