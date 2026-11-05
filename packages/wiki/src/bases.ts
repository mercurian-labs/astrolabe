/**
 * Bases: saved questions over every file in a wiki's repository, in Obsidian's `.base` format, so
 * a base written in Obsidian opens here and the other way round. Results are derived on every
 * read, never stored. Anything the language doesn't have fails with a message naming it, never by
 * matching everything.
 */
import { isMap, isScalar, isSeq, parseDocument, type Document, type Scalar } from "yaml";

import type { BaseCorpus } from "./baseCorpus.ts";
import {
  compileExpression,
  evaluate,
  noteReferences,
  parseExpression,
  renameInExpression,
  unsupported,
  type CompileContext,
  type Expr,
} from "./baseExpression.ts";
import { docName, FILE_FIELDS, fileField, noteProperty, type BaseScope } from "./baseFunctions.ts";
import {
  coordinatesOf,
  displayOf,
  imageOf,
  plainText,
  viewSettings,
  type BaseDisplay,
  type BaseImage,
  type BaseViewSettings,
} from "./baseLayout.ts";
import {
  BaseError,
  display,
  errorValue,
  isEmptyValue,
  isList,
  sortOrder,
  tagged,
  truthy,
  type BaseDoc,
  type BaseValue,
} from "./baseValues.ts";
import { key } from "./links.ts";

export { BaseError } from "./baseValues.ts";

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
  /** Formula source by name. */
  readonly formulas: Readonly<Record<string, string>>;
  /** Custom summary formulas by name; each sees a column's `values`. */
  readonly summaries: Readonly<Record<string, string>>;
  /** Keyed by property id: `note.status`, `file.name`, `formula.total`. */
  readonly properties: Readonly<Record<string, { readonly displayName?: string }>>;
  readonly views: ReadonlyArray<BaseViewSpec>;
}

const DEFAULT_VIEW: BaseViewSpec = { name: "Table", config: { type: "table" } };

const expressions = (raw: unknown, section: string): Record<string, string> => {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) throw new BaseError(`${section} must be a mapping.`);
  return Object.fromEntries(
    Object.entries(raw).map(([name, value]) => {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new BaseError(`${section}'s “${name}” must be an expression.`);
      }
      return [name, String(value)];
    }),
  );
};

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
  if (data.properties !== undefined && data.properties !== null) {
    if (!isRecord(data.properties)) throw new BaseError("properties must be a mapping.");
    for (const [id, config] of Object.entries(data.properties)) {
      const displayName = isRecord(config) ? config.displayName : undefined;
      properties[id] = typeof displayName === "string" ? { displayName } : {};
    }
  }
  if (data.views !== undefined && data.views !== null && !Array.isArray(data.views)) {
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
  return {
    filters: data.filters,
    formulas: expressions(data.formulas, "formulas"),
    summaries: expressions(data.summaries, "summaries"),
    properties,
    views: views.length ? views : [DEFAULT_VIEW],
  };
}

/** Where each fenced ```` ```base ```` block's YAML sits in a note, in order. */
function baseBlockRanges(
  source: string,
): ReadonlyArray<{ readonly from: number; readonly to: number }> {
  const ranges: { from: number; to: number }[] = [];
  // The open fence, and where its YAML starts when it is a base.
  let fence: { readonly run: string; readonly start: number | null } | null = null;
  let at = 0;
  for (const raw of source.split(/(?<=\n)/)) {
    const lineStart = at;
    at += raw.length;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw.replace(/\r?\n$/, ""));
    const run = marker?.[1];
    if (fence === null) {
      if (run === undefined) continue;
      const language = marker?.[2]?.trim().split(/\s/)[0] ?? "";
      fence = { run, start: language === "base" ? at : null };
    } else if (
      run !== undefined &&
      run[0] === fence.run[0] &&
      run.length >= fence.run.length &&
      !marker?.[2]?.trim()
    ) {
      if (fence.start !== null) ranges.push({ from: fence.start, to: lineStart });
      fence = null;
    }
  }
  // An unclosed fence runs to the end of the note.
  if (fence?.start != null) ranges.push({ from: fence.start, to: source.length });
  return ranges;
}

