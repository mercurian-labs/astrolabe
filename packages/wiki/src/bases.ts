/**
 * Bases: saved questions over a wiki's notes, in Obsidian's `.base` format, so a base written in
 * Obsidian opens here and the other way round. Results are derived on every read, never stored.
 * The language is a documented subset (see `baseExpression.ts`); anything outside it fails with
 * a message naming it, never by matching everything.
 */
import { parseDocument } from "yaml";

import {
  BaseError,
  compileExpression,
  display,
  evaluate,
  FILE_FIELDS,
  fileField,
  isEmptyValue,
  noteProperty,
  sortOrder,
  truthy,
  unsupported,
  type BaseDoc,
  type BaseScope,
  type BaseValue,
  type Expr,
} from "./baseExpression.ts";
import { key, noteName } from "./links.ts";
import { noteProperties, noteTags } from "./properties.ts";
import type { WikiIndex, WikiNote } from "./wikiIndex.ts";

export { BaseError } from "./baseExpression.ts";

export const isBaseFile = (file: string): boolean => file.endsWith(".base");

type Raw = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface BaseViewSpec {
  readonly name: string;
  readonly config: Raw;
}

/** A parsed base: its parts, each checked only when a view that uses it runs. */
export interface WikiBase {
  readonly filters: unknown;
  readonly properties: Readonly<Record<string, { readonly displayName?: string }>>;
  readonly views: ReadonlyArray<BaseViewSpec>;
}

const DEFAULT_VIEW: BaseViewSpec = { name: "Table", config: { type: "table" } };

