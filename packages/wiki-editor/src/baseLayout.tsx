/**
 * A base's view drawn as Obsidian draws it: a table, cards, a list, a board, or a map. Shared by
 * the web app and the phone's editor page, which each supply what only they can do (open a file,
 * show a repository image, draw a map) and, where a view can be edited, the edits.
 */
import { Fragment, useState, type DragEvent, type ReactNode } from "react";

import { cellParts, isNameColumn, type BaseCellValue, type BaseScalar } from "./baseCells";
import type {
  WikiEditorBaseDisplay,
  WikiEditorBaseImage,
  WikiEditorBaseResult,
  WikiEditorBaseRow,
  WikiEditorBaseSummary,
} from "./protocol";

type Row = WikiEditorBaseRow;
type Column = WikiEditorBaseResult["columns"][number];

export interface BaseLayoutHost {
  /** Whether a row's own file opens here; one that doesn't shows its name as text. */
  readonly canOpenRow: (row: Row) => boolean;
  readonly openRow: (row: Row) => void;
  /** A `[[Name]]` in a cell. */
  /** Follows a link in a cell, which is written in `from`, the row's file, when it's known. */
  readonly openLink: (name: string, from?: string) => void;
  readonly openUrl?: (href: string) => void;
  /** A repository file as an image; web addresses and colours draw without help. */
  readonly renderImage?: (image: WikiEditorBaseImage, className: string) => ReactNode;
  /** A Lucide icon by name; its name as text without one. */
  readonly renderIcon?: (name: string) => ReactNode;
  /** HTML a formula made, made safe; its text without one. */
  readonly renderHtml?: (html: string) => ReactNode;
  /** The map of a map view; its places as a list without one. */
  readonly renderMap?: (result: WikiEditorBaseResult) => ReactNode;
  /** Editing, where the view allows it: a cell's new value, a card moved to a group, New. */
  readonly canEdit?: (row: Row, column: string) => boolean;
  readonly onEdit?: (row: Row, column: string, value: BaseCellValue) => void;
  readonly onMove?: (row: Row, group: BaseCellValue) => void;
  /** A touch screen can't drag a card, so each gets a picker of the board's groups instead. */
  readonly moveByPicker?: boolean;
  readonly onNew?: (group: BaseCellValue | undefined) => void;
  /** Wraps a column's heading, as a menu's trigger. */
  readonly columnHeading?: (column: Column, label: ReactNode) => ReactNode;
  readonly onResize?: (column: string, width: number) => void;
}

const NAME_COLUMN: Column = { id: "file.basename", label: "Name" };
const ROW_HEIGHTS: Readonly<Record<string, string>> = {
  short: "bl-row-short",
  medium: "bl-row-medium",
  tall: "bl-row-tall",
  "extra-tall": "bl-row-extra-tall",
};

const sameValue = (a: BaseCellValue | undefined, b: BaseCellValue | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isEmpty = (value: BaseCellValue | undefined) =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);

/** A cell's value as the text an editor starts from. */
const editText = (value: BaseCellValue | undefined): string =>
  value === undefined || value === null
    ? ""
    : Array.isArray(value)
      ? value.map((item) => (item === null ? "" : String(item))).join(", ")
      : String(value);