/** The YAML of each fenced ```` ```base ```` block in a note, in order. */
export const baseBlocks = (source: string): ReadonlyArray<string> =>
  baseBlockRanges(source).map(({ from, to }) =>
    source
      .slice(from, to)
      .replace(/\r?\n$/, "")
      .replace(/\r\n/g, "\n"),
  );

/** A base's expressions as YAML text nodes: its filters, at the top and in each view, its formulas and its summaries. */
function expressionNodes(document: Document): ReadonlyArray<Scalar<string>> {
  const found: Scalar<string>[] = [];
  const filters = (node: unknown): void => {
    if (isScalar(node)) {
      if (typeof node.value === "string") found.push(node as Scalar<string>);
    } else if (isMap(node)) for (const pair of node.items) filters(pair.value);
    else if (isSeq(node)) for (const item of node.items) filters(item);
  };
  const root = document.contents;
  if (!isMap(root)) return found;
  filters(root.get("filters", true));
  const views = root.get("views", true);
  if (isSeq(views))
    for (const view of views.items) if (isMap(view)) filters(view.get("filters", true));
  for (const section of ["formulas", "summaries"]) {
    const formulas = root.get(section, true);
    if (!isMap(formulas)) continue;
    for (const pair of formulas.items) {
      if (isScalar(pair.value) && typeof pair.value.value === "string") {
        found.push(pair.value as Scalar<string>);
      }
    }
  }
  return found;
}

const readBase = (source: string): Document | null => {
  const document = parseDocument(source, { schema: "core" });
  return document.errors.length ? null : document;
};

/** A YAML scalar holding `text`, in the node's own quoting where that still reads back. */
const yamlScalar = (text: string, type: Scalar["type"]): string =>
  type === "QUOTE_SINGLE" && !/[\r\n]/.test(text)
    ? `'${text.replaceAll("'", "''")}'`
    : type === "PLAIN"
      ? text
      : JSON.stringify(text);

/**
 * A base's YAML with every expression literal that names the note `from` naming `to` (see
 * `noteReferences`); everything else keeps its bytes. Block scalars are left alone.
 */
export function renameInBase(source: string, from: string, to: string): string {
  const document = readBase(source);
  if (document === null) return source;
  const edits = expressionNodes(document).flatMap((node) => {
    const next = renameInExpression(node.value, from, to);
    const block = node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED";
    return next === node.value || block || !node.range ? [] : [{ node, next }];
  });
  if (!edits.length) return source;
  const expected = expressionNodes(document).map(
    (node) => edits.find((edit) => edit.node === node)?.next ?? node.value,
  );
  const write = (plainAllowed: boolean) => {
    let output = source;
    for (const { node, next } of edits.toReversed()) {
      const type = node.type === "PLAIN" && !plainAllowed ? "QUOTE_DOUBLE" : node.type;
      const [start, end] = node.range!;
      output = output.slice(0, start) + yamlScalar(next, type) + output.slice(end);
    }
    return output;
  };
  // A plain scalar may not survive a new name (a `: ` or `#` in it), so it is checked by reading
  // it back, and double-quoted instead when it doesn't.
  for (const plainAllowed of [true, false]) {
    const output = write(plainAllowed);
    const reread = readBase(output);
    const values = reread === null ? null : expressionNodes(reread).map((node) => node.value);
    if (JSON.stringify(values) === JSON.stringify(expected)) return output;
  }
  return source;
}

/** A note with every ```` ```base ```` block in it renamed as `renameInBase` does. */
export function renameInBaseBlocks(source: string, from: string, to: string): string {
  let output = source;
  for (const { from: start, to: end } of baseBlockRanges(source).toReversed()) {
    const block = source.slice(start, end);
    const next = renameInBase(block, from, to);
    if (next !== block) output = output.slice(0, start) + next + output.slice(end);
  }
  return output;
}

