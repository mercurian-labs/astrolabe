// @effect-diagnostics globalDate:off - an Effect-free package; months and local midnight need Date.
/**
 * The values Obsidian's Bases language works with, and how each one reads, compares and sorts.
 * Text forms follow what Obsidian 1.14 exports as CSV (see fixtures/obsidian-parity).
 */
import { key, type TypedLink } from "./links.ts";

export class BaseError extends Error {
  override readonly name = "BaseError";
}

/** What an expression sees of one file in the wiki's repository. */
export interface BaseDoc {
  /** The repository-relative path. */
  readonly file: string;
  readonly source: string;
  readonly size: number;
  readonly properties: Readonly<Record<string, unknown>>;
  /** `#`-prefixed, prose first, then the `tags` property, as Obsidian lists them. */
  readonly tags: ReadonlyArray<string>;
  /** Every link in the file, in order, repeats kept; embeds are links too. */
  readonly links: ReadonlyArray<LinkValue>;
  readonly embeds: ReadonlyArray<LinkValue>;
  /** The documents the body links to with `@` types; a note's only. */
  readonly typedLinks: ReadonlyArray<TypedLink>;
  /** Epoch milliseconds of the last and the first commit that touched the file, when known. */
  readonly mtime: number | undefined;
  readonly ctime: number | undefined;
}

export interface DateValue {
  readonly kind: "date";
  readonly time: number;
  /** How a property wrote it; a date shows this text until arithmetic makes a new one. */
  readonly text?: string;
}
/** Months and days are calendar units, as Moment.js adds them; the rest is exact time. */
export interface DurationValue {
  readonly kind: "duration";
  readonly months: number;
  readonly days: number;
  readonly ms: number;
}
export interface LinkValue {
  readonly kind: "link";
  /** The target as written: a name or path, with any `#heading`. */
  readonly path: string;
  readonly display?: string;
}
export interface UrlValue {
  readonly kind: "url";
  readonly href: string;
  readonly display?: string;
}
export interface FileValue {
  readonly kind: "file";
  readonly doc: BaseDoc;
}
/** `this`: the file the base is shown in. Its members are that note's properties and `file`. */
export interface ThisValue {
  readonly kind: "this";
  readonly doc: BaseDoc;
}
export interface ObjectValue {
  readonly kind: "object";
  readonly entries: Readonly<Record<string, unknown>>;
}
export interface RegexValue {
  readonly kind: "regex";
  readonly pattern: RegExp;
}
export interface HtmlValue {
  readonly kind: "html";
  readonly html: string;
}
export interface IconValue {
  readonly kind: "icon";
  readonly name: string;
}
export interface ImageValue {
  readonly kind: "image";
  readonly path: string;
}
/** A cell that could not be worked out, such as a function given the wrong type. */
export interface ErrorValue {
  readonly kind: "error";
  readonly message: string;
}

export type BaseValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<BaseValue>
  | DateValue
  | DurationValue
  | LinkValue
  | UrlValue
  | FileValue
  | ThisValue
  | ObjectValue
  | RegexValue
  | HtmlValue
  | IconValue
  | ImageValue
  | ErrorValue;

type Tagged = Exclude<BaseValue, null | boolean | number | string | ReadonlyArray<BaseValue>>;
export const tagged = <K extends Tagged["kind"]>(
  value: BaseValue,
  kind: K,
): value is Extract<Tagged, { kind: K }> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value
    ? value.kind === kind
    : false;

export const isList = (value: BaseValue): value is ReadonlyArray<BaseValue> => Array.isArray(value);

/** The type name `isType` tests for. */
export function typeOf(value: BaseValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value;
  }
  if (isList(value)) return "list";
  return value.kind === "this" ? "file" : value.kind;
}

export const errorValue = (message: string): ErrorValue => ({ kind: "error", message });

/** A type error in Obsidian's words, as `linksTo` given a link reports. */
export const typeError = (fn: string, parameter: string, expected: string, given: BaseValue) =>
  errorValue(
    `Type error in "${fn}", parameter "${parameter}". Expected ${expected}, given ${typeName(given)}.`,
  );

