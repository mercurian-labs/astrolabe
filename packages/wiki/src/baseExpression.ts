/**
 * Obsidian's Bases expression language: parsing, checking every name against the functions it
 * knows, and evaluating. An unknown function or field fails loudly, even in a branch no file
 * reaches; a function given the wrong type makes an error cell, as Obsidian shows one.
 */
import {
  arithmetic,
  callGlobal,
  callMethod,
  FILE_FIELDS,
  GLOBALS,
  index as indexValue,
  member,
  METHODS,
  noteProperty,
  type BaseScope,
} from "./baseFunctions.ts";
import { BaseError, equals, order, tagged, truthy, isList, type BaseValue } from "./baseValues.ts";
import { key, noteName } from "./links.ts";

export { BaseError } from "./baseValues.ts";

export const unsupported = (what: string, where: string, why?: string): BaseError =>
  new BaseError(`Not supported: ${what}${why ? ` (${why})` : ""} in ${where}.`);

type Token =
  | { readonly kind: "number"; readonly value: number; readonly at: number; readonly end: number }
  | { readonly kind: "string"; readonly value: string; readonly at: number; readonly end: number }
  | { readonly kind: "name"; readonly value: string; readonly at: number; readonly end: number }
  | { readonly kind: "op"; readonly value: string; readonly at: number; readonly end: number }
  | {
      readonly kind: "regex";
      readonly source: string;
      readonly flags: string;
      readonly at: number;
      readonly end: number;
    }
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
const FLAGS = /[a-z]*/y;
const ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r" };