/** What a person typed, in the type the cell held: a number stays one, a list splits at commas. */
export function parseCellText(text: string, previous: BaseCellValue | undefined): BaseCellValue {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (Array.isArray(previous)) {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof previous === "number" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

/** A date written without a time, as the device writes dates: Obsidian's `02/29/2024`. */
const localDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

function DefaultImage({ image, className }: { image: WikiEditorBaseImage; className: string }) {
  if (image.kind === "color") {
    return <span className={`${className} bl-color`} style={{ background: image.color }} />;
  }
  if (image.kind === "url") {
    return <img className={className} src={image.url} alt="" loading="lazy" decoding="async" />;
  }
  return <span className={className} data-image-missing />;
}

function Image({
  image,
  className,
  host,
}: {
  image: WikiEditorBaseImage;
  className: string;
  host: BaseLayoutHost;
}) {
  if (image.kind === "file" && host.renderImage) return host.renderImage(image, className);
  return <DefaultImage image={image} className={className} />;
}

function Scalar({
  value,
  from,
  host,
}: {
  value: BaseScalar;
  from: string | undefined;
  host: BaseLayoutHost;
}) {
  if (typeof value === "boolean") {
    return <input type="checkbox" className="bl-check" checked={value} disabled readOnly />;
  }
  // Each part keyed by where its text starts, which is unique within the cell.
  const parts = cellParts(value);
  const starts: number[] = [];
  let offset = 0;
  for (const part of parts) {
    starts.push(offset);
    offset += part.text.length;
  }
  return parts.map((part, position) => {
    const key = `${part.kind}@${starts[position]}`;
    return part.kind === "text" ? (
      <Fragment key={key}>{part.text}</Fragment>
    ) : (
      <button
        key={key}
        type="button"
        className="bl-link"
        onClick={() => host.openLink(part.name, from)}
      >
        {part.text}
      </button>
    );
  });
}

/** A cell's value: rich where the server says so, else text and links, lists spaced apart. */
export function BaseCell({
  value,
  display,
  tags = false,
  from,
  host,
}: {
  readonly value: BaseCellValue | undefined;
  readonly display?: WikiEditorBaseDisplay | undefined;
  /** The file the cell's links are written in: its row's. */
  readonly from?: string | undefined;
  /** File tags show as pills, without their `#`. */
  readonly tags?: boolean;
  readonly host: BaseLayoutHost;
}) {
  if (display !== undefined) {
    switch (display.kind) {
      case "date":
        return <span className="bl-date">{localDate(display.date)}</span>;
      case "url":
        return (
          <a
            className="bl-link bl-url"
            href={display.href}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (!host.openUrl) return;
              event.preventDefault();
              host.openUrl(display.href);
            }}
          >
            {display.text}
          </a>
        );
      case "html":
        return host.renderHtml
          ? host.renderHtml(display.html)
          : display.html.replace(/<[^>]*>/g, "");
      case "icon":
        return host.renderIcon ? host.renderIcon(display.name) : display.name;
      case "image":
        return <Image image={display.image} className="bl-cell-image" host={host} />;
      case "error":
        return <span className="bl-error">{display.message}</span>;
    }
  }
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return <Scalar value={value} from={from} host={host} />;
  return (
    <span className="bl-items">
      {value.map((item, position) =>
        item === null ? null : tags && typeof item === "string" ? (
          // oxlint-disable-next-line react/no-array-index-key -- a list's items can repeat
          <span key={position} className="bl-tag">
            {item.replace(/^#/, "")}
          </span>
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- a list's items can repeat
          <span key={position}>
            <Scalar value={item} from={from} host={host} />
          </span>
        ),
      )}
    </span>
  );
}

/** A cell that edits in place where the host allows it: a checkbox toggles, anything else types. */
function EditableCell({
  row,
  column,
  host,
}: {
  readonly row: Row;
  readonly column: string;
  readonly host: BaseLayoutHost;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = row.values[column];
  const editable = host.canEdit?.(row, column) === true && host.onEdit !== undefined;
  const shown = (
    <BaseCell
      value={value}
      display={row.display?.[column]}
      tags={column === "file.tags"}
      from={row.file}
      host={host}
    />
  );
  if (!editable) return shown;
  if (typeof value === "boolean") {
    return (
      <input
        type="checkbox"
        className="bl-check"
        checked={value}
        aria-label={column}
        onChange={() => host.onEdit?.(row, column, !value)}
      />
    );
  }
  if (draft === null) {
    return (
      // Not a <button>: a cell's links are buttons, which can't nest in one.
      <div
        role="button"
        tabIndex={0}
        className="bl-editable"
        aria-label={`Edit ${column} of ${row.name}`}
        onClick={(event) => {
          // A link inside the cell opens; anywhere else starts editing.
          if ((event.target as HTMLElement).closest(".bl-link")) return;
          setDraft(editText(value));
        }}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && event.key === "Enter") {
            setDraft(editText(value));
          }
        }}
      >
        {shown}
      </div>
    );
  }
  const commit = () => {
    const next = parseCellText(draft, value);
    setDraft(null);
    if (!sameValue(next, value)) host.onEdit?.(row, column, next);
  };
  return (
    <input
      className="bl-input"
      autoFocus
      value={draft}
      aria-label={`${column} of ${row.name}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}

function RowName({ row, host, className }: { row: Row; host: BaseLayoutHost; className?: string }) {
  const text = row.name;
  if (!host.canOpenRow(row)) return <span className={className}>{text}</span>;
  return (
    <button
      type="button"
      className={`bl-link${className ? ` ${className}` : ""}`}
      onClick={() => host.openRow(row)}
    >
      {text}
    </button>
  );
}

function groupText(group: BaseCellValue | undefined): string {
  if (isEmpty(group)) return "None";
  return cellParts(group ?? null)
    .map((part) => part.text)
    .join("");
}

/** The view's rows split at each new group, in order; one run when the view isn't grouped. */
function groupRuns(result: WikiEditorBaseResult) {
  const runs: Array<{
    readonly key: number;
    readonly value: BaseCellValue | undefined;
    rows: Row[];
  }> = [];
  result.rows.forEach((row, position) => {
    const opens =
      position === 0 || (result.groupBy !== null && !sameValue(row.group, runs.at(-1)?.value));
    if (opens) runs.push({ key: position, value: row.group, rows: [] });
    runs.at(-1)?.rows.push(row);
  });
  return runs;
}

const summariesOf = (result: WikiEditorBaseResult, group: BaseCellValue | undefined) =>
  result.groups?.find((entry) => sameValue(entry.value, group))?.summaries ?? [];

function SummaryRow({
  columns,
  summaries,
}: {
  readonly columns: ReadonlyArray<Column>;
  readonly summaries: ReadonlyArray<WikiEditorBaseSummary>;
}) {
  if (!summaries.length) return null;
  return (
    <tr className="bl-summary">
      {columns.map((column, position) => {
        const summary = summaries.find((entry) => entry.column === column.id);
        return (
          <td key={column.id}>
            {summary ? (
              <>
                <span className="bl-muted">{`${summary.name} `}</span>
                <span>{summary.value}</span>
              </>
            ) : position === 0 ? (
              <span className="bl-muted">Summary</span>
            ) : null}
          </td>
        );
      })}
    </tr>
  );
}

function ResizeHandle({ column, host }: { column: string; host: BaseLayoutHost }) {
  if (!host.onResize) return null;
  return (
    <span
      className="bl-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${column}`}
      onPointerDown={(event) => {
        const cell = (event.currentTarget.parentElement as HTMLElement | null) ?? undefined;
        if (!cell) return;
        event.preventDefault();
        const start = event.clientX;
        const width = cell.getBoundingClientRect().width;
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        let next = width;
        const move = (moved: PointerEvent) => {
          next = Math.max(48, Math.round(width + moved.clientX - start));
          cell.style.width = `${next}px`;
        };
        const end = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", end);
          if (next !== width) host.onResize?.(column, next);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
      }}
    />
  );
}