/** Reads a base's YAML; the expressions inside are checked when a view runs. */
export function parseBase(source: string): WikiBase {
  const document = parseDocument(source, { schema: "core", uniqueKeys: true });
  const firstError = document.errors[0];
  if (firstError) throw new BaseError(`The base is not valid YAML: ${firstError.message}`);
  let data: unknown;
  try {
    data = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new BaseError(`The base is not valid YAML: ${String(error)}`);
  }
  if (data === null || data === undefined) data = {};
  if (!isRecord(data)) throw new BaseError("A base must be a YAML mapping.");
  const properties: Record<string, { displayName?: string }> = {};
  if (data.properties !== undefined) {
    if (!isRecord(data.properties)) throw new BaseError("properties must be a mapping.");
    for (const [id, config] of Object.entries(data.properties)) {
      const displayName = isRecord(config) ? config.displayName : undefined;
      properties[id] = typeof displayName === "string" ? { displayName } : {};
    }
  }
  if (data.views !== undefined && !Array.isArray(data.views)) {
    throw new BaseError("views must be a list.");
  }
  const views = ((data.views ?? []) as unknown[]).map((view, position): BaseViewSpec => {
    if (!isRecord(view)) throw new BaseError(`View ${position + 1} must be a mapping.`);
    const type = typeof view.type === "string" ? view.type : "table";
    const name =
      typeof view.name === "string" && view.name.trim()
        ? view.name.trim()
        : `${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;
    return { name, config: view };
  });
  return { filters: data.filters, properties, views: views.length ? views : [DEFAULT_VIEW] };
}

/** The YAML of each fenced ```` ```base ```` block in a note, in order. */
export function baseBlocks(source: string): ReadonlyArray<string> {
  const blocks: string[] = [];
  // The open fence, and the lines of its block when it is a base.
  let fence: { readonly run: string; readonly lines: string[] | null } | null = null;
  for (const line of source.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const run = marker?.[1];
    if (fence === null) {
      if (run === undefined) continue;
      const language = marker?.[2]?.trim().split(/\s/)[0] ?? "";
      fence = { run, lines: language === "base" ? [] : null };
    } else if (
      run !== undefined &&
      run[0] === fence.run[0] &&
      run.length >= fence.run.length &&
      !marker?.[2]?.trim()
    ) {
      if (fence.lines) blocks.push(fence.lines.join("\n"));
      fence = null;
    } else fence.lines?.push(line);
  }
  // An unclosed fence runs to the end of the note.
  if (fence?.lines) blocks.push(fence.lines.join("\n"));
  return blocks;
}

type Filter =
  | { readonly kind: "statement"; readonly expr: Expr; readonly text: string }
  | { readonly kind: "and" | "or" | "not"; readonly items: ReadonlyArray<Filter> };

function compileFilter(raw: unknown, where: string): Filter {
  if (typeof raw === "string") {
    return {
      kind: "statement",
      expr: compileExpression(raw, `${where} \`${raw}\``),
      text: raw,
    };
  }
  if (typeof raw === "boolean" || typeof raw === "number") {
    return compileFilter(String(raw), where);
  }
  if (isRecord(raw)) {
    const keys = Object.keys(raw);
    const group = keys[0];
    if (keys.length !== 1 || (group !== "and" && group !== "or" && group !== "not")) {
      throw new BaseError(
        `A filter group holds exactly one of and, or, not; ${where} has ${keys.join(", ") || "none"}.`,
      );
    }
    const items = raw[group];
    if (!Array.isArray(items)) throw new BaseError(`${group} in ${where} must be a list.`);
    return { kind: group, items: items.map((item) => compileFilter(item, where)) };
  }
  throw new BaseError(`A filter must be a statement or a group (and, or, not) in ${where}.`);
}

function matches(filter: Filter, scope: BaseScope): boolean {
  switch (filter.kind) {
    case "statement":
      return truthy(evaluate(filter.expr, scope, filter.text));
    case "and":
      return filter.items.every((item) => matches(item, scope));
    case "or":
      return filter.items.some((item) => matches(item, scope));
    case "not":
      return !filter.items.some((item) => matches(item, scope));
  }
}

type PropertyRef =
  | { readonly kind: "file"; readonly field: string }
  | { readonly kind: "note"; readonly name: string };

function propertyRef(id: string, where: string): PropertyRef {
  if (id.startsWith("file.")) {
    const field = id.slice("file.".length);
    if (!FILE_FIELDS.has(field)) throw unsupported(id, where);
    return { kind: "file", field };
  }
  if (id.startsWith("formula.")) throw unsupported(id, where, "formulas");
  if (id.startsWith("this.")) throw unsupported(id, where);
  return { kind: "note", name: id.startsWith("note.") ? id.slice("note.".length) : id };
}

const propertyValue = (ref: PropertyRef, doc: BaseDoc, scope: BaseScope): BaseValue =>
  ref.kind === "file" ? fileField(doc, ref.field, scope) : noteProperty(doc, ref.name);

function label(base: WikiBase, id: string, ref: PropertyRef): string {
  const alias = id.startsWith("note.") ? id.slice("note.".length) : `note.${id}`;
  const configured = base.properties[id]?.displayName ?? base.properties[alias]?.displayName;
  if (configured) return configured;
  return ref.kind === "file" ? (FILE_FIELDS.get(ref.field) ?? id) : ref.name;
}

const VIEW_TYPES = new Set(["table", "cards"]);

interface CompiledView {
  readonly name: string;
  readonly type: "table" | "cards";
  readonly filters: ReadonlyArray<Filter>;
  readonly limit: number | undefined;
  readonly columns: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    ref: PropertyRef;
  }>;
  readonly sort: ReadonlyArray<{ readonly ref: PropertyRef; readonly descending: boolean }>;
  readonly groupBy:
    | { readonly id: string; readonly label: string; ref: PropertyRef; descending: boolean }
    | undefined;
}

const descending = (direction: unknown, where: string): boolean => {
  if (direction === undefined || direction === "ASC") return false;
  if (direction === "DESC") return true;
  throw new BaseError(`direction must be ASC or DESC in ${where}.`);
};

function compileView(base: WikiBase, spec: BaseViewSpec): CompiledView {
  const where = `view “${spec.name}”`;
  const { config } = spec;
  const type = typeof config.type === "string" ? config.type : "table";
  if (!VIEW_TYPES.has(type)) throw unsupported(`the ${type} view`, where, "table and cards are");
  const filters: Filter[] = [];
  if (base.filters !== undefined && base.filters !== null) {
    filters.push(compileFilter(base.filters, "the base's filters"));
  }
  if (config.filters !== undefined && config.filters !== null) {
    filters.push(compileFilter(config.filters, `${where}'s filters`));
  }
  const limit = config.limit;
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1)) {
    throw new BaseError(`limit must be a positive whole number in ${where}.`);
  }
  if (config.order !== undefined && !Array.isArray(config.order)) {
    throw new BaseError(`order must be a list in ${where}.`);
  }
  const order = ((config.order as unknown[] | undefined) ?? ["file.name"]).map(String);
  const columns = order.map((id) => {
    const ref = propertyRef(id, `${where}'s order`);
    return { id, label: label(base, id, ref), ref };
  });
  if (config.sort !== undefined && !Array.isArray(config.sort)) {
    throw new BaseError(`sort must be a list in ${where}.`);
  }
  const sort = ((config.sort as unknown[] | undefined) ?? []).map((entry) => {
    if (!isRecord(entry) || typeof entry.property !== "string") {
      throw new BaseError(`Each sort in ${where} needs a property.`);
    }
    return {
      ref: propertyRef(entry.property, `${where}'s sort`),
      descending: descending(entry.direction, `${where}'s sort`),
    };
  });
  let groupBy: CompiledView["groupBy"];
  if (config.groupBy !== undefined && config.groupBy !== null) {
    const group = config.groupBy;
    const id = isRecord(group) ? group.property : group;
    if (typeof id !== "string") throw new BaseError(`groupBy needs a property in ${where}.`);
    const ref = propertyRef(id, `${where}'s groupBy`);
    groupBy = {
      id,
      label: label(base, id, ref),
      ref,
      descending: descending(isRecord(group) ? group.direction : undefined, `${where}'s groupBy`),
    };
  }
  // Checked after the expressions, so an error names the first unsupported one.
  if (config.groupOrder !== undefined) throw unsupported("groupOrder", where);
  if (isRecord(config.summaries) && Object.keys(config.summaries).length) {
    throw unsupported("summaries", where);
  }
  return {
    name: spec.name,
    type: type as CompiledView["type"],
    filters,
    limit,
    columns,
    sort,
    groupBy,
  };
}

