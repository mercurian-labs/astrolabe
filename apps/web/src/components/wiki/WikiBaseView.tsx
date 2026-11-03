import { cellParts, isNameColumn, type BaseCellValue } from "@mercurian/wiki-editor/base-cells";
import type {
  EnvironmentId,
  WikiChangeRequestId,
  WikiId,
  WikiQueryResult,
} from "@t3tools/contracts";
import { TriangleAlertIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { TabHeader } from "~/panes/TabHeader";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { describeWikiFailure, wikiDocumentName } from "./wiki.logic";
import { WikiPart } from "./WikiParts";

/** A base by name (a `.base` file, or a note's first block), or a block's source in `note`. */
export type WikiBaseSource =
  | { readonly base: string }
  | { readonly source: string; readonly note: string };

type Row = WikiQueryResult["rows"][number];
type Column = WikiQueryResult["columns"][number];
type Summary = NonNullable<WikiQueryResult["summaries"]>[number];

/** How a row's own name opens: a wiki document by name, any other file as a file. */
interface RowOpeners {
  readonly onOpenNote: (name: string) => void;
  /** Absent where files can't open; such rows show their name as text. */
  readonly onOpenFile?: ((file: string) => void) | undefined;
}

const NAME_COLUMN: Column = { id: "file.basename", label: "Name" };

function CellValue({
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
      <WikiPart.NoteLink key={key} onClick={() => onOpenNote(part.name)}>
        {part.text}
      </WikiPart.NoteLink>
    );
  });
}

/** The row's own file, under a name or path column, opening as a document or a file. */
function RowName({
  row,
  column,
  openers,
  className,
}: {
  readonly row: Row;
  readonly column?: Column;
  readonly openers: RowOpeners;
  readonly className?: string;
}) {
  const path = column === undefined ? undefined : row.values[column.id];
  const text = column?.id === "file.path" && typeof path === "string" ? path : row.name;
  const document = wikiDocumentName(row.file);
  const { onOpenFile } = openers;
  if (document === null && onOpenFile === undefined)
    return <span className={className}>{text}</span>;
  return (
    <WikiPart.NoteLink
      className={className}
      onClick={() => (document === null ? onOpenFile?.(row.file) : openers.onOpenNote(document))}
    >
      {text}
    </WikiPart.NoteLink>
  );
}

