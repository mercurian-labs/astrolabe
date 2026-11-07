// @effect-diagnostics globalDate:off - an Effect-free package; months and local midnight need Date.
/**
 * Obsidian's Bases functions: the global ones, each type's methods and fields, and a file's
 * fields. `if`, `filter`, `map` and `reduce` evaluate their arguments lazily, so they live in the
 * evaluator; everything here takes values already worked out.
 */
import type { BaseCorpus } from "./baseCorpus.ts";
import {
  display,
  durationMs,
  equals,
  errorValue,
  fileName,
  formatDate,
  fromProperty,
  humanize,
  identity,
  isEmptyValue,
  isList,
  linkOfText,
  parseDate,
  parseDuration,
  shiftDate,
  sortOrder,
  startOfDay,
  tagged,
  timeOf,
  truthy,
  typeError,
  typeOf,
  type BaseDoc,
  type BaseValue,
  type DateValue,
  type DurationValue,
} from "./baseValues.ts";
import { hasTag } from "./properties.ts";

export interface BaseScope {
  readonly row: BaseDoc;
  /** The file `this` names; undefined where the query runs in none. */
  readonly self: BaseDoc | undefined;
  readonly corpus: Pick<BaseCorpus, "resolve" | "backlinks" | "byPath">;
  readonly now: number;
  /** The row's value of a formula, worked out once per row. */
  readonly formula: (name: string) => BaseValue;
  /** `value`, `index` and `acc` inside `filter`, `map` and `reduce`; `values` in a summary. */
  readonly locals?: Readonly<Record<string, BaseValue>>;
}

/** The labels Obsidian heads a file field's column with. */
export const FILE_FIELDS: ReadonlyMap<string, string> = new Map([
  ["name", "file name"],
  ["basename", "file base name"],
  ["path", "file path"],
  ["folder", "folder"],
  ["ext", "file extension"],
  ["size", "file size"],
  ["ctime", "created time"],
  ["mtime", "modified time"],
  ["tags", "file tags"],
  ["links", "file links"],
  ["backlinks", "file backlinks"],
  ["embeds", "file embeds"],
  ["properties", "file properties"],
  ["file", "file"],
]);

export const GLOBALS: ReadonlySet<string> = new Set([
  "date",
  "duration",
  "escapeHTML",
  "file",
  "html",
  "icon",
  "if",
  "image",
  "link",
  "list",
  "max",
  "min",
  "now",
  "number",
  "random",
  "today",
]);

/** Every method of every type; which one applies depends on the value it is called on. */
export const METHODS: ReadonlySet<string> = new Set([
  // any
  "isTruthy",
  "isType",
  "toString",
  "isEmpty",
  // text and lists
  "contains",
  "containsAll",
  "containsAny",
  "endsWith",
  "lower",
  "replace",
  "repeat",
  "reverse",
  "slice",
  "split",
  "startsWith",
  "title",
  "trim",
  // numbers
  "abs",
  "ceil",
  "floor",
  "round",
  "toFixed",
  // lists
  "filter",
  "flat",
  "join",
  "map",
  "mean",
  "reduce",
  "sort",
  "unique",
  // dates
  "date",
  "format",
  "time",
  "relative",
  // links and files
  "asFile",
  "linksTo",
  "asLink",
  "hasLink",
  "linksOfType",
  "backlinksOfType",
  "hasProperty",
  "hasTag",
  "inFolder",
  // objects and regular expressions
  "keys",
  "values",
  "matches",
]);

const folderOf = (file: string): string => {
  const slash = file.lastIndexOf("/");
  return slash < 0 ? "/" : file.slice(0, slash);
};

/** A file's name as Obsidian shows it: a note without `.md`, anything else with its extension. */
export const docName = (doc: BaseDoc): string => {
  const name = fileName(doc.file);
  return /\.md$/i.test(name) ? name.slice(0, -3) : name;
};
const baseName = (doc: BaseDoc): string => fileName(doc.file).replace(/\.[^.]*$/, "");

const dateOf = (time: number | undefined): BaseValue =>
  time === undefined ? null : { kind: "date", time };