const typeName = (value: BaseValue): string => {
  const type = typeOf(value);
  return type === "url" ? "URL" : `${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;
};

// ── Dates ────────────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** A date written as `YYYY-MM-DD`, optionally with a time; local time unless it names a zone. */
export function parseDate(text: string): number | undefined {
  const trimmed = text.trim();
  if (!DATE.test(trimmed)) return undefined;
  const iso = trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed.replace(" ", "T");
  const time = Date.parse(iso);
  return Number.isNaN(time) ? undefined : time;
}

export const timeOf = (value: BaseValue): number | undefined =>
  tagged(value, "date") ? value.time : typeof value === "string" ? parseDate(value) : undefined;

const pad = (value: number, width = 2) => String(Math.trunc(Math.abs(value))).padStart(width, "0");
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ordinal = (day: number): string => {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
};
const offset = (date: Date, separator: string): string => {
  const minutes = -date.getTimezoneOffset();
  return `${minutes < 0 ? "-" : "+"}${pad(minutes / 60)}${separator}${pad(minutes % 60)}`;
};
const dayOfYear = (date: Date): number =>
  Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(date.getFullYear(), 0, 1).getTime()) /
      86_400_000,
  ) + 1;

const FORMAT_TOKEN =
  /\[([^\]]*)\]|YYYY|YY|Q|MMMM|MMM|MM|M|Do|DDDD|DDD|DD|D|dddd|ddd|dd|d|HH|H|hh|h|kk|k|mm|m|ss|s|SSS|SS|S|A|a|ZZ|Z|X|x/g;

/** A date in a Moment.js format, as Obsidian's `format()` writes it, in local time. */
export function formatDate(time: number, format: string): string {
  const date = new Date(time);
  const hours = date.getHours();
  return format.replace(FORMAT_TOKEN, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case "YYYY":
        return String(date.getFullYear()).padStart(4, "0");
      case "YY":
        return pad(date.getFullYear() % 100);
      case "Q":
        return String(Math.floor(date.getMonth() / 3) + 1);
      case "MMMM":
        return MONTHS[date.getMonth()] ?? "";
      case "MMM":
        return (MONTHS[date.getMonth()] ?? "").slice(0, 3);
      case "MM":
        return pad(date.getMonth() + 1);
      case "M":
        return String(date.getMonth() + 1);
      case "Do":
        return ordinal(date.getDate());
      case "DDDD":
        return pad(dayOfYear(date), 3);
      case "DDD":
        return String(dayOfYear(date));
      case "DD":
        return pad(date.getDate());
      case "D":
        return String(date.getDate());
      case "dddd":
        return WEEKDAYS[date.getDay()] ?? "";
      case "ddd":
        return (WEEKDAYS[date.getDay()] ?? "").slice(0, 3);
      case "dd":
        return (WEEKDAYS[date.getDay()] ?? "").slice(0, 2);
      case "d":
        return String(date.getDay());
      case "HH":
        return pad(hours);
      case "H":
        return String(hours);
      case "hh":
        return pad(hours % 12 || 12);
      case "h":
        return String(hours % 12 || 12);
      case "kk":
        return pad(hours || 24);
      case "k":
        return String(hours || 24);
      case "mm":
        return pad(date.getMinutes());
      case "m":
        return String(date.getMinutes());
      case "ss":
        return pad(date.getSeconds());
      case "s":
        return String(date.getSeconds());
      case "SSS":
        return pad(date.getMilliseconds(), 3);
      case "SS":
        return pad(Math.floor(date.getMilliseconds() / 10));
      case "S":
        return String(Math.floor(date.getMilliseconds() / 100));
      case "A":
        return hours < 12 ? "AM" : "PM";
      case "a":
        return hours < 12 ? "am" : "pm";
      case "ZZ":
        return offset(date, "");
      case "Z":
        return offset(date, ":");
      case "X":
        return String(Math.floor(time / 1000));
      case "x":
        return String(time);
      default:
        return token;
    }
  });
}

/** Midnight of the day `time` falls on, locally. */
export const startOfDay = (time: number): number => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

// ── Durations ────────────────────────────────────────────────────────────────

const DURATION_PART =
  /(-?\d+(?:\.\d+)?)\s*(years?|y|months?|M|weeks?|w|days?|d|hours?|h|minutes?|m|seconds?|s)(?![a-z])/gy;
const UNIT_MS: Readonly<Record<string, number>> = {
  h: 3_600_000,
  m: 60_000,
  s: 1000,
};

/** A duration such as `"1M"`, `"2 days"` or `"1d 6h"`; undefined for anything else. */
export function parseDuration(text: string): DurationValue | undefined {
  const source = text.trim();
  if (!source) return undefined;
  let months = 0;
  let days = 0;
  let ms = 0;
  let at = 0;
  while (at < source.length) {
    while (source[at] === " " || source[at] === ",") at++;
    if (at >= source.length) break;
    DURATION_PART.lastIndex = at;
    const match = DURATION_PART.exec(source);
    if (!match) return undefined;
    at = DURATION_PART.lastIndex;
    const amount = Number(match[1]);
    const word = match[2] ?? "";
    const unit = word === "M" || word.startsWith("month") ? "M" : word === "m" ? "m" : word[0]!;
    if (unit === "y") months += amount * 12;
    else if (unit === "M") months += amount;
    else if (unit === "w") days += amount * 7;
    else if (unit === "d") days += amount;
    else ms += amount * (UNIT_MS[unit] ?? 0);
  }
  return { kind: "duration", months, days, ms };
}

/** `time` moved by a duration: months, then days on the calendar, then the exact rest. */
export function shiftDate(time: number, duration: DurationValue, sign: 1 | -1): number {
  const date = new Date(time);
  if (duration.months) date.setMonth(date.getMonth() + sign * Math.trunc(duration.months));
  if (duration.days) date.setDate(date.getDate() + sign * Math.trunc(duration.days));
  return date.getTime() + sign * duration.ms;
}

// Moment.js's own conversions between days and months, which `humanize` rounds through.
const daysToMonths = (days: number) => (days * 4800) / 146097;
const monthsToDays = (months: number) => (months * 146097) / 4800;

/** A duration in words, as Moment.js's `humanize()` writes it: "2 months", "a day". */
export function humanize(duration: DurationValue, withSuffix = false): string {
  const dayCount = duration.days + duration.ms / 86_400_000;
  const totalDays = Math.abs(dayCount + monthsToDays(duration.months));
  const totalMonths = Math.abs(duration.months + daysToMonths(dayCount));
  const seconds = Math.round(totalDays * 86_400);
  const minutes = Math.round(totalDays * 1440);
  const hours = Math.round(totalDays * 24);
  const days = Math.round(totalDays);
  const months = Math.round(totalMonths);
  const years = Math.round(totalMonths / 12);
  const words =
    seconds <= 44
      ? "a few seconds"
      : seconds < 45
        ? `${seconds} seconds`
        : minutes <= 1
          ? "a minute"
          : minutes < 45
            ? `${minutes} minutes`
            : hours <= 1
              ? "an hour"
              : hours < 22
                ? `${hours} hours`
                : days <= 1
                  ? "a day"
                  : days < 26
                    ? `${days} days`
                    : months <= 1
                      ? "a month"
                      : months < 11
                        ? `${months} months`
                        : years <= 1
                          ? "a year"
                          : `${years} years`;
  if (!withSuffix) return words;
  const future = durationMs(duration) > 0;
  return future ? `in ${words}` : `${words} ago`;
}

function durationMs(duration: DurationValue): number {
  return duration.ms + (duration.days + monthsToDays(duration.months)) * 86_400_000;
}

// ── Reading values ───────────────────────────────────────────────────────────

const WIKILINK = /^\[\[([^\]]+)\]\]$/;

/** `[[Target#Heading|Alias]]` as a link value; undefined for other text. */
export function linkOfText(text: string): LinkValue | undefined {
  const inner = WIKILINK.exec(text.trim())?.[1];
  if (inner === undefined) return undefined;
  const bar = inner.indexOf("|");
  const path = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  const display = bar < 0 ? undefined : inner.slice(bar + 1);
  return display === undefined ? { kind: "link", path } : { kind: "link", path, display };
}

/** A frontmatter value as the language sees it: a lone `[[link]]` is a link, a date a date. */
export function fromProperty(raw: unknown): BaseValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "boolean" || typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const link = linkOfText(raw);
    if (link) return link;
    const time = parseDate(raw);
    return time === undefined ? raw : { kind: "date", time, text: raw };
  }
  if (raw instanceof Date) return { kind: "date", time: raw.getTime() };
  if (Array.isArray(raw)) return raw.map(fromProperty);
  if (typeof raw === "object") return { kind: "object", entries: raw as Record<string, unknown> };
  return String(raw);
}

/** A number as Obsidian writes one: no `-0`, nothing for one that isn't finite. */
const numberText = (value: number): string =>
  Number.isFinite(value) ? String(value === 0 ? 0 : value) : "";

/** A value as text: what `+` joins, what `toString()` gives and what a CSV export holds. */
export function display(value: BaseValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return numberText(value);
  if (typeof value === "boolean") return String(value);
  if (isList(value)) return value.map(display).join(", ");
  switch (value.kind) {
    case "date":
      return value.text ?? formatDate(value.time, "YYYY-MM-DDTHH:mm:ss");
    case "duration":
      return humanize(value);
    case "link":
      return value.display === undefined
        ? `[[${value.path}]]`
        : `[[${value.path}|${value.display}]]`;
    case "url":
      return value.href;
    case "file":
    case "this":
      return `[[${value.doc.file}]]`;
    case "object":
      return JSON.stringify(value.entries);
    case "regex":
      return String(value.pattern);
    case "html":
      return value.html;
    case "icon":
      return value.name;
    case "image":
      return `![[${value.path}]]`;
    case "error":
      return `Error: ${value.message}`;
  }
}

export const isEmptyValue = (value: BaseValue): boolean =>
  value === null ||
  value === "" ||
  (isList(value) && value.length === 0) ||
  (tagged(value, "object") && Object.keys(value.entries).length === 0);

export function truthy(value: BaseValue): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value.length > 0;
  if (isList(value)) return value.length > 0;
  if (tagged(value, "error")) return false;
  return true;
}

