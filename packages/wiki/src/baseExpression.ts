// @effect-diagnostics globalDate:off - an Effect-free package; months and local midnight need Date.
/**
 * The part of Obsidian's Bases expression language this wiki evaluates: filter statements and
 * the properties a view shows. Every expression is checked against the subset before it runs,
 * so an unsupported one fails loudly even in a branch no note reaches.
 */
import { key, noteName } from "./links.ts";
import { hasTag } from "./properties.ts";

export class BaseError extends Error {
  override readonly name = "BaseError";
}

/** What an expression sees of one wiki file. */
export interface BaseDoc {
  readonly name: string;
  readonly file: string;
  readonly source: string;
  readonly properties: Readonly<Record<string, unknown>>;
  /** `#`-prefixed, as written. */
  readonly tags: ReadonlyArray<string>;
  /** Distinct link targets, as first written. */
  readonly links: ReadonlyArray<string>;
  /** ISO time of the last commit that changed the file, when known. */
  readonly mtime: string | undefined;
}

interface DateValue {
  readonly kind: "date";
  readonly time: number;
}
interface LinkValue {
  readonly kind: "link";
  readonly target: string;
}
interface FileValue {
  readonly kind: "file";
  readonly doc: BaseDoc;
}
/** `this`: the file the base is shown in. Its members are that note's properties and `file`. */
interface ThisValue {
  readonly kind: "this";
  readonly doc: BaseDoc;
}
interface ObjectValue {
  readonly kind: "object";
  readonly entries: Readonly<Record<string, unknown>>;
}
export type BaseValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<BaseValue>
  | DateValue
  | LinkValue
  | FileValue
  | ThisValue
  | ObjectValue;

type Tagged = Exclude<BaseValue, null | boolean | number | string | ReadonlyArray<BaseValue>>;
const tagged = <K extends Tagged["kind"]>(
  value: BaseValue,
  kind: K,
): value is Extract<Tagged, { kind: K }> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value
    ? value.kind === kind
    : false;

export const FILE_FIELDS: ReadonlyMap<string, string> = new Map([
  ["name", "Name"],
  ["basename", "Name"],
  ["path", "Path"],
  ["folder", "Folder"],
  ["ext", "Extension"],
  ["size", "Size"],
  ["mtime", "Modified"],
  ["tags", "Tags"],
  ["links", "Links"],
  ["backlinks", "Backlinks"],
  ["properties", "Properties"],
]);
const FILE_METHODS = new Set(["hasLink", "hasTag", "hasProperty", "inFolder", "asLink"]);
const METHODS = new Set([
  "contains",
  "containsAll",
  "containsAny",
  "startsWith",
  "endsWith",
  "isEmpty",
  "lower",
]);
const GLOBALS = new Set(["date", "now", "today", "link", "list"]);

export const unsupported = (what: string, where: string, why?: string): BaseError =>
  new BaseError(`Not supported: ${what}${why ? ` (${why})` : ""} in ${where}.`);

type Token =
  | { readonly kind: "number"; readonly value: number; readonly at: number; readonly end: number }
  | { readonly kind: "string"; readonly value: string; readonly at: number; readonly end: number }
  | { readonly kind: "name"; readonly value: string; readonly at: number; readonly end: number }
  | { readonly kind: "op"; readonly value: string; readonly at: number; readonly end: number }
  | { readonly kind: "end"; readonly at: number; readonly end: number };

const OPERATORS = [
  "==",
  "!=",
  ">=",
  "<=",
  "&&",
  "||",
  ">",
  "<",
  "!",
  "+",
  "-",
  "*",
  "/",
  "%",
  "(",
  ")",
  "[",
  "]",
  ",",
  ".",
];
const NAME = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const NUMBER = /\d+(?:\.\d+)?/y;
const ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r" };

