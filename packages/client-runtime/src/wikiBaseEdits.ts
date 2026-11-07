import { isDocumentFile } from "@mercurian/wiki/resolve-link";
import type { WikiBaseCell, WikiBaseEdit, WikiBaseFilter } from "@t3tools/contracts";

/**
 * The edits a base's view holds unsaved, with `edit` added. A setting changed twice keeps one
 * edit, so dragging a column's width leaves one change, not one per pixel.
 */
export function withEdit(
  edits: ReadonlyArray<WikiBaseEdit>,
  edit: WikiBaseEdit,
): ReadonlyArray<WikiBaseEdit> {
  const last = edits.at(-1);
  if (
    edit.kind === "view" &&
    last?.kind === "view" &&
    last.base === edit.base &&
    last.view === edit.view &&
    last.name === undefined &&
    last.type === undefined &&
    edit.name === undefined &&
    edit.type === undefined
  ) {
    return [...edits.slice(0, -1), { ...last, settings: { ...last.settings, ...edit.settings } }];
  }
  if (edit.kind === "property") {
    const kept = edits.filter(
      (entry) =>
        !(
          entry.kind === "property" &&
          entry.file === edit.file &&
          noteKey(entry.property) === noteKey(edit.property)
        ),
    );
    return [...kept, edit];
  }
  return [...edits, edit];
}

/**
 * `edit` added behind the first `sent` edits, which are on their way to the server as they stand,
 * so it can't fold into one of them.
 */
export const withUnsentEdit = (
  edits: ReadonlyArray<WikiBaseEdit>,
  sent: number,
  edit: WikiBaseEdit,
): ReadonlyArray<WikiBaseEdit> => [...edits.slice(0, sent), ...withEdit(edits.slice(sent), edit)];

const noteKey = (property: string) =>
  property.startsWith("note.") ? property.slice("note.".length) : property;

/** Whether a column holds a note's own property, as opposed to a file field or a formula. */
export const isNoteProperty = (column: string): boolean =>
  !column.startsWith("file.") && !column.startsWith("formula.") && !column.startsWith("this.");

/** Whether a base's view may edit a row's file: a note, not a skill map. */
export const isEditableNote = (file: string): boolean =>
  /\.md$/i.test(file) && isDocumentFile(file);

/** A property id as a view's `order` keeps a note's: bare, as Obsidian writes it. */
export const orderId = (property: string): string => noteKey(property);

const EQUALS =
  /^\s*(?:note\.)?([\p{L}_][\p{L}\p{N}_-]*)\s*==\s*(?:"([^"]*)"|'([^']*)'|(-?\d+(?:\.\d+)?)|(true|false))\s*$/u;
const HAS_TAG = /^\s*file\.hasTag\(\s*["']([^"']+)["']\s*\)\s*$/;

/**
 * The properties a new note needs to show in a view: what its plain `x == value` and
 * `file.hasTag("t")` filters ask for (under `and`, or alone), and the group it was made in.
 */
export function newNoteProperties(
  filters: WikiBaseFilter | undefined,
  group: { readonly property: string; readonly value: WikiBaseCell } | undefined,
): Readonly<Record<string, WikiBaseCell>> {
  const properties: Record<string, WikiBaseCell> = {};
  const statements =
    filters === undefined
      ? []
      : typeof filters === "string"
        ? [filters]
        : "and" in filters
          ? filters.and.filter((item): item is string => typeof item === "string")
          : [];
  const tags: string[] = [];
  for (const statement of statements) {
    const tag = HAS_TAG.exec(statement)?.[1];
    if (tag) {
      tags.push(tag);
      continue;
    }
    const match = EQUALS.exec(statement);
    if (!match?.[1]) continue;
    const [, name, double, single, number, boolean] = match;
    properties[name] =
      double ?? single ?? (number !== undefined ? Number(number) : boolean === "true");
  }
  if (tags.length) properties.tags = tags;
  if (group && isNoteProperty(group.property) && group.value !== null) {
    properties[noteKey(group.property)] = group.value;
  }
  return properties;
}
