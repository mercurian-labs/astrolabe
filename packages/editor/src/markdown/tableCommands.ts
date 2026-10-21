import { isolateHistory } from "@codemirror/commands";
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type Command, type ViewUpdate } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { documentIndex } from "./documentIndex.ts";
import { alignments, rowCells, tableRows } from "./table.ts";
import {
  activateCell,
  activateCellAt,
  activeCaret,
  activeLocation,
  cellAt,
  cellMenu,
  deactivateCell,
  keepLineSelected,
  selectedCells,
  selectLine,
  tableAddBar,
  tableCellsDelete,
  tableMove,
  type AddBar,
  type CellRect,
  type LineKind,
  locateCell,
  writeMissing,
  type CellLocation,
  type CellTarget,
  type GridCell,
} from "./tableCells.ts";

// Table structure commands (section 4.11) on the table as a grid whose row 0 is the
// header: add, move, duplicate, and delete rows and columns, align and sort, insert a
// table. Each is one transaction of small changes, one per row it touches, so the rows it
// does not touch keep their padding, alignment markers, and escapes byte for byte.

/**
 * The cell a command acts on: the active cell, else the cell whose slot holds a lone
 * collapsed outer caret while the table's source rows are shown.
 */
function currentCell(state: EditorState) {
  const active = activeLocation(state);
  if (active) return active;
  const { ranges, main } = state.selection;
  return ranges.length === 1 && main.empty ? locateCell(state, main.head) : null;
}

/** One row of a table as slots between pipes: header, delimiter, or body. */
interface RowShape {
  /** Where the row's content starts, after any indentation. */
  from: number;
  slots: { start: number; end: number }[];
  /** Whether a pipe opens the first slot. */
  leading: boolean;
  /** Whether a pipe follows the last slot. */
  closed: boolean;
  /** After the last pipe of a closed row, else the row's end: where cells are appended. */
  end: number;
}

/** A header or body row's slots, from the parser's cells. */
function cellRowShape(state: EditorState, row: SyntaxNode): RowShape {
  const first = row.firstChild;
  const last = row.lastChild;
  const closed = last?.name === "TableDelimiter";
  return {
    from: row.from,
    slots: rowCells(state, row),
    leading: first?.name === "TableDelimiter" && first.from === row.from,
    closed,
    end: closed && last ? last.to : row.to,
  };
}

/** The delimiter row's slots, from its pipes (it holds no escapes). */
function delimiterShape(state: EditorState, row: SyntaxNode): RowShape {
  const text = state.sliceDoc(row.from, row.to);
  const slots: RowShape["slots"] = [];
  let start = row.from;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "|") continue;
    if (i > 0) slots.push({ start, end: row.from + i });
    start = row.from + i + 1;
  }
  const closed = text.slice(start - row.from).trim() === "";
  if (!closed) slots.push({ start, end: row.to });
  return {
    from: row.from,
    slots,
    leading: text.startsWith("|"),
    closed,
    end: closed ? start : row.to,
  };
}

/** Every row of the table in document order: header, delimiter, then body rows. */
function tableShapes(state: EditorState, table: SyntaxNode) {
  const rows = tableRows(table);
  const delimiter = table.getChildren("TableDelimiter")[0];
  const shapes = rows.map((row) => cellRowShape(state, row));
  if (delimiter) shapes.splice(1, 0, delimiterShape(state, delimiter));
  return { shapes, delimiterIndex: delimiter ? 1 : -1 };
}

/**
 * The pipes a row without outer pipes needs once `first` (its first slot's new text) or
 * `last` (its last slot's) is blank: a blank cell at an open end would read as no cell
 * there, so that end gains its pipe. Undefined leaves that end as it is.
 */
function openEdges(shape: RowShape, first: string | undefined, last: string | undefined) {
  const blank = (text: string | undefined) => text !== undefined && text.trim() === "";
  return {
    open: !shape.leading && blank(first) ? "|" : "",
    close: !shape.closed && blank(last) ? "|" : "",
  };
}

const BLANK = "   ";
const RULE = " --- ";

/**
 * The changes that give a row a new empty cell at column `index`, padding a row shorter
 * than the header first. `cell` is where the new cell's text starts: the insertion point
 * and the offset into the inserted text.
 */
function insertCell(shape: RowShape, index: number, columns: number, blank: string) {
  const { slots } = shape;
  const count = slots.length;
  const close = shape.closed ? "" : " |";
  const changes: { from: number; insert: string }[] = [];
  let cell: { at: number; offset: number };
  const slot = slots[index];
  if (slot && index === 0 && !shape.leading) {
    // A row without a leading pipe gains one, so the new cell is a cell of its own.
    changes.push({ from: slot.start, insert: `|${blank}|` });
    cell = { at: slot.start, offset: 2 };
    if (count < columns)
      changes.push({ from: shape.end, insert: `${close}${"  |".repeat(columns - count)}` });
  } else if (slot && index < count) {
    // Right after the slot's opening pipe.
    changes.push({ from: slot.start, insert: `${blank}|` });
    cell = { at: slot.start, offset: 1 };
    if (count < columns)
      changes.push({ from: shape.end, insert: `${close}${"  |".repeat(columns - count)}` });
  } else {
    // Past the row's cells: written among the padding a short row gets.
    const before = `${close}${"  |".repeat(index - count)}`;
    const insert = `${before}${blank}|${"  |".repeat(Math.max(0, columns - index))}`;
    changes.push({ from: shape.end, insert });
    cell = { at: shape.end, offset: before.length + 1 };
  }
  return { changes, cell };
}

/**
 * Removes column `index` from a row that has it: its slot and closing pipe. A row keeps at
 * least one pipe, so when that pipe is the row's only one, the slot's text goes and the
 * pipe stays (`a | b` loses column 0 as `| b`); a delimiter row left with its pipe only
 * before its rule then gains a closing pipe, which a delimiter row needs.
 */
function deleteCell(shape: RowShape, index: number, delimiter: boolean): ChangeSpec[] {
  const { slots } = shape;
  const slot = slots[index];
  if (!slot) return [];
  const pipes = (shape.leading ? 1 : 0) + Math.max(0, slots.length - 1) + (shape.closed ? 1 : 0);
  if (pipes <= 1) {
    const changes: ChangeSpec[] = [{ from: slot.start, to: slot.end }];
    const pipeFirst = index === 0 && !shape.leading && !shape.closed;
    if (delimiter && pipeFirst) changes.push({ from: shape.end, insert: " |" });
    return changes;
  }
  const hasClosingPipe = index < slots.length - 1 || shape.closed;
  if (hasClosingPipe) return [{ from: slot.start, to: slot.end + 1 }];
  // The last slot of an unclosed row goes with the pipe before it.
  return [{ from: Math.max(shape.from, slot.start - 1), to: slot.end }];
}

/**
 * The transaction for a command: its changes, and `target` (a position in the document
 * before them, mapped through them, plus an offset) made the active cell with the caret
 * at its start. A target in a cell a short row leaves out writes that cell too.
 */
function commit(
  state: EditorState,
  changes: ChangeSpec[],
  target: { at: number; offset: number; assoc: -1 | 1 } | GridCell,
  userEvent: string,
): TransactionSpec {
  let point = "at" in target ? target : { at: target.from, offset: 0, assoc: -1 as const };
  const all = [...changes];
  if (!("at" in target) && target.missing) {
    // Written first, so a copy inserted at the same point (a duplicated row) comes after.
    const written = writeMissing(target.missing);
    all.unshift({ from: written.from, insert: written.insert });
    point = { at: written.from, offset: written.cellOffset, assoc: -1 };
  }
  const set = state.changes(all);
  const cellFrom = set.mapPos(point.at, point.assoc) + point.offset;
  return {
    changes: set,
    selection: EditorSelection.cursor(cellFrom),
    effects: activateCellAt(cellFrom, 0),
    annotations: isolateHistory.of("full"),
    userEvent,
    scrollIntoView: true,
  };
}