/** A summary row: each summarized column's value under it, as Obsidian shows one. */
function SummaryRow({
  columns,
  summaries,
}: {
  readonly columns: ReadonlyArray<Column>;
  readonly summaries: ReadonlyArray<Summary>;
}) {
  if (summaries.length === 0) return null;
  return (
    <TableRow>
      {columns.map((column, position) => {
        const summary = summaries.find((entry) => entry.column === column.id);
        return (
          <TableCell key={column.id}>
            {summary ? (
              <span className="text-xs text-muted-foreground">
                {`${summary.name} `}
                <span className="font-medium text-foreground">{summary.value}</span>
              </span>
            ) : position === 0 ? (
              <span className="text-xs text-muted-foreground">Summary</span>
            ) : null}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

function groupLabel(result: WikiQueryResult, group: BaseCellValue | undefined): ReactNode {
  const empty = group === undefined || group === null || (Array.isArray(group) && !group.length);
  return `${result.groupBy?.label ?? "Group"}: ${
    empty
      ? "None"
      : cellParts(group)
          .map((part) => part.text)
          .join("")
  }`;
}

/** Whether `rows[position]` opens a new group of a grouped view. */
const startsGroup = (result: WikiQueryResult, position: number) =>
  result.groupBy !== null &&
  (position === 0 ||
    JSON.stringify(result.rows[position]?.group ?? null) !==
      JSON.stringify(result.rows[position - 1]?.group ?? null));

/**
 * A base's view: a table, or cards. Every row leads with its file's name, which opens it; a
 * view that shows no name column gets one. List, kanban and map views show as a table for now.
 */
export function WikiBaseResults({
  result,
  onOpenNote,
  onOpenFile,
}: {
  readonly result: WikiQueryResult;
} & RowOpeners) {
  const openers: RowOpeners = { onOpenNote, onOpenFile };
  const columns = result.columns.some((column) => isNameColumn(column.id))
    ? result.columns
    : [NAME_COLUMN, ...result.columns];
  const footer = result.truncated ? (
    <WikiPart.Muted>{`Showing ${result.rows.length} of ${result.total} results.`}</WikiPart.Muted>
  ) : null;
  if (result.rows.length === 0) return <WikiPart.Muted>Nothing matches this view.</WikiPart.Muted>;

  if (result.view.type === "cards") {
    const properties = columns.filter((column) => !isNameColumn(column.id));
    const groups: Array<{ readonly key: number; readonly rows: Row[] }> = [];
    result.rows.forEach((row, position) => {
      if (position === 0 || startsGroup(result, position)) groups.push({ key: position, rows: [] });
      groups.at(-1)?.rows.push(row);
    });
    return (
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-2">
            {result.groupBy ? (
              <h4 className="text-xs font-medium text-muted-foreground">
                {groupLabel(result, group.rows[0]?.group)}
              </h4>
            ) : null}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
              {group.rows.map((row) => (
                <article
                  key={row.file}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3"
                >
                  <RowName row={row} openers={openers} className="font-medium" />
                  {properties.length ? (
                    <dl className="flex flex-col gap-1.5">
                      {properties.map((column) => (
                        <WikiPart.Fact key={column.id} label={column.label}>
                          <CellValue value={row.values[column.id]} onOpenNote={onOpenNote} />
                        </WikiPart.Fact>
                      ))}
                    </dl>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ))}
        {footer}
      </div>
    );
  }

  const groupSummaries = (row: Row) =>
    result.groups?.find(
      (group) => JSON.stringify(group.value) === JSON.stringify(row.group ?? null),
    )?.summaries ?? [];
  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.id}>{column.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row, position) => (
            <Fragment key={row.file}>
              {startsGroup(result, position) ? (
                <>
                  <TableRow>
                    <TableCell colSpan={columns.length}>
                      <span className="text-xs font-medium text-muted-foreground">
                        {groupLabel(result, row.group)}
                      </span>
                    </TableCell>
                  </TableRow>
                  <SummaryRow columns={columns} summaries={groupSummaries(row)} />
                </>
              ) : null}
              <TableRow>
                {columns.map((column) => (
                  <TableCell key={column.id}>
                    {isNameColumn(column.id) ? (
                      <RowName row={row} column={column} openers={openers} />
                    ) : (
                      <CellValue value={row.values[column.id]} onOpenNote={onOpenNote} />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </Fragment>
          ))}
          <SummaryRow columns={columns} summaries={result.summaries ?? []} />
        </TableBody>
      </Table>
      {footer}
    </div>
  );
}

/**
 * One view of a base, run on the server over the notes the tab reads (main, or a change
 * request's head), with a picker when the base has more than one view. Read only.
 */
export function WikiBase({
  environmentId,
  wikiId,
  changeRequestId,
  from,
  onOpenNote,
  onOpenFile,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly from: WikiBaseSource;
} & RowOpeners) {
  const [view, setView] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    wikiEnvironment.query({
      environmentId,
      input: {
        wikiId,
        ...(changeRequestId === undefined ? {} : { changeRequestId }),
        ...from,
        ...(view === null ? {} : { view }),
      },
    }),
  );
  const result = query.data;
  if (result === null) {
    return query.error !== null ? (
      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertTitle>This base can't be shown</AlertTitle>
        <AlertDescription>{describeWikiFailure(query.failure ?? query.error)}</AlertDescription>
      </Alert>
    ) : (
      <div className="flex justify-center py-4">
        <Spinner size="md" tone="muted" />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {result.views.length > 1 ? (
        <Select
          value={result.view.name}
          items={Object.fromEntries(result.views.map((name) => [name, name]))}
          onValueChange={(value) => {
            if (typeof value === "string") setView(value);
          }}
        >
          <SelectTrigger size="compact" aria-label="View">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {result.views.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      <WikiBaseResults result={result} onOpenNote={onOpenNote} onOpenFile={onOpenFile} />
    </div>
  );
}

/** A `.base` file opened in its own tab: its view, read only. */
export function WikiBasePage({
  environmentId,
  wikiId,
  file,
  changeRequestId,
  parent,
  onOpenNote,
  onOpenFile,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly file: string;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** Where the base is read from, as the tab header names it. */
  readonly parent: string;
} & RowOpeners) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabHeader.Root>
        <TabHeader.Title label="Base" parent={parent}>
          {file.replace(/\.base$/, "")}
        </TabHeader.Title>
        <TabHeader.Status>Base · read only</TabHeader.Status>
      </TabHeader.Root>
      <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 pt-6 pb-12">
          <WikiBase
            environmentId={environmentId}
            wikiId={wikiId}
            changeRequestId={changeRequestId}
            from={{ base: file }}
            onOpenNote={onOpenNote}
            onOpenFile={onOpenFile}
          />
        </div>
      </div>
    </div>
  );
}