function tokenize(source: string, where: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const char = source[at] ?? "";
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    if (char === '"' || char === "'") {
      let value = "";
      let end = at + 1;
      for (; end < source.length && source[end] !== char; end++) {
        const next = source[end] ?? "";
        if (next === "\\") {
          end++;
          const escaped = source[end] ?? "";
          value += ESCAPES[escaped] ?? escaped;
        } else value += next;
      }
      if (end >= source.length) throw new BaseError(`Unclosed text in ${where}.`);
      tokens.push({ kind: "string", value, at, end: end + 1 });
      at = end + 1;
      continue;
    }
    NUMBER.lastIndex = at;
    const number = NUMBER.exec(source);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]), at, end: NUMBER.lastIndex });
      at = NUMBER.lastIndex;
      continue;
    }
    NAME.lastIndex = at;
    const name = NAME.exec(source);
    if (name) {
      tokens.push({ kind: "name", value: name[0], at, end: NAME.lastIndex });
      at = NAME.lastIndex;
      continue;
    }
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, at));
    if (operator === undefined) {
      throw new BaseError(`Unexpected "${char}" at ${at + 1} in ${where}.`);
    }
    tokens.push({ kind: "op", value: operator, at, end: at + operator.length });
    at += operator.length;
  }
  tokens.push({ kind: "end", at: source.length, end: source.length });
  return tokens;
}

interface Span {
  readonly from: number;
  readonly to: number;
}
export type Expr = Span &
  (
    | { readonly kind: "literal"; readonly value: null | boolean | number | string }
    | { readonly kind: "list"; readonly items: ReadonlyArray<Expr> }
    | { readonly kind: "name"; readonly name: string }
    | { readonly kind: "member"; readonly object: Expr; readonly name: string }
    | { readonly kind: "index"; readonly object: Expr; readonly index: Expr }
    | { readonly kind: "call"; readonly callee: Expr; readonly args: ReadonlyArray<Expr> }
    | { readonly kind: "unary"; readonly op: "!" | "-"; readonly operand: Expr }
    | {
        readonly kind: "binary";
        readonly op: string;
        readonly left: Expr;
        readonly right: Expr;
      }
  );

const BINARY: Readonly<Record<string, number>> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};
const UNARY = 7;

class Parser {
  private position = 0;
  private readonly tokens: ReadonlyArray<Token>;
  private readonly source: string;
  private readonly where: string;
  constructor(tokens: ReadonlyArray<Token>, source: string, where: string) {
    this.tokens = tokens;
    this.source = source;
    this.where = where;
  }

  private peek(): Token {
    return this.tokens[this.position] ?? this.tokens[this.tokens.length - 1]!;
  }

  private take(): Token {
    const token = this.peek();
    if (token.kind !== "end") this.position++;
    return token;
  }

  private fail(token: Token, expected: string): never {
    const found = token.kind === "end" ? "the end" : `"${this.source.slice(token.at, token.end)}"`;
    throw new BaseError(`Expected ${expected} but found ${found} in ${this.where}.`);
  }

  private expect(operator: string): Token {
    const token = this.take();
    if (token.kind !== "op" || token.value !== operator) this.fail(token, `"${operator}"`);
    return token;
  }

  parse(): Expr {
    const expression = this.expression(0);
    const rest = this.peek();
    if (rest.kind !== "end") this.fail(rest, "an operator");
    return expression;
  }

  private expression(power: number): Expr {
    let left = this.prefix();
    for (;;) {
      const token = this.peek();
      if (token.kind !== "op") {
        if (token.kind === "end") return left;
        this.fail(token, "an operator");
      }
      if (token.value === ".") {
        this.take();
        const name = this.take();
        if (name.kind !== "name") this.fail(name, "a name after the dot");
        left = { kind: "member", object: left, name: name.value, from: left.from, to: name.end };
      } else if (token.value === "[") {
        this.take();
        const index = this.expression(0);
        const close = this.expect("]");
        left = { kind: "index", object: left, index, from: left.from, to: close.end };
      } else if (token.value === "(") {
        this.take();
        const args = this.list(")");
        left = { kind: "call", callee: left, args: args.items, from: left.from, to: args.end };
      } else {
        const binding = BINARY[token.value];
        if (binding === undefined || binding <= power) return left;
        this.take();
        const right = this.expression(binding);
        left = { kind: "binary", op: token.value, left, right, from: left.from, to: right.to };
      }
    }
  }