/** Whether a `/` here divides, rather than opening a regular expression. */
const divides = (previous: Token | undefined): boolean =>
  previous !== undefined &&
  (previous.kind === "number" ||
    previous.kind === "string" ||
    previous.kind === "name" ||
    previous.kind === "regex" ||
    (previous.kind === "op" && (previous.value === ")" || previous.value === "]")));

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
    if (char === "/" && !divides(tokens.at(-1))) {
      let end = at + 1;
      let inClass = false;
      for (; end < source.length; end++) {
        const next = source[end];
        if (next === "\\") end++;
        else if (next === "[") inClass = true;
        else if (next === "]") inClass = false;
        else if (next === "/" && !inClass) break;
      }
      if (end >= source.length) throw new BaseError(`Unclosed regular expression in ${where}.`);
      FLAGS.lastIndex = end + 1;
      const flags = FLAGS.exec(source)?.[0] ?? "";
      try {
        RegExp(source.slice(at + 1, end), flags);
      } catch {
        throw new BaseError(`Invalid regular expression in ${where}.`);
      }
      tokens.push({
        kind: "regex",
        source: source.slice(at + 1, end),
        flags,
        at,
        end: FLAGS.lastIndex,
      });
      at = FLAGS.lastIndex;
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
    | { readonly kind: "regex"; readonly source: string; readonly flags: string }
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
      case "regex":
        return { kind: "regex", source: token.source, flags: token.flags, ...span };
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

export interface CompileContext {
  /** The base's formulas, by name; `formula.x` must name one of them. */
  readonly formulas: ReadonlySet<string>;
}

/** Throws for a function, method, field or formula the language doesn't have, naming it. */
function check(expr: Expr, source: string, where: string, context: CompileContext): void {
  const text = (node: Expr) => source.slice(node.from, node.to);
  const visit = (node: Expr): void => {
    switch (node.kind) {
      case "literal":
      case "regex":
        return;
      case "list":
        return node.items.forEach(visit);
      case "name":
        if (node.name === "formula") throw new BaseError(`\`formula\` needs a name in ${where}.`);
        return;
      case "member":
        if (node.object.kind === "name" && node.object.name === "formula") {
          if (!context.formulas.has(node.name)) {
            throw new BaseError(`No formula named “${node.name}” in ${where}.`);
          }
          return;
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
          if (!METHODS.has(callee.name)) throw unsupported(`${text(callee)}()`, where);
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

/** Parses an expression without checking it, to read it rather than run it. */
export const parseExpression = (source: string, where: string): Expr =>
  new Parser(tokenize(source, where), source, where).parse();

/** Parses an expression and checks every name in it; `where` names it in errors. */
export function compileExpression(
  source: string,
  where: string,
  context: CompileContext = { formulas: new Set() },
): Expr {
  const expression = parseExpression(source, where);
  check(expression, source, where, context);
  return expression;
}

/** A text literal that names a note, and where it sits in the expression, quotes included. */
export interface NoteReference {
  readonly name: string;
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

type TextLiteral = Expr & { readonly kind: "literal"; readonly value: string };
const isText = (node: Expr | undefined): node is TextLiteral =>
  node?.kind === "literal" && typeof node.value === "string";
const isNameField = (node: Expr): boolean =>
  node.kind === "member" &&
  (node.name === "name" || node.name === "basename") &&
  isFileRef(node.object);

/**
 * The literals that can only mean a note: `[[links]]`, the argument of `link()` and of a file's
 * `hasLink()`, and text compared with `file.name` or `file.basename`.
 */
export function noteReferences(expr: Expr): ReadonlyArray<NoteReference> {
  const found = new Set<TextLiteral>();
  const visit = (node: Expr): void => {
    switch (node.kind) {
      case "literal":
        if (isText(node) && WIKILINK.test(node.value.trim())) found.add(node);
        return;
      case "regex":
      case "name":
        return;
      case "list":
        return node.items.forEach(visit);
      case "member":
        return visit(node.object);
      case "index":
        visit(node.object);
        return visit(node.index);
      case "call": {
        const { callee } = node;
        const first = node.args[0];
        const naming =
          (callee.kind === "name" && callee.name === "link") ||
          (callee.kind === "member" && callee.name === "hasLink" && isFileRef(callee.object));
        if (naming && isText(first)) found.add(first);
        visit(callee);
        return node.args.forEach(visit);
      }
      case "unary":
        return visit(node.operand);
      case "binary":
        if (node.op === "==" || node.op === "!=") {
          if (isNameField(node.left) && isText(node.right)) found.add(node.right);
          if (isNameField(node.right) && isText(node.left)) found.add(node.left);
        }
        visit(node.left);
        return visit(node.right);
    }
  };
  visit(expr);
  return [...found]
    .map((node) => ({
      name: linkTarget(unwrap(node.value)),
      text: node.value,
      from: node.from,
      to: node.to,
    }))
    .toSorted((a, b) => a.from - b.from);
}

/** `text` naming `to` instead, keeping a link's brackets, alias and heading, and any `.md`. */
function renamedText(text: string, to: string): string {
  const link = WIKILINK.exec(text.trim());
  const inner = link?.[1] ?? text.trim();
  const boundary = link ? inner.search(/[#|]/) : -1;
  const suffix = boundary < 0 ? "" : inner.slice(boundary);
  const target = boundary < 0 ? inner : inner.slice(0, boundary);
  const named = `${to}${/\.md\s*$/i.test(target) ? ".md" : ""}${suffix}`;
  return link ? `[[${named}]]` : named;
}

const quoted = (text: string, quote: string): string =>
  quote +
  text
    .replace(/\\/g, "\\\\")
    .replaceAll(quote, `\\${quote}`)
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t") +
  quote;

/**
 * The expression with every literal that names the note `from` naming `to` instead. An
 * expression that doesn't parse comes back unchanged.
 */
export function renameInExpression(source: string, from: string, to: string): string {
  let expression: Expr;
  try {
    expression = parseExpression(source, "a renamed base");
  } catch {
    return source;
  }
  let output = source;
  for (const reference of noteReferences(expression).toReversed()) {
    if (key(reference.name) !== key(from)) continue;
    output =
      output.slice(0, reference.from) +
      quoted(renamedText(reference.text, to), source[reference.from] ?? '"') +
      output.slice(reference.to);
  }
  return output;
}

const WIKILINK = /^\[\[([^\]]+)\]\]$/;
const linkTarget = (text: string): string =>
  noteName((text.split("|")[0] ?? "").split("#")[0]?.trim() ?? "");
const unwrap = (text: string) => WIKILINK.exec(text.trim())?.[1] ?? text;

const LAZY_METHODS = new Set(["filter", "map", "reduce"]);

export function evaluate(expr: Expr, scope: BaseScope, source: string): BaseValue {
  const run = (node: Expr, here: BaseScope): BaseValue => {
    switch (node.kind) {
      case "literal":
        return node.value;
      case "regex":
        return { kind: "regex", pattern: new RegExp(node.source, node.flags) };
      case "list":
        return node.items.map((item) => run(item, here));
      case "name": {
        const local = here.locals?.[node.name];
        if (local !== undefined) return local;
        switch (node.name) {
          case "file":
            return { kind: "file", doc: here.row };
          case "note":
            return { kind: "object", entries: here.row.properties };
          case "this":
            if (!here.self) {
              throw new BaseError(
                `\`this\` needs the note or base the query runs in: \`${source}\`.`,
              );
            }
            return { kind: "this", doc: here.self };
          default:
            return noteProperty(here.row, node.name);
        }
      }
      case "member":
        if (node.object.kind === "name" && node.object.name === "formula") {
          return here.formula(node.name);
        }
        return member(run(node.object, here), node.name, here);
      case "index":
        return indexValue(run(node.object, here), run(node.index, here));
      case "call": {
        const { callee } = node;
        if (callee.kind === "name") {
          if (callee.name === "if") {
            const condition = run(node.args[0] ?? literalNull, here);
            if (tagged(condition, "error")) return condition;
            const branch = truthy(condition) ? node.args[1] : node.args[2];
            return branch === undefined ? null : run(branch, here);
          }
          return callGlobal(
            callee.name,
            node.args.map((arg) => run(arg, here)),
            here,
          );
        }
        if (callee.kind !== "member") return null;
        const object = run(callee.object, here);
        if (LAZY_METHODS.has(callee.name)) return lazyMethod(object, callee.name, node.args, here);
        return callMethod(
          object,
          callee.name,
          node.args.map((arg) => run(arg, here)),
          here,
        );
      }
      case "unary": {
        const operand = run(node.operand, here);
        if (tagged(operand, "error")) return operand;
        if (node.op === "!") return !truthy(operand);
        return typeof operand === "number" ? -operand : null;
      }
      case "binary": {
        if (node.op === "&&") return truthy(run(node.left, here)) && truthy(run(node.right, here));
        if (node.op === "||") return truthy(run(node.left, here)) || truthy(run(node.right, here));
        const left = run(node.left, here);
        const right = run(node.right, here);
        switch (node.op) {
          case "==":
            return equals(left, right, here.corpus.resolve);
          case "!=":
            return !equals(left, right, here.corpus.resolve);
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

  /** `filter`, `map` and `reduce`, whose arguments run once per item with `value` and `index`. */
  const lazyMethod = (
    object: BaseValue,
    name: string,
    args: ReadonlyArray<Expr>,
    here: BaseScope,
  ): BaseValue => {
    if (tagged(object, "error")) return object;
    if (!isList(object)) return null;
    const body = args[0];
    if (body === undefined) return null;
    const within = (locals: Record<string, BaseValue>): BaseScope => ({
      ...here,
      locals: { ...here.locals, ...locals },
    });
    if (name === "reduce") {
      let acc = args[1] === undefined ? null : run(args[1], here);
      object.forEach((value, index) => {
        acc = run(body, within({ value, index, acc }));
      });
      return acc;
    }
    const results = object.map((value, index) => run(body, within({ value, index })));
    return name === "map" ? results : object.filter((_, index) => truthy(results[index] ?? null));
  };

  return run(expr, scope);
}

const literalNull: Expr = { kind: "literal", value: null, from: 0, to: 0 };