type Filter =
  | { readonly kind: "statement"; readonly expr: Expr; readonly text: string }
  | { readonly kind: "and" | "or" | "not"; readonly items: ReadonlyArray<Filter> };

function compileFilter(raw: unknown, where: string, context: CompileContext): Filter {
  if (typeof raw === "string") {
    return {
      kind: "statement",
      expr: compileExpression(raw, `${where} \`${raw}\``, context),
      text: raw,
    };
  }
  if (typeof raw === "boolean" || typeof raw === "number") {
    return compileFilter(String(raw), where, context);
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
    return { kind: group, items: items.map((item) => compileFilter(item, where, context)) };
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
  | { readonly kind: "note"; readonly name: string }
  | { readonly kind: "formula"; readonly name: string };

/** A property id as Obsidian keys it: `note.status` for a bare `status`. */
const canonical = (ref: PropertyRef): string =>
  ref.kind === "file" ? `file.${ref.field}` : `${ref.kind}.${ref.name}`;

function propertyRef(id: string, where: string, context: CompileContext): PropertyRef {
  if (id.startsWith("file.")) {
    const field = id.slice("file.".length);
    if (!FILE_FIELDS.has(field)) throw unsupported(id, where);
    return { kind: "file", field };
  }
  if (id.startsWith("formula.")) {
    const name = id.slice("formula.".length);
    if (!context.formulas.has(name)) throw new BaseError(`No formula named “${name}” in ${where}.`);
    return { kind: "formula", name };
  }
  if (id.startsWith("this.")) throw unsupported(id, where);
  return { kind: "note", name: id.startsWith("note.") ? id.slice("note.".length) : id };
}

const propertyValue = (ref: PropertyRef, scope: BaseScope): BaseValue =>
  ref.kind === "file"
    ? fileField(scope.row, ref.field, scope)
    : ref.kind === "formula"
      ? scope.formula(ref.name)
      : noteProperty(scope.row, ref.name);

/** A column's heading: its `displayName`, keyed as `note.x` (a bare `x` is ignored, as in Obsidian). */
function label(base: WikiBase, ref: PropertyRef): string {
  const configured = base.properties[canonical(ref)]?.displayName;
  if (configured) return configured;
  return ref.kind === "file" ? (FILE_FIELDS.get(ref.field) ?? canonical(ref)) : ref.name;
}

export const BASE_VIEW_TYPES = ["table", "cards", "list", "kanban", "map"] as const;
export type BaseViewType = (typeof BASE_VIEW_TYPES)[number];
const VIEW_TYPES: ReadonlySet<string> = new Set(BASE_VIEW_TYPES);

/** Obsidian's built-in summaries. */
const SUMMARIES = new Set([
  "Average",
  "Min",
  "Max",
  "Sum",
  "Range",
  "Median",
  "Stddev",
  "Earliest",
  "Latest",
  "Checked",
  "Unchecked",
  "Empty",
  "Filled",
  "Unique",
]);

interface CompiledColumn {
  readonly id: string;
  readonly label: string;
  readonly ref: PropertyRef;
}

interface CompiledView {
  readonly name: string;
  readonly type: BaseViewType;
  readonly settings: BaseViewSettings;
  /** The properties a card's cover and a map's markers come from. */
  readonly cover: PropertyRef | undefined;
  readonly marker:
    | {
        readonly coordinates: PropertyRef;
        readonly icon: PropertyRef | undefined;
        readonly color: PropertyRef | undefined;
      }
    | undefined;
  readonly filters: ReadonlyArray<Filter>;
  readonly limit: number | undefined;
  readonly columns: ReadonlyArray<CompiledColumn>;
  readonly sort: ReadonlyArray<{ readonly ref: PropertyRef; readonly descending: boolean }>;
  readonly groupBy:
    | {
        readonly id: string;
        readonly label: string;
        readonly ref: PropertyRef;
        readonly descending: boolean;
        /** The groups shown, in order; `null` is the group of files without a value. */
        readonly order: ReadonlyArray<string | null> | undefined;
      }
    | undefined;
  /** Summary name by column id. */
  readonly summaries: ReadonlyMap<string, string>;
  readonly formulas: ReadonlyMap<string, { readonly expr: Expr; readonly text: string }>;
  readonly customSummaries: ReadonlyMap<string, { readonly expr: Expr; readonly text: string }>;
}

const descending = (direction: unknown, where: string): boolean => {
  if (direction === undefined || direction === null || direction === "ASC") return false;
  if (direction === "DESC") return true;
  throw new BaseError(`direction must be ASC or DESC in ${where}.`);
};

const compileFormulas = (
  sources: Readonly<Record<string, string>>,
  kind: string,
  context: CompileContext,
) =>
  new Map(
    Object.entries(sources).map(([name, text]) => [
      name,
      { expr: compileExpression(text, `${kind} “${name}” \`${text}\``, context), text },
    ]),
  );

function compileView(base: WikiBase, spec: BaseViewSpec): CompiledView {
  const where = `view “${spec.name}”`;
  const { config } = spec;
  const context: CompileContext = { formulas: new Set(Object.keys(base.formulas)) };
  const formulas = compileFormulas(base.formulas, "formula", context);
  const customSummaries = compileFormulas(base.summaries, "summary", context);
  const type = typeof config.type === "string" ? config.type : "table";
  if (!VIEW_TYPES.has(type)) {
    throw unsupported(`the ${type} view`, where, "table, cards, list, kanban and map are");
  }
  const filters: Filter[] = [];
  if (base.filters !== undefined && base.filters !== null) {
    filters.push(compileFilter(base.filters, "the base's filters", context));
  }
  if (config.filters !== undefined && config.filters !== null) {
    filters.push(compileFilter(config.filters, `${where}'s filters`, context));
  }
  const limit = config.limit;
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1)
  ) {
    throw new BaseError(`limit must be a positive whole number in ${where}.`);
  }
  if (config.order !== undefined && config.order !== null && !Array.isArray(config.order)) {
    throw new BaseError(`order must be a list in ${where}.`);
  }
  const order = ((config.order as unknown[] | undefined | null) ?? ["file.name"]).map(String);
  const columns = order
    .map((id) => {
      const ref = propertyRef(id, `${where}'s order`, context);
      return { id, label: label(base, ref), ref };
    })
    // Obsidian shows no column for an object such as file.properties.
    .filter((column) => !(column.ref.kind === "file" && column.ref.field === "properties"));
  if (config.sort !== undefined && config.sort !== null && !Array.isArray(config.sort)) {
    throw new BaseError(`sort must be a list in ${where}.`);
  }
  const sort = ((config.sort as unknown[] | undefined | null) ?? []).map((entry) => {
    if (!isRecord(entry) || typeof entry.property !== "string") {
      throw new BaseError(`Each sort in ${where} needs a property.`);
    }
    return {
      ref: propertyRef(entry.property, `${where}'s sort`, context),
      descending: descending(entry.direction, `${where}'s sort`),
    };
  });
  let groupBy: CompiledView["groupBy"];
  if (config.groupBy !== undefined && config.groupBy !== null) {
    const group = config.groupBy;
    const id = isRecord(group) ? group.property : group;
    if (typeof id !== "string") throw new BaseError(`groupBy needs a property in ${where}.`);
    const ref = propertyRef(id, `${where}'s groupBy`, context);
    const groupOrder = config.groupOrder;
    if (groupOrder !== undefined && groupOrder !== null && !Array.isArray(groupOrder)) {
      throw new BaseError(`groupOrder must be a list in ${where}.`);
    }
    groupBy = {
      id,
      label: label(base, ref),
      ref,
      descending: descending(isRecord(group) ? group.direction : undefined, `${where}'s groupBy`),
      order: Array.isArray(groupOrder)
        ? groupOrder.map((entry) => (entry === null ? null : String(entry)))
        : undefined,
    };
  }
  const summaries = new Map<string, string>();
  if (config.summaries !== undefined && config.summaries !== null) {
    if (!isRecord(config.summaries))
      throw new BaseError(`summaries must be a mapping in ${where}.`);
    for (const [id, name] of Object.entries(config.summaries)) {
      if (typeof name !== "string" || (!SUMMARIES.has(name) && !customSummaries.has(name))) {
        throw new BaseError(`No summary named “${String(name)}” in ${where}.`);
      }
      const ref = propertyRef(id, `${where}'s summaries`, context);
      const column = columns.find((candidate) => canonical(candidate.ref) === canonical(ref));
      if (column) summaries.set(column.id, name);
    }
  }
  const settings = viewSettings(config);
  const settingRef = (id: string | undefined, name: string) =>
    id === undefined || !id.trim() ? undefined : propertyRef(id, `${where}'s ${name}`, context);
  const coordinates = settingRef(settings.coordinates, "coordinates");
  return {
    name: spec.name,
    type: type as BaseViewType,
    settings,
    cover: type === "cards" ? settingRef(settings.image, "image") : undefined,
    marker:
      type === "map" && coordinates !== undefined
        ? {
            coordinates,
            icon: settingRef(settings.markerIcon, "markerIcon"),
            color: settingRef(settings.markerColor, "markerColor"),
          }
        : undefined,
    filters,
    limit: typeof limit === "number" ? limit : undefined,
    columns,
    sort,
    groupBy,
    summaries,
    formulas,
    customSummaries,
  };
}