type TableCommand = (state: EditorState, location: CellLocation) => TransactionSpec | null;

/** The source line of grid row `row` (0 is the header; the delimiter row is not a row). */
function rowLine(state: EditorState, location: CellLocation, row: number) {
  const node = tableRows(location.table.node)[row];
  return node ? state.doc.lineAt(node.from) : null;
}

function delimiterLine(state: EditorState, location: CellLocation) {
  const node = location.table.node.getChildren("TableDelimiter")[0];
  return node ? state.doc.lineAt(node.from) : null;
}

/**
 * Row `row`'s line with its missing cells written up to `cell`, as entering that cell
 * does; the line as it is when `cell` has source.
 */
function withCell(state: EditorState, location: CellLocation, row: number, cell?: GridCell) {
  const line = rowLine(state, location, row);
  if (!line) return null;
  if (!cell?.missing) return line.text;
  const written = writeMissing(cell.missing);
  const at = written.from - line.from;
  return line.text.slice(0, at) + written.insert + line.text.slice(at);
}

/** Row `row`'s line as it reads in the header's place, which needs every column. */
const asHeader = (state: EditorState, location: CellLocation, row: number) =>
  withCell(state, location, row, location.rows[row]?.at(-1));

/** Where a row's cell in column `column` starts, as an offset into the row's line. */
function cellOffset(state: EditorState, location: CellLocation, row: number, column: number) {
  const line = rowLine(state, location, row);
  const cell = location.rows[row]?.[column];
  if (!line || !cell) return 0;
  if (!cell.missing) return cell.from - line.from;
  const written = writeMissing(cell.missing);
  return written.from - line.from + written.cellOffset;
}

/** A new empty row with the table's column count, carrying the current row's indentation. */
function newRow(state: EditorState, location: CellLocation) {
  const columns = alignments(state, location.table.node).length;
  const row = tableRows(location.table.node)[location.row];
  const line = state.doc.lineAt(row?.from ?? location.table.node.from);
  const indent = state.sliceDoc(line.from, row?.from ?? line.from);
  // The empty cell in column `c` starts two characters into its `   |` after the `|`.
  return {
    line,
    text: `${indent}|${"   |".repeat(columns)}`,
    cellOffset: indent.length + 4 * location.column + 2,
  };
}

const insertRowBelowAt: TableCommand = (state, location) => {
  const { line, text, cellOffset } = newRow(state, location);
  // Below the header, the new row goes after the delimiter row.
  const after = location.row === 0 ? delimiterLine(state, location) : line;
  if (!after) return null;
  return commit(
    state,
    [{ from: after.to, insert: `\n${text}` }],
    { at: after.to, offset: 1 + cellOffset, assoc: -1 },
    "input",
  );
};

const insertRowAboveAt: TableCommand = (state, location) => {
  const { line, text, cellOffset } = newRow(state, location);
  if (location.row > 0) {
    return commit(
      state,
      [{ from: line.from, insert: `${text}\n` }],
      { at: line.from, offset: cellOffset, assoc: -1 },
      "input",
    );
  }
  // Above the header, the new row is the header and the old one the first body row.
  const delimiter = delimiterLine(state, location);
  if (!delimiter) return null;
  return commit(
    state,
    [
      { from: line.from, to: line.to, insert: text },
      { from: delimiter.to, insert: `\n${line.text}` },
    ],
    { at: line.from, offset: cellOffset, assoc: -1 },
    "input",
  );
};

const deleteRowAt: TableCommand = (state, location) => {
  const line = rowLine(state, location, location.row);
  if (!line) return null;
  if (location.row === 0) {
    // The first body row is promoted to header; the delimiter row stays where it is.
    const first = rowLine(state, location, 1);
    const promoted = asHeader(state, location, 1);
    if (!first || promoted === null) return null;
    return commit(
      state,
      [
        { from: line.from, to: line.to, insert: promoted },
        { from: first.from - 1, to: first.to },
      ],
      { at: line.from, offset: cellOffset(state, location, 1, location.column), assoc: -1 },
      "delete",
    );
  }
  const change =
    line.to < state.doc.length
      ? { from: line.from, to: line.to + 1 }
      : { from: line.from - 1, to: line.to };
  // The same column in the row below, else the row above (the header at the last).
  const targetRow = location.rows[location.row + 1] ?? location.rows[location.row - 1];
  const target = targetRow?.[location.column];
  return target ? commit(state, [change], target, "delete") : null;
};

/** Swaps the current row's line with the row `delta` away; the moved cell stays active. */
function moveRow(state: EditorState, location: CellLocation, delta: 1 | -1) {
  const from = location.row;
  const to = from + delta;
  const a = rowLine(state, location, from);
  const b = rowLine(state, location, to);
  // A row taking the header's place gets the header's columns; a padded current cell is
  // written into its moving row, so the cell it stays active in has source.
  const aText =
    to === 0 ? asHeader(state, location, from) : withCell(state, location, from, location.cell);
  const bText = from === 0 ? asHeader(state, location, to) : b?.text;
  if (!a || !b || aText === undefined || aText === null || bText === undefined || bText === null)
    return null;
  return commit(
    state,
    [
      { from: a.from, to: a.to, insert: bText },
      { from: b.from, to: b.to, insert: aText },
    ],
    { at: b.from, offset: cellOffset(state, location, from, location.column), assoc: -1 },
    "move",
  );
}

const moveRowUpAt: TableCommand = (state, location) => moveRow(state, location, -1);
const moveRowDownAt: TableCommand = (state, location) => moveRow(state, location, 1);

const duplicateRowAt: TableCommand = (state, location) => {
  const line = rowLine(state, location, location.row);
  // The header's copy becomes the first body row, after the delimiter row.
  const after = location.row === 0 ? delimiterLine(state, location) : line;
  if (!line || !after) return null;
  return commit(state, [{ from: after.to, insert: `\n${line.text}` }], location.cell, "input");
};

/** Inserts a column at `index` of every row; the new cell in the current row is active. */
function insertColumn(state: EditorState, location: CellLocation, index: number) {
  const columns = alignments(state, location.table.node).length;
  const { shapes, delimiterIndex } = tableShapes(state, location.table.node);
  const currentShape = location.row === 0 ? 0 : location.row + 1;
  const changes: ChangeSpec[] = [];
  let target: { at: number; offset: number; assoc: -1 } | null = null;
  for (const [i, shape] of shapes.entries()) {
    const inserted = insertCell(shape, index, columns, i === delimiterIndex ? RULE : BLANK);
    changes.push(...inserted.changes);
    if (i === currentShape) target = { ...inserted.cell, assoc: -1 };
  }
  return target ? commit(state, changes, target, "input") : null;
}

const insertColumnRightAt: TableCommand = (state, location) =>
  insertColumn(state, location, location.column + 1);

const insertColumnLeftAt: TableCommand = (state, location) =>
  insertColumn(state, location, location.column);