  private list(close: string): { items: Expr[]; end: number } {
    const items: Expr[] = [];
    let next = this.peek();
    if (next.kind === "op" && next.value === close) return { items, end: this.take().end };
    for (;;) {
      items.push(this.expression(0));
      next = this.take();
      if (next.kind === "op" && next.value === close) return { items, end: next.end };
      if (next.kind !== "op" || next.value !== ",") this.fail(next, `"," or "${close}"`);
    }
  }

  private prefix(): Expr {
    const token = this.take();
    const span = { from: token.at, to: token.end };
    switch (token.kind) {
      case "number":
      case "string":
        return { kind: "literal", value: token.value, ...span };
      case "name":
        if (token.value === "true" || token.value === "false") {
          return { kind: "literal", value: token.value === "true", ...span };
        }
        if (token.value === "null") return { kind: "literal", value: null, ...span };
        return { kind: "name", name: token.value, ...span };
      case "op":
        if (token.value === "(") {
          const inner = this.expression(0);
          const close = this.expect(")");
          return { ...inner, from: token.at, to: close.end };
        }
        if (token.value === "[") {
          const { items, end } = this.list("]");
          return { kind: "list", items, from: token.at, to: end };
        }
        if (token.value === "!" || token.value === "-") {
          const operand = this.expression(UNARY);
          return { kind: "unary", op: token.value, operand, from: token.at, to: operand.to };
        }
        if (token.value === "/") throw unsupported("regular expressions", this.where);
        return this.fail(token, "an expression");
      case "end":
        return this.fail(token, "an expression");
    }
  }
}

const isFileRef = (expr: Expr): boolean =>
  (expr.kind === "name" && expr.name === "file") ||
  (expr.kind === "member" &&
    expr.name === "file" &&
    expr.object.kind === "name" &&
    expr.object.name === "this");

/** Throws for anything outside the subset, naming it. */
function check(expr: Expr, source: string, where: string): void {
  const text = (node: Expr) => source.slice(node.from, node.to);
  const visit = (node: Expr): void => {
    switch (node.kind) {
      case "literal":
        return;
      case "list":
        return node.items.forEach(visit);
      case "name":
        if (node.name === "formula") throw unsupported("formula", where, "formulas");
        return;
      case "member":
        if (node.object.kind === "name" && node.object.name === "formula") {
          throw unsupported(text(node), where, "formulas");
        }
        if (isFileRef(node.object) && !FILE_FIELDS.has(node.name)) {
          throw unsupported(text(node), where);
        }
        return visit(node.object);
      case "index":
        visit(node.object);
        return visit(node.index);
      case "call": {
        const { callee } = node;
        if (callee.kind === "name") {
          if (!GLOBALS.has(callee.name)) throw unsupported(`${callee.name}()`, where);
        } else if (callee.kind === "member") {
          const allowed = isFileRef(callee.object) ? FILE_METHODS : METHODS;
          if (!allowed.has(callee.name)) throw unsupported(`${text(callee)}()`, where);
          visit(callee.object);
        } else {
          throw unsupported(text(node), where);
        }
        return node.args.forEach(visit);
      }
      case "unary":
        return visit(node.operand);
      case "binary":
        visit(node.left);
        return visit(node.right);
    }
  };
  visit(expr);
}

/** Parses an expression and checks it against the subset; `where` names it in errors. */
export function compileExpression(source: string, where: string): Expr {
  const expression = new Parser(tokenize(source, where), source, where).parse();
  check(expression, source, where);
  return expression;
}

const WIKILINK = /^\[\[([^\]]+)\]\]$/;
const linkTarget = (text: string): string =>
  noteName((text.split("|")[0] ?? "").split("#")[0]?.trim() ?? "");

