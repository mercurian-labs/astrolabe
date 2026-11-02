import { Fragment, useSyncExternalStore } from "react";

import { cellParts, isNameColumn, type BaseCellValue } from "./baseCells";
import type { WikiEditorPage } from "./mobilePageController";
import type { WikiEditorBaseResult } from "./protocol";

type Row = WikiEditorBaseResult["rows"][number];

function Cell({
  value,
  onOpenNote,
}: {
  readonly value: BaseCellValue | undefined;
  readonly onOpenNote: (name: string) => void;
}) {
  // Each part keyed by where its text starts, which is unique within the cell.
  let at = 0;
  return cellParts(value ?? null).map((part) => {
    const key = `${part.kind}@${at}`;
    at += part.text.length;
    return part.kind === "text" ? (
      <Fragment key={key}>{part.text}</Fragment>
    ) : (
      <button key={key} type="button" className="base-link" onClick={() => onOpenNote(part.name)}>
        {part.text}
      </button>
    );
  });
}

const groupText = (result: WikiEditorBaseResult, group: BaseCellValue | undefined) => {
  const text = cellParts(group ?? null)
    .map((part) => part.text)
    .join("");
  return `${result.groupBy?.label ?? "Group"}: ${text || "None"}`;
};

const opensGroup = (result: WikiEditorBaseResult, position: number) =>
  result.groupBy !== null &&
  (position === 0 ||
    JSON.stringify(result.rows[position]?.group ?? null) !==
      JSON.stringify(result.rows[position - 1]?.group ?? null));

function Results({
  result,
  onOpenNote,
}: {
  readonly result: WikiEditorBaseResult;
  readonly onOpenNote: (name: string) => void;
}) {
  if (result.rows.length === 0) return <p className="base-muted">No notes match this view.</p>;
  const properties = result.columns.filter((column) => !isNameColumn(column.id));
  const name = (row: Row) => (
    <button type="button" className="base-link base-name" onClick={() => onOpenNote(row.name)}>
      {row.name}
    </button>
  );
  const footer = result.truncated ? (
    <p className="base-muted">{`Showing ${result.rows.length} of ${result.total} notes.`}</p>
  ) : null;
  if (result.view.type === "cards") {
    return (
      <>
        {result.rows.map((row, position) => (
          <Fragment key={row.file}>
            {opensGroup(result, position) ? (
              <p className="base-group">{groupText(result, row.group)}</p>
            ) : null}
            <article className="base-card">
              {name(row)}
              {properties.map((column) => (
                <p key={column.id} className="base-fact">
                  <span className="base-muted">{column.label}</span>{" "}
                  <Cell value={row.values[column.id]} onOpenNote={onOpenNote} />
                </p>
              ))}
            </article>
          </Fragment>
        ))}
        {footer}
      </>
    );
  }
  return (
    <>
      <div className="base-scroll">
        <table className="base-table">
          <thead>
            <tr>
              <th>Name</th>
              {properties.map((column) => (
                <th key={column.id}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, position) => (
              <Fragment key={row.file}>
                {opensGroup(result, position) ? (
                  <tr>
                    <td className="base-group" colSpan={properties.length + 1}>
                      {groupText(result, row.group)}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td>{name(row)}</td>
                  {properties.map((column) => (
                    <td key={column.id}>
                      <Cell value={row.values[column.id]} onOpenNote={onOpenNote} />
                    </td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
    </>
  );
}

/**
 * A base's view on the phone, a ```base block's or a `.base` file's: the app runs it and keeps
 * the page's copy current. One view, the one the app picked (a block's first); each row's name
 * opens its note.
 */
export function BaseBlock({
  page,
  source,
  onOpenNote,
}: {
  readonly page: WikiEditorPage;
  readonly source: string;
  readonly onOpenNote: (name: string) => void;
}) {
  const base = useSyncExternalStore(
    (listener) => page.watchBase(source, listener),
    () => page.getBase(source),
  );
  return (
    <div className="base-view">
      {base?.result ? (
        <Results result={base.result} onOpenNote={onOpenNote} />
      ) : base?.error ? (
        <p className="base-error">{base.error}</p>
      ) : (
        <p className="base-muted">Loading the base…</p>
      )}
    </div>
  );
}