const deleteColumnAt: TableCommand = (state, location) => {
  const { shapes, delimiterIndex } = tableShapes(state, location.table.node);
  const changes = shapes.flatMap((shape, i) =>
    deleteCell(shape, location.column, i === delimiterIndex),
  );
  // The cell now at the same index in the current row, else the one before it. Only cells
  // with source count; a short row without one hands activation to the header's.
  const real = (cell: GridCell | undefined) => (cell && !cell.missing ? cell : undefined);
  const pick = (cells: readonly GridCell[] | undefined) =>
    real(cells?.[location.column + 1]) ?? real(cells?.[location.column - 1]);
  const target = pick(location.rows[location.row]) ?? pick(location.rows[0]);
  if (!target) return null;
  return commit(state, changes, { at: target.from, offset: 0, assoc: 1 }, "delete");
};

/** The current row's shape index among header, delimiter, and body rows. */
const shapeIndex = (location: CellLocation) => (location.row === 0 ? 0 : location.row + 1);

/**
 * Swaps the current column's slot with the slot `delta` away in every row that has both,
 * the delimiter row included, so the alignment travels with the column. The moved cell
 * stays active.
 */
function moveColumn(state: EditorState, location: CellLocation, delta: 1 | -1) {
  const from = location.column;
  const to = from + delta;
  const { shapes } = tableShapes(state, location.table.node);
  const changes: ChangeSpec[] = [];
  for (const shape of shapes) {
    const a = shape.slots[from];
    const b = shape.slots[to];
    if (!a || !b) continue;
    changes.push(
      { from: a.start, to: a.end, insert: state.sliceDoc(b.start, b.end) },
      { from: b.start, to: b.end, insert: state.sliceDoc(a.start, a.end) },
    );
  }
  const current = shapes[shapeIndex(location)];
  const a = current?.slots[from];
  const b = current?.slots[to];
  // A padded current cell (its row lacks these columns) is written and stays active.
  const target =
    a && b && !location.cell.missing
      ? { at: b.start, offset: location.cell.from - a.start, assoc: -1 as const }
      : location.cell;
  return commit(state, changes, target, "move");
}

const moveColumnLeftAt: TableCommand = (state, location) => moveColumn(state, location, -1);
const moveColumnRightAt: TableCommand = (state, location) => moveColumn(state, location, 1);

/** Copies the current column's slot and its closing pipe after itself in every row. */
const duplicateColumnAt: TableCommand = (state, location) => {
  const { shapes } = tableShapes(state, location.table.node);
  const changes: ChangeSpec[] = [];
  for (const shape of shapes) {
    const slot = shape.slots[location.column];
    if (!slot) continue;
    const text = state.sliceDoc(slot.start, slot.end);
    const closed = location.column < shape.slots.length - 1 || shape.closed;
    changes.push(
      closed ? { from: slot.end + 1, insert: `${text}|` } : { from: slot.end, insert: `|${text}` },
    );
  }
  return commit(state, changes, location.cell, "input");
};

type Alignment = "left" | "center" | "right";

/**
 * The change that rewrites column `column`'s delimiter cell as `:--`, `:-:`, or `--:` at its
 * own width (a cell too narrow for the colons grows to the shortest valid form), touching no
 * other byte. Null when it already reads that way.
 */
function alignChange(state: EditorState, table: SyntaxNode, column: number, alignment: Alignment) {
  const { shapes, delimiterIndex } = tableShapes(state, table);
  const slot = shapes[delimiterIndex]?.slots[column];
  if (!slot) return null;
  const text = state.sliceDoc(slot.start, slot.end);
  const rule = text.trim();
  const start = slot.start + text.indexOf(rule);
  const left = rule.startsWith(":");
  const right = rule.endsWith(":");
  const current = left && right ? "center" : right ? "right" : left ? "left" : null;
  if (current === alignment) return null;
  const colons = alignment === "center" ? 2 : 1;
  const dashes = "-".repeat(Math.max(1, rule.length - colons));
  const insert =
    alignment === "left" ? `:${dashes}` : alignment === "right" ? `${dashes}:` : `:${dashes}:`;
  return { from: start, to: start + rule.length, insert };
}

/** Aligns the current column; null when it already is. */
function alignColumn(state: EditorState, location: CellLocation, alignment: Alignment) {
  const change = alignChange(state, location.table.node, location.column, alignment);
  return change ? commit(state, [change], location.cell, "input") : null;
}

const alignLeftAt: TableCommand = (state, location) => alignColumn(state, location, "left");
const alignCenterAt: TableCommand = (state, location) => alignColumn(state, location, "center");
const alignRightAt: TableCommand = (state, location) => alignColumn(state, location, "right");

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Reorders the body rows by the current column's cell text (case-insensitive natural
 * order, stable), moving whole lines. Null when the order does not change. The current
 * cell stays active, in its row wherever that row lands.
 */
function sortRows(state: EditorState, location: CellLocation, direction: 1 | -1) {
  const rows = location.rows.slice(1).map((cells, i) => {
    const line = rowLine(state, location, i + 1);
    const cell = cells[location.column];
    const key = cell && !cell.missing ? state.sliceDoc(cell.from, cell.to) : "";
    return { index: i + 1, line, key };
  });
  const sorted = [...rows].sort((a, b) => direction * collator.compare(a.key, b.key));
  if (sorted.every((row, i) => row === rows[i])) return null;
  // A padded current cell is written into its row's line, wherever that line lands.
  const own = withCell(state, location, location.row, location.cell);
  const changes: ChangeSpec[] = [];
  sorted.forEach((row, i) => {
    const place = rows[i]?.line;
    const text = row.index === location.row && own !== null ? own : row.line?.text;
    if (place && text !== undefined && (row !== rows[i] || text !== place.text))
      changes.push({ from: place.from, to: place.to, insert: text });
  });
  // A body cell's row lands in another row's place; the header's cell stays put.
  const landed = rows[sorted.findIndex((row) => row.index === location.row)]?.line;
  const offset = cellOffset(state, location, location.row, location.column);
  const target =
    location.row > 0 && landed
      ? { at: landed.from, offset, assoc: -1 as const }
      : { at: location.cell.from, offset: 0, assoc: -1 as const };
  return commit(state, changes, target, "move");
}

const sortAscendingAt: TableCommand = (state, location) => sortRows(state, location, 1);
const sortDescendingAt: TableCommand = (state, location) => sortRows(state, location, -1);

const COMMANDS = {
  insertRowAbove: insertRowAboveAt,
  insertRowBelow: insertRowBelowAt,
  moveRowUp: moveRowUpAt,
  moveRowDown: moveRowDownAt,
  duplicateRow: duplicateRowAt,
  deleteRow: deleteRowAt,
  insertColumnLeft: insertColumnLeftAt,
  insertColumnRight: insertColumnRightAt,
  moveColumnLeft: moveColumnLeftAt,
  moveColumnRight: moveColumnRightAt,
  alignColumnLeft: alignLeftAt,
  alignColumnCenter: alignCenterAt,
  alignColumnRight: alignRightAt,
  duplicateColumn: duplicateColumnAt,
  deleteColumn: deleteColumnAt,
  sortRowsAscending: sortAscendingAt,
  sortRowsDescending: sortDescendingAt,
} satisfies Record<string, TableCommand>;

type CommandId = keyof typeof COMMANDS;

/** The commands that leave the current cell active (moved, copied, or re-sorted). */
const KEEPS_CELL = new Set<CommandId>([
  "moveRowUp",
  "moveRowDown",
  "duplicateRow",
  "moveColumnLeft",
  "moveColumnRight",
  "alignColumnLeft",
  "alignColumnCenter",
  "alignColumnRight",
  "duplicateColumn",
  "sortRowsAscending",
  "sortRowsDescending",
]);

/**
 * `spec` with the cell it activates keeping the child caret the current cell had (the
 * child clamps it to the cell's text): a command that keeps its cell active keeps the
 * caret where it was.
 */