/** A frontmatter value as the language sees it; a lone `[[wikilink]]` is a link, as in Obsidian. */
export function fromProperty(raw: unknown): BaseValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "boolean" || typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const link = WIKILINK.exec(raw.trim());
    return link ? { kind: "link", target: linkTarget(link[1] ?? "") } : raw;
  }
  if (raw instanceof Date) return { kind: "date", time: raw.getTime() };
  if (Array.isArray(raw)) return raw.map(fromProperty);
  if (typeof raw === "object") return { kind: "object", entries: raw as Record<string, unknown> };
  return String(raw);
}

const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** A date written as `YYYY-MM-DD`, optionally with a time; local time unless it names a zone. */
function parseDate(text: string): number | undefined {
  const trimmed = text.trim();
  if (!DATE.test(trimmed)) return undefined;
  const iso = trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed.replace(" ", "T");
  const time = Date.parse(iso);
  return Number.isNaN(time) ? undefined : time;
}

const timeOf = (value: BaseValue): number | undefined =>
  tagged(value, "date") ? value.time : typeof value === "string" ? parseDate(value) : undefined;

const DURATION =
  /^\s*(-?\d+(?:\.\d+)?)\s*(y|years?|M|months?|d|days?|w|weeks?|h|hours?|m|minutes?|s|seconds?)\s*$/;
const UNIT_MS: Readonly<Record<string, number>> = {
  d: 86_400_000,
  w: 604_800_000,
  h: 3_600_000,
  m: 60_000,
  s: 1000,
};

/** `time` moved by a duration such as `"1M"` or `"2 days"`; undefined for anything else. */
function shift(time: number, duration: string, sign: 1 | -1): number | undefined {
  const match = DURATION.exec(duration);
  if (!match) return undefined;
  const amount = Number(match[1]) * sign;
  const word = match[2] ?? "";
  const unit = word === "M" || word.startsWith("month") ? "M" : word === "m" ? "m" : word[0]!;
  const date = new Date(time);
  if (unit === "y") date.setFullYear(date.getFullYear() + amount);
  else if (unit === "M") date.setMonth(date.getMonth() + amount);
  else return time + amount * (UNIT_MS[unit] ?? 0);
  return date.getTime();
}

/** The note a value names, as links compare: by name, ignoring case. */
function noteRef(value: BaseValue): string | undefined {
  if (tagged(value, "link")) return key(value.target);
  if (tagged(value, "file") || tagged(value, "this")) return key(value.doc.name);
  if (typeof value === "string") {
    const link = WIKILINK.exec(value.trim());
    return key(link ? linkTarget(link[1] ?? "") : noteName(value.trim()));
  }
  return undefined;
}

const isNoteLike = (value: BaseValue): value is LinkValue | FileValue | ThisValue =>
  tagged(value, "link") || tagged(value, "file") || tagged(value, "this");

export function equals(a: BaseValue, b: BaseValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (isNoteLike(a) || isNoteLike(b)) {
    const left = noteRef(a);
    return left !== undefined && left === noteRef(b);
  }
  if (tagged(a, "date") || tagged(b, "date")) {
    const left = timeOf(a);
    return left !== undefined && left === timeOf(b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => equals(item, b[index] ?? null));
  }
  return false;
}

/** How two values order for `<` and friends; undefined when they don't compare. */
function order(a: BaseValue, b: BaseValue): number | undefined {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (tagged(a, "date") || tagged(b, "date")) {
    const left = timeOf(a);
    const right = timeOf(b);
    return left === undefined || right === undefined ? undefined : left - right;
  }
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return undefined;
}

export function truthy(value: BaseValue): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** A value as text: what `+` joins and what a view shows. */
export function display(value: BaseValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(display).join(", ");
  if (tagged(value, "date")) return new Date(value.time).toISOString();
  if (tagged(value, "link")) return `[[${value.target}]]`;
  if (tagged(value, "file") || tagged(value, "this")) return `[[${value.doc.name}]]`;
  if (tagged(value, "object")) return JSON.stringify(value.entries);
  return "";
}

export const isEmptyValue = (value: BaseValue): boolean =>
  value === null || value === "" || (Array.isArray(value) && value.length === 0);