function TableView({ result, host }: { result: WikiEditorBaseResult; host: BaseLayoutHost }) {
  const columns = result.columns.some((column) => isNameColumn(column.id))
    ? result.columns
    : [NAME_COLUMN, ...result.columns];
  const widths = result.settings?.columnSize ?? {};
  const height = ROW_HEIGHTS[result.settings?.rowHeight ?? ""] ?? "bl-row-medium";
  const numeric = (column: Column) =>
    result.rows.some((row) => typeof row.values[column.id] === "number");
  return (
    <div className="bl-scroll">
      <table className={`bl-table ${height}`}>
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.id}
              style={widths[column.id] ? { width: `${widths[column.id]}px` } : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                className={numeric(column) ? "bl-number" : undefined}
                style={widths[column.id] ? { width: `${widths[column.id]}px` } : undefined}
              >
                {host.columnHeading ? host.columnHeading(column, column.label) : column.label}
                <ResizeHandle column={column.id} host={host} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupRuns(result).map((run) => (
            <Fragment key={run.key}>
              {result.groupBy ? (
                <>
                  <tr className="bl-group-row">
                    <td colSpan={columns.length}>
                      <span className="bl-group">
                        {groupText(run.value)}
                        <span className="bl-count">{run.rows.length}</span>
                      </span>
                    </td>
                  </tr>
                  <SummaryRow columns={columns} summaries={summariesOf(result, run.value)} />
                </>
              ) : null}
              {run.rows.map((row) => (
                <tr key={row.file}>
                  {columns.map((column) => (
                    <td key={column.id} className={numeric(column) ? "bl-number" : undefined}>
                      {isNameColumn(column.id) ? (
                        <RowName row={row} host={host} />
                      ) : (
                        <EditableCell row={row} column={column.id} host={host} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
          <SummaryRow columns={columns} summaries={result.summaries ?? []} />
        </tbody>
      </table>
    </div>
  );
}

function Card({
  row,
  properties,
  result,
  host,
  draggable,
  mover,
}: {
  row: Row;
  properties: ReadonlyArray<Column>;
  result: WikiEditorBaseResult;
  host: BaseLayoutHost;
  draggable?: boolean;
  mover?: ReactNode;
}) {
  const settings = result.settings ?? {};
  const fit = settings.imageFit === "contain" ? "bl-fit-contain" : "bl-fit-cover";
  return (
    <article
      className="bl-card"
      draggable={draggable}
      onDragStart={
        draggable
          ? (event: DragEvent) => {
              event.dataTransfer.setData("application/x-base-row", row.file);
              event.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
    >
      {settings.image ? (
        <div className="bl-cover" style={{ aspectRatio: `1 / ${settings.imageAspectRatio ?? 1}` }}>
          {row.cover ? (
            <Image image={row.cover} className={`bl-cover-image ${fit}`} host={host} />
          ) : null}
        </div>
      ) : null}
      <div className="bl-card-body">
        <RowName row={row} host={host} className="bl-name" />
        {properties.map((column) => (
          <div key={column.id} className="bl-fact">
            <span className="bl-muted">{column.label}</span>
            <span>
              <EditableCell row={row} column={column.id} host={host} />
            </span>
          </div>
        ))}
        {mover}
      </div>
    </article>
  );
}

function CardsView({ result, host }: { result: WikiEditorBaseResult; host: BaseLayoutHost }) {
  const properties = result.columns.filter((column) => !isNameColumn(column.id));
  const size = result.settings?.cardSize ?? 200;
  return (
    <div className="bl-stack">
      {groupRuns(result).map((run) => (
        <section key={run.key} className="bl-stack">
          {result.groupBy ? (
            <h4 className="bl-group">
              {groupText(run.value)}
              <span className="bl-count">{run.rows.length}</span>
            </h4>
          ) : null}
          <div
            className="bl-cards"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${size}px, 100%), 1fr))` }}
          >
            {run.rows.map((row) => (
              <Card key={row.file} row={row} properties={properties} result={result} host={host} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ListView({ result, host }: { result: WikiEditorBaseResult; host: BaseLayoutHost }) {
  const settings = result.settings ?? {};
  const properties = result.columns.filter((column) => !isNameColumn(column.id));
  const marker = settings.markers === "number" ? "ol" : "ul";
  const plain = settings.markers === "none" ? " bl-list-plain" : "";
  const separator = settings.separator ?? ", ";
  const List = marker;
  return (
    <div className="bl-stack">
      {groupRuns(result).map((run) => (
        <section key={run.key}>
          {result.groupBy ? (
            <h4 className="bl-group">
              {groupText(run.value)}
              <span className="bl-count">{run.rows.length}</span>
            </h4>
          ) : null}
          <List className={`bl-list${plain}`}>
            {run.rows.map((row) => {
              const filled = properties.filter(
                (column) => !isEmpty(row.values[column.id]) || row.display?.[column.id],
              );
              return (
                <li key={row.file}>
                  <RowName row={row} host={host} />
                  {settings.indentProperties ? (
                    filled.length ? (
                      <ul className="bl-list">
                        {filled.map((column) => (
                          <li key={column.id}>
                            <BaseCell
                              value={row.values[column.id]}
                              display={row.display?.[column.id]}
                              from={row.file}
                              host={host}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null
                  ) : (
                    filled.map((column) => (
                      <Fragment key={column.id}>
                        {separator}
                        <BaseCell
                          value={row.values[column.id]}
                          display={row.display?.[column.id]}
                          from={row.file}
                          host={host}
                        />
                      </Fragment>
                    ))
                  )}
                </li>
              );
            })}
          </List>
        </section>
      ))}
    </div>
  );
}

function BoardView({ result, host }: { result: WikiEditorBaseResult; host: BaseLayoutHost }) {
  const groupColumn = result.groupBy?.id;
  const properties = result.columns.filter(
    (column) => !isNameColumn(column.id) && column.id !== groupColumn,
  );
  const [over, setOver] = useState<number | null>(null);
  const runs = result.groupBy
    ? (result.groups ?? []).map((group, position) => ({
        key: position,
        value: group.value as BaseCellValue | undefined,
        rows: result.rows.filter((row) => sameValue(row.group, group.value)),
      }))
    : [{ key: 0, value: undefined, rows: [...result.rows] }];
  const movable = (row: Row) =>
    host.onMove !== undefined &&
    groupColumn !== undefined &&
    host.canEdit?.(row, groupColumn) === true;
  return (
    <div className="bl-board">
      {runs.map((run) => (
        <section
          key={run.key}
          className={`bl-column${over === run.key ? " bl-column-over" : ""}`}
          onDragOver={
            host.onMove
              ? (event) => {
                  if (!event.dataTransfer.types.includes("application/x-base-row")) return;
                  event.preventDefault();
                  setOver(run.key);
                }
              : undefined
          }
          onDragLeave={() => setOver(null)}
          onDrop={
            host.onMove
              ? (event) => {
                  event.preventDefault();
                  setOver(null);
                  const file = event.dataTransfer.getData("application/x-base-row");
                  const row = result.rows.find((candidate) => candidate.file === file);
                  if (row && !sameValue(row.group, run.value))
                    host.onMove?.(row, run.value ?? null);
                }
              : undefined
          }
        >
          <h4 className="bl-column-heading">
            <span>{result.groupBy ? groupText(run.value) : result.view.name}</span>
            <span className="bl-count">{run.rows.length}</span>
          </h4>
          <div className="bl-column-cards">
            {run.rows.map((row) => (
              <Card
                key={row.file}
                row={row}
                properties={properties}
                result={result}
                host={host}
                draggable={movable(row) && !host.moveByPicker}
                mover={
                  movable(row) && host.moveByPicker ? (
                    <select
                      className="bl-move"
                      aria-label={`Move ${row.name}`}
                      value={run.key}
                      onChange={(event) => {
                        const target = runs[Number(event.target.value)];
                        if (target) host.onMove?.(row, target.value ?? null);
                      }}
                    >
                      {runs.map((option) => (
                        <option key={option.key} value={option.key}>
                          {groupText(option.value)}
                        </option>
                      ))}
                    </select>
                  ) : undefined
                }
              />
            ))}
          </div>
          {host.onNew ? (
            <button type="button" className="bl-new" onClick={() => host.onNew?.(run.value)}>
              + New
            </button>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function PlacesList({ result, host }: { result: WikiEditorBaseResult; host: BaseLayoutHost }) {
  const placed = result.rows.filter((row) => row.marker !== undefined);
  if (!result.settings?.coordinates) {
    return (
      <p className="bl-muted">
        Choose the property that holds each file's coordinates under Layout.
      </p>
    );
  }
  if (!placed.length) return <p className="bl-muted">No file here has coordinates.</p>;
  return (
    <ul className="bl-list">
      {placed.map((row) => (
        <li key={row.file}>
          <RowName row={row} host={host} />
          <span className="bl-muted">{` ${row.marker?.lat}, ${row.marker?.lng}`}</span>
        </li>
      ))}
    </ul>
  );
}

/** One view's rows, laid out by its type. */
export function BaseLayout({
  result,
  host,
}: {
  readonly result: WikiEditorBaseResult;
  readonly host: BaseLayoutHost;
}) {
  const footer = result.truncated ? (
    <p className="bl-muted">{`Showing ${result.rows.length} of ${result.total} results.`}</p>
  ) : null;
  let body: ReactNode;
  if (result.view.type === "map") {
    body = host.renderMap ? host.renderMap(result) : <PlacesList result={result} host={host} />;
  } else if (result.rows.length === 0 && !(result.view.type === "kanban" && host.onNew)) {
    body = <p className="bl-muted">Nothing matches this view.</p>;
  } else if (result.view.type === "cards") body = <CardsView result={result} host={host} />;
  else if (result.view.type === "list") body = <ListView result={result} host={host} />;
  else if (result.view.type === "kanban") body = <BoardView result={result} host={host} />;
  else body = <TableView result={result} host={host} />;
  return (
    <div className="bl-view">
      {body}
      {footer}
    </div>
  );
}