/** A value as a view returns it, in the text Obsidian exports: links `[[Name]]`, lists flat. */
export type BaseCell = null | boolean | number | string | ReadonlyArray<BaseScalar>;
export type BaseScalar = null | boolean | number | string;

const scalar = (value: BaseValue): BaseScalar => {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
  return display(value);
};
const cell = (value: BaseValue): BaseCell => (isList(value) ? value.map(scalar) : scalar(value));

export interface BaseMarker {
  readonly lat: number;
  readonly lng: number;
  readonly icon?: string;
  readonly color?: string;
}

export interface BaseRow {
  /** The file's name as Obsidian shows it: a note's without `.md`, any other file's in full. */
  readonly name: string;
  readonly file: string;
  /** Keyed by column id. */
  readonly values: Readonly<Record<string, BaseCell>>;
  /** How cells that aren't plain text show, keyed by column id. */
  readonly display?: Readonly<Record<string, BaseDisplay>>;
  /** A card's cover, from the view's `image` property. */
  readonly cover?: BaseImage;
  /** Where a map view puts the row, from its `coordinates` property. */
  readonly marker?: BaseMarker;
  /** The row's value of the view's groupBy property; rows of one group are adjacent. */
  readonly group?: BaseCell;
}

export interface BaseSummary {
  readonly column: string;
  readonly name: string;
  readonly value: string;
}