/** How values sort in a view: by kind, then within it; empty values last. */
export function sortOrder(a: BaseValue, b: BaseValue): number {
  if (isEmptyValue(a) || isEmptyValue(b)) return Number(isEmptyValue(a)) - Number(isEmptyValue(b));
  const compared = order(a, b);
  if (compared !== undefined) {
    return typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      : compared;
  }
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return display(a).localeCompare(display(b), undefined, { numeric: true, sensitivity: "base" });
}

export interface BaseScope {
  readonly row: BaseDoc;
  /** The file `this` names; undefined where the query runs in none. */
  readonly self: BaseDoc | undefined;
  readonly backlinks: (doc: BaseDoc) => ReadonlyArray<string>;
  readonly now: number;
}

const encoder = new TextEncoder();

const folderOf = (file: string): string => {
  const slash = file.lastIndexOf("/");
  return slash < 0 ? "/" : file.slice(0, slash);
};

export function fileField(doc: BaseDoc, field: string, scope: BaseScope): BaseValue {
  switch (field) {
    case "name":
    case "path":
      return doc.file;
    case "basename":
      return doc.name;
    case "folder":
      return folderOf(doc.file);
    case "ext":
      return doc.file.slice(doc.file.lastIndexOf(".") + 1);
    case "size":
      return encoder.encode(doc.source).length;
    case "mtime": {
      const time = doc.mtime === undefined ? Number.NaN : Date.parse(doc.mtime);
      return Number.isNaN(time) ? null : { kind: "date", time };
    }
    case "tags":
      return doc.tags;
    case "links":
      return doc.links.map((target): BaseValue => ({ kind: "link", target }));
    case "backlinks":
      return scope.backlinks(doc).map((target): BaseValue => ({ kind: "link", target }));
    case "properties":
      return { kind: "object", entries: doc.properties };
    default:
      return null;
  }
}

export const noteProperty = (doc: BaseDoc, name: string): BaseValue =>
  fromProperty(doc.properties[name]);

function member(object: BaseValue, name: string, scope: BaseScope): BaseValue {
  if (tagged(object, "file")) return fileField(object.doc, name, scope);
  if (tagged(object, "this")) {
    return name === "file" ? { kind: "file", doc: object.doc } : noteProperty(object.doc, name);
  }
  if (tagged(object, "object")) return fromProperty(object.entries[name]);
  if (name === "length" && (typeof object === "string" || Array.isArray(object))) {
    return object.length;
  }
  return null;
}

function fileMethod(doc: BaseDoc, name: string, args: ReadonlyArray<BaseValue>): BaseValue {
  switch (name) {
    case "hasLink": {
      const wanted = noteRef(args[0] ?? null);
      return wanted !== undefined && doc.links.some((target) => key(target) === wanted);
    }
    case "hasTag":
      return args.some((tag) => typeof tag === "string" && hasTag(doc.tags, tag));
    case "hasProperty":
      return typeof args[0] === "string" && Object.hasOwn(doc.properties, args[0]);
    case "inFolder": {
      const folder = typeof args[0] === "string" ? args[0].replace(/^\/+|\/+$/g, "") : null;
      if (folder === null) return false;
      const own = folderOf(doc.file);
      return folder === "" || own === folder || own.startsWith(`${folder}/`);
    }
    case "asLink":
      return { kind: "link", target: doc.name };
    default:
      return null;
  }
}

function method(object: BaseValue, name: string, args: ReadonlyArray<BaseValue>): BaseValue {
  if (tagged(object, "file")) return fileMethod(object.doc, name, args);
  const holds = (needle: BaseValue): boolean => {
    if (typeof object === "string") return object.includes(display(needle));
    if (Array.isArray(object)) return object.some((item) => equals(item, needle));
    return false;
  };
  switch (name) {
    case "contains":
      return holds(args[0] ?? null);
    case "containsAll":
      return args.every(holds);
    case "containsAny":
      return args.some(holds);
    case "startsWith":
      return typeof object === "string" && object.startsWith(display(args[0] ?? null));
    case "endsWith":
      return typeof object === "string" && object.endsWith(display(args[0] ?? null));
    case "isEmpty":
      return (
        object === null ||
        object === "" ||
        (Array.isArray(object) && object.length === 0) ||
        (tagged(object, "object") && Object.keys(object.entries).length === 0)
      );
    case "lower":
      return typeof object === "string" ? object.toLowerCase() : null;
    default:
      return null;
  }
}