export function fileField(doc: BaseDoc, field: string, scope: BaseScope): BaseValue {
  switch (field) {
    case "name":
      return docName(doc);
    case "basename":
      return baseName(doc);
    case "path":
      return doc.file;
    case "folder":
      return folderOf(doc.file);
    case "ext": {
      const name = fileName(doc.file);
      const dot = name.lastIndexOf(".");
      return dot < 0 ? "" : name.slice(dot + 1);
    }
    case "size":
      return doc.size;
    case "mtime":
      return dateOf(doc.mtime);
    case "ctime":
      return dateOf(doc.ctime ?? doc.mtime);
    case "tags":
      return doc.tags;
    case "links":
      return doc.links;
    case "embeds":
      return doc.embeds;
    case "backlinks":
      return scope.corpus.backlinks(doc).map((source): BaseValue => ({
        kind: "link",
        path: source.file,
        display: docName(source),
      }));
    case "properties":
      return { kind: "object", entries: doc.properties };
    case "file":
      return { kind: "file", doc };
    default:
      return null;
  }
}

export const noteProperty = (doc: BaseDoc, name: string): BaseValue =>
  fromProperty(doc.properties[name], doc.file);

const DATE_FIELDS = new Set(["year", "month", "day", "hour", "minute", "second", "millisecond"]);

function dateField(date: DateValue, name: string): BaseValue {
  const at = new Date(date.time);
  switch (name) {
    case "year":
      return at.getFullYear();
    case "month":
      return at.getMonth() + 1;
    case "day":
      return at.getDate();
    case "hour":
      return at.getHours();
    case "minute":
      return at.getMinutes();
    case "second":
      return at.getSeconds();
    default:
      return at.getMilliseconds();
  }
}

export function member(object: BaseValue, name: string, scope: BaseScope): BaseValue {
  if (tagged(object, "error")) return object;
  if (tagged(object, "file")) return fileField(object.doc, name, scope);
  if (tagged(object, "this")) {
    return name === "file" ? { kind: "file", doc: object.doc } : noteProperty(object.doc, name);
  }
  if (tagged(object, "object")) return fromProperty(object.entries[name]);
  if (tagged(object, "date") && DATE_FIELDS.has(name)) return dateField(object, name);
  if (name === "length" && (typeof object === "string" || isList(object))) return object.length;
  return null;
}

export function index(object: BaseValue, at: BaseValue): BaseValue {
  if (tagged(object, "error")) return object;
  if (isList(object) && typeof at === "number") {
    return object[at < 0 ? object.length + at : at] ?? null;
  }
  if (typeof at !== "string") return null;
  if (tagged(object, "this")) return noteProperty(object.doc, at);
  return tagged(object, "object") ? fromProperty(object.entries[at]) : null;
}

const asDate = (value: BaseValue): DateValue | undefined => {
  if (tagged(value, "date")) return value;
  const time = typeof value === "string" ? parseDate(value) : undefined;
  return time === undefined ? undefined : { kind: "date", time };
};
const asDuration = (value: BaseValue): DurationValue | undefined =>
  tagged(value, "duration") ? value : typeof value === "string" ? parseDuration(value) : undefined;

const numbers = (args: ReadonlyArray<BaseValue>): number[] | undefined =>
  args.every((arg) => typeof arg === "number") ? (args as number[]) : undefined;

const unwrapLink = (text: string) => linkOfText(text)?.path ?? text;

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** A file by path, by link, or by a file value; null when the wiki has no such file. */
function fileOf(value: BaseValue, scope: BaseScope): BaseValue {
  if (tagged(value, "file")) return value;
  if (tagged(value, "this")) return { kind: "file", doc: value.doc };
  const path = tagged(value, "link")
    ? value.path
    : typeof value === "string"
      ? unwrapLink(value)
      : undefined;
  if (path === undefined) return null;
  const from = tagged(value, "link") ? value.from : scope.self?.file;
  const doc = scope.corpus.byPath(path) ?? scope.corpus.resolve(path, from);
  return doc ? { kind: "file", doc } : null;
}