function keepingCaret(view: EditorView, location: CellLocation, spec: TransactionSpec) {
  const caret = activeCaret(view, location.cell.from);
  if (caret === 0 || spec.effects === undefined) return spec;
  const effects = [spec.effects]
    .flat()
    .map((effect) =>
      effect.is(activateCell) ? activateCellAt(effect.value.cellFrom, caret) : effect,
    );
  return { ...spec, effects };
}

/** The selected cells, their grid, and their table's column count (see `selectedCells`). */
type Selected = NonNullable<ReturnType<typeof selectedCells>>;

/** The cell a cell command leaves active: the active cell inside the selection, else its top-left. */
function anchorOf(state: EditorState, { grid, rect }: Selected) {
  const active = activeLocation(state);
  const inside =
    active &&
    active.lines.from === grid.lines.from &&
    rect.top <= active.row &&
    active.row <= rect.bottom &&
    rect.left <= active.column &&
    active.column <= rect.right;
  const row = inside ? active.row : rect.top;
  const column = inside ? active.column : rect.left;
  const cell = grid.rows[row]?.[column];
  return cell ? { row, column, cell } : null;
}

/** `spec` with the selection it was made from selected again. */
function keepSelected(spec: TransactionSpec, { selection }: Selected): TransactionSpec {
  const effects = spec.effects === undefined ? [] : [spec.effects].flat();
  return { ...spec, effects: [...effects, selectLine.of(selection)] };
}

/**
 * The changes that write `texts` (by column) into row `row` of the selection's table: each
 * cell's text is replaced, a blank cell at an open end of a row without outer pipes gains
 * that pipe (see `openEdges`), and cells a short row leaves out are written, as entering
 * them writes them, up to the last one given text. Every other byte stays.
 */
function writeCells(
  state: EditorState,
  { grid }: Selected,
  row: number,
  texts: ReadonlyMap<number, string>,
): ChangeSpec[] {
  const { shapes } = tableShapes(state, grid.table.node);
  const shape = shapes[row === 0 ? 0 : row + 1];
  const cells = grid.rows[row];
  if (!shape || !cells) return [];
  const changes: ChangeSpec[] = [];
  let missing: { rowTo: number; closed: boolean; index: number } | null = null;
  for (const [column, text] of texts) {
    const cell = cells[column];
    if (!cell) continue;
    if (cell.missing) {
      if (text !== "" && (!missing || cell.missing.index > missing.index)) missing = cell.missing;
      continue;
    }
    if (text === state.sliceDoc(cell.from, cell.to)) continue;
    const slot = shape.slots[column];
    const written =
      slot && state.sliceDoc(slot.start, cell.from) + text + state.sliceDoc(cell.to, slot.end);
    const last = column === shape.slots.length - 1;
    const { open, close } = openEdges(
      shape,
      column === 0 ? written : undefined,
      last ? written : undefined,
    );
    if (open && slot) changes.push({ from: slot.start, insert: open });
    changes.push({ from: cell.from, to: cell.to, insert: text });
    if (close && slot) changes.push({ from: slot.end, insert: close });
  }
  if (missing) {
    // The short row's absent cells up to the last one given text, as activation writes them.
    const absent = cells.findIndex((cell) => cell.missing);
    let insert = missing.closed ? "" : " |";
    for (let index = 0; index <= missing.index; index++) {
      const text = texts.get(absent + index);
      insert += text ? ` ${text} |` : "  |";
    }
    changes.push({ from: missing.rowTo, insert });
  }
  return changes;
}

/**
 * Writes `text(row, column)` into every cell of the selection it gives text for, keeping
 * the rows, the selection, and its anchor active (found again by its grid place).
 */
function writeSelection(
  state: EditorState,
  selected: Selected,
  text: (row: number, column: number) => string | undefined,
  userEvent: string,
) {
  const anchor = anchorOf(state, selected);
  if (!anchor) return null;
  const { rect, grid } = selected;
  const changes: ChangeSpec[] = [];
  for (let row = rect.top; row <= rect.bottom; row++) {
    const texts = new Map<number, string>();
    for (let column = rect.left; column <= rect.right; column++) {
      const value = text(row, column);
      if (value !== undefined) texts.set(column, value);
    }
    changes.push(...writeCells(state, selected, row, texts));
  }
  if (changes.length === 0) return null;
  const spec = commitLanding(
    state,
    changes,
    grid.lines.from,
    [[anchor.row, anchor.column]],
    userEvent,
  );
  return keepSelected(spec, selected);
}

/** Empties every cell of the selection, keeping the rows, the anchor active, and the selection. */
function clearCellsAt(state: EditorState, selected: Selected) {
  return writeSelection(state, selected, () => "", "delete");
}

/** Whether the selection spans every column (its rows can be deleted) or every row. */
function deletable({ grid, rect, columns }: Selected) {
  const fullWidth = rect.left === 0 && rect.right === columns - 1;
  const fullHeight = rect.top === 0 && rect.bottom === grid.rows.length - 1;
  return { fullWidth, fullHeight, any: fullWidth || fullHeight };
}

/**
 * The transaction for `changes` that activates, in the table as it reads afterwards, the
 * first of `places` holding a cell with source; with none left, the table is gone and the
 * caret goes where it started.
 */
function commitLanding(
  state: EditorState,
  changes: ChangeSpec[],
  tableFrom: number,
  places: readonly (readonly [number, number])[],
  userEvent = "delete",
): TransactionSpec {
  const set = state.changes(changes);
  const after = state.update({ changes: set }).state;
  ensureSyntaxTree(after, after.doc.length, 1000);
  const start = set.mapPos(tableFrom, -1);
  const common = {
    changes: set,
    annotations: isolateHistory.of("full"),
    userEvent,
    scrollIntoView: true,
  };
  for (const [row, column] of places) {
    const found = row >= 0 && column >= 0 ? cellAt(after, start, row, column) : null;
    if (found && !found.cell.missing) {
      const { from } = found.cell;
      return {
        ...common,
        selection: EditorSelection.cursor(from),
        effects: activateCellAt(from, 0),
      };
    }
  }
  return {
    ...common,
    selection: EditorSelection.cursor(Math.min(start, after.doc.length)),
    effects: deactivateCell.of(null),
  };
}

/** Removes columns `left` to `right` from a row that has them, keeping every other byte. */
function deleteSlots(state: EditorState, shape: RowShape, left: number, right: number) {
  const { slots } = shape;
  const first = slots[0];
  const last = slots.at(-1);
  if (!first || !last || slots.length <= left) return null;
  const kept = slots
    .filter((_, i) => i < left || i > right)
    .map((slot) => state.sliceDoc(slot.start, slot.end));
  // A row keeps at least one cell and one pipe, and a blank cell at an open end its pipe.
  if (kept.length === 0) kept.push(" ");
  const edges = openEdges(shape, kept[0], kept.at(-1));
  const open = edges.open;
  const alone = kept.length === 1 && !shape.leading && !open;
  const close = alone && !shape.closed ? "|" : edges.close;
  return { from: first.start, to: last.end, insert: open + kept.join("|") + close };
}

/**
 * Deletes the selection's rows when it spans every column (a deleted header promotes the
 * first row left), its columns when it spans every row, and the whole table when both.
 * Afterwards the cell now in the anchor's place is active, else the header's cell in that
 * column. Null when the selection spans neither.
 */