/** Resolves link text to a file, as the wiki's corpus does; supplied by whoever evaluates. */
export type Resolve = (path: string) => BaseDoc | undefined;

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const stripHeading = (path: string): string => (path.split("#")[0] ?? "").trim();

/** Which file a value names, so links, files and names compare: the file, or the bare name. */
export function identity(value: BaseValue, resolve: Resolve): string | undefined {
  if (tagged(value, "file") || tagged(value, "this")) return `file:${key(value.doc.file)}`;
  let path: string | undefined;
  if (tagged(value, "link")) path = value.path;
  else if (typeof value === "string") path = linkOfText(value)?.path ?? value;
  if (path === undefined) return undefined;
  const target = stripHeading(path);
  const doc = resolve(target);
  return doc ? `file:${key(doc.file)}` : `name:${key(fileName(target).replace(/\.md$/i, ""))}`;
}

const isFileLike = (value: BaseValue): boolean =>
  tagged(value, "link") || tagged(value, "file") || tagged(value, "this");

export function equals(a: BaseValue, b: BaseValue, resolve: Resolve): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (isFileLike(a) || isFileLike(b)) {
    const left = identity(a, resolve);
    return left !== undefined && left === identity(b, resolve);
  }
  if (tagged(a, "date") || tagged(b, "date")) {
    const left = timeOf(a);
    return left !== undefined && left === timeOf(b);
  }
  if (tagged(a, "duration") && tagged(b, "duration")) return durationMs(a) === durationMs(b);
  if (tagged(a, "url") || tagged(b, "url")) return display(a) === display(b);
  if (isList(a) && isList(b)) {
    return (
      a.length === b.length && a.every((item, index) => equals(item, b[index] ?? null, resolve))
    );
  }
  return false;
}

/** How two values order for `<` and friends; undefined when they don't compare. */
export function order(a: BaseValue, b: BaseValue): number | undefined {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (tagged(a, "date") || tagged(b, "date")) {
    const left = timeOf(a);
    const right = timeOf(b);
    return left === undefined || right === undefined ? undefined : left - right;
  }
  if (tagged(a, "duration") && tagged(b, "duration")) return durationMs(a) - durationMs(b);
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return undefined;
}

const collate = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** How values sort in a view: by kind, then within it; empty values last. */
export function sortOrder(a: BaseValue, b: BaseValue): number {
  if (isEmptyValue(a) || isEmptyValue(b)) return Number(isEmptyValue(a)) - Number(isEmptyValue(b));
  if (typeof a === "string" && typeof b === "string") return collate(a, b);
  const compared = order(a, b);
  if (compared !== undefined) return compared;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collate(display(a), display(b));
}

export { fileName, stripHeading, durationMs };
