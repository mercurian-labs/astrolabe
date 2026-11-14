import { useSyncExternalStore } from "react";

import { rowDocument, type BaseCellValue } from "./baseCells";
import { BaseLayout, type BaseLayoutHost } from "./baseLayout";
import type { WikiEditorPage } from "./mobilePageController";

const isNoteProperty = (column: string) =>
  !column.startsWith("file.") && !column.startsWith("formula.") && !column.startsWith("this.");
const isEditableNote = (file: string) => /\.md$/i.test(file) && rowDocument({ file }) !== null;

/** Cells of notes edit in place; a board's cards move between groups. */
function editingHost(
  groupProperty: string | undefined,
  onEdit: (file: string, property: string, value: BaseCellValue) => void,
): Pick<BaseLayoutHost, "canEdit" | "onEdit" | "onMove" | "moveByPicker"> {
  return {
    moveByPicker: true,
    canEdit: (row, column) => isEditableNote(row.file) && isNoteProperty(column),
    onEdit: (row, column, value) => onEdit(row.file, column, value),
    onMove: (row, group) => {
      if (groupProperty !== undefined && isNoteProperty(groupProperty)) {
        onEdit(row.file, groupProperty, group);
      }
    },
  };
}

/**
 * A base's view on the phone, a ```base block's or a `.base` file's: the app runs it and keeps
 * the page's copy current. One view, the one the app picked (a block's first); each row's name
 * opens its note. A map view lists its places, and repository images show as blanks outside a
 * board.
 */
export function BaseBlock({
  page,
  source,
  onOpenNote,
  onOpenUrl,
  onEdit,
  renderImage,
}: {
  readonly page: WikiEditorPage;
  readonly source: string;
  /** Follows a link, or opens a file; `from` is the file a cell's link is written in. */
  readonly onOpenNote: (name: string, from?: string) => void;
  readonly onOpenUrl?: (href: string) => void;
  /** Sets a note's property, where the base shown alone edits in place. */
  readonly onEdit?: (file: string, property: string, value: BaseCellValue) => void;
  /** A repository file as an image, where the page can reach one; else it shows blank. */
  readonly renderImage?: BaseLayoutHost["renderImage"];
}) {
  const base = useSyncExternalStore(
    (listener) => page.watchBase(source, listener),
    () => page.getBase(source),
  );
  const host: BaseLayoutHost = {
    canOpenRow: (row) => rowDocument(row) !== null,
    openRow: (row) => {
      const document = rowDocument(row);
      if (document !== null) onOpenNote(document);
    },
    openLink: onOpenNote,
    ...(onOpenUrl ? { openUrl: onOpenUrl } : {}),
    ...(renderImage ? { renderImage } : {}),
    ...(onEdit && base?.result
      ? editingHost(base.result.settings?.groupBy?.property ?? base.result.groupBy?.id, onEdit)
      : {}),
  };
  return (
    <div className="base-view">
      {base?.result?.warnings?.length ? (
        <ul className="base-error">
          {base.result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {base?.result ? (
        <BaseLayout result={base.result} host={host} />
      ) : base?.error ? (
        <p className="base-error">{base.error}</p>
      ) : (
        <p className="bl-muted">Loading the base…</p>
      )}
    </div>
  );
}