function deleteCellsAt(state: EditorState, selected: Selected) {
  const { grid, rect } = selected;
  const { fullWidth, fullHeight } = deletable(selected);
  const anchor = anchorOf(state, selected);
  if (!anchor || (!fullWidth && !fullHeight)) return null;
  const { lines } = grid;
  const places = [
    [anchor.row, anchor.column],
    [0, anchor.column],
    [anchor.row, rect.left - 1],
    [0, rect.left - 1],
  ] as const;
  const line = (row: number) => rowLine(state, grid, row);
  if (fullWidth && fullHeight) {
    const whole =
      lines.to < state.doc.length
        ? { from: lines.from, to: lines.to + 1 }
        : { from: Math.max(0, lines.from - 1), to: lines.to };
    return commitLanding(state, [whole], lines.from, []);
  }
  if (fullWidth) {
    const top = line(rect.top);
    const bottom = line(rect.bottom);
    if (!top || !bottom) return null;
    if (rect.top > 0) {
      const change =
        bottom.to < state.doc.length
          ? { from: top.from, to: bottom.to + 1 }
          : { from: top.from - 1, to: bottom.to };
      return commitLanding(state, [change], lines.from, places);
    }
    // The header goes too: the first row left takes its place, the delimiter row stays.
    const promoted = asHeader(state, grid, rect.bottom + 1);
    const first = line(1);
    const moved = line(rect.bottom + 1);
    const header = line(0);
    if (promoted === null || !first || !moved || !header) return null;
    return commitLanding(
      state,
      [
        { from: header.from, to: header.to, insert: promoted },
        { from: first.from - 1, to: moved.to },
      ],
      lines.from,
      places,
    );
  }
  const { shapes } = tableShapes(state, grid.table.node);
  const changes = shapes.flatMap((shape) => deleteSlots(state, shape, rect.left, rect.right) ?? []);
  return commitLanding(state, changes, lines.from, places);
}

/** Aligns every column of the selection; null when each already is. */
function alignCellsAt(state: EditorState, selected: Selected, alignment: Alignment) {
  const anchor = anchorOf(state, selected);
  if (!anchor) return null;
  const changes: ChangeSpec[] = [];
  for (let column = selected.rect.left; column <= selected.rect.right; column++) {
    const change = alignChange(state, selected.grid.table.node, column, alignment);
    if (change) changes.push(change);
  }
  if (changes.length === 0) return null;
  return keepSelected(commit(state, changes, anchor.cell, "input"), selected);
}

/** A rectangle dragged out across cells, when that is the selection. */
function rectangle(state: EditorState) {
  const selected = selectedCells(state);
  return selected?.selection.kind === "cells" ? selected : null;
}

/** Escapes each pipe not already escaped (by an odd run of backslashes); line breaks become spaces. */
function escapePipes(text: string) {
  let out = "";
  let backslashes = 0;
  for (const char of text.replace(/\r\n?|\n/g, " ")) {
    if (char === "|" && backslashes % 2 === 0) out += "\\";
    out += char;
    backslashes = char === "\\" ? backslashes + 1 : 0;
  }
  return out;
}

/**
 * The cells of `rect` in the table whose widget starts at `tableFrom`, for the clipboard:
 * tab-separated rows of their source text, and a Markdown table fragment of the rows'
 * slots (a delimiter row after the header when the header is included).
 */
export function cellsToClipboard(state: EditorState, tableFrom: number, rect: CellRect) {
  const grid = cellAt(state, tableFrom, 0, 0);
  if (!grid) return null;
  const { shapes, delimiterIndex } = tableShapes(state, grid.table.node);
  const rows: string[] = [];
  const lines: string[] = [];
  const slotLine = (shape: RowShape | undefined, blank: string) => {
    const texts: string[] = [];
    for (let column = rect.left; column <= rect.right; column++) {
      const slot = shape?.slots[column];
      texts.push(slot ? state.sliceDoc(slot.start, slot.end) : blank);
    }
    return `|${texts.join("|")}|`;
  };
  for (let row = rect.top; row <= rect.bottom; row++) {
    const texts: string[] = [];
    for (let column = rect.left; column <= rect.right; column++) {
      const cell = grid.rows[row]?.[column];
      texts.push(cell && !cell.missing ? state.sliceDoc(cell.from, cell.to) : "");
    }
    rows.push(texts.join("\t"));
    lines.push(slotLine(shapes[row === 0 ? 0 : row + 1], "  "));
    if (row === 0) lines.push(slotLine(shapes[delimiterIndex], RULE));
  }
  return { text: rows.join("\n"), markdown: lines.join("\n") };
}

const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** A line split at its unescaped pipes (a pipe after an even run of backslashes). */
function splitPipes(line: string) {
  const parts: string[] = [];
  let part = "";
  let backslashes = 0;
  for (const char of line) {
    if (char === "|" && backslashes % 2 === 0) {
      parts.push(part);
      part = "";
    } else {
      part += char;
    }
    backslashes = char === "\\" ? backslashes + 1 : 0;
  }
  parts.push(part);
  return parts;
}

/**
 * Clipboard text as rows of cells: tab-separated rows, else Markdown table rows split at
 * their unescaped pipes (outer pipes dropped, cells trimmed, a delimiter row skipped),
 * else one cell per line.
 */
export function parseClipboardCells(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.some((line) => line.includes("\t"))) return lines.map((line) => line.split("\t"));
  if (!lines.some((line) => splitPipes(line).length > 1)) return lines.map((line) => [line]);
  return lines
    .filter((line) => !DELIMITER_ROW.test(line))
    .map((line) => {
      const cells = splitPipes(line.trim());
      // An outer pipe leaves an empty part outside it.
      if (cells.length > 1 && cells[0]?.trim() === "") cells.shift();
      if (cells.length > 1 && cells.at(-1)?.trim() === "") cells.pop();
      return cells.map((value) => value.trim());
    });
}

/**
 * Writes `values` over the selected rectangle row by row, each value as its cell's text
 * with its pipes escaped: values past the rectangle are dropped, cells past the values keep
 * their text. The anchor stays active and the rectangle selected. Null with no rectangle.
 */
export function pasteIntoCells(state: EditorState, values: readonly (readonly string[])[]) {
  const selected = rectangle(state);
  if (!selected) return null;
  const { top, left } = selected.rect;
  return writeSelection(
    state,
    selected,
    (row, column) => {
      const value = values[row - top]?.[column - left];
      return value === undefined ? undefined : escapePipes(value);
    },
    "input.paste",
  );
}

/**
 * Puts the selected cells on the clipboard as text and as Markdown. A `copy` event writes
 * both types; the async clipboard API is the fallback, with plain text only, since browsers
 * refuse `text/markdown` there.
 */
function copyCells(view: EditorView) {
  const selected = selectedCells(view.state);
  const data =
    selected && cellsToClipboard(view.state, selected.selection.tableFrom, selected.rect);
  if (!data) return false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", data.text);
    event.clipboardData.setData("text/markdown", data.markdown);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener("copy", onCopy, true);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }
  if (!copied) void navigator.clipboard?.writeText(data.text).catch(() => undefined);
  return true;
}

/** Fills the selected rectangle from the clipboard's text. */
async function pasteCells(view: EditorView) {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (view.state.readOnly) return;
  const spec = pasteIntoCells(view.state, parseClipboardCells(text));
  if (spec) view.dispatch(spec);
}

/** Wraps a selection command as an editor command acting on the selected cells. */
function onSelectedCells(
  run: (state: EditorState, selected: Selected) => TransactionSpec | null,
): Command {
  return (view) => {
    if (view.state.readOnly) return false;
    const selected = selectedCells(view.state);
    const spec = selected && run(view.state, selected);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  };
}