export interface BaseGroup {
  readonly value: BaseCell;
  readonly count: number;
  readonly summaries: ReadonlyArray<BaseSummary>;
}

export interface BaseResult {
  readonly view: { readonly name: string; readonly type: BaseViewType };
  readonly views: ReadonlyArray<string>;
  /** The view's settings as its YAML gives them, for drawing and editing it. */
  readonly settings: BaseViewSettings;
  /** Every property a view of this base could show: file fields, note properties, formulas. */
  readonly properties: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  /** The base's formulas, by name. */
  readonly formulas: Readonly<Record<string, string>>;
  readonly columns: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly groupBy: { readonly id: string; readonly label: string } | null;
  readonly rows: ReadonlyArray<BaseRow>;
  /** Each group in order, with its own summaries; empty when the view isn't grouped. */
  readonly groups: ReadonlyArray<BaseGroup>;
  /** The view's summaries over every row it shows. */
  readonly summaries: ReadonlyArray<BaseSummary>;
  /** How many files the view shows, after its own limit. */
  readonly total: number;
  /** True when `rows` stops short of `total`. */
  readonly truncated: boolean;
}

export interface BaseQueryOptions {
  /** The view to run, by name; the first view when omitted. */
  readonly view?: string | undefined;
  /** The file `this` names: the note a block is embedded in, or the base file itself. */
  readonly self?: string | undefined;
  /** Epoch milliseconds for `now()` and `today()`. */
  readonly now: number;
  /** At most this many rows come back. */
  readonly cap?: number | undefined;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** A built-in summary over a column's values, as Obsidian works it out. */
function builtInSummary(name: string, values: ReadonlyArray<BaseValue>): BaseValue {
  const numbers = values.filter((value): value is number => typeof value === "number");
  const times = values.flatMap((value) => {
    const time = tagged(value, "date") ? value.time : undefined;
    return time === undefined ? [] : [time];
  });
  const sum = numbers.reduce((total, value) => total + value, 0);
  switch (name) {
    case "Sum":
      return round(sum);
    // Obsidian divides by every row, a missing value counting as nothing.
    case "Average":
      return values.length ? round(sum / values.length) : null;
    case "Min":
      return numbers.length ? Math.min(...numbers) : null;
    case "Max":
      return numbers.length ? Math.max(...numbers) : null;
    case "Range":
      if (numbers.length) return round(Math.max(...numbers) - Math.min(...numbers));
      return times.length
        ? { kind: "duration", months: 0, days: 0, ms: Math.max(...times) - Math.min(...times) }
        : null;
    case "Median": {
      if (!numbers.length) return null;
      const sorted = numbers.toSorted((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return round(
        sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
      );
    }
    case "Stddev": {
      if (!numbers.length) return null;
      const mean = sum / numbers.length;
      const variance =
        numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / numbers.length;
      return round(Math.sqrt(variance));
    }
    case "Earliest":
      return times.length ? { kind: "date", time: Math.min(...times) } : null;
    case "Latest":
      return times.length ? { kind: "date", time: Math.max(...times) } : null;
    case "Checked":
      return values.filter((value) => value === true).length;
    case "Unchecked":
      return values.filter((value) => value !== true).length;
    case "Empty":
      return values.filter(isEmptyValue).length;
    case "Filled":
      return values.filter((value) => !isEmptyValue(value)).length;
    case "Unique":
      return new Set(values.filter((value) => !isEmptyValue(value)).map(display)).size;
    default:
      return null;
  }
}

const collate = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const groupKey = (value: BaseValue): string | null => (isEmptyValue(value) ? null : display(value));

/** Runs one view of `base` over the corpus. Throws `BaseError` for anything it can't run. */
export function queryBase(
  corpus: Pick<BaseCorpus, "docs" | "byPath" | "resolve" | "backlinks">,
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
  const selfFile = options.self;
  const self: BaseDoc | undefined =
    selfFile === undefined
      ? undefined
      : (corpus.byPath(selfFile) ?? {
          file: selfFile,
          source: "",
          size: 0,
          properties: {},
          tags: [],
          links: [],
          embeds: [],
          typedLinks: [],
          mtime: undefined,
          ctime: undefined,
        });

  const scopeFor = (row: BaseDoc): BaseScope => {
    const known = new Map<string, BaseValue>();
    const running = new Set<string>();
    const scope: BaseScope = {
      row,
      self,
      corpus,
      now: options.now,
      formula: (name) => {
        const cached = known.get(name);
        if (cached !== undefined) return cached;
        const formula = view.formulas.get(name);
        if (formula === undefined) return null;
        if (running.has(name)) return errorValue(`The formula “${name}” refers to itself.`);
        running.add(name);
        const value = evaluate(formula.expr, scope, formula.text);
        running.delete(name);
        known.set(name, value);
        return value;
      },
    };
    return scope;
  };

  const groupBy = view.groupBy;
  const visibleGroups =
    groupBy?.order === undefined ? undefined : new Set(groupBy.order.map((entry) => entry));
  const matched = corpus.docs.flatMap((doc) => {
    const scope = scopeFor(doc);
    if (!view.filters.every((filter) => matches(filter, scope))) return [];
    const group = groupBy ? propertyValue(groupBy.ref, scope) : null;
    if (visibleGroups !== undefined && !visibleGroups.has(groupKey(group))) return [];
    return [{ doc, scope, group }];
  });
  const sortValues = new Map(
    matched.map((entry) => [
      entry,
      view.sort.map((sortKey) => propertyValue(sortKey.ref, entry.scope)),
    ]),
  );
  // Sorted and limited first; grouping then keeps that order within each group.
  const sorted = matched.toSorted((a, b) => {
    for (const [position, sortKey] of view.sort.entries()) {
      const left = sortValues.get(a)?.[position] ?? null;
      const right = sortValues.get(b)?.[position] ?? null;
      const compared = sortOrder(left, right);
      // Empty values stay last in either direction.
      const flip = sortKey.descending && !isEmptyValue(left) && !isEmptyValue(right);
      if (compared !== 0) return flip ? -compared : compared;
    }
    return collate(docName(a.doc), docName(b.doc)) || collate(a.doc.file, b.doc.file);
  });
  const limited = view.limit === undefined ? sorted : sorted.slice(0, view.limit);

  let shown = limited;
  const groupOrder: Array<{ key: string | null; value: BaseValue }> = [];
  if (groupBy) {
    for (const entry of limited) {
      const id = groupKey(entry.group);
      if (!groupOrder.some((group) => group.key === id))
        groupOrder.push({ key: id, value: entry.group });
    }
    if (groupBy.order !== undefined) {
      const listed = groupBy.order;
      groupOrder.sort((a, b) => listed.indexOf(a.key) - listed.indexOf(b.key));
    } else {
      groupOrder.sort((a, b) => {
        const compared = sortOrder(a.value, b.value);
        const flip = groupBy.descending && a.key !== null && b.key !== null;
        return flip ? -compared : compared;
      });
    }
    const rank = new Map(groupOrder.map((group, position) => [group.key, position]));
    shown = limited.toSorted(
      (a, b) => (rank.get(groupKey(a.group)) ?? 0) - (rank.get(groupKey(b.group)) ?? 0),
    );
  }

  const columnValues = new Map(
    shown.map((entry) => [
      entry,
      view.columns.map((column) => propertyValue(column.ref, entry.scope)),
    ]),
  );
  const summarize = (entries: typeof shown): BaseSummary[] =>
    view.columns.flatMap((column, position) => {
      const name = view.summaries.get(column.id);
      if (name === undefined) return [];
      const values = entries.map((entry) => columnValues.get(entry)?.[position] ?? null);
      const custom = view.customSummaries.get(name);
      let value: BaseValue;
      if (custom === undefined) value = builtInSummary(name, values);
      else {
        const scope = scopeFor(self ?? entries[0]?.doc ?? EMPTY_DOC);
        value = evaluate(custom.expr, { ...scope, locals: { values } }, custom.text);
      }
      return [{ column: column.id, name, value: display(value) }];
    });

  const cap = options.cap ?? Number.POSITIVE_INFINITY;
  return {
    view: { name: view.name, type: view.type },
    views: base.views.map((entry) => entry.name),
    settings: view.settings,
    properties: availableProperties(base, corpus.docs),
    formulas: base.formulas,
    columns: view.columns.map(({ id, label }) => ({ id, label })),
    groupBy: groupBy ? { id: groupBy.id, label: groupBy.label } : null,
    rows: shown.slice(0, cap).map((entry): BaseRow => {
      const values = columnValues.get(entry) ?? [];
      const display = Object.fromEntries(
        view.columns.flatMap((column, position) => {
          const shownAs = displayOf(values[position] ?? null, corpus.resolve);
          return shownAs === undefined ? [] : [[column.id, shownAs] as const];
        }),
      );
      const cover = view.cover && imageOf(propertyValue(view.cover, entry.scope), corpus.resolve);
      const marker = view.marker && markerOf(view.marker, entry.scope);
      return {
        name: docName(entry.doc),
        file: entry.doc.file,
        values: Object.fromEntries(
          view.columns.map((column, position) => [column.id, cell(values[position] ?? null)]),
        ),
        ...(Object.keys(display).length ? { display } : {}),
        ...(cover ? { cover } : {}),
        ...(marker ? { marker } : {}),
        ...(groupBy ? { group: cell(entry.group) } : {}),
      };
    }),
    groups: groupOrder.map((group) => {
      const members = shown.filter((entry) => groupKey(entry.group) === group.key);
      return { value: cell(group.value), count: members.length, summaries: summarize(members) };
    }),
    summaries: summarize(shown),
    total: shown.length,
    truncated: shown.length > cap,
  };
}

function markerOf(
  marker: NonNullable<CompiledView["marker"]>,
  scope: BaseScope,
): BaseMarker | undefined {
  const at = coordinatesOf(propertyValue(marker.coordinates, scope));
  if (at === undefined) return undefined;
  const icon = marker.icon && plainText(propertyValue(marker.icon, scope));
  const color = marker.color && plainText(propertyValue(marker.color, scope));
  return { lat: at[0], lng: at[1], ...(icon ? { icon } : {}), ...(color ? { color } : {}) };
}

/** The properties a view could show, as Obsidian's property picker lists them. */
function availableProperties(
  base: WikiBase,
  docs: ReadonlyArray<BaseDoc>,
): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  const notes = new Set<string>();
  for (const doc of docs) for (const name of Object.keys(doc.properties)) notes.add(name);
  const refs: PropertyRef[] = [
    ...[...notes].toSorted(collate).map((name): PropertyRef => ({ kind: "note", name })),
    ...Object.keys(base.formulas).map((name): PropertyRef => ({ kind: "formula", name })),
    ...[...FILE_FIELDS.keys()]
      .filter((field) => field !== "properties" && field !== "file")
      .map((field): PropertyRef => ({ kind: "file", field })),
  ];
  return refs.map((ref) => ({ id: canonical(ref), label: label(base, ref) }));
}

const EMPTY_DOC: BaseDoc = {
  file: "",
  source: "",
  size: 0,
  properties: {},
  tags: [],
  links: [],
  embeds: [],
  typedLinks: [],
  mtime: undefined,
  ctime: undefined,
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * What the index reports about a base: YAML or expressions it can't run, and note names nothing
 * in the wiki carries, neither a note nor a link to one, as a rename made elsewhere leaves.
 */
export function baseProblems(
  source: string,
  named: (name: string) => boolean,
): ReadonlyArray<string> {
  let base: WikiBase;
  try {
    base = parseBase(source);
  } catch (error) {
    return [message(error)];
  }
  const problems = new Set<string>();
  for (const spec of base.views) {
    try {
      compileView(base, spec);
    } catch (error) {
      problems.add(message(error));
    }
  }
  const document = readBase(source);
  for (const node of document === null ? [] : expressionNodes(document)) {
    let references: ReadonlyArray<{ readonly name: string }>;
    try {
      references = noteReferences(parseExpression(node.value, "a base"));
    } catch {
      continue;
    }
    for (const { name } of references) {
      if (!named(name)) problems.add(`Names “${name}”, but no note is called that or links to it.`);
    }
  }
  return [...problems];
}
