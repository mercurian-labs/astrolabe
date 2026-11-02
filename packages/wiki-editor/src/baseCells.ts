import { wikilinkNoteName } from "./incoming";

/** One property of a row in a base's view, as the server sends it. */
export type BaseScalar = null | boolean | number | string;
export type BaseCellValue = BaseScalar | ReadonlyArray<BaseScalar>;

export type BaseCellPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "link"; readonly name: string; readonly text: string };

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const WIKILINK = /\[\[([^\]\n]+)\]\]/g;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function scalarParts(value: BaseScalar): BaseCellPart[] {
  if (value === null) return [];
  if (typeof value === "boolean") return [{ kind: "text", text: value ? "Yes" : "No" }];
  if (typeof value === "number") return [{ kind: "text", text: String(value) }];
  if (ISO_TIME.test(value)) return [{ kind: "text", text: dateFormat.format(Date.parse(value)) }];
  const parts: BaseCellPart[] = [];
  let at = 0;
  for (const match of value.matchAll(WIKILINK)) {
    const inner = match[1] ?? "";
    const name = wikilinkNoteName(inner);
    if (name === null) continue;
    const start = match.index ?? 0;
    if (start > at) parts.push({ kind: "text", text: value.slice(at, start) });
    const alias = inner.includes("|") ? inner.slice(inner.indexOf("|") + 1).trim() : "";
    parts.push({ kind: "link", name, text: alias || name });
    at = start + match[0].length;
  }
  if (at < value.length) parts.push({ kind: "text", text: value.slice(at) });
  return parts;
}

/** A cell as text and note links: `[[Name]]` opens Name; ISO times read as local dates. */
export function cellParts(cell: BaseCellValue): ReadonlyArray<BaseCellPart> {
  if (!Array.isArray(cell)) return scalarParts(cell as BaseScalar);
  const items = cell.map(scalarParts).filter((parts) => parts.length > 0);
  return items.flatMap((parts, position) =>
    position === 0 ? parts : [{ kind: "text", text: ", " } as const, ...parts],
  );
}

/** Whether a column shows the row's own note: its name or path. */
export const isNameColumn = (id: string): boolean =>
  id === "file.name" || id === "file.basename" || id === "file.path";