/**
 * Empties every cell of the selected rectangle (or row, or column), keeping the rows and
 * the selection; the anchor stays active. False with nothing selected or nothing to clear.
 */
export const clearCells = onSelectedCells(clearCellsAt);

/**
 * Deletes the selected rows when the selection spans every column, the selected columns
 * when it spans every row (header included); false otherwise.
 */
export const deleteCells = onSelectedCells(deleteCellsAt);

/** Backspace or Delete on a rectangle: its rows when it spans every column, else its cells. */
function deleteFromKey(view: EditorView) {
  const selected = rectangle(view.state);
  if (!selected) return;
  (deletable(selected).fullWidth ? deleteCells : clearCells)(view);
}

const ALIGNS: Partial<Record<CommandId, Alignment>> = {
  alignColumnLeft: "left",
  alignColumnCenter: "center",
  alignColumnRight: "right",
};

/**
 * The commands that apply to a cell, by the grid rule: the header has no move up, the
 * last row no move down (and a header alone cannot be deleted), the first column no move
 * left, the last column no move right, a one-column table no delete column. The menu
 * omits the rest, and the commands return false for them.
 */
function applicable(state: EditorState, location: CellLocation) {
  const ids = new Set(Object.keys(COMMANDS) as CommandId[]);
  const lastRow = location.rows.length - 1;
  const lastColumn = alignments(state, location.table.node).length - 1;
  if (location.row === 0) ids.delete("moveRowUp");
  if (location.row === lastRow) ids.delete("moveRowDown");
  if (lastRow === 0) ids.delete("deleteRow");
  if (location.column === 0) ids.delete("moveColumnLeft");
  if (location.column >= lastColumn) ids.delete("moveColumnRight");
  if (lastColumn === 0) ids.delete("deleteColumn");
  return ids;
}

/** Wraps a table command as an editor command acting on the current cell. */
function onCurrentCell(id: CommandId): Command {
  return (view) => {
    if (view.state.readOnly) return false;
    const location = currentCell(view.state);
    if (!location || !applicable(view.state, location).has(id)) return false;
    // With a rectangle selected, an align applies to each of its columns.
    const alignment = ALIGNS[id];
    const selected = alignment && rectangle(view.state);
    const spec = selected
      ? alignCellsAt(view.state, selected, alignment)
      : COMMANDS[id](view.state, location);
    if (!spec) return false;
    view.dispatch(KEEPS_CELL.has(id) ? keepingCaret(view, location, spec) : spec);
    return true;
  };
}

/**
 * Moves the current body row to body position `to` (1 is the first body row) by cutting
 * its line, line break included, and inserting it there, bytes unchanged. The moved cell
 * stays active. Null on the header, for the header's place, or where it already is.
 */
function moveRowToAt(state: EditorState, location: CellLocation, to: number) {
  const from = location.row;
  const last = location.rows.length - 1;
  if (from < 1 || to < 1 || to > last || to === from) return null;
  const line = rowLine(state, location, from);
  const place = rowLine(state, location, to);
  if (!line || !place) return null;
  const cut =
    line.to < state.doc.length
      ? { from: line.from, to: line.to + 1 }
      : { from: line.from - 1, to: line.to };
  const offset = cellOffset(state, location, from, location.column);
  const moved = withCell(state, location, from, location.cell) ?? line.text;
  return to > from
    ? commit(
        state,
        [cut, { from: place.to, insert: `\n${moved}` }],
        { at: place.to, offset: 1 + offset, assoc: -1 },
        "move",
      )
    : commit(
        state,
        [cut, { from: place.from, insert: `${moved}\n` }],
        { at: place.from, offset, assoc: -1 },
        "move",
      );
}

/**
 * Moves the current column to position `to` in every row that has it, the delimiter row
 * included, by cutting its slot and inserting it at `to`: each slot keeps its bytes, and a
 * row too short for `to` is padded first, as adding a column pads it. A row without the
 * column is left alone. The moved cell stays active. Null where it already is.
 */
function moveColumnToAt(state: EditorState, location: CellLocation, to: number) {
  const from = location.column;
  const columns = alignments(state, location.table.node).length;
  if (to < 0 || to >= columns || to === from) return null;
  const { shapes } = tableShapes(state, location.table.node);
  const changes: ChangeSpec[] = [];
  let target: { at: number; offset: number; assoc: -1 } | null = null;
  for (const [i, shape] of shapes.entries()) {
    const { slots } = shape;
    const first = slots[0];
    const lastSlot = slots.at(-1);
    if (!slots[from] || !first || !lastSlot) continue;
    const texts = slots.map((slot) => state.sliceDoc(slot.start, slot.end));
    while (texts.length <= to) texts.push("  ");
    const [slot] = texts.splice(from, 1);
    if (slot === undefined) continue;
    texts.splice(to, 0, slot);
    // The slots between the first and the last are rewritten with the same bytes in the
    // new order; a closed row keeps its last pipe after them. A blank slot landing at an
    // open end would read as no cell there, so that end gains its pipe.
    const { open, close } = openEdges(shape, texts[0], texts.at(-1));
    changes.push({ from: first.start, to: lastSlot.end, insert: open + texts.join("|") + close });
    if (i === shapeIndex(location) && !location.cell.missing) {
      const before =
        open.length + texts.slice(0, to).reduce((sum, text) => sum + text.length + 1, 0);
      const inSlot = location.cell.from - (slots[from]?.start ?? location.cell.from);
      target = { at: first.start, offset: before + inSlot, assoc: -1 };
    }
  }
  return commit(state, changes, target ?? location.cell, "move");
}

/** Wraps a table command taking a position as an editor command on the current cell. */
function onCurrentCellTo(
  run: (state: EditorState, location: CellLocation, to: number) => TransactionSpec | null,
) {
  return (to: number): Command =>
    (view) => {
      if (view.state.readOnly) return false;
      const location = currentCell(view.state);
      const spec = location ? run(view.state, location, to) : null;
      if (!location || !spec) return false;
      view.dispatch(keepingCaret(view, location, spec));
      return true;
    };
}

/** Moves the current body row to body position `to` (1 is the first body row). */
export const moveRowTo = onCurrentCellTo(moveRowToAt);
/** Moves the current column to position `to` (0 is the first column). */
export const moveColumnTo = onCurrentCellTo(moveColumnToAt);

/** Adds an empty row above the current one; above the header it becomes the new header. */
export const insertRowAbove = onCurrentCell("insertRowAbove");
/** Adds an empty row below the current one (below the delimiter row from the header). */
export const insertRowBelow = onCurrentCell("insertRowBelow");
/** Swaps the current row with the one above; the first body row swaps with the header. */
export const moveRowUp = onCurrentCell("moveRowUp");
/** Swaps the current row with the one below; the header swaps with the first body row. */
export const moveRowDown = onCurrentCell("moveRowDown");
/** Copies the current row's line below itself (the header's copy becomes a body row). */
export const duplicateRow = onCurrentCell("duplicateRow");
/** Deletes the current row; deleting the header promotes the first body row. */
export const deleteRow = onCurrentCell("deleteRow");
/** Adds an empty column before the current one. */
export const insertColumnLeft = onCurrentCell("insertColumnLeft");
/** Adds an empty column after the current one. */
export const insertColumnRight = onCurrentCell("insertColumnRight");
/** Swaps the current column with the one to its left. */
export const moveColumnLeft = onCurrentCell("moveColumnLeft");
/** Swaps the current column with the one to its right. */
export const moveColumnRight = onCurrentCell("moveColumnRight");
/** Aligns the current column left. False when it already is. */
export const alignColumnLeft = onCurrentCell("alignColumnLeft");
/** Centres the current column. False when it already is. */
export const alignColumnCenter = onCurrentCell("alignColumnCenter");
/** Aligns the current column right. False when it already is. */
export const alignColumnRight = onCurrentCell("alignColumnRight");
/** Copies the current column after itself. */
export const duplicateColumn = onCurrentCell("duplicateColumn");
/** Deletes the current column. False on a one-column table. */
export const deleteColumn = onCurrentCell("deleteColumn");
/** Sorts the body rows by the current column, A to Z. False when already in that order. */
export const sortRowsAscending = onCurrentCell("sortRowsAscending");
/** Sorts the body rows by the current column, Z to A. False when already in that order. */
export const sortRowsDescending = onCurrentCell("sortRowsDescending");