/** A value as a view returns it: links as `[[Name]]`, dates as ISO text, lists flat. */
export type BaseCell = null | boolean | number | string | ReadonlyArray<BaseScalar>;
export type BaseScalar = null | boolean | number | string;

const scalar = (value: BaseValue): BaseScalar => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return display(value);
};
const cell = (value: BaseValue): BaseCell =>
  Array.isArray(value) ? value.map(scalar) : scalar(value);

export interface BaseRow {
  readonly name: string;
  readonly file: string;
  /** Keyed by column id. */
  readonly values: Readonly<Record<string, BaseCell>>;
  /** The row's value of the view's groupBy property; rows of one group are adjacent. */
  readonly group?: BaseCell;
}

export interface BaseResult {
  readonly view: { readonly name: string; readonly type: "table" | "cards" };
  readonly views: ReadonlyArray<string>;
  readonly columns: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly groupBy: { readonly id: string; readonly label: string } | null;
  readonly rows: ReadonlyArray<BaseRow>;
  /** How many notes the view shows, after its own limit. */
  readonly total: number;
  /** True when `rows` stops short of `total`. */
  readonly truncated: boolean;
}

export interface BaseQueryOptions {
  /** The view to run, by name; the first view when omitted. */
  readonly view?: string | undefined;
  /** The file `this` names: the note a block is embedded in, or the base file itself. */
  readonly self?: string | undefined;
  /** When each file last changed, for `file.mtime`. */
  readonly editTimes?: ReadonlyMap<string, string> | undefined;
  /** Epoch milliseconds for `now()` and `today()`. */
  readonly now: number;
  /** At most this many rows come back. */
  readonly cap?: number | undefined;
}

const docs = new WeakMap<WikiNote, BaseDoc>();