function global(name: string, args: ReadonlyArray<BaseValue>, scope: BaseScope): BaseValue {
  const first = args[0] ?? null;
  switch (name) {
    case "date": {
      const time = timeOf(first);
      return time === undefined ? null : { kind: "date", time };
    }
    case "now":
      return { kind: "date", time: scope.now };
    case "today": {
      const day = new Date(scope.now);
      day.setHours(0, 0, 0, 0);
      return { kind: "date", time: day.getTime() };
    }
    case "link": {
      if (isNoteLike(first)) return { kind: "link", target: noteNameOf(first) };
      return typeof first === "string" ? { kind: "link", target: linkTarget(unwrap(first)) } : null;
    }
    case "list":
      return first === null ? [] : Array.isArray(first) ? first : [first];
    default:
      return null;
  }
}

const unwrap = (text: string) => WIKILINK.exec(text.trim())?.[1] ?? text;
const noteNameOf = (value: LinkValue | FileValue | ThisValue) =>
  value.kind === "link" ? value.target : value.doc.name;

function arithmetic(op: string, a: BaseValue, b: BaseValue): BaseValue {
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
  if (tagged(a, "date") && typeof b === "string" && (op === "+" || op === "-")) {
    const time = shift(a.time, b, op === "+" ? 1 : -1);
    return time === undefined ? null : { kind: "date", time };
  }
  if (op === "+" && (typeof a === "string" || typeof b === "string")) {
    return display(a) + display(b);
  }
  return null;
}

export function evaluate(expr: Expr, scope: BaseScope, source: string): BaseValue {
  const run = (node: Expr): BaseValue => {
    switch (node.kind) {
      case "literal":
        return node.value;
      case "list":
        return node.items.map(run);
      case "name":
        switch (node.name) {
          case "file":
            return { kind: "file", doc: scope.row };
          case "note":
            return { kind: "object", entries: scope.row.properties };
          case "this":
            if (!scope.self) {
              throw new BaseError(
                `\`this\` needs the note or base the query runs in: \`${source}\`.`,
              );
            }
            return { kind: "this", doc: scope.self };
          default:
            return noteProperty(scope.row, node.name);
        }
      case "member":
        return member(run(node.object), node.name, scope);
      case "index": {
        const object = run(node.object);
        const index = run(node.index);
        if (Array.isArray(object) && typeof index === "number") return object[index] ?? null;
        if (typeof index !== "string") return null;
        if (tagged(object, "this")) return noteProperty(object.doc, index);
        return tagged(object, "object") ? fromProperty(object.entries[index]) : null;
      }
      case "call": {
        const args = node.args.map(run);
        const { callee } = node;
        if (callee.kind === "name") return global(callee.name, args, scope);
        if (callee.kind === "member") return method(run(callee.object), callee.name, args);
        return null;
      }
      case "unary": {
        const operand = run(node.operand);
        if (node.op === "!") return !truthy(operand);
        return typeof operand === "number" ? -operand : null;
      }
      case "binary": {
        if (node.op === "&&") return truthy(run(node.left)) && truthy(run(node.right));
        if (node.op === "||") return truthy(run(node.left)) || truthy(run(node.right));
        const left = run(node.left);
        const right = run(node.right);
        switch (node.op) {
          case "==":
            return equals(left, right);
          case "!=":
            return !equals(left, right);
          case "<":
          case ">":
          case "<=":
          case ">=": {
            const compared = order(left, right);
            if (compared === undefined) return false;
            if (node.op === "<") return compared < 0;
            if (node.op === ">") return compared > 0;
            return node.op === "<=" ? compared <= 0 : compared >= 0;
          }
          default:
            return arithmetic(node.op, left, right);
        }
      }
    }
  };
  return run(expr);
}