const LITERAL_BLOCKS = new Set([
  "FencedCode",
  "CodeBlock",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "MathBlock",
  "Frontmatter",
]);

const NEW_TABLE = "|     |     |\n| --- | --- |\n|     |     |";

/** The block (paragraph, list, heading, and so on) holding `pos` at the document's top level. */
function topBlock(state: EditorState, pos: number) {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    // `resolve`, not `resolveInner`: nested languages (HTML, a fence's code) have their own
    // `Document` nodes, which would stop the climb inside the block.
    let node: SyntaxNode | null = tree.resolve(pos, side);
    while (node?.parent && node.parent.name !== "Document") node = node.parent;
    if (node && node.name !== "Document" && node.from <= pos && pos <= node.to) return node;
  }
  return null;
}

/**
 * Inserts a blank two-by-two table after the caret's paragraph (or other top-level block),
 * as a paragraph of its own, and activates its first header cell. False inside a table,
 * inside a code, HTML, math, or frontmatter block, and wherever the result would not
 * parse as a table.
 */
export const insertTable: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  const { head } = state.selection.main;
  if (documentIndex(state).tables.some(({ node }) => node.from <= head && head <= node.to))
    return false;
  const block = topBlock(state, head);
  // No table inside code, HTML, math, or frontmatter, closed or not.
  if (block && LITERAL_BLOCKS.has(block.name)) return false;
  const at = state.doc.lineAt(block ? block.to : head).to;
  // A line right after it would join the table as a row; keep a blank line between.
  const next = at < state.doc.length ? state.doc.lineAt(at + 1) : null;
  const insert = `\n\n${NEW_TABLE}${next && next.text.trim() !== "" ? "\n" : ""}`;
  // The first header cell starts after the blank line, the `|`, and one space.
  const cellFrom = at + 4;
  // An unclosed fence (or math block, or HTML block) would take the table in as its own
  // text: refuse unless the result parses as a table where it was written.
  const after = state.update({ changes: { from: at, insert } }).state;
  ensureSyntaxTree(after, at + insert.length, 1000);
  if (!documentIndex(after).tables.some(({ node }) => node.from === at + 2)) return false;
  view.dispatch({
    changes: { from: at, insert },
    selection: EditorSelection.cursor(cellFrom),
    effects: activateCellAt(cellFrom, 0),
    annotations: isolateHistory.of("full"),
    userEvent: "input",
    scrollIntoView: true,
  });
  return true;
};

const ROW_ENTRIES: readonly (readonly [CommandId, string])[] = [
  ["insertRowAbove", "Add row above"],
  ["insertRowBelow", "Add row below"],
  ["moveRowUp", "Move row up"],
  ["moveRowDown", "Move row down"],
  ["duplicateRow", "Duplicate row"],
  ["deleteRow", "Delete row"],
];

const COLUMN_ENTRIES: readonly (readonly [CommandId, string])[] = [
  ["insertColumnLeft", "Add column to the left"],
  ["insertColumnRight", "Add column to the right"],
  ["moveColumnLeft", "Move column left"],
  ["moveColumnRight", "Move column right"],
  ["alignColumnLeft", "Align left"],
  ["alignColumnCenter", "Align center"],
  ["alignColumnRight", "Align right"],
  ["duplicateColumn", "Duplicate column"],
  ["deleteColumn", "Delete column"],
];

const SORT_ENTRIES: readonly (readonly [CommandId, string])[] = [
  ["sortRowsAscending", "Sort by column (A to Z)"],
  ["sortRowsDescending", "Sort by column (Z to A)"],
];

/** One entry of a menu level: a command, or a parent that opens a submenu. */
interface MenuEntry {
  element: HTMLElement;
  disabled: boolean;
  choose?: () => void;
  submenu?: MenuLevel;
}

interface MenuLevel {
  element: HTMLElement;
  entries: MenuEntry[];
  index: number;
}

/** The open cell menu, at most one on the page. */
let openMenu: { view: EditorView; close: () => void } | null = null;

/** Closes the cell menu, if one is open. */
function closeCellMenu() {
  openMenu?.close();
}

function menuElement(submenu: boolean) {
  const element = document.createElement("div");
  element.className = submenu ? "cm-md-cell-menu cm-md-cell-submenu" : "cm-md-cell-menu";
  element.setAttribute("role", "menu");
  return element;
}

function entryElement(label: string, disabled: boolean) {
  const element = document.createElement("div");
  element.className = disabled
    ? "cm-md-cell-menu-item cm-md-cell-menu-disabled"
    : "cm-md-cell-menu-item";
  element.setAttribute("role", "menuitem");
  element.tabIndex = -1;
  if (disabled) element.setAttribute("aria-disabled", "true");
  const text = document.createElement("span");
  text.className = "cm-md-cell-menu-label";
  text.textContent = label;
  element.append(text);
  return element;
}

/**
 * Opens the cell menu for a right-clicked cell at the pointer: Row and Column submenus
 * and the two sort entries, with the entries that do not apply to that cell left out.
 * Submenus open on hover, click, or ArrowRight; ArrowUp and ArrowDown move within a
 * level, ArrowLeft closes a submenu, Enter chooses, Escape closes the menu. Focus stays
 * in the cell editor: the menu keeps its own keyboard position.
 */