function docOf(note: WikiNote, editTimes: ReadonlyMap<string, string> | undefined): BaseDoc {
  let doc = docs.get(note);
  if (doc === undefined) {
    const properties = noteProperties(note.source);
    const seen = new Map<string, string>();
    for (const link of note.links)
      if (!seen.has(key(link.target))) seen.set(key(link.target), link.target);
    doc = {
      name: note.name,
      file: note.file,
      source: note.source,
      properties,
      tags: noteTags(note.source, properties),
      links: [...seen.values()],
      mtime: undefined,
    };
    docs.set(note, doc);
  }
  const mtime = editTimes?.get(note.file);
  return mtime === undefined ? doc : { ...doc, mtime };
}

/** Runs one view of `base` over the wiki's notes. Throws `BaseError` for anything unsupported. */
export function queryBase(
  index: Pick<WikiIndex, "notes">,
  base: WikiBase,
  options: BaseQueryOptions,
): BaseResult {
  const wanted = options.view;
  const spec =
    wanted === undefined
      ? base.views[0]!
      : (base.views.find((view) => view.name === wanted) ??
        base.views.find((view) => key(view.name) === key(wanted)));
  if (spec === undefined) {
    throw new BaseError(
      `No view named “${wanted}”; this base has ${base.views.map((view) => `“${view.name}”`).join(", ")}.`,
    );
  }
  const view = compileView(base, spec);
  const rows = [...index.notes.values()].map((note) => docOf(note, options.editTimes));
  const backlinkMap = new Map<string, string[]>();
  for (const doc of rows) {
    for (const target of doc.links) {
      const sources = backlinkMap.get(key(target)) ?? [];
      sources.push(doc.name);
      backlinkMap.set(key(target), sources);
    }
  }
  const selfFile = options.self;
  const selfNote = selfFile === undefined ? undefined : index.notes.get(key(noteName(selfFile)));
  const self: BaseDoc | undefined =
    selfFile === undefined
      ? undefined
      : selfNote !== undefined
        ? docOf(selfNote, options.editTimes)
        : {
            name: selfFile.replace(/\.(md|base)$/i, ""),
            file: selfFile,
            source: "",
            properties: {},
            tags: [],
            links: [],
            mtime: options.editTimes?.get(selfFile),
          };
  const scopeFor = (row: BaseDoc): BaseScope => ({
    row,
    self,
    now: options.now,
    backlinks: (doc) => backlinkMap.get(key(doc.name)) ?? [],
  });

  const matched = rows.flatMap((doc) => {
    const scope = scopeFor(doc);
    if (!view.filters.every((filter) => matches(filter, scope))) return [];
    return [{ doc, scope }];
  });
  const keys = [
    ...(view.groupBy ? [{ ref: view.groupBy.ref, descending: view.groupBy.descending }] : []),
    ...view.sort,
  ];
  const sorted = matched
    .map((entry) => ({
      ...entry,
      sortValues: keys.map((sortKey) => propertyValue(sortKey.ref, entry.doc, entry.scope)),
    }))
    .toSorted((a, b) => {
      for (const [position, sortKey] of keys.entries()) {
        const left = a.sortValues[position] ?? null;
        const right = b.sortValues[position] ?? null;
        const compared = sortOrder(left, right);
        // Empty values stay last in either direction.
        const flip = sortKey.descending && !isEmptyValue(left) && !isEmptyValue(right);
        if (compared !== 0) return flip ? -compared : compared;
      }
      return a.doc.name.localeCompare(b.doc.name, undefined, { numeric: true });
    });
  const shown = view.limit === undefined ? sorted : sorted.slice(0, view.limit);
  const cap = options.cap ?? Number.POSITIVE_INFINITY;
  return {
    view: { name: view.name, type: view.type },
    views: base.views.map((entry) => entry.name),
    columns: view.columns.map(({ id, label }) => ({ id, label })),
    groupBy: view.groupBy ? { id: view.groupBy.id, label: view.groupBy.label } : null,
    rows: shown.slice(0, cap).map(({ doc, scope, sortValues }) => ({
      name: doc.name,
      file: doc.file,
      values: Object.fromEntries(
        view.columns.map((column) => [column.id, cell(propertyValue(column.ref, doc, scope))]),
      ),
      ...(view.groupBy ? { group: cell(sortValues[0] ?? null) } : {}),
    })),
    total: shown.length,
    truncated: shown.length > cap,
  };
}