export function callGlobal(
  name: string,
  args: ReadonlyArray<BaseValue>,
  scope: BaseScope,
): BaseValue {
  const first = args[0] ?? null;
  switch (name) {
    case "date": {
      const date = asDate(first);
      return date ? { kind: "date", time: date.time } : null;
    }
    case "duration":
      return asDuration(first) ?? null;
    case "now":
      return { kind: "date", time: scope.now };
    case "today":
      return { kind: "date", time: startOfDay(scope.now) };
    case "link": {
      const shown = args[1];
      const label = shown === undefined || shown === null ? undefined : display(shown);
      let path: string | undefined;
      if (tagged(first, "file") || tagged(first, "this")) path = first.doc.file;
      else if (tagged(first, "link")) path = first.path;
      else if (typeof first === "string") path = unwrapLink(first);
      if (path === undefined) return null;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
        return label === undefined
          ? { kind: "url", href: path }
          : { kind: "url", href: path, display: label };
      }
      // A literal is written in the base, so it searches from the base's folder.
      const from = tagged(first, "link") ? first.from : scope.self?.file;
      return {
        kind: "link",
        path,
        ...(label === undefined ? {} : { display: label }),
        ...(from === undefined ? {} : { from }),
      };
    }
    case "list":
      return first === null ? [] : isList(first) ? first : [first];
    case "file":
      return fileOf(first, scope);
    case "if":
      return truthy(first) ? (args[1] ?? null) : (args[2] ?? null);
    case "max":
    case "min": {
      const values = numbers(args);
      if (values === undefined || values.length === 0) return null;
      return name === "max" ? Math.max(...values) : Math.min(...values);
    }
    case "number": {
      if (typeof first === "number") return first;
      if (typeof first === "boolean") return first ? 1 : 0;
      if (tagged(first, "date")) return first.time;
      if (tagged(first, "duration")) return durationMs(first);
      if (typeof first === "string") {
        const parsed = first.trim() === "" ? Number.NaN : Number(first);
        return Number.isNaN(parsed)
          ? errorValue(`Could not convert "${first}" to a number.`)
          : parsed;
      }
      return null;
    }
    case "random":
      // @effect-diagnostics-next-line globalRandom:off - a pure package; random() is Obsidian's.
      return Math.random();
    case "escapeHTML":
      return first === null ? null : display(first).replace(/[&<>"']/g, (char) => ESCAPES[char]!);
    case "html":
      return first === null ? null : { kind: "html", html: display(first) };
    case "icon":
      return typeof first === "string" ? { kind: "icon", name: first } : null;
    case "image": {
      if (first === null) return null;
      const path = tagged(first, "file")
        ? first.doc.file
        : tagged(first, "link")
          ? first.path
          : unwrapLink(display(first));
      return { kind: "image", path };
    }
    default:
      return null;
  }
}

function fileMethod(
  doc: BaseDoc,
  name: string,
  args: ReadonlyArray<BaseValue>,
  scope: BaseScope,
): BaseValue | undefined {
  switch (name) {
    case "hasLink": {
      const wanted = identity(args[0] ?? null, scope.corpus.resolve, scope.self?.file);
      return (
        wanted !== undefined &&
        doc.links.some((link) => identity(link, scope.corpus.resolve) === wanted)
      );
    }
    case "linksOfType": {
      const type = args[0] ?? null;
      if (typeof type !== "string") return typeError(name, "type", "String", type);
      return doc.typedLinks
        .filter((link) => link.types.includes(type))
        .map((link): BaseValue => ({ kind: "link", path: link.target, from: doc.file }));
    }
    case "backlinksOfType": {
      const type = args[0] ?? null;
      if (typeof type !== "string") return typeError(name, "type", "String", type);
      return scope.corpus
        .backlinks(doc)
        .filter((source) =>
          source.typedLinks.some(
            (link) =>
              link.types.includes(type) && scope.corpus.resolve(link.target, source.file) === doc,
          ),
        )
        .map((source): BaseValue => ({
          kind: "link",
          path: source.file,
          display: docName(source),
        }));
    }
    case "hasTag":
      return args.some((tag) => typeof tag === "string" && hasTag(doc.tags, tag));
    case "hasProperty":
      return typeof args[0] === "string" && Object.hasOwn(doc.properties, args[0]);
    case "inFolder": {
      const folder = typeof args[0] === "string" ? args[0].replace(/^\/+|\/+$/g, "") : null;
      if (folder === null) return false;
      const own = folderOf(doc.file).toLowerCase();
      const wanted = folder.toLowerCase();
      return wanted === "" || own === wanted || own.startsWith(`${wanted}/`);
    }
    case "asLink": {
      const shown = args[0];
      return shown === undefined || shown === null
        ? { kind: "link", path: doc.file }
        : { kind: "link", path: doc.file, display: display(shown) };
    }
    default:
      return undefined;
  }
}

function textMethod(
  text: string,
  name: string,
  args: ReadonlyArray<BaseValue>,
): BaseValue | undefined {
  const first = args[0] ?? null;
  switch (name) {
    case "lower":
      return text.toLowerCase();
    case "title":
      return text.replace(
        /(^|\s)(\S)/gu,
        (_, space: string, letter: string) => space + letter.toUpperCase(),
      );
    case "trim":
      return text.trim();
    case "startsWith":
      return text.startsWith(display(first));
    case "endsWith":
      return text.endsWith(display(first));
    case "repeat":
      return typeof first === "number" && first >= 0 ? text.repeat(Math.floor(first)) : null;
    case "reverse":
      return [...text].reverse().join("");
    case "slice":
      return text.slice(
        typeof first === "number" ? first : 0,
        typeof args[1] === "number" ? args[1] : undefined,
      );
    case "replace": {
      const replacement = display(args[1] ?? null);
      if (tagged(first, "regex")) return text.replace(first.pattern, replacement);
      return first === null ? text : text.replaceAll(display(first), () => replacement);
    }
    case "split": {
      const separator = tagged(first, "regex")
        ? new RegExp(first.pattern.source, first.pattern.flags.replace("g", ""))
        : display(first);
      const parts = text.split(separator);
      return typeof args[1] === "number" ? parts.slice(0, args[1]) : parts;
    }
    default:
      return undefined;
  }
}

function numberMethod(
  value: number,
  name: string,
  args: ReadonlyArray<BaseValue>,
): BaseValue | undefined {
  const first = args[0];
  switch (name) {
    case "abs":
      return Math.abs(value);
    case "ceil":
      return Math.ceil(value);
    case "floor":
      return Math.floor(value);
    case "round": {
      const digits = typeof first === "number" ? Math.max(0, Math.floor(first)) : 0;
      const scale = 10 ** digits;
      return Math.round(value * scale) / scale;
    }
    case "toFixed":
      return value.toFixed(typeof first === "number" ? Math.max(0, Math.min(100, first)) : 0);
    default:
      return undefined;
  }
}

function listMethod(
  list: ReadonlyArray<BaseValue>,
  name: string,
  args: ReadonlyArray<BaseValue>,
): BaseValue | undefined {
  const first = args[0] ?? null;
  switch (name) {
    case "flat": {
      // Every level, unlike JavaScript's flat().
      const flatten = (items: ReadonlyArray<BaseValue>): BaseValue[] =>
        items.flatMap((item) => (isList(item) ? flatten(item) : [item]));
      return flatten(list);
    }
    case "join":
      return list.map(display).join(display(first));
    // Undocumented, but Obsidian's own example summary uses it; every item counts, as in Average.
    case "mean": {
      if (!list.length) return null;
      const total = list.reduce<number>(
        (sum, item) => sum + (typeof item === "number" ? item : 0),
        0,
      );
      return total / list.length;
    }
    case "reverse":
      return list.toReversed();
    case "slice":
      return list.slice(
        typeof first === "number" ? first : 0,
        typeof args[1] === "number" ? args[1] : undefined,
      );
    case "sort":
      return list.toSorted(sortOrder);
    case "unique": {
      // Obsidian's unique() also sorts what it keeps.
      const seen = new Set<string>();
      return list
        .filter((item) => {
          const id = `${typeOf(item)}:${display(item)}`;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .toSorted(sortOrder);
    }
    default:
      return undefined;
  }
}

function dateMethod(
  date: DateValue,
  name: string,
  args: ReadonlyArray<BaseValue>,
  scope: BaseScope,
): BaseValue | undefined {
  switch (name) {
    case "date":
      return { kind: "date", time: startOfDay(date.time) };
    case "format":
      return formatDate(date.time, typeof args[0] === "string" ? args[0] : "YYYY-MM-DD");
    case "time":
      return formatDate(date.time, "HH:mm:ss");
    case "relative":
      return humanize({ kind: "duration", months: 0, days: 0, ms: date.time - scope.now }, true);
    default:
      return undefined;
  }
}

/** A method on a value already worked out; null when the value has no such method. */
export function callMethod(
  object: BaseValue,
  name: string,
  args: ReadonlyArray<BaseValue>,
  scope: BaseScope,
): BaseValue {
  if (tagged(object, "error")) return object;
  const resolve = scope.corpus.resolve;
  const first = args[0] ?? null;
  switch (name) {
    case "isEmpty":
      return tagged(object, "date") ? false : isEmptyValue(object);
    case "isTruthy":
      return truthy(object);
    case "isType":
      return typeof first === "string" && typeOf(object) === first.toLowerCase();
    case "toString":
      return object === null ? null : display(object);
  }
  if (object === null) return null;
  if (tagged(object, "file") || tagged(object, "this")) {
    return fileMethod(object.doc, name, args, scope) ?? null;
  }
  if (name === "contains" || name === "containsAll" || name === "containsAny") {
    // Text contains ignores case in Obsidian ("Epsilon" contains "e").
    const holds = (needle: BaseValue): boolean =>
      isList(object)
        ? object.some((item) => equals(item, needle, resolve))
        : display(object).toLowerCase().includes(display(needle).toLowerCase());
    if (!isList(object) && typeof object !== "string" && !tagged(object, "url")) return null;
    if (name === "contains") return holds(first);
    return name === "containsAll" ? args.every(holds) : args.some(holds);
  }
  if (typeof object === "string" || tagged(object, "url")) {
    return textMethod(display(object), name, args) ?? null;
  }
  if (typeof object === "number") return numberMethod(object, name, args) ?? null;
  if (isList(object)) return listMethod(object, name, args) ?? null;
  if (tagged(object, "date")) return dateMethod(object, name, args, scope) ?? null;
  if (tagged(object, "link")) {
    if (name === "asFile") {
      const doc = resolve(object.path, object.from);
      return doc ? { kind: "file", doc } : null;
    }
    if (name === "linksTo") {
      if (!tagged(first, "file") && !tagged(first, "this")) {
        return typeError("linksTo", "file", "File", first);
      }
      const doc = resolve(object.path, object.from);
      const wanted = identity(first, resolve);
      return doc !== undefined && doc.links.some((link) => identity(link, resolve) === wanted);
    }
    return null;
  }
  if (tagged(object, "object")) {
    if (name === "keys") return Object.keys(object.entries);
    if (name === "values") return Object.values(object.entries).map((value) => fromProperty(value));
    return null;
  }
  if (tagged(object, "regex") && name === "matches") {
    const pattern = new RegExp(object.pattern.source, object.pattern.flags.replace("g", ""));
    return first === null ? false : pattern.test(display(first));
  }
  return null;
}

/** `+ - * / %` over numbers, dates and durations, and `+` joining text. */
export function arithmetic(op: string, a: BaseValue, b: BaseValue): BaseValue {
  if (tagged(a, "error")) return a;
  if (tagged(b, "error")) return b;
  if (a === null || b === null) return null;
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return a / b;
      default:
        return a % b;
    }
  }
  const date = tagged(a, "date") ? a : undefined;
  if (date && (op === "+" || op === "-")) {
    if (op === "-" && (tagged(b, "date") || asDate(b) !== undefined) && !asDuration(b)) {
      const other = timeOf(b);
      return other === undefined
        ? null
        : { kind: "duration", months: 0, days: 0, ms: date.time - other };
    }
    const duration = asDuration(b);
    if (duration)
      return { kind: "date", time: shiftDate(date.time, duration, op === "+" ? 1 : -1) };
  }
  if (tagged(a, "duration") && typeof b === "number" && (op === "*" || op === "/")) {
    const factor = op === "*" ? b : 1 / b;
    return {
      kind: "duration",
      months: a.months * factor,
      days: a.days * factor,
      ms: a.ms * factor,
    };
  }
  if (tagged(a, "duration") && tagged(b, "duration") && (op === "+" || op === "-")) {
    const sign = op === "+" ? 1 : -1;
    return {
      kind: "duration",
      months: a.months + sign * b.months,
      days: a.days + sign * b.days,
      ms: a.ms + sign * b.ms,
    };
  }
  if (op === "+" && (typeof a === "string" || typeof b === "string"))
    return display(a) + display(b);
  return null;
}