function openCellMenu(view: EditorView, target: CellTarget, event: MouseEvent) {
  closeCellMenu();
  const location = cellAt(view.state, target.start, target.row, target.column);
  if (!location) return;
  // A read-only editor shows the entries but offers none of them.
  const readOnly = view.state.readOnly;
  const ids = applicable(view.state, location);
  const stack: MenuLevel[] = [];

  const run = (id: CommandId) => {
    close();
    // The right-clicked cell becomes the active one first, in a transaction of its own, so
    // the host's undo records the outer caret in that cell and an undo of the command
    // returns there (a padded cell is written by the command itself).
    const { cell } = location;
    if (!cell.missing && activeLocation(view.state)?.cell.from !== cell.from) {
      view.dispatch({
        selection: EditorSelection.cursor(cell.from),
        effects: activateCellAt(cell.from, cell.to - cell.from),
      });
    }
    const made = COMMANDS[id](view.state, location);
    if (!made) return;
    const spec = KEEPS_CELL.has(id) ? keepingCaret(view, location, made) : made;
    // A handle's command keeps its row or column selected, wherever the active cell lands.
    view.dispatch(target.handle ? keepLineSelected(view.state, spec, target.handle) : spec);
  };

  const level = (element: HTMLElement, entries: MenuEntry[]): MenuLevel => {
    const made = { element, entries, index: -1 };
    for (const [i, entry] of entries.entries()) {
      element.append(entry.element);
      entry.element.addEventListener("mouseenter", () => {
        closeBelow(made);
        focus(made, i);
        if (entry.submenu && !entry.disabled) openSubmenu(entry);
      });
      entry.element.addEventListener("click", (click) => {
        click.stopPropagation();
        if (entry.disabled) return;
        if (entry.submenu) openSubmenu(entry);
        else entry.choose?.();
      });
    }
    return made;
  };

  const commands = (entries: readonly (readonly [CommandId, string])[]) =>
    entries
      .filter(([id]) => ids.has(id))
      .map(([id, label]) => ({
        element: entryElement(label, readOnly),
        disabled: readOnly,
        choose: () => run(id),
      }));

  const parent = (label: string, entries: readonly (readonly [CommandId, string])[]) => {
    const element = entryElement(label, readOnly);
    element.setAttribute("aria-haspopup", "menu");
    const arrow = document.createElement("span");
    arrow.className = "cm-md-cell-menu-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";
    element.append(arrow);
    const sub = menuElement(true);
    sub.hidden = true;
    sub.setAttribute("aria-label", label);
    element.append(sub);
    return {
      element,
      disabled: readOnly,
      submenu: level(sub, commands(entries)),
    };
  };

  // An entry of the rectangle's menu: it acts on the selection, which stays as it is.
  const action = (label: string, act: () => unknown): MenuEntry => ({
    element: entryElement(label, readOnly),
    disabled: readOnly,
    choose: () => {
      close();
      act();
    },
  });
  const aligned = (alignment: Alignment) => () => {
    const selected = rectangle(view.state);
    const spec = selected && alignCellsAt(view.state, selected, alignment);
    if (spec) view.dispatch(spec);
  };
  const selected = target.rect ? rectangle(view.state) : null;
  const rectEntries = (rect: Selected) => [
    action("Cut", () => copyCells(view) && clearCells(view)),
    action("Copy", () => copyCells(view)),
    action("Paste", () => pasteCells(view)),
    action("Align left", aligned("left")),
    action("Align center", aligned("center")),
    action("Align right", aligned("right")),
    action("Clear cells", () => clearCells(view)),
    ...(deletable(rect).any ? [action("Delete cells", () => deleteCells(view))] : []),
  ];

  const menu = menuElement(false);
  menu.setAttribute("aria-label", "Table");
  // A handle's menu is flat: the row's six commands, or the sorts then the column's. So is
  // a rectangle's: the clipboard, the aligns, and clearing or deleting its cells.
  const root = level(
    menu,
    selected
      ? rectEntries(selected)
      : target.handle === "row"
        ? commands(ROW_ENTRIES)
        : target.handle === "column"
          ? commands([...SORT_ENTRIES, ...COLUMN_ENTRIES])
          : [
              parent("Row", ROW_ENTRIES),
              parent("Column", COLUMN_ENTRIES),
              ...commands(SORT_ENTRIES),
            ],
  );
  stack.push(root);

  function focus(at: MenuLevel, index: number) {
    at.index = index;
    for (const [i, entry] of at.entries.entries())
      entry.element.classList.toggle("cm-md-cell-menu-focused", i === index);
  }

  function closeBelow(at: MenuLevel) {
    while (stack.length > 0 && stack.at(-1) !== at) {
      const top = stack.pop();
      if (!top) break;
      top.element.hidden = true;
      focus(top, -1);
    }
  }

  function openSubmenu(entry: MenuEntry) {
    const sub = entry.submenu;
    if (!sub || stack.includes(sub)) return;
    sub.element.hidden = false;
    stack.push(sub);
    const box = entry.element.getBoundingClientRect();
    const { width, height } = sub.element.getBoundingClientRect();
    const right = box.right + width <= window.innerWidth;
    sub.element.style.left = `${Math.max(0, right ? box.right : box.left - width)}px`;
    sub.element.style.top = `${Math.max(0, Math.min(box.top, window.innerHeight - height))}px`;
  }

  const onKey = (key: KeyboardEvent) => {
    const top = stack.at(-1);
    if (!top) return;
    const focused = top.entries[top.index];
    const count = top.entries.length;
    switch (key.key) {
      case "Escape":
        close();
        break;
      case "ArrowDown":
        if (count > 0) focus(top, (top.index + 1) % count);
        break;
      case "ArrowUp":
        if (count > 0) focus(top, (top.index - 1 + count) % count);
        break;
      case "ArrowRight":
        if (focused?.submenu && !focused.disabled) {
          openSubmenu(focused);
          focus(focused.submenu, 0);
        }
        break;
      case "ArrowLeft":
        if (stack.length > 1) {
          const below = stack[stack.length - 2];
          if (below) closeBelow(below);
        }
        break;
      case "Enter":
        if (!focused || focused.disabled) break;
        if (focused.submenu) {
          openSubmenu(focused);
          focus(focused.submenu, 0);
        } else {
          focused.choose?.();
        }
        break;
      default:
        return;
    }
    key.preventDefault();
    key.stopPropagation();
  };
  const onDown = (down: MouseEvent) => {
    if (!(down.target instanceof Node) || !menu.contains(down.target)) close();
  };
  function close() {
    menu.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("scroll", close, true);
    if (openMenu?.close === close) openMenu = null;
  }
  // Keep focus where it is (the cell editor) while the menu is pressed.
  menu.addEventListener("mousedown", (down) => down.preventDefault());
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onDown, true);
  // A scroll of the editor, or of the page around it, closes the menu.
  document.addEventListener("scroll", close, true);
  openMenu = { view, close };

  view.dom.append(menu);
  const { width, height } = menu.getBoundingClientRect();
  const x = Math.max(0, Math.min(event.clientX, window.innerWidth - width));
  const y = Math.max(0, Math.min(event.clientY, window.innerHeight - height));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

/**
 * An add bar's command: add row below on the last row (its first cell), or add column to
 * the right on the last column (the header's cell), each activating the new cell.
 */
function addFromBar(view: EditorView, start: number, bar: AddBar) {
  const { state } = view;
  const probe = state.readOnly ? null : cellAt(state, start, 0, 0);
  if (!probe) return;
  const location =
    bar === "row"
      ? cellAt(state, start, probe.rows.length - 1, 0)
      : cellAt(state, start, 0, alignments(state, probe.table.node).length - 1);
  const spec =
    location && (bar === "row" ? insertRowBelowAt : insertColumnRightAt)(state, location);
  if (spec) view.dispatch(spec);
}

/**
 * A handle's drop: moves row or column `from` to `to` in one transaction, which keeps the
 * moved row or column selected with its first cell active.
 */
function moveFromHandle(view: EditorView, start: number, kind: LineKind, from: number, to: number) {
  const { state } = view;
  if (state.readOnly) return;
  const location = kind === "row" ? cellAt(state, start, from, 0) : cellAt(state, start, 0, from);
  const spec =
    location &&
    (kind === "row" ? moveRowToAt(state, location, to) : moveColumnToAt(state, location, to));
  if (!location || !spec) return;
  view.dispatch(keepLineSelected(state, keepingCaret(view, location, spec), kind));
}

/**
 * The table surface for the outer editor: the cell menu, opened on right-click and closed
 * by any document change and when the editor is destroyed (taking its document listeners
 * with it), the add bars' commands, the handles' drop, and Backspace or Delete on a
 * rectangle.
 */
export const tableCellMenu: Extension = [
  cellMenu.of(openCellMenu),
  tableAddBar.of(addFromBar),
  tableMove.of(moveFromHandle),
  tableCellsDelete.of(deleteFromKey),
  ViewPlugin.define((view) => ({
    update(update: ViewUpdate) {
      if (update.docChanged && openMenu?.view === view) closeCellMenu();
    },
    destroy() {
      if (openMenu?.view === view) closeCellMenu();
    },
  })),
];
